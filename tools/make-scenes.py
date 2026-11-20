#!/usr/bin/env python3
"""Scènes du widget photo : trois par journée (matin, après-midi, soir).

Usage : python3 tools/make-scenes.py <dossier>

Le dossier contient, pour le jour N et le moment M (1 matin, 2 après-midi, 3 soir) :
  jNM.png           l'image carrée (2000 × 2000, cadrée selon le gabarit : heure en haut)
  jNM détouré.png   le sujet détouré, même cadrage, fond transparent
Exemples : j11 = jour 1 matin, j103 = jour 10 soir, j131 = jour 13 matin.

Sorties dans travelos/scenes/ :
  jN-M-bg.webp     le fond
  jN-M-fg.webp     le sujet, posé au-dessus de l'heure
  jN-M-glass.webp  la texture des chiffres en verre (fond flouté, éclairci ou assombri)
  meta.json        par scène : ton du ciel derrière l'heure et part des chiffres masquée
"""
import json, os, re, sys
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1]
OUT = os.path.join(ROOT, "travelos", "scenes")
SIZE = 1200
# Zone des chiffres dans le gabarit (fractions du côté) : x 21,8 → 77,7 %, y 14,0 → 28,7 %.
ZONE = (0.218, 0.140, 0.777, 0.287)

os.makedirs(OUT, exist_ok=True)
meta = {}
for f in sorted(os.listdir(SRC)):
    m = re.fullmatch(r"j(\d+)([123])\.png", f)
    if not m:
        continue
    day, slot = int(m.group(1)), int(m.group(2))
    cut = os.path.join(SRC, f"j{day}{slot} détouré.png")
    if not os.path.exists(cut):
        print(f"j{day}{slot} : détouré absent, scène ignorée"); continue
    bg = Image.open(os.path.join(SRC, f)).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
    fg = Image.open(cut).convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS)
    name = f"j{day}-{slot}"
    bg.save(os.path.join(OUT, f"{name}-bg.webp"), "WEBP", quality=84, method=5)
    fg.save(os.path.join(OUT, f"{name}-fg.webp"), "WEBP", quality=84, method=5, exact=False)

    x0, y0, x1, y1 = (int(v * SIZE) for v in ZONE)
    zone = np.asarray(bg.crop((x0, y0, x1, y1)), dtype=np.float32) / 255
    lum = float((zone @ np.array([0.2126, 0.7152, 0.0722])).mean())
    alpha = np.asarray(fg.getchannel("A").crop((x0, y0, x1, y1))) > 128
    cover = float(alpha.mean())

    # Verre : le fond vu à travers un verre épais (flou + saturation), éclairci sur un ciel
    # sombre, légèrement assombri sur un ciel clair, pour que les chiffres se détachent.
    g = bg.resize((600, 600), Image.LANCZOS).filter(ImageFilter.GaussianBlur(9))
    g = ImageEnhance.Color(g).enhance(1.35)
    tone = "light" if lum > 0.55 else "dark"
    if tone == "light":
        g = ImageEnhance.Brightness(ImageEnhance.Color(g).enhance(1.25)).enhance(0.6)
    else:
        g = Image.blend(g, Image.new("RGB", g.size, (255, 255, 255)), 0.42)
    g.save(os.path.join(OUT, f"{name}-glass.webp"), "WEBP", quality=80, method=5)

    meta[name] = {"tone": tone, "lum": round(lum, 2), "cover": round(cover, 2)}
    warn = "  ← chiffres très masqués" if cover > 0.45 else ("  ← aucun recouvrement" if cover < 0.01 else "")
    print(f"{name} : ciel {tone} ({lum:.2f}), chiffres masqués à {cover:.0%}{warn}")

json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=1)
print(f"{len(meta)} scènes")
