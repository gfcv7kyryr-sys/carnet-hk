#!/usr/bin/env python3
"""Télécharge les zones du voyage depuis Overpass (une requête par zone), dans .osm/<zone>.overpass.json.
Une zone déjà présente (cache de la semaine) n'est pas retéléchargée."""
import json, os, sys, time, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, ".osm")
SERVERS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://lz4.overpass-api.de/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.nchc.org.tw/api/interpreter",
           "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
POI = ('nwr["tourism"]{b};nwr["historic"]{b};nwr["leisure"~"park|garden"]["name"]{b};nwr["building"]["name"]{b};nwr["man_made"~"pier|tower"]["name"]{b};'
       'nwr["amenity"~"^(place_of_worship|ferry_terminal|bus_station|theatre|arts_centre|library|marketplace|parking)$"]["name"]{b};'
       'nwr["shop"~"^(mall|books)$"]["name"]{b};'
       'nwr["railway"~"^(station|halt|stop|tram_stop|subway_entrance|funicular|tram|subway|light_rail)$"]{b};nwr["public_transport"]{b};nwr["aerialway"]{b};node["entrance"]{b};way["route"="ferry"]{b};nwr["attraction"]{b};'
       'relation["route"~"^(subway|train|light_rail|monorail|tram)$"]{b}->.r;way(r.r);node(r.r);.r;')
ZONES = {
    "hk-ville": ((22.26, 114.13, 22.40, 114.24), POI + 'way["highway"]["name"](22.270,114.140,22.300,114.170);'),
    "hk-lantau": ((22.20, 113.83, 22.34, 114.06), POI),
    "mo": ((22.10, 113.52, 22.22, 113.61), POI),
    "gz": ((22.95, 113.15, 23.20, 113.45), POI),
    "sz": ((22.48, 113.85, 22.60, 114.12), POI),
    "xp2": ((24.85, 110.40, 25.00, 110.62), POI + 'node["natural"="peak"]["name"]{b};'),
    "hy": ((24.20, 111.15, 24.30, 111.25), POI),
    "rail": ((22.25, 110.35, 25.05, 114.25), 'way["railway"="rail"]["usage"!="industrial"]["service"!~"."]{b};'),
}
def fetch(name, bbox, body):
    dst = os.path.join(OUT, f"{name}.overpass.json")
    if os.path.exists(dst) and os.path.getsize(dst) > 1000: print(f"· {name} (cache)"); return
    b = "(%s,%s,%s,%s)" % bbox
    q = f"[out:json][timeout:600][maxsize:1000000000];({body.replace('{b}', b)});out body geom qt;"
    data = urllib.parse.urlencode({"data": q}).encode()
    for k in range(2):
        for u in SERVERS:
            t = time.time()
            try:
                req = urllib.request.Request(u, data=data, headers={"User-Agent": "TravelOS/0.14 (carnet de voyage familial)"})
                with urllib.request.urlopen(req, timeout=660) as r: raw = r.read()
                d = json.loads(raw)
                if d.get("remark") and not d.get("elements"): raise RuntimeError(d["remark"][:200])
                open(dst, "wb").write(raw)
                print(f"· {name} : {len(d['elements'])} éléments, {len(raw) // 1048576} Mo, {time.time() - t:.0f} s ({u.split('/')[2]})", flush=True); return
            except Exception as e:
                print(f"  {name} via {u.split('/')[2]} : {str(e)[:160]} ({time.time() - t:.0f} s)", flush=True); time.sleep(5)
        time.sleep(60)
    print(f"⚠ zone {name} non téléchargée cette fois : elle sera retentée au prochain calcul", flush=True)
    MISSING.append(name)
MISSING = []
os.makedirs(OUT, exist_ok=True)
for n, (bb, body) in ZONES.items(): fetch(n, bb, body)
if MISSING: print("::warning::Zones OSM manquantes : " + ", ".join(MISSING))
