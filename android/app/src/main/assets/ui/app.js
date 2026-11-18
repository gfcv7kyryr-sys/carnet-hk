/* TravelOS — interface. Le contenu vient du paquet (pack.json + médias synchronisés) ;
   l'état sur place (étapes faites) et les fonctions de la tablette passent par le pont natif. */
"use strict";

const N = window.TravelOSNative || mockBridge();
const ZONE = "Asia/Hong_Kong";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = (s, d) => { try { return JSON.parse(s) ?? d; } catch { return d; } };
const store = {
  get: (k, d) => { try { const v = localStorage.getItem("tos." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("tos." + k, JSON.stringify(v)); } catch {} },
};

let P = null;                 // paquet de contenu
let states = {};              // état des étapes : { "j3:4": "DONE" }
let stack = [];               // historique de navigation du profil Pilote
const TONE = { hk: "hk", mo: "mo", sz: "sz", gz: "gz", ys: "li", li: "li", lt: "lt" };
const RV_ICON = { vol: "機", hotel: "床", train: "車", ferry: "船", resto: "食", activite: "票", voiture: "車" };
const TABS = { today: "Aujourd'hui", programme: "Programme", places: "Lieux", pocket: "Dans la poche", more: "Plus" };

/* ================= temps ================= */

const pad = (n) => String(n).padStart(2, "0");
function nowHK() {
  const sim = store.get("simDate", null);
  if (sim) {
    const [d, t = "09:00"] = sim.split("T");
    const [h, m] = t.split(":").map(Number);
    return { date: d, hm: `${pad(h)}:${pad(m)}`, minutes: h * 60 + m, sim: true };
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const h = Number(parts.hour), m = Number(parts.minute);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${pad(h)}:${pad(m)}`, minutes: h * 60 + m, sim: false };
}
const parisHM = () => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date());
const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const frDate = (iso, o = { weekday: "long", day: "numeric", month: "long" }) =>
  cap(new Date(utc(iso)).toLocaleDateString("fr-FR", { ...o, timeZone: "UTC" }));
const shortDate = (iso) => frDate(iso, { weekday: "short", day: "numeric", month: "short" });
const stepMinutes = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
const dur = (s) => `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;

/* ================= données ================= */

async function loadPack() {
  for (const url of ["/pack/travelos/pack/pack.json", "/assets/seed/pack.json"]) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch {}
  }
  throw new Error("Paquet introuvable");
}

const dayById = (id) => P.days.find((d) => d.id === id);
const placeById = (id) => P.places.find((p) => p.id === id);
const toneOf = (day) => TONE[day?.tone] || "hk";
let placeTone = {}, placeCity = {}, placeDays = {};
function indexPack() {
  placeTone = {}; placeCity = {}; placeDays = {};
  for (const d of P.days) {
    const ids = new Set([...d.steps.map((s) => s.placeId).filter(Boolean), ...d.visits.map((v) => v.id)]);
    for (const id of ids) {
      placeTone[id] ??= toneOf(d);
      placeCity[id] ??= d.city;
      (placeDays[id] ??= []).push(d.id);
    }
  }
}
const visitOf = (placeId) => { for (const d of P.days) { const v = d.visits.find((x) => x.id === placeId); if (v) return v; } return null; };
const status = (key) => states[key] || "PLANNED";
function setStatus(key, st) {
  if (st === "PLANNED") delete states[key]; else states[key] = st;
  N.setStepState(key, st);
}
const dayProgress = (d) => ({ done: d.steps.filter((s) => status(s.key) === "DONE").length, total: d.steps.length });

/* ================= rendu commun ================= */

function art(path, tone, glyph, cls = "") {
  const im = path ? `<img src="/pack/${esc(path)}" alt="" loading="lazy" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()">` : "";
  return `<div class="art tone-${tone} ${cls}"><span class="g">${esc(glyph || "")}</span>${im}</div>`;
}
function audioBtn(a, label) {
  if (!a || !a.src) return "";
  return `<button class="audio-btn" data-audio="${esc(a.src)}" data-title="${esc(label)}" data-sec="${a.seconds || 0}"><i>▶</i>${esc(label)}${a.seconds ? ` <small>${dur(a.seconds)}</small>` : ""}</button>`;
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ================= navigation ================= */

function go(tab, view = null, arg = null, push = true) {
  if (push) stack.push({ tab, view, arg });
  closeSheet(); closeShow();
  $$("#tabbar button").forEach((b, i) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    if (on) $("#lens").style.transform = `translateX(${i * 100}%)`;
  });
  const v = $("#view");
  const r = { today: viewToday, programme: view === "day" ? () => viewDay(arg) : viewProgramme, places: viewPlaces, pocket: () => viewPocket(arg), more: () => viewMore(arg) }[tab];
  v.innerHTML = `<div class="view">${r()}</div>`;
  $("#pageTitle").textContent = view === "day" ? `Jour ${dayById(arg)?.number} · ${dayById(arg)?.city}` : TABS[tab];
  window.scrollTo(0, 0);
  after[tab]?.(view, arg);
}
const after = {};
function back() {
  if (!$("#show").hidden) return closeShow();
  if (!$("#sheet").hidden) return closeSheet();
  if (!$("#kids").hidden || !$("#chooser").hidden) return;
  if (stack.length > 1) { stack.pop(); const s = stack[stack.length - 1]; return go(s.tab, s.view, s.arg, false); }
  if (stack[0]?.tab !== "today") { stack = []; go("today"); }
}
function onHome() {
  if (!$("#kids").hidden || !$("#chooser").hidden) return;
  stack = []; go("today");
}

/* ================= Aujourd'hui ================= */

function phase() {
  const now = nowHK();
  if (now.date < P.trip.startDate) return { kind: "before", now, left: daysBetween(now.date, P.trip.startDate), day: P.days[0] };
  if (now.date > P.trip.endDate) return { kind: "after", now };
  const day = P.days.find((d) => d.date === now.date) || P.days[0];
  const open = day.steps.filter((s) => s.dayOffset === 0 && ["PLANNED", "IN_PROGRESS"].includes(status(s.key)));
  const next = open.find((s) => { const m = stepMinutes(s.time); return m == null || m >= now.minutes - 30; }) || open[0] || null;
  return { kind: "during", now, day, next };
}

function viewToday() {
  const ph = phase();
  const d = ph.day || P.days[P.days.length - 1];
  const tone = toneOf(d);
  const dev = json(N.device(), {});
  const synced = N.hasSyncedPack();
  const chips = `<div class="chips">
    <span class="chip ${synced ? "" : "warn"}"><i></i>${synced ? "Contenu hors ligne prêt" : "Médias à synchroniser"}</span>
    <span class="chip ${dev.battery >= 0 && dev.battery <= 20 ? "warn" : ""}"><i></i>Batterie ${dev.battery ?? "?"} %${dev.charging ? " · en charge" : ""}</span>
    <span class="chip ${dev.network === "NONE" ? "off" : ""}"><i></i>${dev.airplane ? "Mode avion" : esc(dev.networkLabel || "")}</span>
    <span class="chip ${dev.gps ? "" : "warn"}"><i></i>${dev.gps ? "GPS actif" : "GPS coupé"}</span></div>`;

  let over, next;
  if (ph.kind === "before") {
    over = `<p class="eyebrow">Départ dans</p><div class="big">${ph.left}<small>${ph.left > 1 ? "jours" : "jour"}</small></div><p>${frDate(P.trip.startDate)} · Nice → Hong Kong</p>`;
    next = `<span class="k">Première journée</span><div class="time">${shortDate(d.date)}</div>
      <div class="txt"><b>${esc(d.title)}.</b> ${esc(d.lede)}</div>
      <div class="acts"><button class="pill red" data-day="${d.id}">Ouvrir la journée</button></div>`;
  } else if (ph.kind === "during") {
    over = `<p class="eyebrow">Jour ${d.number} · ${esc(d.city)}</p><div class="big" style="font-size:clamp(1.8rem,3.6vw,2.6rem)">${esc(d.title)}</div>`;
    const s = ph.next;
    next = s ? `<span class="k">Prochaine étape</span><div class="time">${esc(s.time)}</div>
      <div class="txt">${esc(s.text)}</div>
      <div class="acts"><button class="pill red" data-done="${s.key}">C'est fait</button>${s.placeId ? `<button class="pill" data-place="${s.placeId}">Fiche du lieu</button>` : ""}<button class="pill" data-day="${d.id}">La journée</button></div>`
      : `<span class="k">Journée terminée</span><div class="txt">Toutes les étapes du jour sont faites. Bonne soirée !</div><div class="acts"><button class="pill" data-day="${d.id}">Revoir la journée</button></div>`;
  } else {
    over = `<p class="eyebrow">Bon retour</p><div class="big">Le voyage est terminé</div>`;
    next = `<span class="k">Souvenirs</span><div class="txt">Les journées, les lieux et les audios restent disponibles.</div>`;
  }
  const quick = [
    ["日", "Journée", "gz", `data-day="${d.id}"`],
    ["票", "Billets", "mo", `data-pocket="resas"`],
    ["話", "Phrases", "li", `data-pocket="phrases"`],
    ["換", "Devises", "sz", `data-pocket="conv"`],
    ["救", "SOS", "gz", `data-pocket="sos"`],
    ["聽", "Récit du jour", "hk", d.audio ? `data-audio="${esc(d.audio.src)}" data-title="Jour ${d.number} · ${esc(d.city)}"` : `data-day="${d.id}"`],
  ].map(([g, l, t, a]) => `<button class="q tone-${t}" ${a}><span class="ic">${g}</span>${l}</button>`).join("");

  return `<section class="today">
    <div class="t-hero">${art(d.image, tone, d.glyph, "")}<div class="over glass">${chips}${over}</div></div>
    <div class="t-next">${next}</div>
    <div class="t-quick">${quick}</div>
  </section>`;
}

/* ================= Programme ================= */

function viewProgramme() {
  const today = nowHK().date;
  const cards = P.days.map((d) => {
    const pr = dayProgress(d);
    return `<button class="card ${d.date === today ? "today-card" : ""}" data-day="${d.id}">
      ${art(d.image, toneOf(d), d.glyph)}
      <div class="cap"><small>Jour ${d.number} · ${shortDate(d.date)} · ${esc(d.city)}</small><b>${esc(d.title)}</b>
      <span>${pr.done ? `${pr.done}/${pr.total} étapes faites` : `${pr.total} étapes`}</span></div></button>`;
  }).join("");
  return `<header class="hero-t"><p class="eyebrow">${P.days.length} journées · ${shortDate(P.days[0].date)} → ${shortDate(P.trip.endDate)}</p>
    <h1 class="display">Le programme</h1><p class="sub">Chaque journée, heure par heure. Cochez les étapes au fil de la journée : rien n'est imposé.</p></header>
    <div class="grid">${cards}</div>`;
}

function viewDay(id) {
  const d = dayById(id);
  if (!d) return `<p>Journée introuvable.</p>`;
  const tone = toneOf(d);
  const ph = phase();
  const nowKey = ph.kind === "during" && ph.day.id === d.id ? ph.next?.key : null;
  const steps = d.steps.map((s) => {
    const st = status(s.key);
    const pl = s.placeId && placeById(s.placeId);
    return `<li class="step ${st === "DONE" ? "done" : st === "SKIPPED" ? "skipped" : ""} ${s.key === nowKey ? "now" : ""}">
      <button class="chk" data-toggle="${s.key}" aria-label="Marquer comme faite"></button>
      <div class="h">${esc(s.time)}${s.dayOffset ? `<small>${s.dayOffset < 0 ? "la veille" : "le lendemain"}</small>` : ""}</div>
      <div class="x">${esc(s.text)}</div>
      <div class="acts">${pl ? `<button class="pill" data-place="${pl.id}">Fiche du lieu</button><button class="pill ghost" data-map="${pl.id}">Y aller ›</button>` : ""}
        <button class="pill ghost" data-skip="${s.key}">${st === "SKIPPED" ? "Rétablir" : "Ignorer"}</button></div></li>`;
  }).join("");
  const list = (title, items, cls = "") => items.length ? `<div class="tile ${cls}"><h3>${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const visits = d.visits.length ? `<section class="sec"><div class="sec-h"><h2 class="h2">Les visites</h2></div><div class="rail">${d.visits.map((v) =>
    `<button class="card" data-place="${v.id}">${art(v.image, tone, v.nameZh?.slice(0, 1))}<div class="cap"><b>${esc(v.name)}</b><span>${esc(v.summary)}</span></div></button>`).join("")}</div></section>` : "";
  const meals = d.meals.length ? `<section class="sec"><h2 class="h2">À table</h2><div class="bento">${d.meals.map((m) => `<div class="tile">
      <span class="k">${esc(m.label)}${m.time ? ` · ${esc(m.time)}` : ""}</span><p>${esc(m.zone)}</p>
      ${m.options.slice(0, 3).map((o) => `<div style="display:grid;grid-template-columns:72px 1fr;gap:12px;align-items:center;margin-top:6px">
        ${art(o.image, tone, o.glyph, "").replace('class="art', 'style="width:72px;height:72px;border-radius:16px" class="art')}
        <div><b>${esc(o.name)}</b> <small class="muted">${esc(o.category)}</small><p style="font-size:.92rem">${esc(o.summary)}</p></div></div>`).join("")}
    </div>`).join("")}</div></section>`
    : (d.mealNotes.length ? `<section class="sec"><h2 class="h2">À table</h2>${list("Repas", d.mealNotes)}</section>` : "");

  return `<div><button class="pill" data-back>‹ Programme</button></div>
    <header class="daytop tone-${tone}">
      <p class="eyebrow">Jour ${d.number} · ${frDate(d.date)} · ${esc(d.city)} <span class="han muted">${esc(d.cityZh)}</span></p>
      <h1 class="h2">${esc(d.title)}</h1>
      <p class="prose">${esc(d.lede)}</p>
      ${art(d.image, tone, d.glyph)}
      <div class="acts">${audioBtn(d.audio, "Écouter la journée")}</div>
    </header>
    <div class="two">
      <section class="sec"><h2 class="h3">Heure par heure</h2><ul class="steps">${steps}</ul></section>
      <aside class="sec" style="gap:16px">${list("Pour Charlie", d.charlie, `tone tone-${tone}`)}${list("Bon à savoir", d.tips)}${list("Les photos", d.photos)}${list("Plan B", d.planB)}</aside>
    </div>${visits}${meals}`;
}

/* ================= Fiche d'un lieu ================= */

function openPlace(id) {
  const p = placeById(id);
  if (!p) return;
  const v = visitOf(id);
  const tone = placeTone[id] || "hk";
  const days = (placeDays[id] || []).map(dayById).filter(Boolean);
  const tracks = (p.audio || []).filter(Boolean);
  const sec = (t, x) => x ? `<div class="fsec"><h3>${t}</h3><p>${esc(x)}</p></div>` : "";
  $("#sheetTitle").textContent = placeCity[id] || "";
  $("#sheetBody").innerHTML = `${art(p.image, tone, p.nameZh.slice(0, 1), "fhero")}
    <div class="fhead"><p class="k">${esc(placeCity[id] || "")}</p><h2>${esc(v?.name || p.name)}</h2><p class="fzh">${esc(p.nameZh)}</p></div>
    ${tracks.length ? `<div class="acts">${tracks.map((a, i) => audioBtn(a, tracks.length > 1 ? `Audioguide ${i + 1}` : "Audioguide")).join("")}</div>` : ""}
    ${v?.summary ? `<p class="flede">${esc(v.summary)}</p>` : ""}
    ${sec("L'histoire", v?.history)}${sec("À remarquer", v?.remark)}${sec("La photo", v?.photo)}
    <div class="acts"><button class="pill red" data-showtext="${esc(p.nameZh)}" data-showfr="${esc(p.name)}">Montrer au chauffeur</button>
      <button class="pill" data-map="${p.id}">Ouvrir dans une carte</button></div>
    ${days.length ? `<div class="fsec"><h3>Au programme</h3><div class="acts">${days.map((d) => `<button class="pill" data-day="${d.id}">Jour ${d.number} · ${esc(d.city)}</button>`).join("")}</div></div>` : ""}
    <p class="muted" style="font-size:.85rem">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (WGS-84)</p>`;
  $("#sheet").hidden = false;
  $("#sheet").scrollTop = 0;
}
function closeSheet() { $("#sheet").hidden = true; }

/* ================= Lieux ================= */

function viewPlaces() {
  const cities = [...new Set(P.days.map((d) => d.city))];
  return `<header class="hero-t"><p class="eyebrow">${P.places.length} lieux</p><h1 class="display">Les lieux</h1></header>
    <div class="sec"><input class="search" id="placeSearch" placeholder="Chercher un lieu, en français ou en chinois" autocomplete="off">
    <div class="seg" id="citySeg"><button class="on" data-city="">Tous</button>${cities.map((c) => `<button data-city="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="pgrid" id="placeGrid"></div></div>`;
}
after.places = () => {
  let city = "";
  const draw = () => {
    const q = ($("#placeSearch").value || "").trim().toLowerCase();
    const list = P.places.filter((p) => (!city || placeCity[p.id] === city) && (!q || p.name.toLowerCase().includes(q) || p.nameZh.includes(q)));
    $("#placeGrid").innerHTML = list.map((p) => `<button class="pcard" data-place="${p.id}">${art(p.image, placeTone[p.id] || "hk", p.nameZh.slice(0, 1))}<b>${esc(p.name)}</b><small>${esc(p.nameZh)}</small></button>`).join("")
      || `<p class="muted">Aucun lieu.</p>`;
  };
  $("#placeSearch").addEventListener("input", draw);
  $("#citySeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    city = b.dataset.city; $$("#citySeg button").forEach((x) => x.classList.toggle("on", x === b)); draw();
  });
  draw();
};

/* ================= Poche ================= */

const POCKET = [["resas", "Billets"], ["hotels", "Hôtels"], ["phrases", "Phrases"], ["conv", "Devises"], ["signs", "Panneaux"], ["sos", "SOS"]];
function viewPocket(seg) {
  seg = seg || store.get("pocketSeg", "resas");
  store.set("pocketSeg", seg);
  const body = { resas: pocketResas, hotels: pocketHotels, phrases: pocketPhrases, conv: pocketConv, signs: pocketSigns, sos: pocketSos }[seg]();
  return `<header class="hero-t small"><h1 class="display">Dans la poche</h1></header>
    <div class="sec"><div style="text-align:center"><div class="seg">${POCKET.map(([k, l]) => `<button class="${k === seg ? "on" : ""}" data-pocket="${k}">${l}</button>`).join("")}</div></div>${body}</div>`;
}
function pocketResas() {
  const todo = P.checklist.filter((c) => !c.done);
  const byDate = {};
  for (const r of P.reservations) (byDate[r.date] ??= []).push(r);
  const rows = Object.keys(byDate).sort().map((date) => `<h3 class="dayhead">${frDate(date)}</h3><ul class="rows">${byDate[date].map((r) => `<li class="row">
      <span class="ic">${RV_ICON[r.type] || "票"}</span>
      <div><b>${esc(r.time)} · ${esc(r.title)}</b><small>${esc(r.detail)}</small>${r.where ? `<small>${esc(r.where)}</small>` : ""}</div>
      <span class="st ${esc(r.status)}">${esc(r.statusLabel)}</span></li>`).join("")}</ul>`).join("");
  const open = store.get("checkOpen", false);
  const shown = open ? todo : todo.slice(0, 4);
  const check = todo.length ? `<div class="tile"><h3>Avant le départ · ${todo.length} à faire</h3><ul class="check">${shown.map((c) => `<li><span>${esc(c.title)}</span><small>${esc(c.when)}</small></li>`).join("")}</ul>
    ${todo.length > 4 ? `<div class="acts"><button class="pill" id="checkMore">${open ? "Réduire" : `Voir les ${todo.length}`}</button></div>` : ""}</div>` : "";
  return `${check}<div>${rows}</div>`;
}
function pocketHotels() {
  return `<div class="bento">${P.hotels.map((h) => `<div class="tile"><span class="k">Jusqu'au ${shortDate(h.date)}</span>
    <h3>${esc(h.name)}</h3><div class="han" style="font-size:2rem;line-height:1.2">${esc(h.nameZh)}</div>
    <p class="han">${esc(h.addressZh)}</p>${h.phone ? `<p>${esc(h.phone)}</p>` : ""}
    <div class="acts"><button class="pill red" data-showtext="${esc(h.nameZh)}" data-showalt="${esc(h.addressZh)}" data-showfr="${esc(h.name)}">Montrer au chauffeur</button></div></div>`).join("")}</div>`;
}
function pocketPhrases() {
  const lang = store.get("phrLang", "yue");
  return `<div style="text-align:center"><div class="seg" id="langSeg"><button class="${lang === "yue" ? "on" : ""}" data-lang="yue">Cantonais (Hong Kong, Macao, Canton)</button><button class="${lang === "cmn" ? "on" : ""}" data-lang="cmn">Mandarin (Chine)</button></div></div>
    <div>${P.phrases.map((p) => { const zh = lang === "yue" ? p.zhHant || p.zhHans : p.zhHans; const pr = lang === "yue" ? p.jyutping : p.pinyin;
      return `<button class="phr" data-showtext="${esc(zh)}" data-showfr="${esc(p.fr)}" data-showalt="${esc(pr)}"><span><span class="fr">${esc(p.fr)}</span><br><span class="zh">${esc(zh)}</span> <span class="pr">${esc(pr)}</span></span><span class="pill">Montrer</span></button>`; }).join("")}</div>`;
}
function rates() { return { ...P.rates, ...store.get("rates", {}) }; }
function pocketConv() {
  const r = rates();
  const cur = store.get("convCur", "HKD");
  return `<div class="tile conv"><h3>Convertisseur</h3>
    <div class="conv-in"><input id="convAmount" type="number" inputmode="decimal" value="${store.get("convAmount", 100)}">
      <div class="seg" id="convCur">${["EUR", "HKD", "MOP", "CNY"].map((c) => `<button class="${c === cur ? "on" : ""}" data-cur="${c}">${c}</button>`).join("")}</div></div>
    <div class="conv-out" id="convOut"></div>
    <div class="rates">1 € = <label>HK$ <input data-rate="HKD" value="${r.HKD}"></label><label>MOP <input data-rate="MOP" value="${r.MOP}"></label><label>¥ <input data-rate="CNY" value="${r.CNY}"></label></div>
    <p style="font-size:.9rem">Taux enregistrés${r.asOf ? ` (${esc(r.asOf)})` : ""}, modifiables à la main : ce n'est pas un taux en temps réel.</p></div>`;
}
function pocketSigns() {
  const grid = (items, a, b) => `<div class="signs">${items.map((x) => `<button data-showtext="${esc(x[a])}" data-showfr="${esc(x[b])}"><span class="zh">${esc(x[a])}</span><small>${esc(x[b])}</small></button>`).join("")}</div>`;
  return `<section class="sec"><h2 class="h3">Panneaux</h2>${grid(P.signs, "zh", "fr")}</section>
    <section class="sec"><h2 class="h3">Les nombres</h2>${grid(P.numbers, "zh", "fr")}</section>
    <section class="sec"><h2 class="h3">Dim sum</h2>${grid(P.dimsum.map((x) => ({ zh: x.zh, fr: `${x.roman} · ${x.fr}` })), "zh", "fr")}</section>`;
}
function pocketSos() {
  const e = P.emergency;
  return `<div class="tile tone tone-gz"><h3>Je suis perdu</h3><p class="han" style="font-size:1.6rem">${esc(e.lost.zh)}</p><p>${esc(e.lost.fr)}</p>
      <div class="acts"><button class="pill" style="background:#fff;color:#C4161C" data-showtext="${esc(e.lost.zh)}" data-showfr="${esc(e.lost.fr)}">Montrer</button></div></div>
    <div class="sos">${e.numbers.map((n) => `<div class="n"><span><b style="font-size:1rem;color:var(--muted)">${esc(n.region)}</b><br>${esc(n.label)}</span><b>${esc(n.number)}</b></div>`).join("")}</div>
    <div class="bento">${e.consulates.map((c) => `<div class="tile"><h3>${esc(c.name)}</h3><p><b>${esc(c.phone)}</b></p><p>${esc(c.address)}</p>${c.addressZh ? `<p class="han">${esc(c.addressZh)}</p>` : ""}</div>`).join("")}</div>
    ${pocketHotels()}`;
}
after.pocket = () => {
  $("#checkMore")?.addEventListener("click", () => { store.set("checkOpen", !store.get("checkOpen", false)); go("pocket", null, "resas", false); });
  $("#langSeg")?.addEventListener("click", (e) => { const b = e.target.closest("[data-lang]"); if (b) { store.set("phrLang", b.dataset.lang); go("pocket", null, "phrases", false); } });
  if (!$("#convOut")) return;
  const draw = () => {
    const r = rates();
    const amount = parseFloat($("#convAmount").value.replace(",", ".")) || 0;
    const cur = store.get("convCur", "HKD");
    const eur = cur === "EUR" ? amount : amount / r[cur];
    const fmt = (n) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: n < 100 ? 2 : 0 });
    $("#convOut").innerHTML = ["EUR", "HKD", "MOP", "CNY"].filter((c) => c !== cur)
      .map((c) => `<div><small>${c}</small><b>${fmt(c === "EUR" ? eur : eur * r[c])}</b></div>`).join("");
    store.set("convAmount", amount);
  };
  $("#convAmount").addEventListener("input", draw);
  $("#convCur").addEventListener("click", (e) => { const b = e.target.closest("[data-cur]"); if (!b) return; store.set("convCur", b.dataset.cur); $$("#convCur button").forEach((x) => x.classList.toggle("on", x === b)); draw(); });
  $$("[data-rate]").forEach((i) => i.addEventListener("change", () => {
    const v = parseFloat(i.value.replace(",", "."));
    if (v > 0) { const saved = store.get("rates", {}); saved[i.dataset.rate] = v; saved.asOf = `saisi le ${new Date().toLocaleDateString("fr-FR")}`; store.set("rates", saved); }
    draw();
  }));
  draw();
};

/* ================= Plus ================= */

const MORE = [["content", "Contenu"], ["apps", "Applications"], ["device", "Tablette"], ["settings", "Réglages"]];
function viewMore(seg) {
  seg = seg || store.get("moreSeg", "content");
  store.set("moreSeg", seg);
  const body = { content: moreContent, apps: moreApps, device: moreDevice, settings: moreSettings }[seg]();
  return `<header class="hero-t small"><h1 class="display">Plus</h1></header>
    <div class="sec"><div style="text-align:center"><div class="seg">${MORE.map(([k, l]) => `<button class="${k === seg ? "on" : ""}" data-more="${k}">${l}</button>`).join("")}</div></div>${body}</div>`;
}
function moreContent() {
  return `<div class="tile"><h3>Contenu du voyage</h3>
    <p>Textes, images et audios viennent du carnet de route. Ils se téléchargent une fois en Wi-Fi (environ 90 Mo la première fois, puis seulement ce qui a changé) et restent ensuite disponibles sans réseau.</p>
    <ul class="kv" id="syncKv"></ul><div class="progress" id="syncBar" hidden><i></i></div>
    <div class="acts"><button class="pill red" id="syncBtn">Synchroniser maintenant</button><button class="pill" data-settings="wifi">Réglages Wi-Fi</button></div></div>`;
}
function moreApps() {
  const apps = json(N.apps(), []);
  return `<p class="sub" style="margin:0 auto;text-align:center">TravelOS est l'écran d'accueil : les autres applications s'ouvrent d'ici.</p>
    <div class="apps">${apps.map((a) => `<button class="app" data-app="${esc(a.pkg)}"><img src="/appicon/${esc(a.pkg)}.png" alt="">${esc(a.label)}</button>`).join("")}</div>`;
}
function moreDevice() {
  const d = json(N.device(), {});
  const f = (n) => (typeof n === "number" ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "?");
  return `<div class="bento"><div class="tile"><h3>Tablette</h3><ul class="kv">
      <li><span>Modèle</span><span>${esc(d.model)}</span></li><li><span>Android</span><span>${esc(d.android)} (API ${d.sdk})</span></li>
      <li><span>Mémoire vive</span><span>${f(d.ramGb)} Go</span></li><li><span>Stockage libre</span><span>${f(d.freeGb)} Go sur ${f(d.totalGb)} Go</span></li>
      <li><span>Services Google</span><span>${d.playServices ? "présents, non utilisés" : "absents"}</span></li><li><span>Puce GNSS</span><span>${esc(d.gnss)}</span></li>
      <li><span>Version TravelOS</span><span>${esc(N.version())}</span></li></ul></div>
    <div class="tile"><h3>Test GPS sans Google</h3><p>La puce GPS seule : dehors, Wi-Fi coupé, pour une mesure réaliste.</p>
      <ul class="kv" id="gpsKv"></ul><div class="acts"><button class="pill red" id="gpsBtn">Lancer le test</button></div></div></div>`;
}
function moreSettings() {
  const home = N.isDefaultHome();
  const sim = store.get("simDate", "");
  return `<div class="bento">
    <div class="tile"><h3>Écran d'accueil</h3><p>${home ? "TravelOS est l'écran d'accueil : la tablette démarre sur le choix du profil." : "Pour démarrer la tablette sur TravelOS, choisissez-le comme application d'accueil."}</p>
      <div class="acts"><button class="pill ${home ? "" : "red"}" data-settings="home">${home ? "Changer d'écran d'accueil" : "Choisir TravelOS"}</button><button class="pill" data-settings="android">Réglages Android</button></div></div>
    <div class="tile"><h3>Verre</h3><p>Le verre transparent peut être remplacé par un fond mat si l'affichage ralentit.</p>
      <div class="seg" id="glassSeg"><button class="${store.get("matte", false) ? "" : "on"}" data-matte="0">Transparent</button><button class="${store.get("matte", false) ? "on" : ""}" data-matte="1">Mat</button></div></div>
    <div class="tile"><h3>Simuler une date</h3><p>Pour essayer l'accueil comme pendant le voyage. Heure de Hong Kong.</p>
      <input class="search" id="simDate" type="datetime-local" value="${esc(sim)}" min="2027-02-20T00:00" max="2027-03-06T23:59">
      <div class="acts"><button class="pill" id="simReset">Revenir à la date réelle</button></div></div>
    <div class="tile"><h3>Profil</h3><p>Revenir à l'écran « Qui voyage ? ».</p><div class="acts"><button class="pill" id="toChooser">Changer de profil</button></div></div></div>`;
}
after.more = () => {
  if ($("#syncKv")) {
    const draw = () => {
      const s = json(N.syncState(), {});
      const mb = (b) => `${(b / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
      $("#syncKv").innerHTML = `<li><span>Version</span><span>${esc(s.packVersion || "aucune synchro")}</span></li>
        <li><span>Fichiers sur la tablette</span><span>${s.localFiles} · ${mb(s.localBytes)}</span></li>
        <li><span>Dernière synchro</span><span>${s.lastSync ? new Date(s.lastSync).toLocaleString("fr-FR") : "jamais"}</span></li>
        ${s.running ? `<li><span>En cours</span><span>${s.filesDone}/${s.filesTotal} · ${mb(s.bytesDone)} / ${mb(s.bytesTotal)}</span></li>` : ""}
        ${s.message && !s.running ? `<li><span>État</span><span>${esc(s.message)}</span></li>` : ""}
        ${s.error ? `<li><span>Erreur</span><span style="color:var(--red-ink)">${esc(s.error)}</span></li>` : ""}`;
      $("#syncBar").hidden = !s.running;
      $("#syncBar i").style.width = s.bytesTotal ? `${(100 * s.bytesDone) / s.bytesTotal}%` : "0";
      $("#syncBtn").textContent = s.running ? "Synchronisation…" : "Synchroniser maintenant";
      return s;
    };
    const poll = () => { if (!$("#syncKv")) return; const s = draw(); if (s.running) setTimeout(poll, 600); else if (poll.was) { poll.was = false; reloadPack(); } };
    $("#syncBtn").addEventListener("click", () => { N.startSync(); poll.was = true; setTimeout(poll, 300); });
    poll();
  }
  if ($("#gpsKv")) {
    const draw = () => {
      const g = json(N.gpsState(), {});
      const s = (ms) => (ms == null ? "…" : `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`);
      $("#gpsKv").innerHTML = `<li><span>Autorisation</span><span>${N.hasLocationPermission() ? "accordée" : "à accorder"}</span></li>
        ${g.running || g.firstFixMs != null ? `<li><span>Temps écoulé</span><span>${s(g.elapsedMs)}</span></li><li><span>Premier point</span><span>${g.firstFixMs != null ? s(g.firstFixMs) : "en attente…"}</span></li>
        <li><span>Satellites utilisés / vus</span><span>${g.satsUsed} / ${g.satsVisible}</span></li>` : ""}
        ${g.lat != null ? `<li><span>Position</span><span>${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}</span></li><li><span>Précision</span><span>± ${Math.round(g.accuracy || 0)} m</span></li>` : ""}
        ${g.error ? `<li><span>Erreur</span><span style="color:var(--red-ink)">${esc(g.error)}</span></li>` : ""}`;
      $("#gpsBtn").textContent = g.running ? "Arrêter le test" : "Lancer le test";
      return g;
    };
    const poll = () => { if (!$("#gpsKv")) { N.gpsStop(); return; } const g = draw(); if (g.running) setTimeout(poll, 500); };
    $("#gpsBtn").addEventListener("click", () => {
      const g = json(N.gpsState(), {});
      if (g.running) { N.gpsStop(); setTimeout(draw, 200); return; }
      if (!N.hasLocationPermission()) { N.requestLocationPermission(); return; }
      N.gpsStart(); setTimeout(poll, 300);
    });
    window.TravelOS.onPermission = () => { if (N.hasLocationPermission()) { N.gpsStart(); setTimeout(poll, 300); } else draw(); };
    draw();
  }
  $("#glassSeg")?.addEventListener("click", (e) => { const b = e.target.closest("[data-matte]"); if (!b) return; store.set("matte", b.dataset.matte === "1"); applyPrefs(); go("more", null, "settings", false); });
  $("#simDate")?.addEventListener("change", (e) => { store.set("simDate", e.target.value || null); toast(e.target.value ? "Date simulée" : "Date réelle"); tick(); });
  $("#simReset")?.addEventListener("click", () => { store.set("simDate", null); go("more", null, "settings", false); tick(); });
  $("#toChooser")?.addEventListener("click", showChooser);
};

/* ================= texte à montrer ================= */

function openShow(big, alt, fr) {
  $("#showBig").textContent = big; $("#showAlt").textContent = alt || ""; $("#showFr").textContent = fr || "";
  $("#show").hidden = false; N.keepScreenOn(true);
}
function closeShow() { if ($("#show").hidden) return; $("#show").hidden = true; N.keepScreenOn(false); }

/* ================= audio ================= */

const player = $("#player");
function playAudio(src, title) {
  player.src = `/pack/${src}`;
  $("#mpTitle").textContent = title || "Audio";
  $("#miniPlayer").hidden = false;
  player.play().catch(() => {});
}
player.addEventListener("timeupdate", () => {
  $("#mpProgress").style.width = player.duration ? `${(100 * player.currentTime) / player.duration}%` : "0";
  $("#mpTime").textContent = dur(player.currentTime || 0);
});
player.addEventListener("play", () => { $("#mpToggle").textContent = "❚❚"; });
player.addEventListener("pause", () => { $("#mpToggle").textContent = "▶"; });
player.addEventListener("error", () => { $("#miniPlayer").hidden = true; toast("Audio pas encore téléchargé : Plus › Contenu › Synchroniser."); });
$("#mpToggle").addEventListener("click", () => (player.paused ? player.play() : player.pause()));
$("#mpClose").addEventListener("click", () => { player.pause(); $("#miniPlayer").hidden = true; });

/* ================= clics ================= */

document.addEventListener("click", (e) => {
  const t = e.target.closest("button,[data-day],[data-place]");
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { stack = []; return go(d.tab); }
  if (d.day) return go("programme", "day", d.day);
  if (d.place) return openPlace(d.place);
  if (d.back !== undefined) return back();
  if (d.close !== undefined) return closeSheet();
  if (d.closeShow !== undefined) return closeShow();
  if (d.pocket) return go("pocket", null, d.pocket, stack[stack.length - 1]?.tab !== "pocket");
  if (d.more) return go("more", null, d.more, false);
  if (d.audio) return playAudio(d.audio, d.title);
  if (d.showtext) return openShow(d.showtext, d.showalt, d.showfr);
  if (d.map) { const p = placeById(d.map); if (p) N.openMap(p.lat, p.lng, p.name); return; }
  if (d.app) return N.launchApp(d.app);
  if (d.settings) return N.openSettings(d.settings);
  if (d.toggle) { setStatus(d.toggle, status(d.toggle) === "DONE" ? "PLANNED" : "DONE"); return refreshKeepScroll(); }
  if (d.skip) { setStatus(d.skip, status(d.skip) === "SKIPPED" ? "PLANNED" : "SKIPPED"); return refreshKeepScroll(); }
  if (d.done) { setStatus(d.done, "DONE"); toast("Étape cochée"); return go("today", null, null, false); }
});
function refreshKeepScroll() {
  const y = window.scrollY; const s = stack[stack.length - 1];
  go(s.tab, s.view, s.arg, false); window.scrollTo(0, y);
}

/* ================= profils ================= */

function showChooser() {
  player.pause(); $("#miniPlayer").hidden = true;
  $("#pilote").hidden = true; $("#kids").hidden = true; closeSheet(); closeShow();
  const last = store.get("lastProfile", null);
  $$(".profile").forEach((b) => b.classList.toggle("last", b.dataset.profile === last));
  $("#chooser").hidden = false;
}
$$(".profile").forEach((b) => b.addEventListener("click", () => {
  const p = b.dataset.profile;
  store.set("lastProfile", p);
  $("#chooser").hidden = true;
  if (p === "pilote") { $("#pilote").hidden = false; stack = []; go("today"); }
  else openKids();
}));
$("#switchProfile").addEventListener("click", showChooser);

function openKids() {
  $("#kids").hidden = false;
  const n = daysBetween(nowHK().date, P.trip.startDate);
  $("#kidsCount").textContent = n > 0 ? n : "C'est parti !";
  $("#kidsSleeps").textContent = n > 1 ? "dodos avant Hong Kong" : n === 1 ? "dodo avant Hong Kong" : "Xiao Long ouvre la valise";
}
// Sortie du profil Carnet : appui long (1,5 s) sur le dragon, pour éviter les sorties par accident.
(() => {
  let timer = null;
  const b = $("#kidsExit");
  const start = (e) => { e.preventDefault(); timer = setTimeout(showChooser, 1500); };
  const cancel = () => clearTimeout(timer);
  b.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, cancel));
})();

/* ================= démarrage ================= */

function applyPrefs() { document.body.classList.toggle("matte", !!store.get("matte", false)); }
function tick() {
  const n = nowHK();
  $("#clockHk").textContent = n.hm;
  const dev = json(N.device(), {});
  $("#clockSub").textContent = `${n.sim ? "simulé · " : "Hong Kong · "}Paris ${parisHM()} · ${dev.battery ?? "?"} %`;
}
async function reloadPack() {
  P = await loadPack(); indexPack();
  const s = stack[stack.length - 1]; if (s && !$("#pilote").hidden) go(s.tab, s.view, s.arg, false);
  decorateChooser();
}
function decorateChooser() {
  const hero = P.days[0]?.image;
  if (hero) {
    const bg = $("#chooserBg"); bg.onload = () => bg.classList.add("ok"); bg.src = `/pack/${hero}`;
    const av = $("#avPilote");
    if (!av.querySelector("img")) { const im = new Image(); im.onload = () => av.prepend(im); im.src = `/pack/${hero}`; }
  }
}

window.TravelOS = { back, onHome, toast, onPermission: () => {} };

(async () => {
  applyPrefs();
  try {
    P = await loadPack();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:40px">Le contenu du voyage est introuvable.</p>`;
    return;
  }
  indexPack();
  states = json(N.stepStates(), {});
  decorateChooser();
  tick(); setInterval(tick, 15000);
  showChooser();
})();

/* ================= pont de démonstration (navigateur) ================= */

function mockBridge() {
  const ls = (k, d) => json(localStorage.getItem("mock." + k), d);
  return {
    version: () => "aperçu navigateur",
    device: () => JSON.stringify({ battery: 87, charging: false, network: "WIFI", networkLabel: "Wi-Fi", gps: true, airplane: false, model: "Lenovo TB336FU", android: "16", sdk: 36, ramGb: 7.6, freeGb: 111, totalGb: 128, playServices: true, gnss: "MediaTek" }),
    stepStates: () => JSON.stringify(ls("states", {})),
    setStepState: (k, s) => { const o = ls("states", {}); if (s === "PLANNED") delete o[k]; else o[k] = s; localStorage.setItem("mock.states", JSON.stringify(o)); },
    hasSyncedPack: () => true,
    syncState: () => JSON.stringify({ running: false, packVersion: "aperçu", localFiles: 283, localBytes: 92700000, lastSync: Date.now(), message: "Contenu à jour", error: null }),
    startSync: () => {},
    hasLocationPermission: () => true, requestLocationPermission: () => {},
    gpsStart: () => {}, gpsStop: () => {}, gpsState: () => JSON.stringify({ running: false, firstFixMs: 5800, satsUsed: 14, satsVisible: 31, lat: 43.7, lng: 7.26, accuracy: 4, error: null }),
    openUrl: () => {}, openMap: () => {},
    apps: () => JSON.stringify(["Amap", "Appareil photo", "Chrome", "DeepSeek", "Galerie", "Paramètres", "Swiss", "Trip.com"].map((l) => ({ pkg: "x." + l, label: l }))),
    launchApp: () => {}, openSettings: () => {}, isDefaultHome: () => false, keepScreenOn: () => {},
  };
}
