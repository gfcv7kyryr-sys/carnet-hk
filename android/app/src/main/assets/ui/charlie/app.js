/* Le carnet de Charlie — version interactive (PWA hors ligne) */
(() => {
'use strict';
const C = window.CARNET, P = C.pages;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const W = 1118, H = 794, HALF = 559;

/* ---------- état ---------- */
const KEY = 'carnet-charlie-v1';
const S = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
for (const k of ['ck', 'stars', 'meteo', 'found', 'stickers', 'slots', 'stamps', 'pp', 'media', 'dest', 'polas', 'seen']) S[k] = S[k] || {};
S.cfg = Object.assign({ sound: true, rate: 0.95, mode: 'auto' }, S.cfg || {});
let saveT; const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 150); };

/* ---------- IndexedDB pour photos et dessins ---------- */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('carnet-charlie', 1); r.onupgradeneeded = () => r.result.createObjectStore('m'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction('m', mode); const st = t.objectStore('m'); const q = fn(st); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)), keys: () => tx('readonly', s => s.getAllKeys()) };
})();
const urlCache = {};
async function mediaURL(k) { if (urlCache[k]) return urlCache[k]; const b = await idb.get(k); if (!b) return null; return (urlCache[k] = URL.createObjectURL(b)); }
async function putMedia(k, blob) { if (urlCache[k]) { URL.revokeObjectURL(urlCache[k]); delete urlCache[k]; } await idb.set(k, blob); S.media[k] = Date.now(); save(); }
async function delMedia(k) { if (urlCache[k]) { URL.revokeObjectURL(urlCache[k]); delete urlCache[k]; } await idb.del(k); delete S.media[k]; save(); }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- sons (synthétisés, aucun fichier) ---------- */
let AC;
function tone(seq) {
  if (!S.cfg.sound) return;
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  let t = AC.currentTime + 0.01;
  for (const [f, d, type = 'sine', v = 0.18] of seq) {
    const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d + 0.02); t += d * 0.6;
  }
}
const SND = {
  tick: () => tone([[880, .08, 'triangle', .12]]),
  found: () => tone([[784, .12], [1047, .12], [1319, .22]]),
  miss: () => tone([[220, .12, 'triangle', .08]]),
  pop: () => tone([[520, .07, 'square', .06], [1040, .18, 'sine', .16]]),
  stamp: () => tone([[90, .18, 'square', .2], [60, .2, 'sine', .25]]),
  fanfare: () => tone([[523, .16], [659, .16], [784, .16], [1047, .4, 'triangle', .2], [784, .14], [1047, .5, 'triangle', .22]]),
};

/* ---------- toast & confettis ---------- */
let toastT;
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
const fx = $('#fx'), fxc = fx.getContext('2d'); let parts = [], fxRun = false;
function confetti(n = 120, x = innerWidth / 2, y = innerHeight / 3) {
  const cols = ['#F2C14E', '#C23B2C', '#2B3A67', '#F7E08A', '#3FA796', '#E98FA0'];
  for (let i = 0; i < n; i++) parts.push({ x, y, vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 3, r: Math.random() * 6 + 4, c: cols[i % cols.length], a: Math.random() * 6, va: (Math.random() - .5) * .4, life: 120 + Math.random() * 60 });
  if (!fxRun) { fxRun = true; requestAnimationFrame(fxLoop); }
}
function fxLoop() {
  fx.width = innerWidth * devicePixelRatio; fx.height = innerHeight * devicePixelRatio; fxc.scale(devicePixelRatio, devicePixelRatio);
  parts = parts.filter(p => p.life-- > 0 && p.y < innerHeight + 40);
  for (const p of parts) { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va; fxc.save(); fxc.translate(p.x, p.y); fxc.rotate(p.a); fxc.fillStyle = p.c; fxc.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); fxc.restore(); }
  if (parts.length) requestAnimationFrame(fxLoop); else { fxRun = false; fxc.clearRect(0, 0, fx.width, fx.height); }
}
function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }

/* ---------- narration ----------
   La lecture à voix haute arrivera en fichiers audio (voix enregistrées) : en attendant, rien n'est lu. */
function stopSpeak() {}
function say() {}

/* ---------- navigation & affichage ---------- */
const vp = $('#vp'), stage = $('#stage');
let idx = Math.min(+(S.seen.last || 0), P.length - 1), half = +(S.seen.half || 0), board = null, cur = null;
const styleEl = document.createElement('style'); styleEl.textContent = P.map(p => p.css).join('\n'); document.head.appendChild(styleEl);
const hasHalves = el => { const r = el.firstElementChild; return !!r && r.children.length === 2 && [...r.children].every(c => Math.abs(c.offsetWidth - HALF) < 3); };
const single = () => S.cfg.mode === 'single' || (S.cfg.mode === 'auto' && stage.clientWidth / stage.clientHeight < 1.15);
let scale = 1;
function layout() {
  if (!board) return;
  const sw = stage.clientWidth, sh = stage.clientHeight, pad = sw < 700 ? 8 : 70, padV = 14;
  const one = single() && board._halves; const bw = one ? HALF : W;
  scale = Math.min((sw - 2 * (one && sw < 700 ? 8 : pad)) / bw, (sh - 2 * padV - 8) / H);
  const w = bw * scale, h = H * scale;
  Object.assign(vp.style, { width: w + 'px', height: h + 'px', left: (sw - w) / 2 + 'px', top: (sh - h) / 2 + 'px' });
  const tx = one && half ? -HALF * scale : 0;
  board.style.transform = `translateX(${tx}px) scale(${scale})`; board.style.setProperty('--t', board.style.transform);
  $('#prev').disabled = idx === 0 && !(one && half);
  $('#next').disabled = idx === P.length - 1 && !(one && !half && board._halves);
}
function go(i, h = 0, dir = 0) {
  i = Math.max(0, Math.min(P.length - 1, i)); stopSpeak(); closeSheet();
  idx = i; half = h; cur = P[i]; S.seen.last = i; S.seen.half = h; S.seen[cur.id] = 1; save();
  const b = document.createElement('div'); b.className = 'board'; b.dataset.b = cur.id; b.innerHTML = cur.html;
  vp.replaceChildren(b); board = b; b._halves = hasHalves(b);
  if (half && !(single() && b._halves)) half = 0;
  if (dir) { b.style.setProperty('--dx', (dir * 40) + 'px'); b.classList.add('enter'); setTimeout(() => b.classList.remove('enter'), 300); }
  layout(); enhance(b, cur);
  $('#ptitle').textContent = cur.kind === 'cover' ? 'Xiao Long et la valise de Mamie Nainai' : cur.title.replace(/·/g, '–').replace(/\s*\(.*?\)\s*/g, ' ');
  dots();
}
function step(d) {
  const one = single() && board._halves;
  if (d > 0) { if (one && !half) go(idx, 1, 1); else if (idx < P.length - 1) go(idx + 1, 0, 1); }
  else { if (one && half) go(idx, 0, -1); else if (idx > 0) { const pb = P[idx - 1]; go(idx - 1, 0, -1); if (single() && board._halves) { half = 1; S.seen.half = 1; layout(); } } }
}
$('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
addEventListener('keydown', e => { if (!$$('.ov').some(o => !o.hidden)) { if (e.key === 'ArrowRight') step(1); if (e.key === 'ArrowLeft') step(-1); } });
addEventListener('resize', () => { layout(); });
/* balayage */
let sx = null, sy = 0, st = 0;
stage.addEventListener('pointerdown', e => { if (e.target.closest('.cs-ov,.zone,.nav,.speak')) { sx = null; return; } sx = e.clientX; sy = e.clientY; st = Date.now(); });
stage.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > 1.6 * Math.abs(dy) && Date.now() - st < 700) step(dx < 0 ? 1 : -1); sx = null; });
function dots() {
  const d = $('#dots'); if (!d.children.length) d.innerHTML = P.map(() => '<i></i>').join('');
  [...d.children].forEach((x, i) => { x.className = i === idx ? 'on' : (S.seen[P[i].id] ? '' : ''); });
}
/* coordonnées dans la planche (non transformée) */
function local(e, el) { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]; }
function tapify(el, fn) { el.classList.add('tap'); el.addEventListener('click', e => { e.stopPropagation(); fn(e); }); }

/* ---------- perle de lumière (progression) ---------- */
const nStickers = () => Object.keys(S.stickers).length;
function perle() {
  const n = nStickers(), f = $('#perle-fill'); const hgt = 30 * n / 13;
  f.setAttribute('y', 35 - hgt); f.setAttribute('height', hgt); $('#perle-n').textContent = n + '/13';
  const nb = Object.keys(S.stamps).filter(k => !S.pp[k]).length; const b = $('#pass-badge'); b.hidden = !nb; b.textContent = nb;
}
$('#btn-perle').onclick = () => { const n = nStickers(); toast(n >= 13 ? '✨ La perle brille ! ✨' : `${n} objet${n > 1 ? 's' : ''} retrouvé${n > 1 ? 's' : ''} sur 13`); };

/* ---------- petite feuille d'actions ---------- */
function sheet(x, y, actions) {
  const s = $('#sheet'); s.innerHTML = ''; actions.forEach(([l, f]) => { const b = document.createElement('button'); b.textContent = l; b.onclick = ev => { ev.stopPropagation(); closeSheet(); f(); }; s.appendChild(b); });
  s.hidden = false; const r = s.getBoundingClientRect(); s.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px'; s.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y + 12)) + 'px';
  setTimeout(() => addEventListener('pointerdown', outside, { once: true }), 0);
  function outside(e) { if (!s.contains(e.target)) closeSheet(); else addEventListener('pointerdown', outside, { once: true }); }
}
function closeSheet() { $('#sheet').hidden = true; }

/* ---------- photos ---------- */
function pickPhoto() {
  return new Promise(res => { const f = $('#file'); f.value = ''; f.onchange = () => res(f.files[0] || null); f.click(); });
}
async function shrink(file, max = 1400) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = url; });
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
}

/* ======================================================================
   ENRICHISSEMENT D'UNE PLANCHE
   ====================================================================== */
const STAR = '90aed01aded1dd086c542cb7d04067fb', METEO = ['95c50277068f95bf83a1325bc8eda08d', 'e2857b87a4f46827409ba8494d2b1ff8', 'c73b427cd5ab4381eee9dd6758bfaf1e', '06532213f072052f56ec63ed4dfc2601'];
const ownText = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ') + ' ' + [...el.children].filter(c => c.tagName === 'BR').map(() => ' ').join('');
function enhance(b, p) {
  const id = p.id;
  /* cases à cocher */
  if (p.kind !== 'cherche') {
    $$('.ck', b).forEach((el, i) => {
      const k = id + ':ck' + i; if (S.ck[k]) el.classList.add('on');
      tapify(el, () => { S.ck[k] = !S.ck[k]; if (!S.ck[k]) delete S.ck[k]; el.classList.toggle('on', !!S.ck[k]); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); SND.tick(); save(); if (S.ck[k]) { const [x, y] = centerOf(el); confetti(18, x, y); } });
    });
  }
  /* étoiles « J'ai aimé » */
  $$('span', b).filter(s => s.querySelector(`img[src*="${STAR}"]`)).forEach((grp, g) => {
    const imgs = $$('img', grp), k = id + ':st' + g; const paint = () => imgs.forEach((im, j) => im.classList.toggle('lit', j < (S.stars[k] || 0)));
    imgs.forEach((im, j) => { im.classList.add('star'); im.style.width = im.style.height = '26px'; tapify(im, () => { S.stars[k] = S.stars[k] === j + 1 ? 0 : j + 1; paint(); SND.tick(); save(); }); });
    grp.style.gap = '5px'; paint();
  });
  /* météo */
  $$('img', b).forEach(im => {
    const m = METEO.findIndex(h => im.src.includes(h)); if (m < 0) return;
    const k = id + ':me' + m; im.classList.add('meteo'); im.dataset.m = m; if (S.meteo[k]) im.classList.add('lit');
    const lbl = im.parentElement.querySelector('span');
    tapify(im.parentElement, () => { S.meteo[k] = !S.meteo[k]; if (!S.meteo[k]) delete S.meteo[k]; im.classList.toggle('lit', !!S.meteo[k]); SND.pop(); save(); if (S.meteo[k] && lbl) say(lbl.textContent); });
  });
  /* zones « colle ici » (photos) et objet de Mamie */
  let zi = 0;
  $$('div', b).forEach(el => {
    const t = ownText(el).replace(/\s+/g, ' ').trim();
    if (/^colle ici/i.test(t) && !/de Mamie$/i.test(t) && !/Mamie a oublié/.test(t)) photoZone(el, id + ':ph' + (zi++));
  });
  /* dessins */
  let di = 0;
  $$('div', b).forEach(el => {
    const t = ownText(el).replace(/\s+/g, ' ').trim();
    if (/(^|\s)(dessine|Dessine)/.test(t) && parseFloat(el.style.height) >= 80) drawZone(el, id + ':dr' + (di++), t);
  });
  $$('div', b).filter(el => /text-stroke/.test(el.getAttribute('style') || '')).forEach((el, i) => colorZone(el, id + ':co' + i));
  /* polaroïds : remplacer le dessin par une vraie photo */
  $$('.pola', b).forEach((po, i) => { const im = po.querySelector('img'); if (im) polaroid(po, im, id + ':po' + i); });
  /* mot du jour : petite animation au toucher */
  $$('div', b).filter(el => /Ma Shan Zheng/.test(el.style.fontFamily) && /solid #C23B2C|solid rgb\(194, 59, 44\)/.test(el.getAttribute('style') || '')).forEach(el => {
    el.classList.add('zh-say'); const box = el.parentElement; const fr = box.querySelector('.h1:not(:first-child), div[style*="font-size:36px"]');
    const word = $$('div', box.parentElement).find(d => /font-size: ?36px/.test(d.getAttribute('style') || ''));
    tapify(el, () => { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); SND.pop(); });
  });
  /* tampons des lieux → passeport */
  $$('img', b).filter(im => /^Tampon/.test(im.alt)).forEach(im => stampable(im));
  /* jour-spécifique */
  if (p.kind === 'cherche') cherche(b, p);
  if (p.kind === 'soir') objetTrouve(b, p);
  if (id === 'Prologue2') valise(b);
  if (id === 'Prologue1') { const nm = $$('div', b).find(d => d.textContent.trim() === 'Charlie' && /66px/.test(d.style.fontSize)); }
  if (id === 'Fin') diplome(b);
  if (p.kind === 'cover') { const r = b.firstElementChild; if (r && r.children.length === 2) r.appendChild(r.firstElementChild); }
}

function photoZone(el, k) {
  el.classList.add('zone', 'photo');
  const show = async () => { $$('.fill', el).forEach(x => x.remove()); const u = S.media[k] && await mediaURL(k); if (u) { const im = document.createElement('img'); im.className = 'fill'; im.src = u; el.appendChild(im); } };
  show();
  tapify(el, async e => {
    const doPick = async () => { const f = await pickPhoto(); if (!f) return; await putMedia(k, await shrink(f)); await show(); SND.pop(); const [x, y] = centerOf(el); confetti(40, x, y); };
    if (S.media[k]) sheet(e.clientX, e.clientY, [['Changer la photo', doPick], ['Retirer', async () => { await delMedia(k); show(); }]]); else doPick();
  });
}
function polaroid(po, im, k) {
  const orig = im.getAttribute('src'); const btn = document.createElement('button'); btn.className = 'polacam'; btn.setAttribute('aria-label', 'Mettre ma photo');
  po.appendChild(btn);
  const show = async () => { const u = S.media[k] && await mediaURL(k); im.src = u || orig; };
  show();
  btn.addEventListener('click', async e => {
    e.stopPropagation();
    const doPick = async () => { const f = await pickPhoto(); if (!f) return; await putMedia(k, await shrink(f)); await show(); SND.pop(); };
    if (S.media[k]) sheet(e.clientX, e.clientY, [['Changer la photo', doPick], ['Remettre le dessin', async () => { await delMedia(k); show(); }]]); else doPick();
  });
}
function drawZone(el, k, label) {
  el.classList.add('zone', 'drawz');
  const show = async () => { $$('.fill', el).forEach(x => x.remove()); const u = S.media[k] && await mediaURL(k); if (u) { const im = document.createElement('img'); im.className = 'fill draw'; im.src = u; el.appendChild(im); } };
  show();
  tapify(el, () => openDraw({ key: k, title: label, w: el.offsetWidth, h: el.offsetHeight, onDone: show }));
}
function colorZone(el, k) {
  el.classList.add('zone', 'drawz', 'color'); el.style.position = el.style.position || 'relative';
  const ch = el.textContent.trim();
  const show = async () => { $$('.fill', el).forEach(x => x.remove()); const u = S.media[k] && await mediaURL(k); if (u) { const im = document.createElement('img'); im.className = 'fill'; im.style.objectFit = 'contain'; im.style.background = 'transparent'; im.src = u; el.appendChild(im); el.style.color = 'transparent'; el.style.webkitTextStroke = '0'; } };
  show();
  tapify(el, () => openDraw({ key: k, title: 'Colorie ' + ch, w: el.offsetWidth, h: el.offsetHeight, outline: { text: ch, font: getComputedStyle(el).fontSize }, onDone: show }));
}
function stampable(im) {
  const h = (im.src.match(/([0-9a-f]{32})/) || [])[1]; if (!h) return;
  im.classList.add('stampable');
  const mark = () => { if (!S.stamps[h]) return; const ok = document.createElement('div'); ok.className = 'stamp-ok'; ok.textContent = '✓'; ok.style.left = (im.offsetLeft + im.offsetWidth - 22) + 'px'; ok.style.top = (im.offsetTop - 6) + 'px'; im.parentElement.appendChild(ok); };
  mark();
  tapify(im, () => {
    im.classList.remove('stamped'); void im.offsetWidth; im.classList.add('stamped'); SND.stamp();
    if (!S.stamps[h]) { S.stamps[h] = { alt: im.alt, t: Date.now() }; save(); perle(); mark(); setTimeout(() => toast('Tampon ajouté au passeport !'), 250); const [x, y] = centerOf(im); confetti(30, x, y); }
    else toast('Ce tampon est déjà dans ton passeport');
  });
}

/* ---------- cherche-et-trouve ---------- */
function cherche(b, p) {
  const scene = $$('img', b).find(im => /824px/.test(im.style.width)); if (!scene) return;
  const frame = scene.parentElement; const ov = document.createElement('div'); ov.className = 'cs-ov'; frame.appendChild(ov);
  const rows = $$('.row', b); const found = S.found[p.id] = S.found[p.id] || [];
  const ring = i => { const [x, y, r] = p.spots[i]; const d = document.createElement('div'); d.className = 'cs-ring'; Object.assign(d.style, { left: x + 'px', top: y + 'px', width: 2 * r + 'px', height: 2 * r + 'px' }); ov.appendChild(d); };
  const tick = (i, anim) => { const row = rows[i]; if (!row) return; row.classList.add('found'); $$('.ck, div[style*="width:16px"]', row).forEach(c => { c.classList.add(c.classList.contains('ck') ? 'ck' : 'ck2', 'on'); if (anim) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } }); };
  found.forEach(i => { ring(i); tick(i); });
  ov.addEventListener('click', e => {
    e.stopPropagation(); const [x, y] = local(e, ov);
    let best = -1, bd = 1e9; p.spots.forEach(([sx, sy, r], i) => { const d = Math.hypot(x - sx, y - sy); if (d < r * 1.15 && d / r < bd) { bd = d / r; best = i; } });
    if (best >= 0 && !found.includes(best)) {
      found.push(best); save(); ring(best); tick(best, true); SND.found(); confetti(40, e.clientX, e.clientY);
      const lbl = rows[best] && rows[best].querySelector('.lbl'); if (lbl) say('Bravo ! ' + lbl.textContent.replace(/\d+\s*empreintes/, 'les empreintes'));
      if (found.length === p.spots.length) setTimeout(() => { SND.fanfare(); confetti(220); toast('Bravo ! Tu as tout trouvé !', 3000); say('Bravo Charlie ! Tu as tout trouvé !'); }, 900);
    } else if (best < 0) { const m = document.createElement('div'); m.className = 'cs-miss'; m.style.left = x + 'px'; m.style.top = y + 'px'; ov.appendChild(m); setTimeout(() => m.remove(), 700); SND.miss(); }
  });
  /* indice : toucher l'image ronde d'une ligne */
  rows.forEach((row, i) => {
    const th = row.firstElementChild; const lbl = row.querySelector('.lbl');
    const hint = ev => { ev.stopPropagation(); if (lbl) say(lbl.textContent.replace(/\d+\s*empreintes/, 'les empreintes')); if (found.includes(i)) return; const [x, y, r] = p.spots[i]; const ang = Math.random() * 6.28, off = r * 1.2; const d = document.createElement('div'); d.className = 'cs-hint'; const R = r * 4.5; Object.assign(d.style, { left: x + Math.cos(ang) * off + 'px', top: y + Math.sin(ang) * off + 'px', width: R + 'px', height: R + 'px' }); ov.appendChild(d); setTimeout(() => d.remove(), 1900); };
    th.addEventListener('click', hint); if (lbl) lbl.addEventListener('click', hint);
  });
}

/* ---------- objet trouvé (soirées) ---------- */
function objetTrouve(b, p) {
  const zone = $$('div', b).find(d => /dashed #F2C14E|dashed rgb\(242, 193, 78\)/.test(d.getAttribute('style') || '')); if (!zone) return;
  const day = p.day, img = 'img/' + C.obj[day - 1] + '.webp';
  zone.style.cursor = 'pointer'; if (getComputedStyle(zone).position === 'static') zone.style.position = 'relative';
  const place = anim => {
    $$('.sticker', zone).forEach(x => x.remove()); [...zone.children].forEach(c => c.style.visibility = 'hidden');
    const s = document.createElement('img'); s.src = img; s.className = 'sticker white'; const w = zone.offsetWidth, h = zone.offsetHeight;
    Object.assign(s.style, { left: '8%', top: '8%', width: '84%', height: '84%', objectFit: 'contain', transform: 'rotate(-6deg)', visibility: 'visible' });
    if (anim) { s.style.setProperty('--fx', '-260px'); s.style.setProperty('--fy', '-320px'); s.classList.add('fly'); }
    zone.appendChild(s);
  };
  if (S.stickers[day]) place(false); else zone.classList.add('glow');
  tapify(zone, () => {
    if (S.stickers[day]) { zone.classList.remove('wiggle'); void zone.offsetWidth; zone.classList.add('wiggle'); say(`C'est ${C.objn[day - 1]} de Mamie !`); return; }
    S.stickers[day] = Date.now(); save(); zone.classList.remove('glow'); place(true); SND.pop();
    setTimeout(() => { const [x, y] = centerOf(zone); confetti(day === 13 ? 300 : 90, x, y); perle(); SND.found(); }, 700);
    setTimeout(() => {
      if (day === 13) { SND.fanfare(); toast('✨ La Perle de Lumière ! ✨', 3500); say('La Perle de Lumière ! Bravo Charlie, tu as sauvé la baie de Hong Kong !'); }
      else { toast('Objet trouvé ! ' + C.objn[day - 1][0].toUpperCase() + C.objn[day - 1].slice(1)); say(`Objet trouvé ! ${C.objn[day - 1]} de Mamie. Va vite le ranger dans sa valise, au début du carnet !`); }
    }, 900);
  });
}
/* ---------- la valise de Mamie (prologue) ---------- */
function valise(b) {
  $$('.slot', b).forEach((sl, i) => {
    const day = i + 1, img = 'img/' + C.obj[i] + '.webp';
    const fill = anim => { const im = document.createElement('img'); im.src = img; im.className = 'sl' + (anim ? ' pop' : ''); sl.appendChild(im); [...sl.childNodes].forEach(n => { if (n !== im && n.style) n.style.opacity = .15; }); sl.style.borderStyle = 'solid'; sl.style.background = '#fff'; };
    if (S.slots[day]) fill(false); else if (S.stickers[day]) sl.classList.add('ready');
    tapify(sl, () => {
      if (S.slots[day]) { say(C.objn[i]); return; }
      if (!S.stickers[day]) { toast(`Retrouve d'abord l'objet du jour ${day} !`); say(`Il faut d'abord retrouver l'objet du jour ${day}.`); return; }
      S.slots[day] = 1; save(); sl.classList.remove('ready'); fill(true); SND.pop(); const [x, y] = centerOf(sl); confetti(50, x, y);
      if (Object.keys(S.slots).length === 13) setTimeout(() => { SND.fanfare(); confetti(260); toast('La valise est pleine !', 3000); }, 500);
    });
  });
}
/* ---------- diplôme ---------- */
function diplome(b) {
  const left = b.firstElementChild && b.firstElementChild.firstElementChild; if (!left) return;
  const n = nStickers();
  if (n < 13 && !S.cfg.unlock) {
    const l = document.createElement('div'); l.className = 'locked';
    l.innerHTML = `<b>Ton diplôme t'attend !</b>Retrouve les 13 objets de Mamie<br>pour le débloquer.<div class="bar"><i style="width:${n / 13 * 100}%"></i></div><div style="margin-top:8px;font-size:24px">${n} / 13</div>`;
    left.appendChild(l);
  } else if (!S.seen.diploma) { S.seen.diploma = 1; save(); setTimeout(() => { SND.fanfare(); confetti(300); say('Félicitations Charlie ! Tu es une grande exploratrice !'); }, 400); }
}

/* ======================================================================
   DESSIN
   ====================================================================== */
const COLORS = ['#2B2420', '#C23B2C', '#F28C28', '#F2C14E', '#3FA34D', '#3FA796', '#2F6FD0', '#7A4BC2', '#E98FA0', '#8A5A2B', '#FFFFFF'];
function openDraw({ key, title, w, h, outline, onDone }) {
  const ov = $('#draw'); ov.hidden = false; stopSpeak();
  ov.innerHTML = `<div class="dr-top"><button data-a="cancel">Annuler</button><h2></h2><button class="ok" data-a="ok">C'est fini !</button></div><div class="dr-wrap"><canvas></canvas></div><div class="dr-tools"></div>`;
  $('h2', ov).textContent = title;
  const cv = $('canvas', ov), ctx = cv.getContext('2d'); const K = Math.min(4, 1600 / Math.max(w, h)); cv.width = Math.round(w * K); cv.height = Math.round(h * K);
  const wrap = $('.dr-wrap', ov); const fit = () => { const k = Math.min(wrap.clientWidth / cv.width, wrap.clientHeight / cv.height); cv.style.width = cv.width * k + 'px'; cv.style.height = cv.height * k + 'px'; };
  let color = outline ? '#C23B2C' : COLORS[0], size = outline ? 26 : 10, eraser = false; const hist = [];
  const bg = () => { if (outline) { ctx.save(); ctx.font = `${parseFloat(outline.font) * K}px 'Ma Shan Zheng'`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 1.5 * K; ctx.strokeStyle = '#C23B2C'; ctx.strokeText(outline.text, cv.width / 2, cv.height / 2 + 4 * K); ctx.restore(); } };
  const base = async () => { ctx.clearRect(0, 0, cv.width, cv.height); if (!outline) { ctx.fillStyle = '#FFFCF5'; ctx.fillRect(0, 0, cv.width, cv.height); } const u = S.media[key] && await mediaURL(key); if (u) { const im = new Image(); im.src = u; await im.decode().catch(() => {}); ctx.drawImage(im, 0, 0, cv.width, cv.height); } else bg(); };
  base().then(fit); setTimeout(fit, 50);
  const tools = $('.dr-tools', ov);
  COLORS.forEach(c => { const bt = document.createElement('button'); bt.style.background = c; if (c === '#FFFFFF') bt.style.borderColor = '#ccc'; if (c === color) bt.classList.add('on'); bt.onclick = () => { color = c; eraser = false; $$('button', tools).forEach(x => x.classList.remove('on')); bt.classList.add('on'); }; tools.appendChild(bt); });
  [[6, 8], [14, 14], [28, 22]].forEach(([s, d]) => { const bt = document.createElement('button'); bt.className = 'tool sz'; bt.innerHTML = `<i style="width:${d}px;height:${d}px"></i>`; bt.onclick = () => { size = outline ? s * 2 : s; }; tools.appendChild(bt); });
  const tb = (txt, f, lab) => { const bt = document.createElement('button'); bt.className = 'tool'; bt.textContent = txt; bt.setAttribute('aria-label', lab); bt.onclick = f; tools.appendChild(bt); return bt; };
  const er = tb('🧽', () => { eraser = true; $$('button', tools).forEach(x => x.classList.remove('on')); er.classList.add('on'); }, 'Gomme');
  tb('↩︎', () => { const d = hist.pop(); if (d) ctx.putImageData(d, 0, 0); }, 'Annuler le dernier trait');
  tb('🗑', () => { hist.push(ctx.getImageData(0, 0, cv.width, cv.height)); ctx.clearRect(0, 0, cv.width, cv.height); if (!outline) { ctx.fillStyle = '#FFFCF5'; ctx.fillRect(0, 0, cv.width, cv.height); } bg(); }, 'Tout effacer');
  let drawing = false, lx, ly;
  const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); drawing = true; hist.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 25) hist.shift(); [lx, ly] = pt(e); line(e, lx + .1, ly + .1); };
  cv.onpointermove = e => { if (!drawing) return; (e.getCoalescedEvents ? e.getCoalescedEvents() : [e]).forEach(ev => { const [x, y] = pt(ev); line(ev, x, y); }); };
  cv.onpointerup = cv.onpointercancel = () => { drawing = false; if (outline) bg(); };
  function line(e, x, y) {
    const pr = e.pointerType === 'pen' && e.pressure ? 0.5 + e.pressure : 1;
    ctx.save(); ctx.lineCap = ctx.lineJoin = 'round'; ctx.lineWidth = size * K * 0.5 * pr;
    if (eraser) { if (outline) ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = outline ? '#000' : '#FFFCF5'; } else ctx.strokeStyle = color;
    if (outline && !eraser) ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); lx = x; ly = y;
  }
  const close = () => { ov.hidden = true; ov.innerHTML = ''; removeEventListener('resize', fit); };
  addEventListener('resize', fit);
  ov.querySelector('[data-a=cancel]').onclick = close;
  ov.querySelector('[data-a=ok]').onclick = () => { if (outline) bg(); cv.toBlob(async bl => { await putMedia(key, bl); close(); await onDone(); SND.found(); confetti(70); toast('Magnifique !'); }, 'image/png'); };
}

/* ======================================================================
   SOMMAIRE
   ====================================================================== */
function openTOC() {
  const ov = $('#toc'), body = $('#toc-body'); const groups = [];
  P.forEach((p, i) => { const g = p.day ? 'Jour ' + p.day : (p.kind === 'fin' ? 'La fin' : 'Le début'); let G = groups.find(x => x.g === g); if (!G) groups.push(G = { g, day: p.day, items: [] }); G.items.push([p, i]); });
  body.innerHTML = groups.map(G => `<div class="toc-day"><h3>${G.g}${G.day && S.stickers[G.day] ? `<img src="img/${C.obj[G.day - 1]}.webp" alt="">` : ''}</h3><div class="toc-grid">${G.items.map(([p, i]) => `<button data-i="${i}" class="${i === idx ? 'cur' : ''}"><img loading="lazy" src="thumbs/${p.id}.webp" alt=""><span>${p.title.replace(/^Jour \d+ · /, '').replace(/^Prologue · /, '')}</span></button>`).join('')}</div></div>`).join('');
  $$('button[data-i]', body).forEach(bt => bt.onclick = () => { ov.hidden = true; go(+bt.dataset.i, 0, 0); });
  ov.hidden = false; const c = $('.cur', body); if (c) c.scrollIntoView({ block: 'center' });
}
$('#btn-menu').onclick = openTOC;
$$('[data-close]').forEach(b => b.onclick = () => { b.closest('.ov').hidden = true; if (b.closest('#pass')) go(idx, half); });

/* ======================================================================
   PASSEPORT
   ====================================================================== */
const DEST = [['Hong Kong', '香港'], ['Macao', '澳门'], ['Canton', '广州'], ['Shenzhen', '深圳'], ['Guilin et la rivière Li', '桂林'], ['Huangyao', '黄姚']];
let ppSpread = 0;
function openPass() { $('#pass').hidden = false; stopSpeak(); renderPass(); }
$('#btn-pass').onclick = openPass;
function renderPass() {
  const body = $('#pass-body'); const NSP = 7;
  body.innerHTML = `<div class="pp-book"></div><div class="pp-nav"><button data-d="-1">‹</button><span></span><button data-d="1">›</button></div><div class="pp-tray"></div>`;
  const book = $('.pp-book', body), tray = $('.pp-tray', body);
  $('.pp-nav span', body).textContent = ppSpread === 0 ? 'Identité' : `Pages ${ppSpread * 2 - 1}-${ppSpread * 2}`;
  $$('.pp-nav button', body).forEach(bt => bt.onclick = () => { ppSpread = Math.max(0, Math.min(NSP - 1, ppSpread + +bt.dataset.d)); renderPass(); });
  if (ppSpread === 0) {
    book.innerHTML = `<div class="pp-page"><div class="pp-id"><div class="ph">${'<span>ta photo</span>'}</div><div class="l">Prénom</div><div class="v" style="font-family:'Caveat Brush'">Charlie</div><div class="l">Profession</div><div class="v">grande exploratrice</div><div class="l">Pays</div><div class="v">Royaume des dragons</div><div class="l">Valable</div><div class="v">pour toujours !</div></div></div><div class="pp-page"><div class="vh"><span>DESTINATIONS</span><b>旅行</b></div><div class="pp-id pp-dest" style="padding-top:16%">${DEST.map(([a, z], i) => `<div data-i="${i}" class="${S.dest[i] ? 'on' : ''}"><i></i>${a}<b>${z}</b></div>`).join('')}</div></div>`;
    const ph = $('.ph', book); const k = 'pp:photo';
    (async () => { const u = S.media[k] && await mediaURL(k); if (u) ph.innerHTML = `<img src="${u}" alt="">`; })();
    ph.onclick = async () => { const f = await pickPhoto(); if (!f) return; await putMedia(k, await shrink(f, 900)); renderPass(); };
    $$('.pp-dest div', book).forEach(d => d.onclick = () => { const i = d.dataset.i; S.dest[i] = !S.dest[i]; if (!S.dest[i]) delete S.dest[i]; d.classList.toggle('on'); SND.tick(); save(); if (S.dest[i]) say(DEST[i][0]); });
  } else {
    const pages = [ppSpread * 2 - 1, ppSpread * 2];
    book.innerHTML = pages.map(n => `<div class="pp-page" data-n="${n}"><div class="wm">龙</div><div class="vh"><span>VISAS</span><b>签证</b></div><div class="num">${n}</div></div>`).join('');
    Object.entries(S.pp).forEach(([h, v]) => { const pg = book.querySelector(`[data-n="${v.n}"]`); if (pg) pg.appendChild(stampEl(h, v)); });
  }
  const free = Object.keys(S.stamps).filter(h => !S.pp[h]);
  tray.innerHTML = free.length ? '' : `<div class="empty">${Object.keys(S.stamps).length ? 'Tous tes tampons sont collés. Bravo !' : 'Touche les tampons dans les pages des lieux pour les gagner, puis fais-les glisser ici dans ton passeport.'}</div>`;
  free.forEach(h => { const im = document.createElement('img'); im.src = `img/${h}.webp`; im.alt = S.stamps[h].alt || ''; im.draggable = false; dragFrom(im, h); tray.appendChild(im); });
  perle();
}
function stampEl(h, v) {
  const im = document.createElement('img'); im.src = `img/${h}.webp`; im.className = 'pp-stamp'; im.draggable = false;
  Object.assign(im.style, { left: v.x * 100 + '%', top: v.y * 100 + '%', transform: `translate(-50%,-50%) rotate(${v.r}deg)` });
  dragFrom(im, h, true); return im;
}
function dragFrom(src, h, placed) {
  src.addEventListener('pointerdown', e => {
    if (ppSpread === 0) { toast('Va sur une page « Visas » pour coller tes tampons'); return; }
    e.preventDefault(); const book = $('.pp-book'); const pr = book.getBoundingClientRect(); const ghost = src.cloneNode(); const gw = pr.width / 2 * 0.3;
    Object.assign(ghost.style, { position: 'fixed', width: gw + 'px', height: 'auto', left: 0, top: 0, zIndex: 90, pointerEvents: 'none', transform: `translate(${e.clientX - gw / 2}px,${e.clientY - gw / 2}px) scale(1.1)`, filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' });
    document.body.appendChild(ghost); if (placed) src.style.opacity = .25; let t0 = Date.now();
    const mv = ev => { ghost.style.transform = `translate(${ev.clientX - gw / 2}px,${ev.clientY - gw / 2}px) scale(1.1)`; };
    const up = ev => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); ghost.remove();
      const pg = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => x.classList && x.classList.contains('pp-page') && x.dataset.n);
      if (placed && Date.now() - t0 < 250 && !pg) { src.style.opacity = 1; return; }
      if (pg) { const r = pg.getBoundingClientRect(); S.pp[h] = { n: +pg.dataset.n, x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height, r: placed && S.pp[h] ? S.pp[h].r : Math.round(Math.random() * 16 - 8) }; SND.stamp(); }
      else if (placed) { delete S.pp[h]; }
      save(); renderPass();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
}

/* ======================================================================
   PARENTS (appui long sur la roue)
   ====================================================================== */
(() => {
  const g = $('#btn-gear'); let t;
  const start = e => { e.preventDefault(); g.classList.add('hold'); t = setTimeout(() => { g.classList.remove('hold'); openParent(); }, 1400); };
  const end = () => { clearTimeout(t); g.classList.remove('hold'); };
  g.addEventListener('pointerdown', start); g.addEventListener('pointerup', end); g.addEventListener('pointerleave', end);
  g.addEventListener('click', () => toast('Garde le doigt appuyé (parents)'));
})();
function openParent() {
  const ov = $('#parent'), b = $('#parent-body'); ov.hidden = false;
  b.innerHTML = `
  <label>Sons <input type="checkbox" id="o-sound" ${S.cfg.sound ? 'checked' : ''}></label>
  <label>Affichage <select id="o-mode"><option value="auto">automatique</option><option value="single">une page à la fois</option><option value="double">double page</option></select></label>
  <label>Diplôme débloqué <input type="checkbox" id="o-unlock" ${S.cfg.unlock ? 'checked' : ''}></label>
  <button class="pb danger" id="o-reset">Tout effacer<small>Remet le carnet à neuf (appuie deux fois).</small></button>`;
  $('#o-mode').value = S.cfg.mode;
  $('#o-sound').onchange = e => { S.cfg.sound = e.target.checked; save(); };
  $('#o-mode').onchange = e => { S.cfg.mode = e.target.value; save(); go(idx, 0); };
  $('#o-unlock').onchange = e => { S.cfg.unlock = e.target.checked; save(); };
  let armed = false; $('#o-reset').onclick = async e => { if (!armed) { armed = true; e.currentTarget.firstChild.textContent = 'Sûr ? Appuie encore pour tout effacer'; return; } const ks = await idb.keys(); for (const k of ks) await idb.del(k); localStorage.removeItem(KEY); location.reload(); };
}
/* ---------- démarrage ---------- */
document.fonts && document.fonts.ready.then(() => layout());
go(idx, half); perle();
$('#btn-home').onclick = () => { stopSpeak(); parent.postMessage('kids-back', location.origin); };
})();
