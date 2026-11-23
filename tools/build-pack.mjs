#!/usr/bin/env node
// Construit le paquet de contenu de TravelOS à partir du carnet de route (index.html).
// Le carnet reste la source unique : textes, images et audios ne sont jamais recopiés à la main.
//
// Sorties :
//   travelos/pack/pack.json      contenu du voyage (journées, visites, lieux, repas, réservations…)
//   travelos/pack/manifest.json  liste des fichiers (pack + médias) avec taille et SHA-256
//   android/app/src/main/assets/seed/pack.json  copie embarquée, utilisée avant la première synchro
//
// Usage : node tools/build-pack.mjs

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");

// Lit le littéral JS qui suit « const NOM= » (tableau ou objet), en ignorant les chaînes.
function literal(name) {
  const marker = `const ${name}=`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`${name} introuvable dans index.html`);
  let i = start + marker.length;
  const open = html[i];
  const close = open === "{" ? "}" : "]";
  if (open !== "{" && open !== "[") throw new Error(`${name} n'est pas un littéral`);
  let depth = 0, quote = null;
  for (; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) break;
  }
  return new Function(`return ${html.slice(start + marker.length, i + 1)}`)();
}
const optional = (name, fallback) => { try { return literal(name); } catch { return fallback; } };

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const plain = (s) => String(s ?? "")
  .replace(/<[^>]+>/g, "")
  .replace(/&(#\d+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)
  .replace(/\s+/g, " ")
  .trim();
const list = (a) => (Array.isArray(a) ? a.map(plain).filter(Boolean) : []);
const pad = (n) => String(n).padStart(2, "0");
// Version HD (travelos/hd/<hash>.webp, tools/make-hd.py) quand elle existe ; sinon l'image du carnet.
const hdPath = (p) => { const m = /^img\/([0-9a-f]+\.webp)$/.exec(p); return m && existsSync(join(root, "travelos/hd", m[1])) ? `travelos/hd/${m[1]}` : p; };
const media = (p) => (p ? hdPath(String(p).split("?")[0]) : null);

const DAYS = literal("DAYS");
const PLACES = literal("PLACES");
const IMG = literal("IMG");
const HOTELS = literal("HOTELS");
const PHR = literal("PHR");
const RESV = optional("RESV", []);
const RESA = optional("RESA", []);
const RV_ST = optional("RV_ST", {});
const WEATHER = optional("WEATHER", []);
const SIGNS = optional("SIGNS", []);
const NUMS = optional("NUMS", []);
const DS = optional("DS", []);
const AUDIO_DAY = optional("AUDIO_DAY", {});
const AUDIO_PLACE = optional("AUDIO_PLACE", {});
const AUDIO_CITY = optional("AUDIO_CITY", {});
const FX = optional("FX", {});
const MEAL_DATA = optional("MEAL_DATA", {});
const NOTE = optional("NOTE", {});
const SHOTS = optional("SHOTS", {});
const SPEC = optional("SPEC", []);
const SPEC_F = optional("SPEC_F", {});
const COMPRENDRE = optional("COMPRENDRE", []);

// Taux du convertisseur du carnet : « const rates=Object.assign({HKD:9.08,…} ».
function readRates() {
  const m = html.match(/const rates=Object\.assign\((\{[^}]*\})/);
  const r = m ? new Function(`return ${m[1]}`)() : { HKD: 9.08, CNY: 7.5, MOP: 9.35 };
  const asOf = (html.match(/Taux d[’']([a-zéû]+ \d{4})/) || [])[1] || "";
  return { base: "EUR", ...r, asOf };
}

// Numéros d'urgence et consulats (fiche « En cas de pépin » du carnet).
const EMERGENCY = {
  numbers: [
    { region: "Hong Kong et Macao", label: "Police, pompiers, ambulance", number: "999" },
    { region: "Chine", label: "Police", number: "110" },
    { region: "Chine", label: "Ambulance", number: "120" },
    { region: "Chine", label: "Pompiers", number: "119" },
  ],
  consulates: [
    { name: "Consulat de France à Hong Kong et Macao", phone: "+852 3752 9900", address: "25/F et 26/F, Tower II, Admiralty Centre, 18 Harcourt Road, Admiralty", addressZh: "" },
    { name: "Consulat de France à Canton", phone: "+86 20 2829 2000", address: "19e étage, Central Tower (Kaihua International Center), 5 Xiancun Road, Tianhe", addressZh: "天河区冼村路5号凯华国际中心19楼" },
  ],
  lost: { zh: "我迷路了。请帮我联系这家酒店。", fr: "Je suis perdu. Aidez-moi à joindre cet hôtel, s'il vous plaît." },
};

const SCENES_META = (() => { try { return JSON.parse(readFileSync(join(root, "travelos/scenes/meta.json"), "utf8")); } catch { return {}; } })();
const DEPTH_META = (() => { try { return JSON.parse(readFileSync(join(root, "travelos/depth/meta.json"), "utf8")); } catch { return {}; } })();
const img = (code) => media(IMG[code]) || null;
const audio = (entry) => (entry ? { src: media(entry[0]), seconds: entry[1] || 0, title: entry[2] ? plain(entry[2]) : null } : null);
// Un lieu peut avoir une piste [src, s] ou plusieurs [[src, s], [src, s]].
const tracks = (entry) => (!entry ? [] : Array.isArray(entry[0]) ? entry.map(audio) : [audio(entry)]);

// Images : jour = J + rang dans DAYS, lieu = L + rang dans PLACES (règle du carnet).
const dayImage = new Map(DAYS.map((d, i) => [d.id, img(`J${pad(i + 1)}`)]));
const placeImage = new Map(PLACES.map((p, i) => [p[0], img(`L${pad(i + 1)}`)]));

const places = PLACES.map(([id, name, nameZh, lat, lng, lang]) => ({
  id, name: plain(name), nameZh: plain(nameZh), lat, lng, lang: lang || "",
  image: placeImage.get(id) || (FX[id] ? img(FX[id][0]) : null),
  audio: tracks(AUDIO_PLACE[id]),
  note: NOTE[id] ? {
    kicker: plain(NOTE[id].k), lede: plain(NOTE[id].l),
    sections: (NOTE[id].s || []).map(([t, x]) => ({ title: plain(t), text: plain(x) })),
    know: list(NOTE[id].d), practical: plain(NOTE[id].p),
  } : null,
  shots: (SHOTS[id] || []).map(([type, title, kind, how, phone, camera]) => ({
    type: type === "v" ? "video" : "photo", title: plain(title), kind: kind || "", how: plain(how), phone: plain(phone), camera: plain(camera),
  })),
}));
const placeById = new Map(places.map((p) => [p.id, p]));

const meals = (dayId) => (MEAL_DATA[dayId] || []).map((slot) => ({
  slot: slot.slot, label: plain(slot.lab), time: slot.t || "", zone: plain(slot.zone),
  options: (slot.opts || []).map((o) => ({
    id: o.id, name: plain(o.fr), category: plain(o.cat), glyph: o.g || "", image: img(o.img),
    address: plain(o.ad), summary: plain(o.l), rating: o.note || "", reviews: o.nb || "",
    dishes: (o.plats || []).map(([n, d, code]) => ({ name: plain(n), note: plain(d), image: img(code) })),
    charlie: plain(o.ch),
    tags: list(o.tags),
    reviews2: (o.avis || []).map(([t, x]) => ({ title: plain(t), text: plain(x) })),
    zh: plain(o.zh || ""),
  })),
}));

// Pages éditoriales du carnet (Comprendre, fiches pratiques) : HTML nettoyé, images locales.
function article(id) {
  const start = html.indexOf(`id="p-${id}"`);
  if (start < 0) return null;
  const open = html.lastIndexOf("<section", start);
  let end = html.indexOf("</section>", start);
  // la section peut contenir des sous-sections : on avance jusqu'à la fermeture équilibrée
  let depth = 0, i = open;
  const re = /<section\b|<\/section>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0] === "</section>" ? -1 : 1;
    if (depth === 0) { end = m.index; break; }
  }
  let body = html.slice(html.indexOf(">", open) + 1, end);
  const title = plain((html.slice(open, start + 200).match(/data-t="([^"]*)"/) || [])[1] || id);
  const glyph = (html.slice(open, start + 200).match(/data-zh="([^"]*)"/) || [])[1] || "";
  const images = [];
  body = body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<button[\s\S]*?<\/button>/g, "")
    .replace(/<input[^>]*>/g, "")
    .replace(/<div class="dishes"[^>]*><\/div>/g, "")
    .replace(/<div class="art ([^"]*)" data-art="([^"]*)" data-tone="([^"]*)" data-g="([^"]*)"><\/div>/g, (all, cls, code, tone, g) => {
      const src = img(code);
      if (src) images.push(src);
      const t = TONE_CLASS[tone] || "hk";
      return src ? `<figure class="art ${cls} tone-${t} has-img"><img src="/pack/${src}" alt="" loading="lazy"></figure>`
        : `<figure class="art ${cls} tone-${t}"><span class="g">${g}</span></figure>`;
    })
    .replace(/\s(id|onclick|aria-[a-z]+|data-go)="[^"]*"/g, "")
    .replace(/data-tone="([^"]*)"/g, (a, t) => `data-tone="${TONE_CLASS[t] || t}"`)
    .replace(/\n\s*/g, "\n");
  return { id, title, glyph, html: body.trim(), images };
}
const TONE_CLASS = { hk: "hk", mo: "mo", sz: "sz", gz: "gz", ys: "li", li: "li", lt: "lt", food: "food", ui: "ui" };
const articles = [...COMPRENDRE.map((id) => ({ id, group: "comprendre" })), { id: "dimsum", group: "pratique" }, { id: "massage", group: "pratique" }, { id: "langue", group: "pratique" }]
  .map(({ id, group }) => { const a = article(id); return a && { ...a, group }; })
  .filter(Boolean);

const days = [...DAYS]
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((d, n) => ({
    id: d.id,
    number: n + 1,
    date: d.date,
    city: plain(d.city),
    cityZh: plain(d.zh),
    glyph: d.g || "",
    tone: d.scene || "hk",
    pace: d.r || "",
    title: plain(d.title),
    lede: plain(d.lede),
    image: dayImage.get(d.id),
    // Photo du jour en carré + sujet détouré (tools/make-depth.py), pour l'effet de profondeur de l'accueil.
    depth: existsSync(join(root, `travelos/depth/${d.id}-fg.webp`))
      ? { bg: `travelos/depth/${d.id}-bg.webp`, fg: `travelos/depth/${d.id}-fg.webp`, clockFront: (DEPTH_META[d.id]?.cover ?? 0) > 0.33 } : null,
    // Trois scènes (matin, après-midi, soir) pour le widget photo : fond, heure en verre, sujet détouré
    // (tools/make-scenes.py). L'accueil choisit la scène selon l'heure du voyage.
    scenes: [1, 2, 3].map((slot) => {
      const k = `j${n + 1}-${slot}`, m = SCENES_META[k];
      return m ? { slot, bg: `travelos/scenes/${k}-bg.webp`, fg: `travelos/scenes/${k}-fg.webp`, glass: `travelos/scenes/${k}-glass.webp`, tone: m.tone, dy: m.dy || 0 } : null;
    }).filter(Boolean),
    audio: audio(AUDIO_DAY[d.id]),
    feature: d.feature ? { quote: plain(d.feature.q), text: plain(d.feature.t) } : null,
    steps: (d.prog || []).map((it, k) => ({
      key: `${d.id}:${k}`,
      time: it[0],
      text: plain(it[1]),
      placeId: Array.isArray(it[2]) && it[2].length ? it[2][0] : null,
      dayOffset: typeof it[3] === "number" ? it[3] : 0,
    })),
    visits: (d.visits || []).map((v) => ({
      id: v.id, name: plain(v.n), nameZh: plain(v.zh), summary: plain(v.s), history: plain(v.h),
      remark: plain(v.r), photo: plain(v.ph),
      image: placeById.get(v.id)?.image || null, audio: placeById.get(v.id)?.audio || [],
    })),
    charlie: list(d.charlie),
    photos: list(d.photos),
    mealNotes: list(d.meals),
    meals: meals(d.id),
    planB: list(d.planB),
    tips: list(d.tips),
  }));

/* Carte du jour : arrêts dans l'ordre du programme et tronçons découpés en segments (mode, tracé).
   travelos/routes/<id>.json décrit les arrêts et la façon de tracer chaque tronçon ; les tracés
   calculés sur OpenStreetMap sont dans travelos/routes/osm/<id>.json (tools/osm-routes.py).
   Sans fichier, les arrêts viennent des étapes du programme et aucun trajet n'est dessiné.
   Coordonnées en WGS-84 ; un seul point par arrêt, partagé par le repère, les tracés et « Y aller ». */
const placeIndex = new Map(places.map((p) => [p.id, p]));
const metres = (a, b) => { const k = Math.PI / 180, dy = (a[0] - b[0]) * 111320, dx = (a[1] - b[1]) * 111320 * Math.cos(a[0] * k); return Math.hypot(dx, dy); };
for (const d of days) {
  let spec = null, osm = null;
  try { spec = JSON.parse(readFileSync(join(root, `travelos/routes/${d.id}.json`), "utf8")); } catch {}
  try { osm = JSON.parse(readFileSync(join(root, `travelos/routes/osm/${d.id}.json`), "utf8")); } catch {}
  const stepOf = (ref) => d.steps.find((s) => s.key === ref) || d.steps.find((s) => s.placeId === ref);
  const ids = spec ? spec.stops : [...new Set(d.steps.map((s) => s.placeId).filter(Boolean))].map((id) => ({ id }));
  let n = 0;
  const stops = ids.map((x) => {
    const own = placeIndex.get(x.id);
    const pl = x.minor ? null : placeIndex.get(x.place || x.id);
    const step = stepOf(x.step || x.id);
    const at = x.lat != null ? [x.lat, x.lng] : osm?.anchors?.[x.id]?.p || (own ? [own.lat, own.lng] : null);
    if (!at || (!x.minor && !pl)) { console.warn(`Carte ${d.id} : arrêt ${x.id} sans point ou sans fiche`); return null; }
    return { n: x.minor ? 0 : ++n, id: x.id, minor: !!x.minor, kind: x.kind || "", short: x.short || "", name: x.name || own?.name || pl?.name, zh: x.zh || own?.nameZh || pl?.nameZh || "",
      lat: at[0], lng: at[1], verified: !!x.verified, place: pl?.id || null, step: step?.key || null, time: step?.time || "" };
  }).filter(Boolean);
  const pos = new Map(stops.map((s) => [s.id, [s.lat, s.lng]]));
  const legs = (spec?.legs || []).map((l) => {
    const id = `${l.from}>${l.to}`;
    let segments = osm?.legs?.[id]?.segments;
    if (!segments) segments = (l.segments || (l.path ? [{ mode: l.mode, path: l.path }] : [])).filter((s) => s.path).map((s) => ({ mode: s.mode, path: s.path }));
    // Segment « à confirmer » : pas de tracé, seulement ses points de départ et d'arrivée.
    segments = segments.map((s) => (s.path ? { mode: s.mode, path: s.path } : { mode: s.mode, path: null, from: s.from, to: s.to, confirm: s.confirm || "à confirmer" }));
    const confirm = segments.some((s) => !s.path) || !!l.confirm;
    return { from: l.from, to: l.to, mode: l.mode, label: l.label || "", note: l.note || "", confirm, segments };
  });
  /* Contrôle : chaque tronçon dessiné part du point de son arrêt de départ, enchaîne ses segments
     sans trou et finit sur le point de l'arrêt d'arrivée (≤ 15 m). Sinon, on refuse le paquet. */
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i], miss = ["from", "to"].find((k) => !pos.has(l[k]));
    if (miss) { console.warn(`Carte ${d.id} : tronçon ${l.from} > ${l.to} ignoré (arrêt ${l[miss]} sans point : lancer tools/osm-routes.py)`); legs.splice(i, 1); }
  }
  for (const l of legs) {
    if (!l.segments.length) { console.warn(`Carte ${d.id} : tronçon ${l.from} > ${l.to} sans tracé (mode seulement)`); continue; }
    let cur = pos.get(l.from);
    for (const s of l.segments) {
      const a = s.path ? s.path[0] : s.from, z = s.path ? s.path[s.path.length - 1] : s.to;
      if (!a || !z) { cur = z || cur; continue; }
      const gap = metres(a, cur);
      if (gap > 15) throw new Error(`Carte ${d.id} : ${l.from} > ${l.to}, segment ${s.mode} décollé de ${gap.toFixed(0)} m`);
      cur = z;
    }
    const gap = metres(cur, pos.get(l.to));
    if (gap > 15) throw new Error(`Carte ${d.id} : ${l.from} > ${l.to} finit à ${gap.toFixed(0)} m de l'arrêt`);
  }
  for (const s of stops) if (!s.zh) console.warn(`Carte ${d.id} : arrêt ${s.id} sans nom chinois pour AMap`);
  for (const s of stops) { const own = placeIndex.get(s.id); if (own && metres([s.lat, s.lng], [own.lat, own.lng]) > 150) console.warn(`Carte ${d.id} : le point de ${s.id} est à plus de 150 m de celui de sa fiche`); }
  // Zones (journées sur plusieurs villes) et plan illustré (Disneyland).
  const zones = (spec?.zones || []).map((z) => ({ name: z.name, stops: z.stops.filter((id) => pos.has(id)) })).filter((z) => z.stops.length);
  let illustration = null;
  if (spec?.illustration) {
    try { const c = JSON.parse(readFileSync(join(root, spec.illustration.calage), "utf8")); illustration = { name: spec.illustration.name, image: c.image, coordinates: c.coordinates, errorM: c.controle_max_m }; }
    catch { console.warn(`Carte ${d.id} : plan illustré pas encore calé`); }
  }
  for (const s of stops) { const a = osm?.anchors?.[s.id]; if (a?.confirm) s.confirm = true; }
  d.map = { stops, legs, zones, illustration, verified: !!spec, traced: legs.filter((l) => l.segments.some((s) => s.path)).length };
}

const pack = {
  formatVersion: 1,
  // Version du schéma : l'app refuse un paquet plus ancien que celui qu'elle attend (plans en segments = 3).
  schema: 3,
  trip: {
    id: "hk-china-2027",
    name: "Hong Kong & Chine du Sud",
    startDate: "2027-02-20",
    endDate: days[days.length - 1].date,
    timeZone: "Asia/Hong_Kong",
    currency: "HKD",
  },
  days,
  places,
  hotels: HOTELS.map(([date, name, nameZh, addressZh, phone, lang]) => ({ date, name: plain(name), nameZh, addressZh, phone: phone || "", lang: lang || "" })),
  reservations: RESV.map(([date, time, type, title, detail, status, where]) => ({
    date, time: plain(time), type, title: plain(title), detail: plain(detail), status, statusLabel: RV_ST[status] || status, where: plain(where),
  })),
  checklist: RESA.map(([id, title, when, who, done]) => ({ id, title: plain(title), when: plain(when), who: plain(who), done: !!done })),
  phrases: PHR.map(([fr, zhHans, pinyin, zhHant, jyutping]) => ({ fr: plain(fr), zhHans, pinyin, zhHant: zhHant || "", jyutping: jyutping || "" })),
  signs: SIGNS.map(([zh, fr]) => ({ zh, fr: plain(fr) })),
  numbers: NUMS.map(([zh, fr]) => ({ zh, fr: plain(fr) })),
  // Illustrations du carnet : F01 à F12 pour les dim sum (dans l'ordre), SPEC_F pour les spécialités.
  dimsum: DS.map(([zh, roman, fr], i) => ({ zh, roman, fr: plain(fr), image: img(`F${String(i + 1).padStart(2, "0")}`) })),
  weather: WEATHER.map(([place, min, max]) => ({ place, min, max })),
  cityAudio: Object.entries(AUDIO_CITY).map(([id, e]) => ({ id, ...audio(e) })),
  // Espace de Charlie (travelos/kids/kids.json) : carnet, coloriages, histoires ; vide tant que rien n'est déposé.
  kids: (() => { try { return JSON.parse(readFileSync(join(root, "travelos/kids/kids.json"), "utf8")); } catch { return null; } })(),
  // Album du voyage (travelos/album/album.json + les fichiers audio à côté) : vide tant que les chansons ne sont pas déposées.
  album: (() => { try { const a = JSON.parse(readFileSync(join(root, "travelos/album/album.json"), "utf8"));
    for (const c of a.chapters || []) c.tracks = (c.tracks || []).filter((t) => t.src && existsSync(join(root, t.src)));
    return a; } catch { return null; } })(),
  rates: readRates(),
  lockscreen: existsSync(join(root, "travelos/lockscreen/lanternes.webp")) ? "travelos/lockscreen/lanternes.webp" : null,
  lockscreenDark: existsSync(join(root, "travelos/lockscreen/lanternes-noir.webp")) ? "travelos/lockscreen/lanternes-noir.webp" : null,
  lockscreenLight: existsSync(join(root, "travelos/lockscreen/lanternes-blanc.webp")) ? "travelos/lockscreen/lanternes-blanc.webp" : null,
  articles,
  specialties: SPEC.map(([region, dishes]) => ({ region: plain(region), dishes: dishes.map(([zh, name, text, verdict]) => ({ zh, name: plain(name), text: plain(text), verdict: verdict || "", image: SPEC_F[name] ? img(SPEC_F[name]) : null })) })),
  emergency: EMERGENCY,
};

// Contrôles
const missingPlaces = days.flatMap((d) => d.steps.filter((s) => s.placeId && !placeById.has(s.placeId)).map((s) => s.key));
if (missingPlaces.length) console.warn(`Étapes liées à un lieu inconnu : ${missingPlaces.join(", ")}`);

const json = JSON.stringify(pack);
const packDir = join(root, "travelos/pack");
mkdirSync(packDir, { recursive: true });
writeFileSync(join(packDir, "pack.json"), json);
const seedDir = join(root, "android/app/src/main/assets/seed");
mkdirSync(seedDir, { recursive: true });
writeFileSync(join(seedDir, "pack.json"), json);

// Manifeste : tous les médias cités + le pack lui-même.
const referenced = new Set(["travelos/pack/pack.json", ...articles.flatMap((a) => a.images)]);
if (pack.lockscreen) referenced.add(pack.lockscreen);
for (const k of ["lockscreenDark", "lockscreenLight"]) if (pack[k]) referenced.add(pack[k]);
for (const x of pack.kids?.book?.spreads || []) referenced.add(x);
for (const p of [...(pack.kids?.carnet || []), ...(pack.kids?.coloriages || [])]) { if (p.img) referenced.add(p.img); if (p.src) referenced.add(p.src); }
// Les images « charlie/… » sont embarquées dans l'APK (carnet interactif) : pas dans le paquet.
const inPack = (x) => x && !x.startsWith("charlie/");
for (const st of pack.kids?.stories || []) { for (const x of [st.cover, st.audio, ...st.pages.flatMap((p) => [p.img, p.audio])]) if (inPack(x)) referenced.add(x); }
for (const c of pack.album?.chapters || []) { for (const t of c.tracks) referenced.add(t.src); if (c.cover) referenced.add(c.cover); }
if (pack.album?.cover) referenced.add(pack.album.cover);
for (const d of days) if (d.depth) { referenced.add(d.depth.bg); referenced.add(d.depth.fg); }
for (const d of days) for (const sc of d.scenes) { referenced.add(sc.bg); referenced.add(sc.fg); referenced.add(sc.glass); }
// Icônes de l'accueil (travelos/icons/<id>.webp), ajoutées dès qu'elles sont déposées dans le dépôt.
const iconDir = join(root, "travelos/icons");
if (existsSync(iconDir)) for (const f of readdirSync(iconDir)) if (/\.(webp|png)$/.test(f)) referenced.add(`travelos/icons/${f}`);
JSON.stringify(pack, (k, v) => {
  if (typeof v === "string" && /^(img|audio|travelos\/hd)\//.test(v)) referenced.add(v);
  return v;
});
const files = [];
const absent = [];
for (const path of [...referenced].sort()) {
  const full = join(root, path);
  if (!existsSync(full)) { absent.push(path); continue; }
  const data = readFileSync(full);
  files.push({ path, size: statSync(full).size, sha256: createHash("sha256").update(data).digest("hex") });
}
if (absent.length) console.warn(`Médias cités mais absents du dépôt : ${absent.join(", ")}`);
const version = createHash("sha256").update(json).digest("hex").slice(0, 12);
const manifest = { formatVersion: 1, packVersion: version, files };
writeFileSync(join(packDir, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");

const total = files.reduce((n, f) => n + f.size, 0);
const steps = days.reduce((n, d) => n + d.steps.length, 0);
const visits = days.reduce((n, d) => n + d.visits.length, 0);
console.log(`Paquet ${version} : ${days.length} journées, ${steps} étapes, ${visits} visites, ${places.length} lieux, ` +
  `${pack.reservations.length} réservations, ${files.length} fichiers (${(total / 1e6).toFixed(1)} Mo)`);
