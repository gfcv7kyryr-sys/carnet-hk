#!/usr/bin/env python3
"""Photo du jour avec effet de profondeur (accueil de TravelOS).

Pour chaque journée, prend la photo de la première visite (sinon l'image de la journée),
la recadre en carré et détoure le sujet principal. L'accueil superpose :
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

for day in pack["days"]:
    src = (day["visits"][0].get("image") if day["visits"] else None) or day.get("image")
    if not src or not (ROOT / src).exists():
        print(f"{day['id']} : pas d'image")
        continue
    im = Image.open(ROOT / src).convert("RGB")
    w, h = im.size
    s = min(w, h)
    # Carré centré horizontalement, un peu vers le haut (les sujets sont rarement en bas).
    left, top = (w - s) // 2, (h - s) // 4
    sq = im.crop((left, top, left + s, top + s))
    fg = remove(sq, session=session)
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
