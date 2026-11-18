#!/usr/bin/env node
// Extrait les données du carnet de route (index.html) vers des fichiers JSON
// utilisés par TravelOS. Le carnet reste la source unique : on ne réécrit rien à la main.
//
// Usage : node tools/extract-pack.mjs [dossier-de-sortie]
// Par défaut : android/app/src/main/assets/seed

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] || join(root, "android/app/src/main/assets/seed"));
const html = readFileSync(join(root, "index.html"), "utf8");

// Lit le littéral JS « const NOM=[ ... ] » en équilibrant les crochets,
// en ignorant ceux qui sont dans des chaînes.
function grab(name) {
  const marker = `const ${name}=[`;
  const start = html.indexOf(marker);
  if (start < 0) throw new Error(`Tableau ${name} introuvable dans index.html`);
  let i = start + marker.length - 1;
  let depth = 0, quote = null;
  for (; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  const literal = html.slice(start + marker.length - 1, i + 1);
  return new Function(`return ${literal}`)();
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const plain = (s) =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();

const DAYS = grab("DAYS");
const PLACES = grab("PLACES");
const HOTELS = grab("HOTELS");
const PHR = grab("PHR");

const days = [...DAYS]
  .sort((a, b) => a.date.localeCompare(b.date))
  .map((d, n) => ({
    id: d.id,
    date: d.date,
    city: plain(d.city),
    cityZh: plain(d.zh),
    title: plain(d.title),
    lede: plain(d.lede),
    order: n,
    steps: (d.prog || []).map((it) => ({
      time: it[0],
      text: plain(it[1]),
      placeId: Array.isArray(it[2]) && it[2].length ? it[2][0] : null,
      dayOffset: typeof it[3] === "number" ? it[3] : 0,
    })),
  }));

const places = PLACES.map(([id, name, nameZh, lat, lng, lang]) => ({
  id, name: plain(name), nameZh: plain(nameZh), lat, lng, lang: lang || "",
}));

const hotels = HOTELS.map(([date, name, nameZh, addressZh, phone, lang]) => ({
  date, name: plain(name), nameZh, addressZh, phone: phone || "", lang: lang || "",
}));

const phrases = PHR.map(([fr, zhHans, pinyin, zhHant, jyutping]) => ({
  fr: plain(fr), zhHans, pinyin, zhHant: zhHant || "", jyutping: jyutping || "",
}));

const trip = {
  id: "hk-china-2027",
  name: "Hong Kong & Chine du Sud",
  country: "Hong Kong, Macao, Chine",
  currency: "HKD",
  startDate: "2027-02-20",
  endDate: days[days.length - 1].date,
  timeZone: "Asia/Hong_Kong",
  formatVersion: 1,
};

// Contrôle : chaque lieu cité par une étape doit exister.
const known = new Set(places.map((p) => p.id));
const missing = days.flatMap((d) => d.steps.filter((s) => s.placeId && !known.has(s.placeId)).map((s) => `${d.id}:${s.placeId}`));
if (missing.length) console.warn(`Lieux cités mais absents de PLACES : ${missing.join(", ")}`);

mkdirSync(out, { recursive: true });
const write = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 1) + "\n");
write("trip.json", trip);
write("days.json", days);
write("places.json", places);
write("hotels.json", hotels);
write("phrases.json", phrases);

const steps = days.reduce((n, d) => n + d.steps.length, 0);
console.log(`Extrait : ${days.length} journées, ${steps} étapes, ${places.length} lieux, ${hotels.length} hôtels, ${phrases.length} phrases → ${out}`);
