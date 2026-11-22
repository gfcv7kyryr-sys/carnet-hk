#!/usr/bin/env python3
"""
Cale le plan illustré de Hong Kong Disneyland sur la carte réelle (WGS-84).

    python3 tools/park-calibrate.py

Lit travelos/routes/hkdl-calage.json : des points repérés à la fois sur l'illustration (pixels) et dans
OpenStreetMap (élément du parc, ou coordonnées). Les points « calage » servent à ajuster la déformation
(spline de plaque mince, avec une part affine) ; les points « controle » ne servent qu'à mesurer l'écart.

Écrit :
  android/app/src/main/assets/map/hkdl-plan.webp  l'illustration redressée, nord en haut, à poser sur la carte
  travelos/routes/osm/hkdl-calage.json            coins de l'image (WGS-84), écarts point par point
  travelos/preview/calage-hkdl.png                contrôle visuel : illustration redressée + points OSM
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.interpolate import RBFInterpolator
from scipy.ndimage import map_coordinates

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = json.load(open(os.path.join(ROOT, "travelos/routes/hkdl-calage.json"), encoding="utf8"))
disc = json.load(open(os.path.join(ROOT, "travelos/routes/osm/discover.json"), encoding="utf8"))["hkdl"]
LAT0, LNG0 = 22.3125, 114.0415
KX = 111320 * math.cos(math.radians(LAT0)); KY = 111320.0
def to_m(lat, lng): return [(lng - LNG0) * KX, (lat - LAT0) * KY]
def to_ll(x, y): return [LAT0 + y / KY, LNG0 + x / KX]

def osm_point(p):
    if "ll" in p: return p["ll"], "coordonnées fixées"
    want = p["osm"].lower()
    c = [e for e in disc if want == (e.get("en") or "").lower() or want == (e.get("name") or "").lower()]
    if not c: c = [e for e in disc if want in ((e.get("en") or "") + " " + (e.get("name") or "")).lower()]
    if not c: sys.exit(f"Point OSM introuvable : {p['osm']}")
    c.sort(key=lambda e: (e["t"][0] == "n", e["t"]))  # bâtiment ou surface avant un simple point
    if p.get("pick"): c = [e for e in c if e["t"] == p["pick"]] or c
    return c[0]["p"], f"{c[0]['t']} « {c[0].get('en') or c[0].get('name')} »"

pts = []
for p in spec["points"]:
    ll, src = osm_point(p)
    pts.append({**p, "ll": ll, "m": to_m(*ll), "src": src})
cal = [p for p in pts if p["role"] == "calage"]; chk = [p for p in pts if p["role"] == "controle"]
P = np.array([p["px"] for p in cal], float); M = np.array([p["m"] for p in cal], float)
S = spec.get("smoothing", 2.0)
px2m = RBFInterpolator(P, M, kernel="thin_plate_spline", smoothing=S)
m2px = RBFInterpolator(M, P, kernel="thin_plate_spline", smoothing=S)

def err(p, f=px2m):
    q = f(np.array([p["px"]], float))[0]
    return math.hypot(q[0] - p["m"][0], q[1] - p["m"][1])

report = {"calage": [], "controle": []}
for p in cal:  # validation croisée : chaque point de calage est prédit sans lui
    others = [q for q in cal if q is not p]
    f = RBFInterpolator(np.array([q["px"] for q in others], float), np.array([q["m"] for q in others], float), kernel="thin_plate_spline", smoothing=S)
    report["calage"].append({"nom": p["name"], "ecart_m": round(err(p), 1), "sans_lui_m": round(err(p, f), 1), "osm": p["src"]})
for p in chk:
    report["controle"].append({"nom": p["name"], "ecart_m": round(err(p), 1), "osm": p["src"]})

# Image redressée : chaque pixel de sortie (nord en haut) va chercher sa couleur dans l'illustration.
src = Image.open(os.path.join(ROOT, spec["image"])).convert("RGBA")
W0, H0 = src.size
edge = [(x, 0) for x in range(0, W0, 20)] + [(x, H0) for x in range(0, W0, 20)] + [(0, y) for y in range(0, H0, 20)] + [(W0, y) for y in range(0, H0, 20)]
E = px2m(np.array(edge, float))
x0, y0 = E.min(0); x1, y1 = E.max(0)
OW = spec.get("width", 1800); OH = int(OW * (y1 - y0) / (x1 - x0))
gx, gy = np.meshgrid(np.linspace(x0, x1, OW), np.linspace(y1, y0, OH))
Q = m2px(np.column_stack([gx.ravel(), gy.ravel()])).reshape(OH, OW, 2)
arr = np.asarray(src).astype(np.float32)
out = np.zeros((OH, OW, 4), np.float32)
for ch in range(4):
    out[..., ch] = map_coordinates(arr[..., ch], [Q[..., 1], Q[..., 0]], order=1, mode="constant", cval=0)
# Bords adoucis (90 px de forêt) pour que l'illustration se fonde dans le fond de carte.
d = np.minimum.reduce([Q[..., 0], W0 - Q[..., 0], Q[..., 1], H0 - Q[..., 1]])
out[..., 3] *= np.clip(d / 90.0, 0, 1) ** 1.5
img = Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA")
dst = os.path.join(ROOT, "android/app/src/main/assets/map/hkdl-plan.webp")
os.makedirs(os.path.dirname(dst), exist_ok=True)
img.save(dst, "WEBP", quality=82, method=6)
nw, se = to_ll(x0, y1), to_ll(x1, y0)
corners = [[nw[1], nw[0]], [se[1], nw[0]], [se[1], se[0]], [nw[1], se[0]]]

# Contrôle visuel : points OSM (rouge = calage, bleu = contrôle) et où l'illustration les place (croix noires).
dbg = img.copy(); dr = ImageDraw.Draw(dbg)
def to_out(m): return ((m[0] - x0) / (x1 - x0) * OW, (y1 - m[1]) / (y1 - y0) * OH)
for p in pts:
    a = to_out(p["m"]); b = to_out(px2m(np.array([p["px"]], float))[0])
    col = (220, 20, 40) if p["role"] == "calage" else (20, 90, 230)
    dr.ellipse([a[0] - 7, a[1] - 7, a[0] + 7, a[1] + 7], outline=col, width=3)
    dr.line([b[0] - 6, b[1], b[0] + 6, b[1]], fill=(0, 0, 0), width=2); dr.line([b[0], b[1] - 6, b[0], b[1] + 6], fill=(0, 0, 0), width=2)
    dr.text((a[0] + 9, a[1] - 7), p["name"], fill=col)
os.makedirs(os.path.join(ROOT, "travelos/preview"), exist_ok=True)
dbg.convert("RGB").save(os.path.join(ROOT, "travelos/preview/calage-hkdl.png"))

ce = [r["ecart_m"] for r in report["controle"]]; cv = [r["sans_lui_m"] for r in report["calage"]]
res = {"image": "/assets/map/hkdl-plan.webp", "coordinates": corners, "size": [OW, OH], "points_calage": len(cal), "points_controle": len(chk),
       "controle_median_m": round(float(np.median(ce)), 1) if ce else None, "controle_max_m": round(max(ce), 1) if ce else None,
       "validation_croisee_median_m": round(float(np.median(cv)), 1), "validation_croisee_max_m": round(max(cv), 1), **report}
json.dump(res, open(os.path.join(ROOT, "travelos/routes/osm/hkdl-calage.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(json.dumps({k: res[k] for k in ("points_calage", "points_controle", "controle_median_m", "controle_max_m", "validation_croisee_median_m", "validation_croisee_max_m")}, ensure_ascii=False))
for r in report["controle"]: print(f"  contrôle  {r['nom']:<28} {r['ecart_m']:6.1f} m   {r['osm']}")
for r in report["calage"]: print(f"  calage    {r['nom']:<28} sans lui {r['sans_lui_m']:6.1f} m   {r['osm']}")
if ce and max(ce) > spec.get("tolerance_m", 25): sys.exit(f"Calage insuffisant : écart de contrôle maximal {max(ce):.0f} m")
