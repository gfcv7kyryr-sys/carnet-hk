#!/usr/bin/env python3
"""Fond de l'écran verrouillé de TravelOS : les lanternes de la couverture du carnet sur fond nuit.

Format 2560 × 1600 (paysage de la tablette). En portrait, Android garde la bande centrale :
les lanternes y tiennent entièrement. Sortie : travelos/lockscreen/lanternes.webp
"""
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "travelos" / "lockscreen"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 2560, 1600
NIGHT = (14, 20, 38)
import sys
# Source : original HD passé en argument, sinon la version du carnet.
lan = Image.open(sys.argv[1] if len(sys.argv) > 1 else ROOT / "img" / "cover-lanternes.webp").convert("RGBA")
lan = lan.crop(lan.getbbox())
scale = min(980 / lan.width, (H * 0.9) / lan.height)
lan = lan.resize((round(lan.width * scale), round(lan.height * scale)), Image.LANCZOS)
canvas = Image.new("RGBA", (W, H), NIGHT + (255,))
canvas.alpha_composite(lan, ((W - lan.width) // 2, 0))
canvas.convert("RGB").save(OUT / "lanternes.webp", quality=92)
print(f"lanternes.webp : {lan.width}×{lan.height} sur {W}×{H}")
