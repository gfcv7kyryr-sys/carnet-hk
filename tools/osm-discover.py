#!/usr/bin/env python3
"""
Inventaire OpenStreetMap autour des lieux du programme, pour préparer les itinéraires des 13 journées.

    python3 tools/osm-discover.py

Écrit travelos/routes/osm/discover.json :
  places   : pour chaque lieu du programme, les éléments nommés proches (le plus ressemblant d'abord),
             les entrées (entrance=*), les sorties de métro (railway=subway_entrance) et les quais ou gares ;
  hotels   : les hôtels du voyage retrouvés par leur nom ;
  hkdl     : tous les éléments nommés de Hong Kong Disneyland (points de calage du plan illustré).
Tout est en WGS-84 (OpenStreetMap). À lancer là où Internet est ouvert (workflow « Données carte »).
"""
import json, math, os, re, sys, time, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "TravelOS/0.14 (carnet de voyage familial)"
OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
KEEP = ("tourism", "leisure", "historic", "railway", "public_transport", "aerialway", "man_made", "amenity", "building", "attraction", "place", "highway", "natural", "landuse", "route")
AMENITY_OK = {"place_of_worship", "ferry_terminal", "bus_station", "taxi", "theatre", "arts_centre", "library", "marketplace", "parking", "townhall", "public_bookcase", "community_centre"}

def overpass(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    for k in range(2):
        for u in OVERPASS:
            try:
                req = urllib.request.Request(u, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=90) as r: return json.loads(r.read())
            except Exception as e:
                print("   overpass", u, e, flush=True); time.sleep(3 + 6 * k)
    return {"elements": []}

def metres(a, b):
    k = math.pi / 180
    return math.hypot((a[1] - b[1]) * 111320 * math.cos((a[0] + b[0]) / 2 * k), (a[0] - b[0]) * 111320)

def pt(e): return [e["center"]["lat"], e["center"]["lon"]] if "center" in e else [e["lat"], e["lon"]] if "lat" in e else None

def slim(e, at):
    t = e.get("tags", {}); p = pt(e)
    return {"t": e["type"][0] + str(e["id"]), "name": t.get("name"), "en": t.get("name:en"), "zh": t.get("name:zh") or t.get("name:zh-Hans"),
            "k": {k: t[k] for k in t if k in KEEP or k in ("entrance", "ref", "operator", "network", "station", "subway", "train", "ferry", "cable_car")},
            "p": [round(p[0], 6), round(p[1], 6)], "d": round(metres(p, at))}

def tokens(*names):
    out = set()
    for n in names:
        for w in re.findall(r"[A-Za-z]{3,}|[一-鿿]", n or ""):
            out.add(w.lower())
    return out - {"the", "and", "road", "street", "station", "park", "temple", "hong", "kong", "de", "des", "la", "le", "du"}

_L = None
def L():
    global _L
    if _L is None:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from osmlocal import OSM
        _L = OSM()
    return _L

def slim2(e, at):
    t = e["tags"]; p = L().center(e)
    return {"t": e["t"] + str(e["id"]), "name": t.get("name"), "en": t.get("name:en"), "zh": t.get("name:zh") or t.get("name:zh-Hans"),
            "k": {k: t[k] for k in t if k in KEEP or k in ("entrance", "ref", "operator", "network", "station")},
            "p": [round(p[0], 6), round(p[1], 6)], "d": round(metres(p, at))}

def around(lat, lng, R, names):
    at = [lat, lng]; tk = tokens(*names)
    named, ent, trans = [], [], []
    for e in L().around(at, R + 200):
        t = e["tags"]; d = metres(L().center(e), at)
        if t.get("railway") == "subway_entrance" or "entrance" in t: ent.append(slim2(e, at)); continue
        if t.get("railway") in ("station", "halt") or t.get("public_transport") == "station" or t.get("amenity") == "ferry_terminal" or t.get("aerialway") == "station":
            trans.append(slim2(e, at))
        if d > R or not t.get("name"): continue
        if not any(k in t for k in ("tourism", "historic", "leisure", "building", "man_made", "railway", "aerialway", "public_transport")) and t.get("amenity") not in AMENITY_OK: continue
        x = slim2(e, at); x["score"] = len(tk & tokens(t.get("name"), t.get("name:en"), t.get("name:zh"))); named.append(x)
    named.sort(key=lambda s: (-s["score"], s["d"])); ent.sort(key=lambda s: s["d"]); trans.sort(key=lambda s: s["d"])
    return {"named": named[:30], "entrances": ent[:25], "transit": trans[:20]}

DST = os.path.join(ROOT, "travelos/routes/osm/discover.json")
def save(out):
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    json.dump(out, open(DST, "w", encoding="utf8"), ensure_ascii=False, indent=0)

def main():
    pack = json.load(open(os.path.join(ROOT, "travelos/pack/pack.json"), encoding="utf8"))
    pl = {x["id"]: x for x in pack["places"]}
    ids = []
    for d in pack["days"]:
        for s in d["steps"]:
            for i in (s.get("placeIds") or ([s["placeId"]] if s.get("placeId") else [])):
                if i not in ids and i in pl: ids.append(i)
    out = {"places": {}, "hotels": {}, "hkdl": []}
    out["hkdl"] = [slim2(e, [22.3125, 114.0415]) for e in L().around([22.3120, 114.0425], 1100, lambda e: bool(e["tags"].get("name")))]
    for i in ids:
        x = pl[i]
        out["places"][i] = {"carnet": [x["lat"], x["lng"]], "name": x["name"], "zh": x.get("nameZh"), **around(x["lat"], x["lng"], 450, [x["name"], x.get("nameZh")])}
    hotels = {"nathan": (22.3047, 114.1715), "voco": (23.1225, 113.2500), "lijiang": (24.9200, 110.5200), "hollywood": (22.3095, 114.0480)}
    for k, (la, ln) in hotels.items():
        out["hotels"][k] = sorted([slim2(e, [la, ln]) for e in L().around([la, ln], 3000, lambda e: e["tags"].get("tourism") in ("hotel", "guest_house", "resort", "apartment") and e["tags"].get("name"))], key=lambda s: s["d"])[:30]
    save(out)
    print(f"→ {DST} : {len(out['places'])} lieux, {len(out['hkdl'])} éléments dans le parc")

if __name__ == "__main__":
    main()
