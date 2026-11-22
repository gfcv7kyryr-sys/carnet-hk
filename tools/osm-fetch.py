#!/usr/bin/env python3
"""Télécharge les zones du voyage depuis Overpass (une requête par zone), dans .osm/<zone>.overpass.json.
Une zone déjà présente (cache de la semaine) n'est pas retéléchargée."""
import json, os, sys, time, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".osm")
SERVERS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter",
           "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
POI = ('nwr["tourism"]{b};nwr["historic"]{b};nwr["leisure"]["name"]{b};nwr["building"]["name"]{b};nwr["man_made"]["name"]{b};'
       'nwr["amenity"~"^(place_of_worship|ferry_terminal|bus_station|theatre|arts_centre|library|marketplace|parking|restaurant|cafe|fast_food)$"]["name"]{b};'
       'nwr["shop"~"^(mall|books|department_store)$"]["name"]{b};nwr["landuse"]["name"]{b};nwr["place"]{b};nwr["natural"]["name"]{b};'
       'nwr["railway"]{b};nwr["public_transport"]{b};nwr["aerialway"]{b};node["entrance"]{b};way["route"="ferry"]{b};nwr["attraction"]{b};'
       'relation["route"~"^(subway|train|light_rail|monorail|tram|ferry)$"]{b};')
ZONES = {
    "hk": ((22.15, 113.82, 22.56, 114.30), POI + 'way["highway"]["name"](22.270,114.140,22.300,114.170);way["highway"~"^(footway|pedestrian|path|steps)$"](22.300,114.030,22.322,114.052);'),
    "mo": ((22.10, 113.52, 22.22, 113.61), POI),
    "gz": ((22.95, 113.15, 23.20, 113.45), POI),
    "sz": ((22.48, 113.85, 22.60, 114.12), POI),
    "xp": ((24.85, 110.40, 25.00, 110.60), POI),
    "hy": ((24.20, 111.15, 24.30, 111.25), POI),
    "rail": ((22.25, 110.35, 25.05, 114.25), 'way["railway"="rail"]{b};'),
}
def fetch(name, bbox, body):
    dst = os.path.join(OUT, f"{name}.overpass.json")
    if os.path.exists(dst) and os.path.getsize(dst) > 1000: print(f"· {name} (cache)"); return
    b = "(%s,%s,%s,%s)" % bbox
    q = f"[out:json][timeout:900][maxsize:2000000000];({body.replace('{b}', b)});(._;>;);out body geom qt;"
    data = urllib.parse.urlencode({"data": q}).encode()
    for k in range(3):
        for u in SERVERS:
            t = time.time()
            try:
                req = urllib.request.Request(u, data=data, headers={"User-Agent": "TravelOS/0.14 (carnet de voyage familial)"})
                with urllib.request.urlopen(req, timeout=960) as r: raw = r.read()
                d = json.loads(raw)
                if d.get("remark") and not d.get("elements"): raise RuntimeError(d["remark"][:200])
                open(dst, "wb").write(raw)
                print(f"· {name} : {len(d['elements'])} éléments, {len(raw) // 1048576} Mo, {time.time() - t:.0f} s ({u.split('/')[2]})", flush=True); return
            except Exception as e:
                print(f"  {name} via {u.split('/')[2]} : {str(e)[:160]} ({time.time() - t:.0f} s)", flush=True); time.sleep(5)
    sys.exit(f"zone {name} impossible à télécharger")
os.makedirs(OUT, exist_ok=True)
for n, (bb, body) in ZONES.items(): fetch(n, bb, body)
