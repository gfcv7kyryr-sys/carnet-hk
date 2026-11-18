#!/usr/bin/env python3
"""Photo du jour avec effet de profondeur (accueil de TravelOS).

Pour chaque journée, prend l'image carrée fournie dans travelos/widget/jourNN.(png|jpg|webp) (NN = numéro du jour dans TravelOS, 01 à 13)
(générée exprès, avec de la place en haut pour l'heure), sinon la photo de la première visite,
sinon l'image de la journée ; la recadre en carré et détoure le sujet principal.
Si un détourage fait main est fourni (travelos/widget/jourNN-fg.png), il est utilisé tel quel. L'accueil superpose :
fond carré, heure en transparence, puis le sujet détouré qui passe devant l'heure.

Sorties : travelos/depth/<jour>-bg.webp et travelos/depth/<jour>-fg.webp (même cadrage).
À relancer quand les images changent (par exemple les versions haute définition) :
    pip install rembg onnxruntime pillow
    python3 tools/make-depth.py && node tools/build-pack.mjs
"""
import json
import pathlib

from PIL import Image
from rembg import new_session, remove

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "travelos" / "depth"
OUT.mkdir(parents=True, exist_ok=True)

pack = json.loads((ROOT / "travelos" / "pack" / "pack.json").read_text(encoding="utf-8"))
session = new_session("isnet-general-use")
meta = {}

WIDGET = ROOT / "travelos" / "widget"
MAX = 1440


def provided(number, suffix=""):
    for ext in ("png", "webp", "jpg", "jpeg"):
        f = WIDGET / f"jour{number:02d}{suffix}.{ext}"
        if f.exists():
            return f
    return None


for day in pack["days"]:
    own = provided(day["number"])
    src = own or (day["visits"][0].get("image") if day["visits"] else None) or day.get("image")
    path = own if own else (ROOT / src if src else None)
    if not path or not path.exists():
        print(f"{day['id']} : pas d'image")
        continue
    im = Image.open(path).convert("RGB")
    w, h = im.size
    s = min(w, h)
    # Carré centré horizontalement, un peu vers le haut (les sujets sont rarement en bas).
    left, top = (w - s) // 2, (h - s) // 4
    sq = im.crop((left, top, left + s, top + s))
    if s > MAX:
        sq = sq.resize((MAX, MAX), Image.LANCZOS)
        s = MAX
    own_fg = provided(day["number"], "-fg")
    if own_fg:
        fg = Image.open(own_fg).convert("RGBA").resize((s, s), Image.LANCZOS)
    else:
        fg = remove(sq, session=session)
    src = str(path.relative_to(ROOT))
    sq.save(OUT / f"{day['id']}-bg.webp", quality=90)
    fg.save(OUT / f"{day['id']}-fg.webp", quality=90, lossless=False)
    # Part de la zone de l'heure masquée par le sujet : au-delà d'un tiers, l'heure passe devant
    # (comme iOS, qui n'applique la profondeur que si l'heure reste lisible).
    alpha = fg.getchannel("A")
    band = alpha.crop((int(s * .08), int(s * .12), int(s * .92), int(s * .40)))
    hist = band.histogram()
    covered = sum(hist[128:]) / max(1, sum(hist))
    meta[day["id"]] = {"cover": round(covered, 3)}
    print(f"{day['id']} : {src} → {s}×{s}, heure masquée à {covered:.0%}")

(OUT / "meta.json").write_text(json.dumps(meta, indent=1) + "\n", encoding="utf-8")
