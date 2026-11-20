#!/usr/bin/env python3
"""Versions HD des images du carnet pour TravelOS.

Usage : python3 tools/make-hd.py <dossier des originaux PNG>

Chaque original est reconnu par comparaison visuelle avec les images du carnet
(img/<hash>.webp) ; la version HD est écrite dans travelos/hd/<hash>.webp au même
cadrage, en pleine définition (sans agrandissement). Le carnet n'est pas modifié :
build-pack.mjs remplace img/<hash>.webp par travelos/hd/<hash>.webp quand elle existe.
"""
import json, os, re, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1]
OUT = os.path.join(ROOT, "travelos/hd")
MAX_SIDE = 1800       # plafond ; les originaux font 1100 à 1700 px
SEUIL = 0.045         # écart moyen maximal (couleurs 24×24)…
MARGE = 2.0           # …et le 2e candidat doit être au moins 2× plus loin

html = open(os.path.join(ROOT, "index.html"), encoding="utf8").read()
block = re.search(r"const IMG=\{(.*?)\};", html, re.S).group(1)
webps = sorted(set(re.findall(r'"(img/[0-9a-f]+\.webp)"', block)))

def crop(im, ar):
    w, h = im.size
    if w / h > ar:
        nw = round(h * ar); x = (w - nw) // 2; return im.crop((x, 0, x + nw, h))
    nh = round(w / ar); y = (h - nh) // 2; return im.crop((0, y, w, y + nh))

def desc(im):
    return np.asarray(im.convert("RGB").resize((24, 24), Image.BILINEAR), dtype=np.float32) / 255

ref = {}
for w in webps:
    p = os.path.join(ROOT, w)
    if os.path.exists(p):
        im = Image.open(p); ref[w] = (im.size, desc(im))

import hashlib
origs, vus = {}, set()
for f in sorted(os.listdir(SRC)):
    if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        h = hashlib.sha1(open(os.path.join(SRC, f), "rb").read()).hexdigest()
        if h in vus: continue      # doublon exact
        vus.add(h)
        im = Image.open(os.path.join(SRC, f)).convert("RGB"); small = im.copy(); small.thumbnail((400, 400))
        origs[f] = small

# Nom de fichier = code du carnet (F2 → F02, v2 → V2) : confirmation suffisante sans marge.
inv = {}
for k, v in re.findall(r'(\w+):"(img/[0-9a-f]+\.webp)"', block): inv.setdefault(v, set()).add(k)
def code(f):
    m = re.fullmatch(r"([A-Za-z]+)0*(\d+)\.\w+", f)
    return {m.group(1).upper() + m.group(2), m.group(1).upper() + m.group(2).zfill(2)} if m else set()

choix = {}
for w, (size, d) in ref.items():
    ar = size[0] / size[1]
    errs = sorted((float(((desc(crop(s, ar)) - d) ** 2).mean()), f) for f, s in origs.items())
    if not errs or errs[0][0] >= SEUIL: continue
    nomme = bool(code(errs[0][1]) & inv.get(w, set()))
    if nomme or len(errs) < 2 or errs[0][0] < 0.005 or errs[1][0] >= MARGE * errs[0][0]:
        choix[w] = (errs[0][1], round(errs[0][0], 5))

os.makedirs(OUT, exist_ok=True)
carte = {}
for w, (f, e) in sorted(choix.items()):
    size = ref[w][0]
    src = Image.open(os.path.join(SRC, f))
    mode = "RGBA" if "A" in src.getbands() and Image.open(os.path.join(ROOT, w)).mode == "RGBA" else "RGB"
    im = crop(src.convert(mode), size[0] / size[1])
    if max(im.size) > MAX_SIDE: im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    if im.size[0] <= size[0]:   # pas plus net que l'existant : inutile
        continue
    dst = os.path.join(OUT, os.path.basename(w))
    im.save(dst, "WEBP", quality=84, method=6, exact=False)
    carte[w] = {"source": f, "ecart": e, "taille": list(im.size)}

json.dump(carte, open(os.path.join(OUT, "sources.json"), "w"), ensure_ascii=False, indent=1)
total = sum(os.path.getsize(os.path.join(OUT, os.path.basename(w))) for w in carte)
print(f"{len(carte)} images HD sur {len(ref)} ({total/1e6:.1f} Mo) ; sans original : {len(ref)-len(choix)}")
