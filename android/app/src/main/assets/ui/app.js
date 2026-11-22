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

/* Paquet de contenu. Celui synchronisé sur la tablette passe avant celui livré avec l'application, sauf s'il
   est d'un schéma plus ancien que celui que cette version attend : on prend alors le paquet livré, et on
   invite à resynchroniser (packStale). Dans tous les cas, normalizePack() complète un paquet ancien. */
const PACK_SCHEMA = 3;
let packStale = false;
async function loadPack() {
  const get = async (url) => { try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; } };
  const synced = await get("/pack/travelos/pack/pack.json");
  if (synced && (synced.schema || 1) >= PACK_SCHEMA) return normalizePack(synced);
  const seed = await get("/assets/seed/pack.json");
  if (synced) packStale = true;
  if (seed && (seed.schema || 1) >= (synced?.schema || 1)) return normalizePack(seed);
  if (synced) return normalizePack(synced);
  throw new Error("Paquet introuvable");
}
/* Bandeau : le paquet synchronisé sur la tablette est plus ancien que celui de l'application. */
function showStale() {
  if ($("#stale")) return;
  const el = document.createElement("div");
  el.id = "stale"; el.className = "stale glass";
  el.innerHTML = `<p><b>Contenu à mettre à jour.</b> Celui enregistré sur la tablette vient d'une version précédente : l'application affiche le sien en attendant. Mettez à jour en Wi-Fi pour récupérer les dernières photos et corrections.</p>
    <button class="pill red" data-resync>Mettre à jour</button><button class="dm-x" data-stalex aria-label="Masquer">×</button>`;
  document.body.appendChild(el);
}
function resync() {
  N.startSync(); toast("Mise à jour du contenu…");
  const t = setInterval(() => {
    const st = json(N.syncState(), {});
    if (st.running) return;
    clearInterval(t);
    if (st.error) toast(`Mise à jour impossible : ${st.error}`); else location.reload();
  }, 2000);
}
/* Complète un paquet d'une version précédente pour qu'aucun écran ne casse (plans sans segments, etc.). */
function normalizePack(p) {
  for (const d of p.days || []) {
    d.steps ||= []; d.visits ||= []; d.meals ||= []; d.mealNotes ||= []; d.charlie ||= []; d.tips ||= []; d.photos ||= []; d.planB ||= [];
    const m = (d.map ||= {});
    m.stops = (m.stops || []).filter((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lng)).map((x, i) => ({ minor: false, short: "", zh: "", n: i + 1, ...x }));
    const ids = new Set(m.stops.map((x) => x.id));
    m.legs = (m.legs || []).filter((l) => ids.has(l.from) && ids.has(l.to)).map((l) => ({ ...l,
      segments: Array.isArray(l.segments) ? l.segments.filter((g) => Array.isArray(g.path) && g.path.length > 1)
        : (Array.isArray(l.path) && l.path.length > 1 && l.redraw !== false ? [{ mode: l.mode, path: l.path }] : []) }));
  }
  return p;
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
  mapTeardown();
  document.body.classList.toggle("mapmode", view === "map");
  const v = $("#view");
  const r = { today: viewToday, programme: view === "day" ? () => viewDay(arg) : view === "map" ? () => viewMap(arg) : viewProgramme, places: viewPlaces, food: () => viewFood(arg), guide: () => viewGuide(arg), pocket: () => viewPocket(arg), more: () => viewMore(arg) }[tab];
  v.innerHTML = `<div class="view">${r()}</div>`;
  $("#pageTitle").textContent = view === "day" ? `Jour ${dayById(arg)?.number} · ${dayById(arg)?.city}` : view === "map" ? "Plan du jour" : TABS[tab];
  window.scrollTo(0, 0);
  mapShownSig = "";
  after[tab]?.(view, arg);
  if (!$("#dmMap")) mapStopGps(); // on a quitté le plan : fin du suivi
  requestAnimationFrame(fitDayTabs);
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
  conv: ["換", "Devises", "food"], photo: ["影", "Photo", "lt"], games: ["戲", "Jeux", "li"], plans: ["圖", "Plans", "lt"],
};
function appIcon(id, d, size = "") {
  const [g, label, tone] = APPS[id];
  const act = {
    tickets: `data-pocket="resas"`, phrases: `data-pocket="phrases"`, ask: `data-guide="ask"`,
    translate: `data-guide="translate"`, sos: `data-pocket="sos"`, conv: `data-pocket="conv"`, photo: `data-guide="photo"`,
    audio: d.audio ? `data-audio="${esc(d.audio.src)}" data-title="Jour ${d.number} · ${esc(d.city)}"` : `data-day="${d.id}"`,
    games: `data-soon="Les jeux arrivent dans une prochaine version."`, plans: `data-daymap="${d.id}"`,
  }[id];
  return `<button class="app-ic ${size}" ${act}><span class="sq tone-${tone}"><b class="han">${g}</b><img src="/pack/travelos/icons/${id}.webp" alt="" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()"></span><span class="lb">${label}</span></button>`;
}
const HOME_APPS = ["plans", "tickets", "phrases", "translate", "ask", "sos", "conv", "audio", "photo", "games"];

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
/* Moment de la journée à l'heure du voyage : 1 matin (5 h – 12 h), 2 après-midi (12 h – 18 h), 3 soir. */
const sceneSlot = (min) => (min >= 300 && min < 720 ? 1 : min >= 720 && min < 1080 ? 2 : 3);
function sceneOf(d, now) {
  const want = sceneSlot(now.minutes);
  return d.scenes?.find((x) => x.slot === want) || d.scenes?.[0] || null;
}
/* Heure à la manière de l'écran verrouillé : sans zéro devant l'heure, deux-points espacés. */
const bigClock = (hm) => { const [h, m] = hm.split(":"); return `${Number(h)}<i>:</i>${m}`; };

/* Étapes à venir : la prochaine, puis les deux suivantes (avant le voyage, le début du jour 1). */
function upcoming(h) {
  const d = h.d;
  const list = d.steps.filter((x) => x.dayOffset === 0 && ["PLANNED", "IN_PROGRESS"].includes(status(x.key)));
  if (h.ph.kind !== "during") return list.slice(0, 3);
  const i = h.ph.next ? list.indexOf(h.ph.next) : -1;
  return i < 0 ? [] : list.slice(i, i + 3);
}
const stepPlace = (s) => (s.placeId ? placeById(s.placeId) : null);
const stepLabel = (s) => stepPlace(s)?.name || s.text.split(/ : |\. |, puis /)[0].replace(/[.,]$/, "");
function calWidget(h) {
  const d = h.d, n = h.now;
  const dt = new Date(utc(n.date));
  const dow = dt.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
  const mon = dt.toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" });
  const kicker = h.ph.kind === "before" ? `Départ dans ${h.ph.left} ${h.ph.left > 1 ? "jours" : "jour"} · Jour 1, ${shortDate(d.date)}`
    : h.ph.kind === "during" ? `Jour ${d.number} · ${d.city}` : "Voyage terminé";
  const head = `<button class="cw-head" data-day="${d.id}">
      <span class="cw-date"><span class="cw-dow">${esc(dow)}</span><span class="cw-num">${dt.getUTCDate()}</span><span class="cw-mon">${esc(mon)}</span></span>
      <span class="cw-body"><small>${esc(kicker)}</small><b>${esc(h.ph.kind === "after" ? "Bon retour" : d.title)}</b></span>
    </button>`;
  if (h.ph.kind === "after") return `<div class="cal-w">${head}</div>`;
  const [s, ...rest] = upcoming(h);
  let next;
  if (s) {
    const pl = stepPlace(s);
    const au = pl?.audio?.[0];
    next = `<div class="cw-next" data-next="${s.key}">
      <small>${h.ph.kind === "before" ? "Première étape" : "Prochaine étape"}</small>
      <div class="cwn"><b class="cwn-t">${esc(s.time)}</b><span><b class="cwn-p">${esc(stepLabel(s))}</b>${s.text.replace(/[.\s]+$/, "") !== stepLabel(s) ? `<span class="cwn-x">${esc(s.text)}</span>` : ""}</span></div>
      ${pl || au ? `<div class="acts">${pl ? `<button class="pill red" data-map="${pl.id}">Y aller</button>` : ""}${au ? `<button class="pill" data-audio="${esc(au.src)}" data-title="${esc(au.title || pl.name)}">▶ Écouter</button>` : ""}${pl ? `<button class="pill ghost" data-place="${pl.id}">Fiche</button>` : ""}</div>` : ""}
    </div>`;
  } else {
    next = `<div class="cw-next"><small>Prochaine étape</small><div class="cwn"><b class="cwn-t">✓</b><span><b class="cwn-p">Journée terminée</b><span class="cwn-x">Toutes les étapes du jour sont faites.</span></span></div></div>`;
  }
  const more = `<div class="cw-more"><small>Au programme</small>
      ${rest.map((x) => `<button class="cwm" data-day="${d.id}"><b>${esc(x.time)}</b><span>${esc(stepLabel(x))}</span></button>`).join("")}
      <div class="cw-foot"><button class="pill dark" data-daymap="${d.id}">Voir le plan du jour</button><button class="cwm all" data-day="${d.id}">Toute la journée <span>›</span></button></div>
    </div>`;
  return `<div class="cal-w">${head}${next}${more}</div>`;
}
/* Widget photo : fond, heure en verre, puis sujet détouré qui passe devant les chiffres. */
function photoWidget(h) {
  const d = h.d, sc = sceneOf(d, h.now);
  if (!sc) {
    const dep = d.depth, bg = dep?.bg || d.visits[0]?.image || d.image;
    return `<button class="pw tone-${h.tone} ${dep?.clockFront ? "front" : ""}" data-day="${d.id}" data-scene="none" aria-label="Ouvrir la journée">
      <span class="pw-ph">${bg ? `<img class="pw-bg" src="/pack/${esc(bg)}" alt="" onerror="this.remove()">` : ""}</span>
      <span class="pw-clock glass-light" style="--glass:none"><span class="gc gc-sh" data-bigclock>${bigClock(h.now.hm)}</span><span class="gc gc-rim" data-bigclock>${bigClock(h.now.hm)}</span><span class="gc gc-fill plain" data-bigclock>${bigClock(h.now.hm)}</span><span class="gc gc-hi" data-bigclock>${bigClock(h.now.hm)}</span></span>
      ${dep ? `<img class="pw-fg" src="/pack/${esc(dep.fg)}" alt="" onerror="this.remove()">` : ""}
    </button>`;
  }
  const c = bigClock(h.now.hm);
  return `<button class="pw" data-day="${d.id}" data-scene="${d.id}-${sc.slot}" aria-label="Ouvrir la journée" style="--dy:${sc.dy || 0}">
    <img class="pw-bg" src="/pack/${esc(sc.bg)}" alt="">
    <span class="pw-clock glass-${sc.tone}" style="--glass:url('/pack/${esc(sc.glass)}')" aria-hidden="true">
      <span class="gc gc-sh" data-bigclock>${c}</span><span class="gc gc-rim" data-bigclock>${c}</span><span class="gc gc-fill" data-bigclock>${c}</span><span class="gc gc-hi" data-bigclock>${c}</span>
    </span>
    <img class="pw-fg" src="/pack/${esc(sc.fg)}" alt="">
  </button>`;
}
/* Clé de ce qu'affichent les widgets : quand elle change (moment, journée, étape), on les redessine. */
function homeKey(h) {
  const sc = sceneOf(h.d, h.now);
  return `${h.d.id}|${sc ? sc.slot : "-"}|${upcoming(h).map((x) => x.key).join(",")}|${h.ph.kind}`;
}
let homeShown = "";
function refreshHome() {
  const w = $(".home-w");
  if (!w) return;
  const h = homeData(), k = homeKey(h);
  if (k === homeShown) return;
  homeShown = k;
  w.querySelector(".pw").outerHTML = photoWidget(h);
  w.querySelector(".cal-w").outerHTML = calWidget(h);
}
/* Accueil : photo du jour (heure en verre derrière le sujet), widget calendrier, grille d'applications. */
function viewToday() {
  setTimeout(() => updateLockWallpaper(false), 1500);
  const h = homeData();
  homeShown = homeKey(h);
  return `<section class="home-w">
    ${photoWidget(h)}
    ${calWidget(h)}
    <div class="hw-apps">${HOME_APPS.map((id) => appIcon(id, h.d)).join("")}</div>
  </section>`;
}

/* ================= Plan du jour ================= */
/* Carte MapLibre GL en plein écran : fond vectoriel clair (OpenStreetMap, tuiles servies et gardées par la
   tablette sous /osm/). Par-dessus : un en-tête compact « Jour 2 · Hong Kong » avec les onglets du jour, une
   fiche compacte (prochain lieu, Voir la fiche, Voir les étapes), Ma position, Vue du jour et la légende
   repliable. Même logique de « prochaine étape » que le widget calendrier. Tous les points sont en WGS-84 :
   un seul point par arrêt, partagé par le repère, les tracés et « Y aller » ; seul AMap convertit (dev=1). */
const MODES = {
  ferry: { label: "Ferry", color: "#1E88E5", ic: "⛴" }, walk: { label: "À pied", color: "#2E9D4F", ic: "🚶" }, peaktram: { label: "Peak Tram", color: "#F07C00", ic: "🚞" },
  metro: { label: "Métro", color: "#C8102E", ic: "🚇" }, dingding: { label: "Tram", color: "#0B6E4F", ic: "🚋" }, taxi: { label: "Taxi", color: "#E09A00", ic: "🚕" },
  train: { label: "Train", color: "#6A3FB5", ic: "🚄" }, bus: { label: "Bus", color: "#00838F", ic: "🚌" }, cablecar: { label: "Téléphérique", color: "#D81B60", ic: "🚡" },
  car: { label: "Voiture", color: "#455A64", ic: "🚗" },
};
const LEGEND_ORDER = ["ferry", "walk", "peaktram", "metro", "train", "dingding", "bus", "cablecar", "taxi", "car"];
const mapZone = {}, mapIllu = {}; // zone affichée (journées sur plusieurs villes) et plan illustré, par journée
let mapFailed = false, glMap = null, glDay = null, mapUserMoved = false, mapListOpen = false, mapLegendOpen = false, mapMarkers = [];
const mapCam = {}, mapScroll = {};
const glOk = () => !mapFailed && !!window.maplibregl;
const mapSel = {}; // lieu sélectionné par journée, gardé d'un format à l'autre
const mapRoot = () => $(".dmap") || $(".dm-embed");
const mapEmbedded = () => !$(".dmap") && !!$(".dm-embed");
/* Onglet Plan de la page du jour : carte intégrée, avec Plein écran, la fiche compacte et la légende. */
function mapEmbedHtml(d) {
  const stops = mapStops(d), legs = d.map?.legs || [];
  const modes = new Set(legs.flatMap((l) => l.segments.map((s) => s.mode)));
  return `<div class="dm-embedwrap">
    <section class="dm-embed" data-mapday="${d.id}">
      <div class="dm-map" id="dmMap">${glOk() ? "" : planSvg(d, stops)}</div>
      <button class="pill glass dm-full" data-mapfull aria-label="Afficher le plan en plein écran"><span aria-hidden="true">⤢</span> Plein écran</button>
      <div class="dm-etools"><button class="pill glass" data-maplocate><span aria-hidden="true">➤</span> Ma position</button><button class="pill glass" data-mapfit><span aria-hidden="true">⤢</span> Vue du jour</button>${mapExtraChips(d)}</div>
      <span class="dm-attrib">© les contributeurs d'OpenStreetMap · OpenFreeMap</span>
    </section>
    <div class="dm-under">
      <div id="dmCard">${mapCardHtml(d, stops, true)}</div>
      ${modes.size ? `<div class="dm-legend dm-legline">${LEGEND_ORDER.filter((k) => modes.has(k)).map((k) => `<span class="m-${k}"><em aria-hidden="true">${MODES[k].ic}</em><i></i>${MODES[k].label}</span>`).join("")}</div>` : ""}
    </div>
  </div>`;
}

/* Arrêts du jour avec l'état : prochaine étape (même règle que l'accueil) et étapes faites.
   Les étapes sans numéro (repas, sieste) ne sont jamais « prochaine étape ». */
function mapStops(d) {
  const m = d.map || { stops: [], legs: [] };
  const ph = phase();
  const idx = (key) => d.steps.findIndex((x) => x.key === key);
  let nextKey = null;
  if (ph.kind === "during" && ph.day.id === d.id) nextKey = ph.next?.key || null;
  else if (d.date > nowHK().date) nextKey = d.steps.find((x) => x.placeId && x.dayOffset === 0)?.key || null;
  const ni = nextKey ? idx(nextKey) : -1;
  let flagged = false;
  const legIn = (id) => m.legs.find((l) => l.to === id), legOut = (id) => m.legs.find((l) => l.from === id);
  return m.stops.map((x) => {
    const done = x.step && status(x.step) === "DONE";
    const next = !x.minor && !flagged && ni >= 0 && !done && x.step && idx(x.step) >= ni;
    if (next) flagged = true;
    const mode = (legIn(x.id) || legOut(x.id))?.mode || "walk";
    return { ...x, next, done, mode };
  });
}
/* « Peak Tram, station basse (Garden Road) » → « Peak Tram » · « Station basse · Garden Road ». */
function stopTitle(x) {
  const [t, ...rest] = String(x.name || "").split(/,\s*|\s·\s/);
  const sub = rest.join(" · ").replace(/\s*\(([^)]+)\)/, " · $1");
  return { t, sub: sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : "" };
}
const MINOR_ICON = { meal: "🥢", hotel: "🛏", station: "🚉", pier: "⛴", parking: "P", attraction: "✦" };
const shortOf = (x) => x.short || stopTitle(x).t;
/* Boutons propres à certaines journées : une ville à la fois, plan illustré du parc. */
function mapExtraChips(d) {
  const zs = d.map?.zones || [], cur = mapZone[d.id] ?? 0;
  const z = zs.length > 1 ? zs.map((x, i) => `<button class="pill glass dm-zone ${i === cur ? "on" : ""}" data-mapzone="${i}">${esc(x.name)}</button>`).join("") : "";
  const il = d.map?.illustration ? `<button class="pill glass dm-illu ${mapIllu[d.id] !== false ? "on" : ""}" data-mapillu aria-pressed="${mapIllu[d.id] !== false}">${mapIllu[d.id] !== false ? "Plan du parc" : "Fond standard"}</button>` : "";
  return z + il;
}

/* Libellé du retour : l'écran d'où l'on vient (« Jour 2 », « Aujourd'hui »…). */
function mapBackLabel() {
  const o = stack[stack.length - 2];
  if (!o) return "Aujourd'hui";
  if (o.view === "day") return `Jour ${dayById(o.arg)?.number ?? ""}`.trim();
  return TABS[o.tab] || "Retour";
}
function mapCardHtml(d, stops, embedded) {
  const sel = stops.find((x) => x.id === mapSel[d.id] && !x.minor);
  const nx = sel || stops.find((x) => x.next) || stops.find((x) => !x.minor && !x.done);
  if (!nx) return `<div class="dm-card glass"><p class="muted">Pas d'étape à placer pour ce jour.</p></div>`;
  const pl = placeById(nx.place), t = stopTitle(nx), before = d.date > nowHK().date;
  return `<div class="dm-card glass">
    <div class="dm-thumb">${art(pl?.image, toneOf(d), pl?.nameZh?.slice(0, 1) || d.glyph)}</div>
    <div class="dm-ct">
      <p class="dm-k">${sel && !nx.next ? `Étape ${nx.n}` : before ? "Première étape" : nx.next ? "Prochaine étape" : "Étape"}${nx.time ? ` · ${esc(nx.time)}` : ""}</p>
      <h3>${esc(t.t)}</h3>${t.sub ? `<p class="dm-sub">${esc(t.sub)}</p>` : ""}
    </div>
    <div class="acts dm-acts"><button class="pill red" data-mapstop="${nx.id}">Voir la fiche</button>
      <button class="pill dark dm-amap" data-amapstop="${nx.id}" data-amapday="${d.id}" aria-label="Y aller avec Amap : ${esc(t.t)}"><span aria-hidden="true">➤</span> Amap</button>
      ${embedded ? `<button class="pill" data-daysec="steps">Voir les étapes</button>` : `<button class="pill" data-maplist aria-expanded="${mapListOpen}">${mapListOpen ? "Masquer les étapes" : "Voir les étapes"}</button>`}</div>
  </div>`;
}
function mapListHtml(d, stops) {
  const legs = d.map?.legs || [], legAfter = (id) => legs.find((l) => l.from === id);
  return stops.map((x) => {
    const l = legAfter(x.id), tt = stopTitle(x);
    const row = x.minor
      ? `<li class="dm-minor"><span class="mi">${MINOR_ICON[x.kind] || "•"}</span><span>${esc(x.name)}</span><small>${esc(x.time)}</small></li>`
      : `<li><button class="dm-stop ${x.next ? "next" : ""} ${x.done ? "done" : ""}" data-mapstop="${x.id}">
          <span class="n" style="--c:${x.done ? "#9A9AA0" : MODES[x.mode]?.color}">${x.n}</span><span class="t"><b>${esc(tt.t)}</b>${tt.sub ? `<small>${esc(tt.sub)}</small>` : ""}</span><small class="tm">${x.done ? "fait" : esc(x.time)}</small>
        </button></li>`;
    return row + (l ? `<li class="dm-leg m-${l.mode} ${l.confirm ? "confirm" : ""}"><i></i><em aria-hidden="true">${MODES[l.mode]?.ic || ""}</em><span>${esc(l.label || MODES[l.mode]?.label || "")}${l.confirm ? ` · <b>Trajet à confirmer</b>` : ""}</span></li>` : "");
  }).join("");
}
/* Choix du jour dans le plan plein écran : ‹ Jour 12 · Disneyland › (liste déroulante au milieu). */
function mapDayPicker(d) {
  const i = P.days.findIndex((x) => x.id === d.id), prev = P.days[i - 1], next = P.days[i + 1];
  return `<div class="dm-pick">
    <button class="dm-pa" ${prev ? `data-mapgo="${prev.id}"` : "disabled"} aria-label="Jour précédent">‹</button>
    <label class="dm-day"><span class="sr">Choisir le jour</span><select data-mappick aria-label="Choisir le jour">${P.days.map((x) =>
      `<option value="${x.id}" ${x.id === d.id ? "selected" : ""}>Jour ${x.number} · ${esc(x.city)}</option>`).join("")}</select><span class="dm-caret" aria-hidden="true">▾</span></label>
    <button class="dm-pa" ${next ? `data-mapgo="${next.id}"` : "disabled"} aria-label="Jour suivant">›</button>
  </div>`;
}
/* « Y aller » depuis le plan : le point exact de l'arrêt (repère et bout du tracé), son nom chinois, le mode du tronçon. */
function amapStop(dayId, stopId) {
  const d = dayById(dayId), x = d?.map?.stops.find((s) => s.id === stopId);
  if (!x) return;
  const p = x.place ? placeById(x.place) : null, leg = d.map.legs.find((l) => l.to === x.id);
  const t = { lat: x.lat, lng: x.lng, zh: x.zh || p?.nameZh || "", name: x.name, mode: leg?.mode || "transit" };
  if (N.goAmap) N.goAmap(JSON.stringify(t)); else N.openMap(t.lat, t.lng, t.zh || t.name);
}
function viewMap(dayId) {
  const d = dayById(dayId) || homeData().d;
  const stops = mapStops(d), legs = d.map?.legs || [];
  const modes = new Set(legs.flatMap((l) => l.segments.map((s) => s.mode)));
  const back = mapBackLabel();
  return `<section class="dmap ${mapListOpen ? "list-open" : ""} ${mapLegendOpen ? "legend-open" : ""}" data-mapday="${d.id}">
    <div class="dm-map" id="dmMap">${glOk() ? "" : planSvg(d, stops)}</div>
    <span class="dm-attrib">© les contributeurs d'OpenStreetMap · OpenFreeMap</span>
    <header class="dm-top glass">
      <button class="dm-back" data-mapback aria-label="Retour : ${esc(back)}"><span class="chev" aria-hidden="true">‹</span><span>${esc(back)}</span></button>
      ${mapDayPicker(d)}
      <nav class="daytabs dm-tabs" aria-label="Sections du jour">${DAY_SECS.map(([k, l]) => k === "plan"
        ? `<button class="on" aria-current="page"><span class="tl">${l}</span></button>` : `<button data-mapsec="${k}"><span class="tl">${l}</span></button>`).join("")}</nav>
      <button class="pill dm-reduce" data-mapreduce aria-label="Réduire le plan dans la page du jour"><span aria-hidden="true">⤡</span> Réduire</button>
    </header>
    <div class="dm-tools">
      ${modes.size ? `<div class="dm-legwrap"><button class="pill glass dm-legbtn" data-maplegend aria-expanded="${mapLegendOpen}">Légende</button>
        <div class="dm-legend glass">${LEGEND_ORDER.filter((k) => modes.has(k)).map((k) => `<span class="m-${k}"><em aria-hidden="true">${MODES[k].ic}</em><i></i>${MODES[k].label}</span>`).join("")}</div></div>` : ""}
      <button class="pill glass" data-maplocate><span aria-hidden="true">➤</span> Ma position</button>
      <button class="pill glass" data-mapfit><span aria-hidden="true">⤢</span> Vue du jour</button>
      ${mapExtraChips(d)}
    </div>
    <aside class="dm-side" id="dmPanel">
      <div class="dm-listbox glass" ${mapListOpen ? "" : "hidden"}>
        <div class="dm-lhead"><b>Les étapes</b><button class="dm-x" data-maplist aria-label="Masquer les étapes">×</button></div>
        <ol class="dm-list" id="dmList">${mapListHtml(d, stops)}</ol>
        ${!d.map?.verified ? `<p class="dm-note">Trajets pas encore préparés pour ce jour : repères seulement.</p>` : ""}
      </div>
      <div id="dmCard">${mapCardHtml(d, stops)}</div>
    </aside>
  </section>`;
}

/* ---------- fond de carte : style vectoriel clair, peu de libellés au premier niveau de zoom ---------- */
function mapStyle() {
  const o = location.origin;
  const name = ["coalesce", ["get", "name:fr"], ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
  const road = (cls) => ["in", ["get", "class"], ["literal", cls]];
  const W = (pairs) => ["interpolate", ["exponential", 1.6], ["zoom"], ...pairs];
  return {
    version: 8,
    glyphs: `${o}/osm/fonts/{fontstack}/{range}.pbf`,
    sources: { omt: { type: "vector", tiles: [`${o}/osm/t/{z}/{x}/{y}.pbf`], minzoom: 0, maxzoom: 14, attribution: "© OpenStreetMap · OpenFreeMap" } },
    layers: [
      { id: "fond", type: "background", paint: { "background-color": "#F5F1E8" } },
      { id: "verdure", type: "fill", source: "omt", "source-layer": "landcover", filter: road(["wood", "forest", "grass", "scrub"]), paint: { "fill-color": "#D7ECC9", "fill-opacity": 0.9 } },
      { id: "parcs", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": "#CFE8C0", "fill-opacity": 0.85 } },
      { id: "sable", type: "fill", source: "omt", "source-layer": "landcover", filter: road(["sand"]), paint: { "fill-color": "#F3E9CF" } },
      { id: "eau", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": "#A6DCE7" } },
      { id: "rivieres", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": "#A6DCE7", "line-width": 1.2 } },
      { id: "batiments", type: "fill", source: "omt", "source-layer": "building", minzoom: 14.5, paint: { "fill-color": "#ECE5D8", "fill-outline-color": "#E0D6C5" } },
      { id: "chemins", type: "line", source: "omt", "source-layer": "transportation", minzoom: 15, filter: road(["path", "track"]), paint: { "line-color": "#D8CFBE", "line-width": 1, "line-dasharray": [2, 1.5] } },
      { id: "rues-bord", type: "line", source: "omt", "source-layer": "transportation", minzoom: 13, filter: ["all", road(["minor", "service", "tertiary"]), ["!=", ["get", "brunnel"], "tunnel"]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#E4DCCC", "line-width": W([13, 1.2, 18, 16]) } },
      { id: "rues", type: "line", source: "omt", "source-layer": "transportation", minzoom: 13, filter: ["all", road(["minor", "service", "tertiary"]), ["!=", ["get", "brunnel"], "tunnel"]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": W([13, 0.6, 18, 13]) } },
      { id: "axes-bord", type: "line", source: "omt", "source-layer": "transportation", filter: ["all", road(["motorway", "trunk", "primary", "secondary"]), ["!=", ["get", "brunnel"], "tunnel"]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#E2D8C4", "line-width": W([10, 1.4, 18, 22]) } },
      { id: "axes", type: "line", source: "omt", "source-layer": "transportation", filter: ["all", road(["motorway", "trunk", "primary", "secondary"]), ["!=", ["get", "brunnel"], "tunnel"]],
        layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": W([10, 0.8, 18, 18]) } },
      { id: "voies-ferrees", type: "line", source: "omt", "source-layer": "transportation", minzoom: 14, filter: ["all", road(["rail", "transit"]), ["!=", ["get", "brunnel"], "tunnel"]], paint: { "line-color": "#D2C9B8", "line-width": 1 } },
      { id: "noms-rues", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 15.5,
        layout: { "symbol-placement": "line", "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-max-angle": 30 },
        paint: { "text-color": "#77756F", "text-halo-color": "#FFFFFF", "text-halo-width": 1.4 } },
      { id: "noms-eau", type: "symbol", source: "omt", "source-layer": "water_name", minzoom: 11,
        layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": ["interpolate", ["linear"], ["zoom"], 11, 12, 15, 17], "text-letter-spacing": 0.25, "text-max-width": 12 },
        paint: { "text-color": "#3F8797", "text-halo-color": "rgba(255,255,255,.6)", "text-halo-width": 1 } },
      // Vue d'ensemble (journées sur plusieurs villes) : les villes seulement.
      { id: "villes", type: "symbol", source: "omt", "source-layer": "place", maxzoom: 10.5, filter: ["all", road(["city"]), ["<=", ["coalesce", ["get", "rank"], 99], 6]],
        layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": 13, "text-padding": 10, "text-max-width": 8 },
        paint: { "text-color": "#3A3A3C", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.6 } },
      // Vue du jour : pas de nom de quartier ; ils apparaissent en zoomant (13,4), les rues à 15,5.
      { id: "quartiers", type: "symbol", source: "omt", "source-layer": "place", minzoom: 13.4, filter: road(["suburb", "town"]),
        layout: { "text-field": name, "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12, 12, 16, 16], "text-padding": 24, "text-max-width": 8 },
        paint: { "text-color": "#3A3A3C", "text-halo-color": "rgba(255,255,255,.9)", "text-halo-width": 1.6 } },
      { id: "voisinages", type: "symbol", source: "omt", "source-layer": "place", minzoom: 15, filter: road(["quarter", "neighbourhood"]),
        layout: { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 12, "text-padding": 16, "text-max-width": 8 },
        paint: { "text-color": "#6E6C66", "text-halo-color": "#FFFFFF", "text-halo-width": 1.4 } },
    ],
  };
}

/* ---------- tracés ---------- */
/* Le prochain tronçon (celui qui mène à la prochaine étape) est mis en avant ; les autres sont atténués. */
function lineFC(d, stops) {
  const nx = stops.find((x) => x.next);
  const hl = (l) => (!nx || l.to === nx.id ? 1 : 0);
  const feats = (d.map?.legs || []).flatMap((l) => l.segments.filter((s) => s.path).map((s) => ({
    type: "Feature", properties: { mode: s.mode, hl: hl(l) }, geometry: { type: "LineString", coordinates: s.path.map((p) => [p[1], p[0]]) } })));
  feats.sort((a, b) => a.properties.hl - b.properties.hl);
  return { type: "FeatureCollection", features: feats };
}
/* Points de départ et d'arrivée des trajets à confirmer (petits ronds creux, sans ligne). */
function endsFC(d) {
  const seen = new Set(), feats = [];
  for (const l of d.map?.legs || []) for (const s of l.segments) if (!s.path) for (const p of [s.from, s.to]) {
    if (!p) continue; const k = p.join(); if (seen.has(k)) continue; seen.add(k);
    feats.push({ type: "Feature", properties: { mode: s.mode }, geometry: { type: "Point", coordinates: [p[1], p[0]] } });
  }
  return { type: "FeatureCollection", features: feats };
}
/* Zone à cadrer : toute la journée, ou une ville (journées sur plusieurs villes). */
function dayBounds(d, zi) {
  const z = zi != null && zi >= 0 ? d.map?.zones?.[zi] : null, inZ = (id) => !z || z.stops.includes(id);
  const legs = (d.map?.legs || []).filter((l) => inZ(l.from) && inZ(l.to));
  const pts = [...(d.map?.stops || []).filter((x) => inZ(x.id)).map((x) => [x.lat, x.lng]),
    ...legs.flatMap((l) => l.segments.flatMap((s) => s.path || [s.from, s.to].filter(Boolean)))];
  if (!pts.length) return null;
  const la = pts.map((p) => p[0]), ln = pts.map((p) => p[1]);
  return [[Math.min(...ln), Math.min(...la)], [Math.max(...ln), Math.max(...la)]];
}
/* Ce qui couvre la carte : en-tête, fiche et liste, boutons. Sert au cadrage et au placement des étiquettes. */
function mapObstacles() {
  const sels = mapEmbedded() ? [".dm-full", ".dm-etools .pill"] : [".dm-top", ".dm-reduce", ".dm-card", ".dm-listbox:not([hidden])", ".dm-tools .pill", ".dm-legend"];
  return sels
    .flatMap((sel) => $$(sel).map((e) => e.getBoundingClientRect())).filter((r) => r.width && r.height && getComputedStyle(document.elementFromPoint(r.left + 1, r.top + 1) || document.body).visibility !== "hidden");
}
function mapPadding() {
  if (mapEmbedded()) return { top: 74, left: 70, right: 70, bottom: 74 };
  const W = innerWidth, H = innerHeight, m = 26, r = (sel) => $(sel)?.getBoundingClientRect();
  const top = r(".dm-top"), side = r("#dmPanel"), tools = r(".dm-tools");
  const pad = { top: (top ? top.bottom : 0) + m + 44, left: 90, right: 90, bottom: m + 20 };
  if (side && side.left > W * 0.45 && side.top < H * 0.6) pad.right = W - side.left + m + 40; // fiche à droite (paysage)
  else if (side) pad.bottom = H - side.top + m + 20;                                           // fiche en bas (portrait)
  if (tools) pad.bottom = Math.max(pad.bottom, H - tools.top + m + 20);
  return pad;
}
function mapFit(animate, zi) {
  if (!glMap || !glDay) return;
  const zs = glDay.map?.zones || [];
  // Journée avec plan illustré : on ouvre sur le parc. Sinon, sur la ville de la prochaine étape.
  if (zi === undefined) zi = zs.length > 1 ? (mapZone[glDay.id] ?? (glDay.map?.illustration ? 0 : Math.max(0, zs.findIndex((z) => z.stops.includes(mapStops(glDay).find((x) => x.next)?.id))))) : -1;
  if (zs.length > 1) { mapZone[glDay.id] = zi; $$("[data-mapzone]").forEach((b) => b.classList.toggle("on", +b.dataset.mapzone === zi)); }
  const b = dayBounds(glDay, zi);
  if (!b) return;
  glMap.fitBounds(b, { padding: mapPadding(), duration: animate ? 600 : 0, maxZoom: 16 });
  mapUserMoved = false;
}

/* ---------- repères : point exact, trait de rappel, étiquette numérotée ---------- */
function calloutEl(x) {
  const el = document.createElement("div");
  el.className = `co ${x.minor ? "minor" : ""} ${x.next ? "next" : ""} ${x.done ? "done" : ""} ${glDay && mapSel[glDay.id] === x.id ? "sel" : ""}`;
  el.style.setProperty("--c", x.done ? "#9A9AA0" : MODES[x.mode]?.color || "#E3262B");
  el.innerHTML = `<i class="co-line"></i><span class="co-dot"></span>${x.minor
    ? `<span class="co-b" title="${esc(x.name)}" aria-label="${esc(x.name)}">${MINOR_ICON[x.kind] || "•"}</span>`
    : `<button class="co-b" data-mapstop="${x.id}" aria-label="${x.n}. ${esc(x.name)}"><b>${x.n}</b><span class="co-t">${esc(shortOf(x))}</span></button>`}`;
  return el;
}
/* Un seul repère pour un même hôtel (départ du matin, retour du soir, valises) ou une même gare. */
function mapUniqueStops(stops) {
  const kept = [];
  for (const x of stops) {
    if (x.minor && kept.some((k) => k.minor && k.kind === x.kind && metersBetween(k, x) < 120)) continue;
    kept.push(x);
  }
  return kept;
}
function metersBetween(a, b) {
  const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/* Pastilles de mode (🚄 🚇 ⛴ 🚕…) au milieu des tracés : on lit le moyen de transport sans ouvrir la légende. */
let mapBadges = [];
function mapBadgeList(d) {
  const out = [];
  for (const l of d.map?.legs || []) for (const s of l.segments) {
    if (!s.path || s.path.length < 2) continue;
    const pts = s.path.map(([lat, lng]) => ({ lat, lng }));
    let tot = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { tot += metersBetween(pts[i - 1], pts[i]); cum.push(tot); }
    if (s.mode === "walk" && tot < 350) continue;
    const half = tot / 2, i = Math.max(1, cum.findIndex((c) => c >= half)), t = (half - cum[i - 1]) / Math.max(1, cum[i] - cum[i - 1]);
    out.push({ mode: s.mode, to: l.to, len: tot, lat: pts[i - 1].lat + (pts[i].lat - pts[i - 1].lat) * t, lng: pts[i - 1].lng + (pts[i].lng - pts[i - 1].lng) * t,
      a: pts[0], b: pts[pts.length - 1] });
  }
  return out;
}
function mapPlaceBadges(d) {
  mapBadges.forEach((k) => k.marker.remove());
  mapBadges = mapBadgeList(d).map((x) => {
    const el = document.createElement("div");
    el.className = "mb"; el.style.setProperty("--c", MODES[x.mode]?.color || "#6E6E73");
    el.innerHTML = `<span aria-label="${esc(MODES[x.mode]?.label || "")}">${MODES[x.mode]?.ic || "•"}</span>`;
    return { x, el, marker: new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([x.lng, x.lat]).addTo(glMap) };
  });
}
function mapPlaceMarkers(d, stops) {
  mapMarkers.forEach((k) => k.marker.remove());
  mapPlaceBadges(d);
  mapMarkers = mapUniqueStops(stops).map((x) => {
    const el = calloutEl(x);
    const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([x.lng, x.lat]).addTo(glMap);
    return { x, el, marker, b: el.querySelector(".co-b"), line: el.querySelector(".co-line") };
  });
  requestAnimationFrame(mapDeclutter);
}
/* Place chaque étiquette autour de son point sans chevaucher les autres ni l'interface : la prochaine étape
   d'abord, puis les étapes dans l'ordre, puis les repas et la sieste. Sans place pour l'étiquette entière,
   on garde le numéro seul. Le point reste toujours à l'endroit exact ; un trait le relie à l'étiquette. */
function mapDeclutter() {
  if (!glMap || !mapMarkers.length) return;
  const box = $("#dmMap").getBoundingClientRect(), W = box.width, H = box.height, gap = 12, pad = 3;
  const obstacles = mapObstacles().map((r) => ({ l: r.left - box.left - 4, r: r.right - box.left + 4, t: r.top - box.top - 4, b: r.bottom - box.top + 4 }));
  const pts = mapMarkers.map((k) => glMap.project([k.x.lng, k.x.lat]));
  const dots = pts.map((p) => ({ l: p.x - 5, r: p.x + 5, t: p.y - 5, b: p.y + 5 }));
  const hit = (a, b) => a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
  const order = mapMarkers.map((k, i) => i).sort((i, j) => {
    const a = mapMarkers[i].x, b = mapMarkers[j].x;
    return (b.next - a.next) || (a.minor - b.minor) || (a.n - b.n);
  });
  const placed = [];
  for (const i of order) {
    const k = mapMarkers[i], p = pts[i];
    // Par ordre de préférence : étiquette près du point, étiquette un peu plus loin, numéro seul près du point,
    // étiquette loin, numéro seul loin. Une étiquette éloignée ne passe qu'après le numéro seul.
    const near = (w, h) => [[0, -(h / 2 + gap + 6)], [w / 2 + gap, -h / 2], [-(w / 2 + gap), -h / 2], [w / 2 + gap, h / 2], [-(w / 2 + gap), h / 2], [0, h / 2 + gap + 2],
      [w / 2 + gap + 8, -(h + gap)], [-(w / 2 + gap + 8), -(h + gap)], [w / 2 + gap + 8, h + gap], [-(w / 2 + gap + 8), h + gap]];
    const ring = (w, rs) => rs.flatMap((r) => [...Array(8)].map((_, a) => { const t = -Math.PI / 2 + (a * Math.PI) / 4; return [Math.cos(t) * (r + w / 2), Math.sin(t) * r]; }));
    const stages = k.x.minor ? [[false, "near"], [false, "mid"], [false, "far"]]
      : [[false, "near"], [false, "mid"], [true, "near"], [false, "far"], [true, "mid"], [true, "far"]];
    let done = false;
    for (const [compact, dist] of stages) {
      k.el.classList.toggle("compact", compact);
      const w = k.b.offsetWidth, h = k.b.offsetHeight;
      const c = dist === "near" ? near(w, h) : dist === "mid" ? ring(w, [60]) : ring(w, [92, 128]);
      const rect = ([dx, dy]) => ({ l: p.x + dx - w / 2, r: p.x + dx + w / 2, t: p.y + dy - h / 2, b: p.y + dy + h / 2 });
      const ok = (q) => q.l >= 4 && q.r <= W - 4 && q.t >= 4 && q.b <= H - 4 && !placed.some((z) => hit(q, z)) && !obstacles.some((z) => hit(q, z)) && !dots.some((z, j) => j !== i && hit(q, z));
      const best = c.find((o) => ok(rect(o)));
      if (best) { mapPlace(k, p, best, w, h, rect(best), compact, placed); done = true; break; }
    }
    if (!done) { k.el.classList.add("compact"); const w = k.b.offsetWidth, h = k.b.offsetHeight, o = [0, -(h / 2 + gap + 6)];
      mapPlace(k, p, o, w, h, { l: p.x - w / 2, r: p.x + w / 2, t: p.y + o[1] - h / 2, b: p.y + o[1] + h / 2 }, true, placed); }
  }
  // Pastilles de mode : seulement là où il reste de la place, et sur un tracé assez long à l'écran.
  for (const k of mapBadges.sort((a, b) => b.x.len - a.x.len)) {
    const p = glMap.project([k.x.lng, k.x.lat]), a = glMap.project([k.x.a.lng, k.x.a.lat]), b = glMap.project([k.x.b.lng, k.x.b.lat]);
    const q = { l: p.x - 14, r: p.x + 14, t: p.y - 14, b: p.y + 14 };
    const ok = Math.hypot(a.x - b.x, a.y - b.y) > 70 && q.l >= 4 && q.r <= W - 4 && q.t >= 4 && q.b <= H - 4
      && !placed.some((z) => hit(q, z)) && !obstacles.some((z) => hit(q, z)) && !dots.some((z) => hit(q, z));
    k.el.hidden = !ok;
    if (ok) placed.push(q);
  }
}
function mapPlace(k, p, best, w, h, q, compact, placed) {
  placed.push(q);
  k.pos = { dx: best[0], dy: best[1], w, h, compact };
  k.b.style.transform = `translate(${best[0] - w / 2}px, ${best[1] - h / 2}px)`;
  // Trait du point au bord de l'étiquette.
  const tx = Math.max(q.l, Math.min(p.x, q.r)) - p.x, ty = Math.max(q.t, Math.min(p.y, q.b)) - p.y, len = Math.hypot(tx, ty);
  k.line.style.width = `${Math.max(0, len - 4)}px`;
  k.line.style.transform = `rotate(${Math.atan2(ty, tx)}rad)`;
}
let mapDeclutterQueued = false;
const mapQueueDeclutter = () => { if (mapDeclutterQueued) return; mapDeclutterQueued = true; requestAnimationFrame(() => { mapDeclutterQueued = false; mapDeclutter(); }); };

function mapMount() {
  const sec = mapRoot(), el = $("#dmMap");
  if (!sec || !el || !glOk()) return;
  const d = dayById(sec.dataset.mapday), stops = mapStops(d);
  glDay = d; mapShownSig = stops.map((x) => `${x.next ? 1 : 0}${x.done ? 1 : 0}`).join("");
  let m;
  try {
    m = new maplibregl.Map({ container: el, style: mapStyle(), attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      minZoom: 4.5, maxZoom: 18, fadeDuration: 150, localIdeographFontFamily: "'Noto Sans CJK SC','Noto Sans SC',sans-serif", center: [114.17, 22.29], zoom: 12 });
  } catch (e) { mapFailed = true; el.innerHTML = planSvg(d, stops); return; }
  glMap = m;
  m.touchZoomRotate.disableRotation();
  m.on("error", (e) => { if (/webgl/i.test(String(e?.error?.message || ""))) { mapFailed = true; refreshView(); } });
  m.on("load", () => {
    m.addSource("legs", { type: "geojson", data: lineFC(d, mapStops(d)) });
    m.addSource("acc", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    m.addSource("me", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const hl = (a, b) => ["case", ["==", ["get", "hl"], 1], a, b];
    m.addLayer({ id: "legs-casing", type: "line", source: "legs", layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 11, hl(8, 5.5), 16, hl(14, 10)], "line-opacity": hl(0.95, 0.7) } });
    // Chaque mode a son dessin : pointillés verts à pied, tirets bleus en ferry, tirets ambre en taxi,
    // trait plein pour le métro, le bus et la voiture, et un rail (trait violet coupé de traverses blanches) pour le train.
    const dash = { ferry: [2.2, 1.6], walk: [0, 2], taxi: [1.6, 1], cablecar: [1.2, 0.8] };
    const thick = { train: [5, 9], metro: [4.5, 8], walk: [4, 7] };
    for (const k of LEGEND_ORDER) {
      const [w0, w1] = thick[k] || [4, 7];
      m.addLayer({ id: `leg-${k}`, type: "line", source: "legs", filter: ["==", ["get", "mode"], k],
        layout: { "line-cap": k === "ferry" || k === "taxi" || k === "cablecar" ? "butt" : "round", "line-join": "round" },
        paint: { "line-color": MODES[k].color, "line-width": ["interpolate", ["linear"], ["zoom"], 6, hl(w0, w0 * 0.8), 11, hl(w0 * 1.3, w0), 16, hl(w1 * 1.3, w1)], "line-opacity": hl(1, 0.62), ...(dash[k] ? { "line-dasharray": dash[k] } : {}) } });
      if (k === "train") m.addLayer({ id: "leg-train-ties", type: "line", source: "legs", filter: ["==", ["get", "mode"], "train"], layout: { "line-cap": "butt" },
        paint: { "line-color": "#FFFFFF", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 11, 2.2, 16, 3.5], "line-dasharray": [1.2, 1.6], "line-opacity": hl(0.95, 0.7) } });
    }
    m.addSource("ends", { type: "geojson", data: endsFC(d) });
    m.addLayer({ id: "ends", type: "circle", source: "ends", paint: { "circle-radius": 6, "circle-color": "#FFFFFF", "circle-stroke-width": 2.5, "circle-stroke-color": "#8A8A8E" } });
    const il = d.map?.illustration;
    if (il) {
      m.addSource("plan-parc", { type: "image", url: il.image, coordinates: il.coordinates });
      m.addLayer({ id: "plan-parc", type: "raster", source: "plan-parc", paint: { "raster-fade-duration": 0, "raster-opacity": 1 },
        layout: { visibility: mapIllu[d.id] === false ? "none" : "visible" } }, "legs-casing");
    }
    m.addLayer({ id: "acc", type: "fill", source: "acc", paint: { "fill-color": "rgba(10,132,255,.16)", "fill-outline-color": "rgba(10,132,255,.45)" } });
    m.addLayer({ id: "me", type: "circle", source: "me", paint: { "circle-radius": 8, "circle-color": "#0A84FF", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 } });
    mapTrackRender(); // suivi déjà actif (passage petite carte ↔ plein écran, autre jour) : le point réapparaît tout de suite
    if (mapMe) mapShowMe(mapMe);
  });
  mapPlaceMarkers(d, stops);
  const panel = $("#dmPanel");
  if (panel && window.ResizeObserver) new ResizeObserver(() => { sec.style.setProperty("--panel-h", `${panel.offsetHeight}px`); mapQueueDeclutter(); }).observe(panel);
  const cam = mapCam[d.id];
  if (cam) { m.jumpTo(cam); mapUserMoved = true; } else requestAnimationFrame(() => mapFit(false));
  m.on("move", mapQueueDeclutter);
  m.on("moveend", () => { mapCam[d.id] = { center: m.getCenter(), zoom: m.getZoom() }; });
  m.on("dragstart", () => { mapUserMoved = true; });
  m.on("zoomstart", (e) => { if (e.originalEvent) mapUserMoved = true; });
}
/* Prochaine étape changée (heure, étape cochée) : on met à jour la fiche, la liste, les repères et les tracés
   sur place, sans recharger la vue : une fiche ouverte reste ouverte, le cadrage ne bouge pas. */
function mapUpdate() {
  const sec = mapRoot(); if (!sec) return;
  const d = dayById(sec.dataset.mapday), stops = mapStops(d);
  if ($("#dmCard")) $("#dmCard").innerHTML = mapCardHtml(d, stops, mapEmbedded());
  const list = $("#dmList"); if (list) { const y = list.scrollTop; list.innerHTML = mapListHtml(d, stops); list.scrollTop = y; }
  if (glMap) { glMap.getSource("legs")?.setData(lineFC(d, stops)); mapPlaceMarkers(d, stops); }
}
function mapTeardown() {
  mapMarkers = []; mapBadges = [];
  if (glMap) { try { glMap.remove(); } catch {} glMap = null; glDay = null; }
}
/* La fiche ou la liste change de taille (orientation, ouverture) : on recadre si l'utilisateur n'a pas bougé la carte. */
function mapRelayout() {
  if (!glMap) return;
  glMap.resize();
  if (!mapUserMoved) mapFit(false); else mapQueueDeclutter();
}
addEventListener("resize", () => { clearTimeout(mapRelayout.t); mapRelayout.t = setTimeout(mapRelayout, 120); });
function mapSync() { if (glMap) { glMap.resize(); mapQueueDeclutter(); } }

/* ---------- position : point bleu et cercle de précision ---------- */
let mapMe = null, mapGpsTimer = null, mapLocateAsked = false;
function mapCircle(lat, lng, r) {
  const ring = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI; ring.push([lng + (r / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (r / 111320) * Math.sin(a)]); }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}
function mapShowMe(g) {
  const m = glMap; if (!m || !m.getSource("me")) return;
  m.getSource("me").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [g.lng, g.lat] } }] });
  m.getSource("acc").setData({ type: "FeatureCollection", features: [mapCircle(g.lat, g.lng, Math.max(5, g.accuracy || 20))] });
}
/* Suivi de position : une fois activé avec « Ma position », il dure tant qu'un plan est affiché
   (petite carte ou plein écran, d'un jour à l'autre) et s'arrête dès qu'on quitte le plan.
   La carte n'est jamais recentrée d'office : seulement à la première position et quand on touche « Ma position ». */
let mapTrack = false, mapCenterNext = false, mapStale = false;
const MAP_STALE_MS = 15000;
function mapLocate() {
  if (!glMap) return planLocate();
  if (!N.hasLocationPermission()) { mapLocateAsked = true; N.requestLocationPermission(); return; }
  if (!mapTrack) {
    mapTrack = true; N.gpsStart(); mapTrackLoop();
    if (!mapMe) toast("Recherche de ta position…");
  }
  if (mapMe && !mapStale) mapCenterOnMe();
  else { mapCenterNext = true; if (mapMe) { mapCenterOnMe(); toast("Signal perdu : la carte montre ta dernière position connue."); } }
  mapTrackRender();
}
function mapCenterOnMe() {
  if (!glMap || !mapMe) return;
  glMap.easeTo({ center: [mapMe.lng, mapMe.lat], zoom: Math.max(glMap.getZoom(), 15.5), duration: 600 });
  mapUserMoved = true;
}
function mapTrackLoop() {
  clearInterval(mapGpsTimer);
  const t0 = Date.now(); let warned = false;
  mapGpsTimer = setInterval(() => {
    if (!mapTrack) return;
    const g = json(N.gpsState(), {});
    const fresh = g.lat != null && (g.fixAgeMs == null || g.fixAgeMs < MAP_STALE_MS);
    if (fresh) {
      mapMe = { lat: g.lat, lng: g.lng, accuracy: g.accuracy, at: Date.now() - (g.fixAgeMs || 0) };
      mapStale = false;
      if (mapCenterNext) { mapCenterNext = false; mapCenterOnMe(); }
    } else {
      mapStale = !!mapMe;
      if (!mapMe && !warned && Date.now() - t0 > 25000) { warned = true; toast(g.error || "Pas encore de position : le GPS capte mieux à l'extérieur."); }
    }
    mapTrackRender();
  }, 1000);
}
/* Point bleu (à jour) ou gris (dernière position connue), cercle de précision, bandeau et état du bouton. */
function mapTrackRender() {
  $$("[data-maplocate]").forEach((b) => { b.classList.toggle("on", mapTrack); b.setAttribute("aria-pressed", mapTrack ? "true" : "false"); });
  const box = $("#dmMap")?.parentElement;
  let note = $("#dmGpsNote");
  if (mapTrack && mapStale && mapMe && box) {
    if (!note) { note = document.createElement("div"); note.id = "dmGpsNote"; note.className = "dm-gpsnote"; note.setAttribute("role", "status"); box.appendChild(note); }
    const min = Math.round((Date.now() - mapMe.at) / 60000);
    note.textContent = `Signal GPS perdu · dernière position connue, ${min < 1 ? "il y a moins d'une minute" : `il y a ${min} min`}`;
  } else note?.remove();
  const m = glMap; if (!m || !m.getLayer("me")) return;
  if (!mapTrack || !mapMe) { m.getSource("me").setData({ type: "FeatureCollection", features: [] }); m.getSource("acc").setData({ type: "FeatureCollection", features: [] }); return; }
  mapShowMe(mapMe);
  m.setPaintProperty("me", "circle-color", mapStale ? "#8E8E93" : "#0A84FF");
  m.setPaintProperty("acc", "fill-color", mapStale ? "rgba(142,142,147,.14)" : "rgba(10,132,255,.16)");
  m.setPaintProperty("acc", "fill-outline-color", mapStale ? "rgba(142,142,147,.45)" : "rgba(10,132,255,.45)");
}
function mapStopGps() {
  if (mapGpsTimer) { clearInterval(mapGpsTimer); mapGpsTimer = null; }
  if (mapTrack) { mapTrack = false; N.gpsStop && N.gpsStop(); }
  mapMe = null; mapStale = false; mapCenterNext = false;
  $("#dmGpsNote")?.remove();
}

/* Plan de secours (sans WebGL) : projection simple des coordonnées, sans fond de carte. */
function planSvg(d, stops) {
  if (!stops.length) return `<div class="dm-empty">Pas de lieux à placer pour ce jour.</div>`;
  const segs = (d.map?.legs || []).flatMap((l) => l.segments);
  const pts = [...stops.map((x) => [x.lat, x.lng]), ...segs.flatMap((s) => s.path)];
  const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length, k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 1000, H = 700, pad = 90, sc = Math.min((W - 2 * pad) / (x1 - x0 || 1e-3), (H - 2 * pad) / (y1 - y0 || 1e-3));
  const ox = (W - sc * (x1 - x0)) / 2, oy = (H - sc * (y1 - y0)) / 2;
  const P2 = (lat, lng) => [ox + (lng * k - x0) * sc, oy + (-lat - y0) * sc];
  planSvg.proj = { P2, W, H };
  return `<svg class="plan" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${segs.map((s) => `<polyline class="pl m-${s.mode}" points="${s.path.map((p) => P2(p[0], p[1]).map((v) => v.toFixed(1)).join(",")).join(" ")}"/>`).join("")}
      <g id="planMe"></g>
      ${stops.filter((x) => !x.minor).map((x) => { const [px, py] = P2(x.lat, x.lng);
        return `<g class="pin ${x.next ? "next" : ""} ${x.done ? "done" : ""}" data-mapstop="${x.id}" transform="translate(${px.toFixed(1)},${py.toFixed(1)})"><circle r="${x.next ? 22 : 17}" style="fill:${MODES[x.mode]?.color}"/><text dy=".36em">${x.n}</text></g>`; }).join("")}
    </svg><p class="dm-plan-note">Plan simplifié : la carte n'a pas pu s'afficher sur cet écran.</p>`;
}
function planLocate() {
  if (!N.hasLocationPermission()) { mapLocateAsked = true; N.requestLocationPermission(); return; }
  N.gpsStart(); toast("Recherche de ta position…");
  let tries = 0;
  const poll = () => {
    if (!$("#planMe")) return;
    const g = json(N.gpsState(), {});
    if (g.lat != null && planSvg.proj) {
      const [x, y] = planSvg.proj.P2(g.lat, g.lng);
      if (x < -200 || y < -200 || x > planSvg.proj.W + 200 || y > planSvg.proj.H + 200) return toast("Tu es hors de cette carte : ta position s'affichera sur place.");
      $("#planMe").innerHTML = `<circle class="acc" cx="${x}" cy="${y}" r="${Math.max(10, Math.min(120, (g.accuracy || 20) / 4))}"/><circle class="me" cx="${x}" cy="${y}" r="9"/>`;
      return;
    }
    if (++tries < 30) setTimeout(poll, 1000); else toast("Pas encore de position : réessaie à l'extérieur.");
  };
  poll();
}

/* Arrêt dont la fiche est ouverte depuis la Carte du jour : « Y aller » y utilise exactement son point. */
let sheetStop = null;
function openMapStop(id) {
  const d = dayById(mapRoot()?.dataset.mapday);
  const x = d?.map?.stops.find((s) => s.id === id);
  if (!x || !x.place) return;
  // Le lieu touché devient le lieu sélectionné, dans les deux formats.
  mapSel[d.id] = x.id;
  mapMarkers.forEach((k) => k.el.classList.toggle("sel", k.x.id === x.id));
  if ($("#dmCard")) $("#dmCard").innerHTML = mapCardHtml(d, mapStops(d), mapEmbedded());
  sheetStop = x.id; openPlace(x.place);
}
/* Destination de « Y aller » : le point de l'arrêt (celui du repère et du tracé), son nom chinois
   et le mode du tronçon qui y mène. Sans arrêt correspondant, repli sur la fiche du lieu. */
function amapTarget(placeId) {
  let stop = null, day = null;
  const scan = (id, ds) => { for (const d of ds) { const s = d.map?.stops.find((x) => x.id === id); if (s) return [s, d]; } return null; };
  if (sheetStop) { const hit = scan(sheetStop, P.days); if (hit && hit[0].place === placeId) [stop, day] = hit; }
  if (!stop) { const hit = scan(placeId, P.days); if (hit) [stop, day] = hit; }
  const p = placeById(placeId);
  if (!stop) return { lat: p.lat, lng: p.lng, zh: p.nameZh, name: p.name, mode: "transit" };
  const leg = day.map.legs.find((l) => l.to === stop.id);
  return { lat: stop.lat, lng: stop.lng, zh: stop.zh || p.nameZh, name: stop.name, mode: leg?.mode || "transit" };
}
function goAmap(placeId) {
  const t = amapTarget(placeId);
  if (N.goAmap) N.goAmap(JSON.stringify(t)); else N.openMap(t.lat, t.lng, t.zh || t.name);
}

after.programme = (view) => {
  if (view === "day" && $(".dm-embed")) return requestAnimationFrame(mapMount);
  if (view !== "map") return;
  const list = $("#dmList"), day = $(".dmap").dataset.mapday;
  if (list) { list.scrollTop = mapScroll[day] || 0; list.addEventListener("scroll", () => { mapScroll[day] = list.scrollTop; }, { passive: true }); }
  requestAnimationFrame(mapMount);
};
/* Les cinq onglets du jour tiennent sur une ligne : si un libellé déborde, on retire les compteurs,
   puis on resserre les marges ; l'onglet actif garde son fond et sa couleur. */
function fitDayTabs() {
  for (const nav of $$(".daytabs")) {
    nav.classList.remove("nocount", "tight", "smaller");
    const over = () => [...nav.children].some((b) => { const t = b.querySelector(".tl") || b; return b.scrollWidth > b.clientWidth + 1 || t.scrollWidth > t.clientWidth + 1; });
    if (over()) nav.classList.add("nocount");
    if (over()) nav.classList.add("tight");
    if (over()) nav.classList.add("smaller"); // écran très étroit seulement : on réduit un peu le texte
  }
}
addEventListener("resize", () => requestAnimationFrame(fitDayTabs));
function refreshView() { const st = stack[stack.length - 1]; if (st) go(st.tab, st.view, st.arg, false); }
let mapShownSig = "";
function refreshMap() {
  const sec = mapRoot();
  if (!sec) return;
  const sig = mapStops(dayById(sec.dataset.mapday)).map((x) => `${x.next ? 1 : 0}${x.done ? 1 : 0}`).join("");
  if (mapShownSig && sig !== mapShownSig) mapUpdate();
  mapShownSig = sig;
}
/* Contrôle (aperçu et tests) : chaque repère est-il visible, hors de l'interface, sans chevauchement, et son
   point est-il exactement sur le lieu ? */
window.__mapCheck = () => {
  if (!glMap) return null;
  const bx = $("#dmMap").getBoundingClientRect();
  const ui = mapObstacles();
  const boxes = mapMarkers.map((k) => k.b.getBoundingClientRect());
  return mapMarkers.map((k, i) => {
    const r = boxes[i], p0 = glMap.project([k.x.lng, k.x.lat]), p = { x: p0.x + bx.left, y: p0.y + bx.top }, dot = k.el.querySelector(".co-dot").getBoundingClientRect();
    const ov = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { id: k.x.id, label: !k.el.classList.contains("compact"), inView: r.left >= bx.left && r.right <= bx.right && r.top >= bx.top && r.bottom <= bx.bottom,
      hidden: ui.filter((q) => ov(r, q)).length, overlap: boxes.filter((q, j) => j !== i && ov(r, q)).length,
      off: Math.round(Math.hypot(dot.left + dot.width / 2 - p.x, dot.top + dot.height / 2 - p.y)) };
  });
};

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
const DAY_SECS = [["steps", "Étapes"], ["plan", "Plan"], ["visits", "Visites"], ["meals", "Repas"], ["infos", "Infos"]];
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
  const count = { plan: 0, steps: pr.total, visits: d.visits.length, meals: d.meals.length || d.mealNotes.length, infos: d.charlie.length + d.tips.length + d.photos.length + d.planB.length };
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
  } else if (sec === "plan") {
    body = mapEmbedHtml(d);
  } else if (sec === "visits") {
    body = d.visits.length ? `<div class="pgrid wide">${d.visits.map((v) =>
      `<button class="pcard" data-place="${v.id}">${art(v.image, tone, v.nameZh?.slice(0, 1))}<b>${esc(v.name)}</b><small class="sum">${esc(v.summary)}</small></button>`).join("")}</div>` : `<p class="muted">Pas de visite détaillée ce jour-là.</p>`;
  } else if (sec === "meals") {
    body = `<div style="display:grid;gap:18px">${mealSlots(d)}</div>`;
  } else {
    const list = (title, items, cls = "") => items.length ? `<div class="tile ${cls}"><h3>${title}</h3><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
    body = `<div class="bento">${list("Pour Charlie", d.charlie, `tone tone-${tone}`)}${list("Bon à savoir", d.tips)}${list("Les photos", d.photos)}${list("Plan B", d.planB)}</div>`;
  }
  return `<header class="dayhead2 tone-${tone} ${sec === "plan" ? "compact" : ""}">
      ${art(d.image, tone, d.glyph, "dh-img")}
      <div class="dh-txt">
        <p class="eyebrow">Jour ${d.number} · ${frDate(d.date)} · ${esc(d.city)}</p>
        <h1 class="h2">${esc(d.title)}</h1>
        <p class="dh-lede">${esc(d.lede)}</p>
        <div class="acts"><button class="pill" data-back>‹ Programme</button>${audioBtn(d.audio, "Écouter la journée")}<span class="muted" style="font-size:.9rem;align-self:center">${pr.done}/${pr.total} étapes faites</span></div>
      </div>
    </header>
    <nav class="daytabs glass">${DAY_SECS.map(([k, l]) => `<button class="${k === sec ? "on" : ""}" data-daysec="${k}" ${k === sec ? `aria-current="page"` : ""}><span class="tl">${l}</span>${count[k] ? `<small>${count[k]}</small>` : ""}</button>`).join("")}</nav>
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
      <button class="pill" data-map="${p.id}">Y aller (AMap)</button>
      <button class="pill" data-askplace="${p.id}">Demander au guide</button></div>
    ${days.length ? `<div class="fsec"><h3>Au programme</h3><div class="acts">${days.map((d) => `<button class="pill" data-day="${d.id}">Jour ${d.number} · ${esc(d.city)}</button>`).join("")}</div></div>` : ""}
  </div></div>
  ${p.shots?.length ? `<section class="sec"><h2 class="h3">Conseils photo et vidéo</h2><div class="bento">${p.shots.map(shotHtml).join("")}</div></section>` : ""}
  <p class="muted" style="font-size:.85rem">${(() => { const t = amapTarget(p.id); return `${t.lat.toFixed(5)}, ${t.lng.toFixed(5)} (WGS-84) · point visé par Y aller`; })()}</p>`;
  $("#sheet").hidden = false;
  $("#sheet").scrollTop = 0;
  mapSync();
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
function closeSheet() { const was = !$("#sheet").hidden; $("#sheet").hidden = true; sheetStop = null; if (was) mapSync(); }

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
/* Illustrations des tuiles du guide, embarquées dans l'APK (assets/ui/covers) : disponibles avant toute synchronisation.
   Toutes au format 16:9, comme la tuile : l'image entière est visible, en portrait comme en paysage.
   pos = point d'intérêt gardé au centre si la tuile changeait un jour de proportions. */
const COVERS = {
  "hong-kong": { pos: "56% 50%" }, macao: { pos: "50% 55%" }, canton: { pos: "45% 60%" }, shenzhen: { pos: "60% 50%" },
  "riviere-li": { pos: "45% 55%" }, dimsum: { pos: "50% 55%" }, massage: { pos: "50% 50%", cut: true },
};
function coverArt(a, tone) {
  const c = COVERS[a.id];
  return `<div class="art tone-${tone} cover ${c.cut ? "cover-cut" : ""}"><span class="g">${esc(a.glyph || "")}</span><img src="covers/${a.id}.webp" alt="" width="1672" height="941" style="object-position:${c.pos}" onload="this.parentNode.classList.add('has-img')" onerror="this.remove()"></div>`;
}
function guideLearn() {
  const card = (a) => {
    const im = a.images[0];
    const tone = (a.html.match(/tone-([a-z]+)/) || [])[1] || "hk";
    return `<button class="acard" data-article="${a.id}">${COVERS[a.id] ? coverArt(a, tone) : art(im, tone, a.glyph, "")}<b>${esc(a.title)}</b></button>`;
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
  return `<p class="sub" style="margin:0 auto;text-align:center">Le carnet est l'écran d'accueil : les autres applications s'ouvrent d'ici.</p>
    <div class="apps">${apps.map((a) => `<button class="app" data-app="${esc(a.pkg)}"><img src="/appicon/${esc(a.pkg)}.png" alt="">${esc(a.label)}</button>`).join("")}</div>`;
}
function moreDevice() {
  const d = json(N.device(), {});
  const f = (n) => (typeof n === "number" ? n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "?");
  return `<div class="bento"><div class="tile"><h3>Tablette</h3><ul class="kv">
      <li><span>Modèle</span><span>${esc(d.model)}</span></li><li><span>Android</span><span>${esc(d.android)} (API ${d.sdk})</span></li>
      <li><span>Mémoire vive</span><span>${f(d.ramGb)} Go</span></li><li><span>Stockage libre</span><span>${f(d.freeGb)} Go sur ${f(d.totalGb)} Go</span></li>
      <li><span>Services Google</span><span>${d.playServices ? "présents, non utilisés" : "absents"}</span></li><li><span>Puce GNSS</span><span>${esc(d.gnss)}</span></li>
      <li><span>Version de l'application</span><span>${esc(N.version())}</span></li></ul></div>
    <div class="tile"><h3>Test GPS sans Google</h3><p>La puce GPS seule : dehors, Wi-Fi coupé, pour une mesure réaliste.</p>
      <ul class="kv" id="gpsKv"></ul><div class="acts"><button class="pill red" id="gpsBtn">Lancer le test</button></div></div></div>`;
}
function moreSettings() {
  const home = N.isDefaultHome();
  const sim = store.get("simDate", "");
  return `<div class="bento">
    <div class="tile"><h3>Écran d'accueil</h3><p>${home ? "Le carnet est l'écran d'accueil : la tablette démarre sur le choix du profil." : "Pour démarrer la tablette sur le carnet, choisissez « Carnet de voyage » comme application d'accueil."}</p>
      <div class="acts"><button class="pill ${home ? "" : "red"}" data-settings="home">${home ? "Changer d'écran d'accueil" : "Choisir le carnet"}</button><button class="pill" data-settings="android">Réglages Android</button></div></div>
    <div class="tile"><h3>Écran de veille</h3>
      <p><b>Économiseur d'écran</b> : quand la tablette charge, le carnet affiche la photo du jour, l'heure et la prochaine étape. Choisissez « Carnet de voyage » dans le réglage Android.</p>
      <div class="acts"><button class="pill red" data-settings="dream">Choisir l'économiseur</button></div>
      <p><b>Écran verrouillé</b> : les lanternes du carnet en fond (l'horloge reste celle d'Android).</p>
      <div class="seg" id="lockSeg"><button class="${store.get("lockWp", false) ? "" : "on"}" data-lockwp="0">Non</button><button class="${store.get("lockWp", false) ? "on" : ""}" data-lockwp="1">Oui</button></div></div>
    <div class="tile"><h3>Carte</h3><p>Fond de carte OpenStreetMap, sans compte ni clé. <b>Y aller</b> ouvre AMap avec la destination et le mode déjà choisis.</p>
      <p><b>Cartes hors ligne</b> : une zone par journée, à télécharger en Wi-Fi avant le départ pour garder la carte sans réseau. <span class="muted" id="offlineState"></span></p>
      <div class="acts"><button class="pill" id="offlineGo">Télécharger les journées</button></div></div>
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
  $("#offlineGo")?.addEventListener("click", () => {
    /* Une région par journée : boîte autour des arrêts et des tracés (WGS-84). */
    const regs = P.days.filter((d) => d.map?.stops?.length).map((d) => {
      const pts = [...d.map.stops.map((x) => [x.lat, x.lng]), ...d.map.legs.flatMap((l) => l.path || [])];
      const lat = pts.map((p) => p[0]), lng = pts.map((p) => p[1]);
      return { id: d.id, name: `Jour ${d.number}`, s: Math.min(...lat), n: Math.max(...lat), w: Math.min(...lng), e: Math.max(...lng) };
    });
    N.offlineMaps(JSON.stringify(regs)); toast("Téléchargement lancé : laisse la tablette en Wi-Fi.");
  });
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
    window.TravelOS.onGpsPermission = () => { if (N.hasLocationPermission()) { N.gpsStart(); setTimeout(poll, 300); } else draw(); };
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

// Choix du jour dans le plan plein écran.
document.addEventListener("change", (e) => {
  const id = e.target.matches?.("[data-mappick]") && e.target.value;
  if (id) { stack[stack.length - 1] = { tab: "programme", view: "map", arg: id }; go("programme", "map", id, false); }
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("button,[data-day],[data-place],[data-mapstop]");
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { stack = []; return go(d.tab); }
  if (d.daymap) return go("programme", "map", d.daymap);
  if (d.mapgo !== undefined) { if (d.mapgo) { stack[stack.length - 1] = { tab: "programme", view: "map", arg: d.mapgo }; go("programme", "map", d.mapgo, false); } return; }
  if (d.mapstop) return openMapStop(d.mapstop);
  if (d.amapstop) return amapStop(d.amapday, d.amapstop);
  if (d.maplocate !== undefined) return mapLocate();
  if (d.mapfit !== undefined) { if (glMap) { mapUserMoved = false; mapFit(true, (glDay?.map?.zones?.length > 1) ? -1 : undefined); } else $("#planMe") && ($("#planMe").innerHTML = ""); return; }
  if (d.mapback !== undefined) return back();
  if (d.mapzone !== undefined) { mapUserMoved = false; return mapFit(true, +d.mapzone); }
  if (d.mapillu !== undefined) {
    const day = mapRoot()?.dataset.mapday; mapIllu[day] = mapIllu[day] === false;
    glMap?.getLayer("plan-parc") && glMap.setLayoutProperty("plan-parc", "visibility", mapIllu[day] ? "visible" : "none");
    t.classList.toggle("on", mapIllu[day]); t.setAttribute("aria-pressed", mapIllu[day]); t.textContent = mapIllu[day] ? "Plan du parc" : "Fond standard"; return;
  }
  if (d.mapfull !== undefined) { const day = mapRoot()?.dataset.mapday; return go("programme", "map", day); }
  if (d.mapreduce !== undefined) {
    // Retour à l'onglet Plan de la même journée (la page d'où l'on vient, si c'en est une).
    const day = mapRoot()?.dataset.mapday, prev = stack[stack.length - 2];
    store.set("daySec", "plan");
    if (prev?.view === "day" && prev.arg === day) { stack.pop(); return go("programme", "day", day, false); }
    stack[stack.length - 1] = { tab: "programme", view: "day", arg: day };
    return go("programme", "day", day, false);
  }
  if (d.resync !== undefined) { $("#stale")?.remove(); return resync(); }
  if (d.stalex !== undefined) { $("#stale")?.remove(); return; }
  if (d.maplist !== undefined) {
    mapListOpen = !mapListOpen;
    $(".dmap")?.classList.toggle("list-open", mapListOpen);
    const lb = $(".dm-listbox"); if (lb) lb.hidden = !mapListOpen;
    const dd = dayById($(".dmap").dataset.mapday); $("#dmCard").innerHTML = mapCardHtml(dd, mapStops(dd));
    setTimeout(mapRelayout, 60); return;
  }
  if (d.maplegend !== undefined) {
    mapLegendOpen = !mapLegendOpen;
    $(".dmap")?.classList.toggle("legend-open", mapLegendOpen);
    t.setAttribute("aria-expanded", mapLegendOpen); setTimeout(mapQueueDeclutter, 50); return;
  }
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
  if (d.mapsec) {
    // Onglet du jour depuis le Plan : on revient sur la page du jour (celle d'où l'on vient, si c'en est une).
    store.set("daySec", d.mapsec);
    const day = $(".dmap")?.dataset.mapday, prev = stack[stack.length - 2];
    if (prev?.view === "day" && prev.arg === day) { stack.pop(); return go("programme", "day", day, false); }
    stack[stack.length - 1] = { tab: "programme", view: "day", arg: day };
    return go("programme", "day", day, false);
  }
  if (d.zoom) { const v = +d.zoom; store.set("textZoom", v); N.setTextZoom && N.setTextZoom(v); return go("more", null, "settings", false); }
  if (d.lockwp) { store.set("lockWp", d.lockwp === "1"); store.set("lockWpDate", null); if (d.lockwp === "1") updateLockWallpaper(true); return go("more", null, "settings", false); }
  if (d.photoday) { store.set("photoDay", d.photoday); return go("guide", null, "photo", false); }
  if (d.askchip) { $("#askQ").value = d.askchip; return; }
  if (d.ask) return askGuide(d.ask === "photo");
  if (d.askplace) { const p = placeById(d.askplace); closeSheet(); go("guide", null, "ask"); $("#askCtx").value = `Nous visitons : ${p.name} (${p.nameZh}), à ${placeCity[p.id] || ""}.`; return; }
  if (d.theme) { store.set("theme", d.theme); applyTheme(); return go("more", null, "settings", false); }
  if (d.audio) return playAudio(d.audio, d.title);
  if (d.showtext) return openShow(d.showtext, d.showalt, d.showfr);
  if (d.map) { if (placeById(d.map)) goAmap(d.map); return; }
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
  const big = bigClock(n.hm);
  $$("[data-bigclock]").forEach((e) => { if (e.innerHTML !== big) e.innerHTML = big; });
  refreshHome();
  refreshMap();
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

// Retour de veille ou de l'arrière-plan : heure, scène et prochaine étape à jour tout de suite.
document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
window.addEventListener("resize", () => { if ($("#dmMap")) requestAnimationFrame(() => mapSync(false)); });
window.TravelOS = {
  back, onHome, toast, onResume: () => tick(), onTranslate, onSystemTheme: () => applyTheme(),
  onPermission: () => {
    if (mapLocateAsked) { mapLocateAsked = false; if (N.hasLocationPermission()) mapLocate(); else toast("Position non autorisée : la carte et les fiches restent disponibles."); }
    else window.TravelOS.onGpsPermission?.();
  },
  onMapStop: (id) => openMapStop(id),
  onMapFailed: () => { mapFailed = true; const st = stack[stack.length - 1]; if (st?.view === "map") go(st.tab, st.view, st.arg, false); },
  onOfflineMap: (j) => { const o = json(j, {}); const el = $("#offlineState"); if (el) el.textContent = o.status < 0 ? `${o.city} : échec, réessaie en Wi-Fi` : `${o.city} : ${o.pct} %`; },
};

(async () => {
  applyPrefs();
  try {
    P = await loadPack();
    if (packStale) setTimeout(showStale, 600);
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
    // Aperçu : « mock.map »=1 simule la carte native par un cadre, pour vérifier son placement.
    mapState: () => JSON.stringify({ ready: localStorage.getItem("mock.map") === "1" }),
    goAmap: (j) => { (window.__goAmap = window.__goAmap || []).push(JSON.parse(j)); },
    mapShow: (j) => { const o = JSON.parse(j); window.__mapShow = o; let b = document.getElementById("mockMap"); if (!b) { b = document.createElement("div"); b.id = "mockMap"; document.body.appendChild(b); }
      Object.assign(b.style, { position: "fixed", left: o.rect.x + "px", top: o.rect.y + "px", width: o.rect.w + "px", height: o.rect.h + "px", borderRadius: o.rect.r + "px", background: "repeating-linear-gradient(45deg,#cfe3f0,#cfe3f0 12px,#dbeaf3 12px,#dbeaf3 24px)", display: "grid", placeItems: "center", font: "600 18px Inter", color: "#246", zIndex: 5 });
      b.textContent = `Carte MapLibre native · ${o.key} · ${o.stops.length} repères · prochaine : ${o.stops.find((x) => x.next)?.n || "–"}`; b.hidden = false; },
    mapHide: () => { const b = document.getElementById("mockMap"); if (b) b.hidden = true; },
    mapFit: () => {}, mapLocate: () => {}, offlineMaps: () => {},
  };
}
