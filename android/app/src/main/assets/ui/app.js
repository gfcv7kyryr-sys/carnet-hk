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
const TABS = { today: "Aujourd'hui", programme: "Programme", places: "Lieux", food: "Repas", guide: "Guide", pocket: "Dans la poche", more: "Plus et réglages" };

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
  let found = false;
  $$("#tabbar button").forEach((b, i) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    if (on) { $("#lens").style.transform = `translateX(${i * 100}%)`; found = true; }
  });
  $("#lens").style.opacity = found ? "1" : "0";
  const v = $("#view");
  const r = { today: viewToday, programme: view === "day" ? () => viewDay(arg) : viewProgramme, places: viewPlaces, food: () => viewFood(arg), guide: () => viewGuide(arg), pocket: () => viewPocket(arg), more: () => viewMore(arg) }[tab];
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

/* Icônes façon iPhone : image travelos/icons/<id>.webp si elle existe (à générer), sinon dégradé + caractère. */
const APPS = {
  tickets: ["票", "Billets", "mo"], phrases: ["話", "Phrases", "li"], translate: ["譯", "Traduire", "sz"],
  ask: ["問", "Demander", "ui"], sos: ["救", "SOS", "gz"], audio: ["聽", "Récit", "hk"],
  conv: ["換", "Devises", "food"], photo: ["影", "Photo", "lt"], games: ["戲", "Jeux", "li"],
};
function appIcon(id, d, size = "") {
  const [g, label, tone] = APPS[id];
  const act = {
    tickets: `data-pocket="resas"`, phrases: `data-pocket="phrases"`, ask: `data-guide="ask"`,
    translate: `data-guide="translate"`, sos: `data-pocket="sos"`, conv: `data-pocket="conv"`, photo: `data-guide="photo"`,
    audio: d.audio ? `data-audio="${esc(d.audio.src)}" data-title="Jour ${d.number} · ${esc(d.city)}"` : `data-day="${d.id}"`,
    games: `data-soon="Les jeux arrivent dans une prochaine version."`,
  }[id];
  return `<button class="app-ic ${size}" ${act}><span class="sq tone-${tone}"><b class="han">${g}</b><img src="/pack/travelos/icons/${id}.webp" alt="" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()"></span><span class="lb">${label}</span></button>`;
}
const HOME_APPS = ["tickets", "phrases", "translate", "ask", "sos", "conv", "audio", "photo", "games"];

function homeData() {
  const ph = phase();
  const d = ph.day || P.days[P.days.length - 1];
  const now = ph.now;
  const dateLabel = frDate(now.date);
  let eyebrow, headline, sub, nextHtml;
  const cal = (list, hi) => list.length ? `<ul class="t-list">${list.map((s) => `<li class="${s.key === hi ? "hi" : ""} ${status(s.key) === "DONE" ? "done" : ""}"><b>${esc(s.time)}</b><span>${esc(s.text)}</span></li>`).join("")}</ul>` : "";
  const daySteps = d.steps.filter((x) => x.dayOffset === 0);
  if (ph.kind === "before") {
    eyebrow = "Départ dans";
    headline = `${ph.left} ${ph.left > 1 ? "jours" : "jour"}`;
    sub = `${frDate(P.trip.startDate)} · Nice → Hong Kong`;
    nextHtml = `<span class="k">Première journée · ${shortDate(d.date)}</span><b class="w-t">${esc(d.title)}</b><p class="w-p">${esc(d.lede)}</p>
      <div class="acts"><button class="pill red" data-day="${d.id}">Ouvrir la journée</button></div>`;
  } else if (ph.kind === "during") {
    eyebrow = `Jour ${d.number} · ${d.city}`;
    headline = d.title;
    sub = d.lede;
    const s = ph.next;
    nextHtml = s ? `<span class="k">Prochaine étape · ${esc(s.time)}</span><p class="w-p strong">${esc(s.text)}</p>
      <div class="acts"><button class="pill red" data-done="${s.key}">C'est fait</button>${s.placeId ? `<button class="pill" data-place="${s.placeId}">Fiche du lieu</button>` : ""}</div>`
      : `<span class="k">Journée terminée</span><p class="w-p">Toutes les étapes du jour sont faites. Bonne soirée !</p>`;
  } else {
    eyebrow = "Bon retour"; headline = "Le voyage est terminé"; sub = "Les journées, les lieux et les audios restent disponibles.";
    nextHtml = `<span class="k">Souvenirs</span><p class="w-p">${esc(sub)}</p>`;
  }
  const calendar = `<span class="k">Au programme · ${shortDate(d.date)}</span>${cal(daySteps, ph.next?.key)}`;
  return { ph, d, tone: toneOf(d), now, dateLabel, eyebrow, headline, sub, nextHtml, calendar };
}
/* Accueil : calendrier du jour à gauche, photo du jour en carré avec l'heure en transparence
   derrière le sujet (effet de profondeur), grille d'applications réduite à droite. */
/* Fond de l'écran verrouillé : les lanternes du carnet (appliqué une fois, et à chaque nouveau paquet). */
function updateLockWallpaper(force) {
  if (!store.get("lockWp", false) || !N.setLockWallpaper || !P.lockscreen) return;
  const key = `${P.lockscreen}:${json(N.syncState(), {}).packVersion || "seed"}`;
  if (!force && store.get("lockWpDate", null) === key) return;
  const r = N.setLockWallpaper(P.lockscreen);
  if (r === "ok") { store.set("lockWpDate", key); if (force) toast("Les lanternes sont sur l'écran verrouillé"); }
  else if (force) toast(r);
}
function calWidget(h) {
  const d = h.d, n = h.now;
  const dt = new Date(utc(n.date));
  const dow = dt.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
  const mon = dt.toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" });
  let kicker, title, line = "";
  if (h.ph.kind === "before") {
    kicker = `Départ dans ${h.ph.left} ${h.ph.left > 1 ? "jours" : "jour"}`;
    title = d.title;
    line = `<span>Jour 1</span>${esc(shortDate(d.date))} · ${esc(d.city)}`;
  } else if (h.ph.kind === "during") {
    kicker = `Jour ${d.number} · ${d.city}`;
    title = d.title;
    const s = h.ph.next;
    line = s ? `<span>${esc(s.time)}</span>${esc(s.text)}` : `<span>✓</span>Journée terminée`;
  } else {
    kicker = "Voyage terminé"; title = "Bon retour";
  }
  return `<button class="cal-w" data-day="${d.id}">
    <span class="cw-date"><span class="cw-dow">${esc(dow)}</span><span class="cw-num">${dt.getUTCDate()}</span><span class="cw-mon">${esc(mon)}</span></span>
    <span class="cw-body"><small>${esc(kicker)}</small><b>${esc(title)}</b>${line ? `<span class="cw-line">${line}</span>` : ""}</span>
  </button>`;
}
/* Accueil : photo du jour (heure en transparence derrière le sujet), widget calendrier, grille d'applications. */
function viewToday() {
  setTimeout(() => updateLockWallpaper(false), 1500);
  const h = homeData();
  const d = h.d;
  const dep = d.depth;
  const bg = dep?.bg || d.visits[0]?.image || d.image;
  return `<section class="home-w">
    <button class="pw tone-${h.tone} ${dep?.clockFront ? "front" : ""}" data-day="${d.id}" aria-label="Ouvrir la journée">
      <span class="pw-ph">${bg ? `<img class="pw-bg" src="/pack/${esc(bg)}" alt="" onerror="this.remove()">` : ""}</span>
      <span class="pw-date">${esc(h.dateLabel)}</span>
      <span class="pw-clock" data-bigclock>${h.now.hm}</span>
      ${dep ? `<img class="pw-fg" src="/pack/${esc(dep.fg)}" alt="" onerror="this.remove()">` : ""}
    </button>
    ${calWidget(h)}
    <div class="hw-apps">${HOME_APPS.map((id) => appIcon(id, d)).join("")}</div>
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

/* Page d'une journée : en-tête compact, puis quatre sections au lieu d'une longue page. */
const DAY_SECS = [["steps", "Heure par heure"], ["visits", "Visites"], ["meals", "Repas"], ["infos", "Infos"]];
function mealSlots(day) {
  const tone = toneOf(day);
  if (!day.meals.length) return day.mealNotes.length ? `<div class="tile"><ul>${day.mealNotes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : `<p class="muted">Pas de repas prévu.</p>`;
  return day.meals.map((m) => `<section class="tile"><span class="k">${esc(m.label)}${m.time ? ` · ${esc(m.time)}` : ""}</span><h3>${esc(m.zone)}</h3>
    ${m.options.map((o) => `<div class="opt">${art(o.image, tone, o.glyph)}
      <div><b>${esc(o.name)}</b> ${o.zh ? `<span class="han muted">${esc(o.zh)}</span>` : ""}
      <div class="meta">${esc([o.category, o.rating ? `${o.rating}/5${o.reviews ? ` (${o.reviews} avis)` : ""}` : "", o.address].filter(Boolean).join(" · "))}</div>
      <p>${esc(o.summary)}</p>
      ${o.reviews2.map((r) => `<p><strong style="color:var(--ink)">${esc(r.title)}</strong> ${esc(r.text)}</p>`).join("")}
      ${o.charlie ? `<p><strong style="color:var(--ink)">Pour Charlie</strong> ${esc(o.charlie)}</p>` : ""}
      ${o.dishes.length ? `<div class="dishes">${o.dishes.map((x) => `<span class="dish">${x.image ? `<img src="/pack/${esc(x.image)}" alt="" onerror="this.remove()">` : ""}<b>${esc(x.name)}</b>&nbsp;<span class="muted">${esc(x.note)}</span></span>`).join("")}</div>` : ""}
      </div></div>`).join("")}</section>`).join("");
}
function viewDay(id) {
  const d = dayById(id);
  if (!d) return `<p>Journée introuvable.</p>`;
  const tone = toneOf(d);
  const sec = DAY_SECS.some(([k]) => k === store.get("daySec", "steps")) ? store.get("daySec", "steps") : "steps";
  const ph = phase();
  const nowKey = ph.kind === "during" && ph.day.id === d.id ? ph.next?.key : null;
  const pr = dayProgress(d);
  const count = { steps: pr.total, visits: d.visits.length, meals: d.meals.length || d.mealNotes.length, infos: d.charlie.length + d.tips.length + d.photos.length + d.planB.length };
  let body = "";
  if (sec === "steps") {
    body = `<ul class="steps">${d.steps.map((s) => {
      const st = status(s.key);
      const pl = s.placeId && placeById(s.placeId);
      return `<li class="step ${st === "DONE" ? "done" : st === "SKIPPED" ? "skipped" : ""} ${s.key === nowKey ? "now" : ""}">
        <button class="chk" data-toggle="${s.key}" aria-label="Marquer comme faite"></button>
        <div class="h">${esc(s.time)}${s.dayOffset ? `<small>${s.dayOffset < 0 ? "la veille" : "le lendemain"}</small>` : ""}</div>
        <div class="x">${esc(s.text)}</div>
        <div class="acts">${pl ? `<button class="pill" data-place="${pl.id}">Fiche du lieu</button><button class="pill ghost" data-map="${pl.id}">Y aller ›</button>` : ""}
          <button class="pill ghost" data-skip="${s.key}">${st === "SKIPPED" ? "Rétablir" : "Ignorer"}</button></div></li>`;
    }).join("")}</ul>`;
  } else if (sec === "visits") {
    body = d.visits.length ? `<div class="pgrid wide">${d.visits.map((v) =>
      `<button class="pcard" data-place="${v.id}">${art(v.image, tone, v.nameZh?.slice(0, 1))}<b>${esc(v.name)}</b><small class="sum">${esc(v.summary)}</small></button>`).join("")}</div>` : `<p class="muted">Pas de visite détaillée ce jour-là.</p>`;
  } else if (sec === "meals") {
    body = `<div style="display:grid;gap:18px">${mealSlots(d)}</div>`;
  } else {
    const list = (title, items, cls = "") => items.length ? `<div class="tile ${cls}"><h3>${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
    body = `<div class="bento">${list("Pour Charlie", d.charlie, `tone tone-${tone}`)}${list("Bon à savoir", d.tips)}${list("Les photos", d.photos)}${list("Plan B", d.planB)}</div>`;
  }
  return `<header class="dayhead2 tone-${tone}">
      ${art(d.image, tone, d.glyph, "dh-img")}
      <div class="dh-txt">
        <p class="eyebrow">Jour ${d.number} · ${frDate(d.date)} · ${esc(d.city)}</p>
        <h1 class="h2">${esc(d.title)}</h1>
        <p class="dh-lede">${esc(d.lede)}</p>
        <div class="acts"><button class="pill" data-back>‹ Programme</button>${audioBtn(d.audio, "Écouter la journée")}<span class="muted" style="font-size:.9rem;align-self:center">${pr.done}/${pr.total} étapes faites</span></div>
      </div>
    </header>
    <nav class="daytabs glass">${DAY_SECS.map(([k, l]) => `<button class="${k === sec ? "on" : ""}" data-daysec="${k}">${l}${count[k] ? ` <small>${count[k]}</small>` : ""}</button>`).join("")}</nav>
    <section class="daybody">${body}</section>`;
}

/* ================= Fiche d'un lieu ================= */

function shotHtml(x) {
  return `<div class="shot"><span class="k">${x.type === "video" ? "Vidéo" : "Photo"}${x.kind ? ` · ${esc(x.kind)}` : ""}</span><b>${esc(x.title)}</b>
    ${x.how ? `<p>${esc(x.how)}</p>` : ""}${x.phone ? `<p><strong>iPhone</strong> · ${esc(x.phone)}</p>` : ""}${x.camera ? `<p><strong>Reflex</strong> · ${esc(x.camera)}</p>` : ""}</div>`;
}
function openPlace(id) {
  const p = placeById(id);
  if (!p) return;
  const v = visitOf(id);
  const n = p.note;
  const tone = placeTone[id] || "hk";
  const days = (placeDays[id] || []).map(dayById).filter(Boolean);
  const tracks = (p.audio || []).filter(Boolean);
  const sec = (t, x) => x ? `<div class="fsec"><h3>${esc(t)}</h3><p>${esc(x)}</p></div>` : "";
  $("#sheetTitle").textContent = placeCity[id] || "";
  $("#sheetBody").innerHTML = `<div class="fgrid">${art(p.image, tone, p.nameZh.slice(0, 1), "fhero")}<div>
    <div class="fhead"><p class="k">${esc(n?.kicker || placeCity[id] || "")}</p><h2>${esc(v?.name || p.name)}</h2><p class="fzh">${esc(p.nameZh)}</p></div>
    ${tracks.length ? `<div class="acts">${tracks.map((a, i) => audioBtn(a, tracks.length > 1 ? `Audioguide ${i + 1}` : "Audioguide")).join("")}</div>` : ""}
    ${n?.lede || v?.summary ? `<p class="flede">${esc(n?.lede || v.summary)}</p>` : ""}
    ${(n?.sections || []).map((x) => sec(x.title, x.text)).join("")}
    ${!n?.sections?.length ? sec("L'histoire", v?.history) : ""}
    ${sec("À repérer", v?.remark)}
    ${n?.know?.length ? `<div class="tile"><h3>À savoir</h3><ul>${n.know.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${sec("Sur place", n?.practical)}
    <div class="acts"><button class="pill red" data-showtext="${esc(p.nameZh)}" data-showfr="${esc(p.name)}">Montrer au chauffeur</button>
      <button class="pill" data-map="${p.id}">Ouvrir dans une carte</button>
      <button class="pill" data-askplace="${p.id}">Demander au guide</button></div>
    ${days.length ? `<div class="fsec"><h3>Au programme</h3><div class="acts">${days.map((d) => `<button class="pill" data-day="${d.id}">Jour ${d.number} · ${esc(d.city)}</button>`).join("")}</div></div>` : ""}
  </div></div>
  ${p.shots?.length ? `<section class="sec"><h2 class="h3">Conseils photo et vidéo</h2><div class="bento">${p.shots.map(shotHtml).join("")}</div></section>` : ""}
  <p class="muted" style="font-size:.85rem">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (WGS-84)</p>`;
  $("#sheet").hidden = false;
  $("#sheet").scrollTop = 0;
}
function openArticle(id) {
  const a = P.articles.find((x) => x.id === id);
  if (!a) return;
  $("#sheetTitle").textContent = a.title;
  let extra = "";
  if (id === "dimsum") extra = `<section class="sec"><h2 class="h2">La carte.</h2><div class="signs">${P.dimsum.map((x) => `<button data-showtext="${esc(x.zh)}" data-showfr="${esc(x.roman)} · ${esc(x.fr)}"><span class="zh">${esc(x.zh)}</span><small>${esc(x.roman)} · ${esc(x.fr)}</small></button>`).join("")}</div></section>`;
  $("#sheetBody").innerHTML = `<article class="cmp">${a.html}</article>${extra}`;
  $$("#sheetBody img").forEach((im) => { im.onerror = () => im.remove(); });
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

/* ================= Repas ================= */

const FOOD = [["days", "Par jour"], ["spec", "Spécialités"], ["dimsum", "Dim sum"]];
function viewFood(arg) {
  const seg = FOOD.some(([k]) => k === arg) ? arg : (dayById(arg) ? "days" : store.get("foodSeg", "days"));
  store.set("foodSeg", seg);
  const body = seg === "spec" ? foodSpec() : seg === "dimsum" ? foodDimsum() : foodDays(dayById(arg)?.id);
  return `<header class="hero-t small"><h1 class="display">À table</h1><p class="sub">Les adresses choisies pour chaque repas, sans fruits de mer pour l'un de vous, et le verdict pour Charlie.</p></header>
    <div class="sec"><div style="text-align:center"><div class="seg">${FOOD.map(([k, l]) => `<button class="${k === seg ? "on" : ""}" data-food="${k}">${l}</button>`).join("")}</div></div>${body}</div>`;
}
function foodDays(dayId) {
  const withMeals = P.days.filter((d) => d.meals.length || d.mealNotes.length);
  const today = phase().day;
  const cur = dayById(dayId) || (today && withMeals.includes(today) ? today : withMeals[0]);
  store.set("foodDay", cur.id);
  const chips = `<div class="chips" style="justify-content:center">${withMeals.map((d) => `<button class="pill ${d.id === cur.id ? "red" : ""}" data-food="${d.id}">J${d.number} · ${esc(d.city)}</button>`).join("")}</div>`;
  const tone = toneOf(cur);
  const slots = cur.meals.length ? cur.meals.map((m) => `<section class="tile"><span class="k">${esc(m.label)}${m.time ? ` · ${esc(m.time)}` : ""}</span><h3>${esc(m.zone)}</h3>
    ${m.options.map((o) => `<div class="opt">${art(o.image, tone, o.glyph)}
      <div><b>${esc(o.name)}</b> ${o.zh ? `<span class="han muted">${esc(o.zh)}</span>` : ""}
      <div class="meta">${esc([o.category, o.rating ? `${o.rating}/5${o.reviews ? ` (${o.reviews} avis)` : ""}` : "", o.address].filter(Boolean).join(" · "))}</div>
      <p>${esc(o.summary)}</p>
      ${o.reviews2.map((r) => `<p><strong style="color:var(--ink)">${esc(r.title)}</strong> ${esc(r.text)}</p>`).join("")}
      ${o.charlie ? `<p><strong style="color:var(--ink)">Pour Charlie</strong> ${esc(o.charlie)}</p>` : ""}
      ${o.dishes.length ? `<div class="dishes">${o.dishes.map((x) => `<span class="dish">${x.image ? `<img src="/pack/${esc(x.image)}" alt="" onerror="this.remove()">` : ""}<b>${esc(x.name)}</b>&nbsp;<span class="muted">${esc(x.note)}</span></span>`).join("")}</div>` : ""}
      </div></div>`).join("")}</section>`).join("")
    : `<div class="tile"><ul>${cur.mealNotes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  return `${chips}<div style="display:grid;gap:18px">${slots}</div>`;
}
function foodSpec() {
  const label = { "SÛR": "Sûr", SURV: "À surveiller", VOUS: "Pour vous" };
  return `<p class="muted" style="text-align:center">Sûr : cuit, chaud, sans arêtes. À surveiller : arêtes, épices. Pour vous : pas pour Charlie.</p>` +
    P.specialties.map((r) => `<section class="sec"><h2 class="h3">${esc(r.region)}</h2><div>${r.dishes.map((x) => `<button class="spec" style="width:100%;text-align:left" data-showtext="${esc(x.zh)}" data-showfr="${esc(x.name)}">
      <span class="zh">${esc(x.zh)}</span><span><b>${esc(x.name)}</b><small>${esc(x.text)}</small></span>${x.verdict ? `<span class="verdict v-${esc(x.verdict)}">${label[x.verdict] || esc(x.verdict)}</span>` : ""}</button>`).join("")}</div></section>`).join("");
}
function foodDimsum() {
  return `<div class="acts" style="justify-content:center"><button class="pill red" data-article="dimsum">Le dim sum, mode d'emploi</button></div>
    <div class="signs">${P.dimsum.map((x) => `<button data-showtext="${esc(x.zh)}" data-showfr="${esc(x.roman)} · ${esc(x.fr)}"><span class="zh">${esc(x.zh)}</span><small>${esc(x.roman)} · ${esc(x.fr)}</small></button>`).join("")}</div>`;
}

/* ================= Guide ================= */

const GUIDE = [["learn", "Comprendre"], ["ask", "Demander"], ["translate", "Traduire"], ["photo", "Photo"]];
function viewGuide(arg) {
  const seg = GUIDE.some(([k]) => k === arg) ? arg : store.get("guideSeg", "learn");
  store.set("guideSeg", seg);
  const body = { learn: guideLearn, ask: guideAsk, translate: guideTranslate, photo: guidePhoto }[seg]();
  return `<header class="hero-t small"><h1 class="display">Le guide</h1></header>
    <div class="sec"><div style="text-align:center"><div class="seg">${GUIDE.map(([k, l]) => `<button class="${k === seg ? "on" : ""}" data-guide="${k}">${l}</button>`).join("")}</div></div>${body}</div>`;
}
function guideLearn() {
  const card = (a) => {
    const im = a.images[0];
    const tone = (a.html.match(/tone-([a-z]+)/) || [])[1] || "hk";
    return `<button class="acard" data-article="${a.id}">${art(im, tone, a.glyph, "")}<b>${esc(a.title)}</b></button>`;
  };
  const g = (k) => P.articles.filter((a) => a.group === k);
  return `<section class="sec"><h2 class="h3">Comprendre les villes</h2><div class="grid">${g("comprendre").map(card).join("")}</div></section>
    <section class="sec"><h2 class="h3">Fiches pratiques</h2><div class="grid">${g("pratique").map(card).join("")}</div></section>
    ${P.cityAudio.length ? `<section class="sec"><h2 class="h3">Les villes racontées</h2><div class="acts">${P.cityAudio.map((a) => audioBtn(a, a.title || a.id)).join("")}</div></section>` : ""}`;
}
function guideContext() {
  const ph = phase();
  const d = ph.day;
  if (ph.kind === "during" && d) return `Nous sommes à ${d.city}, le ${frDate(d.date).toLowerCase()}. Programme du jour : ${d.title}.`;
  return "Nous voyageons à Hong Kong, Macao et dans le sud de la Chine, du 21 février au 5 mars.";
}
const GUIDE_RULE = "Réponds en français, simplement et en quelques paragraphes. Nous sommes une famille française avec une petite fille de 3 ans.";
const GUIDE_FOOD = /\b(mang|plat|menu|restau|dim ?sum|goût|déjeun|dîn|commander|épic|boisson|dessert|cuisine|soupe|nouille|viande|poisson)/i;
function guideAsk(ctx) {
  const chips = ["Qu'est-ce que je vois sur cette photo ?", "Explique-le à une enfant de 3 ans", "L'histoire de ce lieu", "Que dit ce panneau ?", "Que veut dire ce plat ?", "Traduis ce menu"];
  return `<div class="tile ask"><h3>Demander à Xiao Long</h3>
    <p>La question part dans DeepSeek avec le contexte du voyage, et une photo si vous le souhaitez. Il faut du réseau : partage de connexion de l'iPhone ou Wi-Fi.</p>
    <label class="muted" style="font-size:.9rem">Contexte</label><textarea id="askCtx" style="min-height:70px">${esc(ctx || store.get("askCtx", "") || guideContext())}</textarea>
    <div class="chips">${chips.map((c) => `<button class="pill" data-askchip="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <textarea id="askQ" placeholder="Votre question"></textarea>
    <div class="acts"><button class="pill red" data-ask="photo">Prendre une photo et demander</button><button class="pill" data-ask="text">Demander sans photo</button></div></div>`;
}
function guideTranslate() {
  return `<div class="tile tr"><h3>Traducteur hors ligne</h3>
    <p id="trState">…</p>
    <div class="seg" id="trDir"><button class="${store.get("trDir", "fr") === "fr" ? "on" : ""}" data-trdir="fr">Français → chinois</button><button class="${store.get("trDir", "fr") === "zh" ? "on" : ""}" data-trdir="zh">Chinois → français</button></div>
    <textarea id="trIn" placeholder="Tapez ou dictez votre phrase">${esc(store.get("trLast", ""))}</textarea>
    <div class="acts"><button class="pill red" id="trGo">Traduire</button><button class="pill" id="trDl" hidden>Télécharger les langues (Wi-Fi)</button></div>
    <div class="tr-out" id="trOut"><span class="muted">La traduction apparaît ici.</span></div>
    <div class="acts" id="trActs" hidden><button class="pill red" id="trShow">Montrer en grand</button><button class="pill" id="trSpeakZh">Écouter (mandarin)</button><button class="pill" id="trSpeakYue">Écouter (cantonais)</button></div></div>
  <div class="tile"><h3>Conversation et caméra</h3><p>Pour traduire en parlant ou en photographiant un menu, Google Traduction fonctionne aussi hors ligne une fois la langue « chinois » téléchargée dans l'appli. À installer avant le départ : le Play Store ne fonctionne pas en Chine continentale.</p>
    <div class="acts"><button class="pill" id="gTr">Ouvrir Google Traduction</button></div></div>
  <div class="acts" style="justify-content:center"><button class="pill" data-pocket="phrases">Phrases toutes prêtes</button><button class="pill" data-pocket="signs">Panneaux</button></div>`;
}
function guidePhoto() {
  const d = phase().day || P.days[0];
  const cur = dayById(store.get("photoDay", d.id)) || d;
  const ids = [...new Set([...cur.steps.map((s) => s.placeId), ...cur.visits.map((v) => v.id)].filter(Boolean))];
  const items = ids.map(placeById).filter((p) => p && p.shots?.length);
  return `<div class="chips" style="justify-content:center">${P.days.map((x) => `<button class="pill ${x.id === cur.id ? "red" : ""}" data-photoday="${x.id}">J${x.number} · ${esc(x.city)}</button>`).join("")}</div>
    ${cur.photos.length ? `<div class="tile"><h3>Les photos du jour</h3><ul>${cur.photos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${items.map((p) => `<section class="sec"><div class="sec-h"><h2 class="h3">${esc(p.name)}</h2><button class="pill" data-place="${p.id}">Fiche</button></div><div class="bento">${p.shots.map(shotHtml).join("")}</div></section>`).join("") || `<p class="muted" style="text-align:center">Pas de conseil photo pour cette journée.</p>`}`;
}
after.guide = () => {
  if ($("#askQ")) {
    $("#askCtx").addEventListener("input", (e) => store.set("askCtx", e.target.value));
  }
  if ($("#trIn")) {
    const st = () => {
      const s = json(N.translatorState(), {});
      $("#trState").textContent = s.ready ? "Langues installées : la traduction fonctionne sans réseau." : s.downloading ? "Téléchargement des langues en cours (environ 60 Mo)…" : s.error ? `Erreur : ${s.error}` : "Les langues ne sont pas encore installées : téléchargez-les une fois en Wi-Fi.";
      $("#trDl").hidden = s.ready || s.downloading;
      if (s.downloading && $("#trIn")) setTimeout(st, 1500);
      return s;
    };
    st();
    $("#trDl").addEventListener("click", () => { N.translatorDownload(); setTimeout(st, 500); });
    $("#trDir").addEventListener("click", (e) => { const b = e.target.closest("[data-trdir]"); if (!b) return; store.set("trDir", b.dataset.trdir); $$("#trDir button").forEach((x) => x.classList.toggle("on", x === b)); });
    $("#trGo").addEventListener("click", () => {
      const text = $("#trIn").value.trim(); if (!text) return;
      store.set("trLast", text);
      if (!json(N.translatorState(), {}).ready) return toast("Téléchargez d'abord les langues, en Wi-Fi.");
      $("#trOut").innerHTML = `<span class="muted">Traduction…</span>`;
      N.translate("tr", text, store.get("trDir", "fr") === "fr");
    });
    $("#gTr").addEventListener("click", () => N.openGoogleTranslate($("#trIn").value.trim()));
    $("#trShow").addEventListener("click", () => openShow(lastTr.zh || lastTr.text, "", lastTr.src));
    $("#trSpeakZh").addEventListener("click", () => speak(lastTr.zh || lastTr.text, "zh-CN"));
    $("#trSpeakYue").addEventListener("click", () => speak(lastTr.zh || lastTr.text, "yue-HK"));
  }
};
let lastTr = {};
function onTranslate(id, r) {
  if (!$("#trOut")) return;
  if (r.error) { $("#trOut").innerHTML = `<span style="color:var(--red-ink)">${esc(r.error)}</span>`; return; }
  const toZh = store.get("trDir", "fr") === "fr";
  lastTr = { text: r.text, zh: toZh ? r.text : $("#trIn").value.trim(), src: $("#trIn").value.trim() };
  $("#trOut").innerHTML = toZh ? `<div class="zh">${esc(r.text)}</div>` : `<div style="font-size:1.4rem">${esc(r.text)}</div>`;
  $("#trActs").hidden = false;
}
function speak(text, lang) {
  const r = N.speak(text, lang);
  if (r === "missing") toast("Voix non installée : Réglages Android › Synthèse vocale › installer la voix chinoise.");
  else if (r === "off") toast("Synthèse vocale indisponible.");
}
function askGuide(withPhoto) {
  const ctx = $("#askCtx").value.trim();
  const q = $("#askQ").value.trim() || "Explique-moi ce que je vois.";
  const food = GUIDE_FOOD.test(q + " " + ctx);
  const text = [ctx, q, (withPhoto ? "La photo jointe montre ce que nous regardons. " : "") + GUIDE_RULE + (food ? " L'un de nous ne mange pas de fruits de mer." : "")].filter(Boolean).join("\n\n");
  N.askGuide(text, withPhoto);
}

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
    <p>Textes, images et audios viennent du carnet de route. Ils se téléchargent une fois en Wi-Fi (environ 115 Mo la première fois, puis seulement ce qui a changé) et restent ensuite disponibles sans réseau.</p>
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
    <div class="tile"><h3>Écran de veille</h3>
      <p><b>Économiseur d'écran</b> : quand la tablette charge, TravelOS affiche la photo du jour, l'heure et la prochaine étape. Choisissez « TravelOS » dans le réglage Android.</p>
      <div class="acts"><button class="pill red" data-settings="dream">Choisir l'économiseur</button></div>
      <p><b>Écran verrouillé</b> : les lanternes du carnet en fond (l'horloge reste celle d'Android).</p>
      <div class="seg" id="lockSeg"><button class="${store.get("lockWp", false) ? "" : "on"}" data-lockwp="0">Non</button><button class="${store.get("lockWp", false) ? "on" : ""}" data-lockwp="1">Oui</button></div></div>
    <div class="tile"><h3>Taille du texte</h3><p>Pour lire de près sans lunettes, ou pour voir plus de choses à l'écran.</p>
      <div class="seg">${[[85, "Petit"], [100, "Normal"], [115, "Grand"], [130, "Très grand"]].map(([v, l]) => `<button class="${(store.get("textZoom", 100)) === v ? "on" : ""}" data-zoom="${v}" style="font-size:${(v / 100) * 0.92}rem">${l}</button>`).join("")}</div></div>
    <div class="tile"><h3>Apparence</h3><p>Automatique : suit le mode clair ou sombre de la tablette.</p>
      <div class="seg">${[["auto", "Automatique"], ["light", "Clair"], ["dark", "Sombre"]].map(([k, l]) => `<button class="${store.get("theme", "auto") === k ? "on" : ""}" data-theme="${k}">${l}</button>`).join("")}</div></div>
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
  if (d.food) return go("food", null, d.food, stack[stack.length - 1]?.tab !== "food");
  if (d.guide) return go("guide", null, d.guide, stack[stack.length - 1]?.tab !== "guide");
  if (d.article) return openArticle(d.article);
  if (d.soon) return toast(d.soon);
  if (d.daysec) { store.set("daySec", d.daysec); const st = stack[stack.length - 1]; go(st.tab, st.view, st.arg, false); return; }
  if (d.zoom) { const v = +d.zoom; store.set("textZoom", v); N.setTextZoom && N.setTextZoom(v); return go("more", null, "settings", false); }
  if (d.lockwp) { store.set("lockWp", d.lockwp === "1"); store.set("lockWpDate", null); if (d.lockwp === "1") updateLockWallpaper(true); return go("more", null, "settings", false); }
  if (d.photoday) { store.set("photoDay", d.photoday); return go("guide", null, "photo", false); }
  if (d.askchip) { $("#askQ").value = d.askchip; return; }
  if (d.ask) return askGuide(d.ask === "photo");
  if (d.askplace) { const p = placeById(d.askplace); closeSheet(); go("guide", null, "ask"); $("#askCtx").value = `Nous visitons : ${p.name} (${p.nameZh}), à ${placeCity[p.id] || ""}.`; return; }
  if (d.theme) { store.set("theme", d.theme); applyTheme(); return go("more", null, "settings", false); }
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

function applyTheme() {
  const mode = store.get("theme", "auto");
  const dark = mode === "dark" || (mode === "auto" && N.systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
function applyPrefs() {
  document.body.classList.toggle("matte", !!store.get("matte", false));
  applyTheme();
  N.setTextZoom && N.setTextZoom(store.get("textZoom", 100));
}
function tick() {
  const n = nowHK();
  $("#clockHk").textContent = n.hm;
  $$("[data-bigclock]").forEach((e) => { e.textContent = n.hm; });
  $("#topStatus").innerHTML = statusIcons(json(N.device(), {}));
}
/* État de la tablette, dans la barre du haut comme sur iPhone. */
function statusIcons(dev) {
  const pct = Math.max(0, Math.min(100, dev.battery ?? 0));
  const low = pct <= 20;
  const battery = `<span class="si" title="Batterie"><svg viewBox="0 0 30 14" width="27" height="13"><rect x=".7" y=".7" width="25" height="12.6" rx="3.5" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.4"/><rect x="2.6" y="2.6" width="${(21.2 * pct) / 100}" height="8.8" rx="2" fill="${low ? "var(--red)" : dev.charging ? "var(--green)" : "currentColor"}"/><path d="M27.6 4.8v4.4c1-.3 1.6-1.2 1.6-2.2s-.6-1.9-1.6-2.2z" fill="currentColor" fill-opacity=".45"/></svg>${pct} %</span>`;
  const net = dev.airplane ? `<span class="si" title="Mode avion">✈︎</span>`
    : dev.network === "NONE" ? `<span class="si off" title="Sans réseau"><svg viewBox="0 0 20 15" width="19" height="14"><path d="M10 3C6.6 3 3.6 4.3 1.3 6.5L10 15l8.7-8.5C16.4 4.3 13.4 3 10 3z" fill="currentColor" fill-opacity=".25"/></svg></span>`
    : `<span class="si" title="${esc(dev.networkLabel || "")}"><svg viewBox="0 0 20 15" width="19" height="14"><path d="M10 3C6.6 3 3.6 4.3 1.3 6.5L10 15l8.7-8.5C16.4 4.3 13.4 3 10 3z" fill="currentColor"/></svg></span>`;
  const gps = `<span class="si ${dev.gps ? "" : "off"}" title="GPS"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M15 1 1 7.2l6 1.8 1.8 6z" fill="currentColor"/></svg></span>`;
  const content = N.hasSyncedPack() ? "" : `<span class="si warn" title="Médias à synchroniser">↓</span>`;
  return content + gps + net + battery;
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

window.TravelOS = { back, onHome, toast, onPermission: () => {}, onTranslate, onSystemTheme: () => applyTheme() };

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
    systemDark: () => matchMedia("(prefers-color-scheme: dark)").matches,
    translatorState: () => JSON.stringify({ ready: false, downloading: false, error: null, tts: true }),
    translatorDownload: () => {}, translate: (id) => setTimeout(() => window.TravelOS.onTranslate(id, { text: "你好", error: null }), 300),
    setLockWallpaper: () => "ok", setTextZoom: (v) => { document.documentElement.style.fontSize = `${v}%`; },
    speak: () => "ok", openGoogleTranslate: () => {}, hasApp: () => false, askGuide: () => {},
  };
}
