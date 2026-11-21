#!/usr/bin/env python3
"""
Trace les tronçons d'une Carte du jour sur les données OpenStreetMap.

    python3 tools/osm-routes.py j2

Lit travelos/routes/<jour>.json et écrit travelos/routes/osm/<jour>.json :
  anchors : points trouvés (étapes sans numéro géocodées, stations, carrefours)
  legs    : pour chaque tronçon « from>to », la suite de segments {mode, path, source, m}

Règles :
  - tout est en WGS-84 (OpenStreetMap) ; aucune conversion ;
  - chaque segment commence exactement au point où le précédent s'arrête, et le dernier finit
    exactement sur le point de l'arrêt d'arrivée : carte et « Y aller » désignent le même lieu ;
  - marche et taxi : OSRM (routing.openstreetmap.de) ; funiculaire et tram : voies ferrées OSM ;
    métro : voies de la ligne (relation OSM), de station en station.

À lancer là où Internet est ouvert (workflow GitHub « Données carte »).
"""
import heapq, json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "TravelOS/0.11 (carnet de voyage familial; github travelos-socle)"
BBOX = (22.255, 114.12, 22.335, 114.235)  # sud, ouest, nord, est : île de Hong Kong et Kowloon
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

def http(url, data=None, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:
            last = e; time.sleep(3 + 5 * i)
    raise RuntimeError(f"{url[:90]} : {last}")

def overpass(q):
    body = urllib.parse.urlencode({"data": q}).encode()
    for u in OVERPASS:
        try: return json.loads(http(u, body))
        except Exception as e: print("  overpass", u, e)
    raise RuntimeError("Overpass injoignable")

def metres(a, b):
    k = math.pi / 180
    dx = (a[1] - b[1]) * 111320 * math.cos((a[0] + b[0]) / 2 * k); dy = (a[0] - b[0]) * 111320
    return math.hypot(dx, dy)

def length(p): return sum(metres(p[i], p[i + 1]) for i in range(len(p) - 1))
def r6(p): return [round(p[0], 6), round(p[1], 6)]

# ---------------- graphes de voies ----------------

class Graph:
    def __init__(self): self.adj = {}
    def add_way(self, geom):
        pts = [(round(g["lat"], 7), round(g["lon"], 7)) for g in geom]
        for a, b in zip(pts, pts[1:]):
            w = metres(a, b)
            self.adj.setdefault(a, []).append((b, w)); self.adj.setdefault(b, []).append((a, w))
    def nearest(self, p):
        return min(self.adj, key=lambda n: metres(n, p))
    def path(self, a, b):
        s, t = self.nearest(a), self.nearest(b)
        dist = {s: 0}; prev = {}; pq = [(0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == t: break
            if d > dist[u]: continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
        if t not in dist: raise RuntimeError("pas de chemin sur la voie")
        out = [t]
        while out[-1] != s: out.append(prev[out[-1]])
        return [list(x) for x in reversed(out)], metres(s, a), metres(t, b)

def load_rails():
    s, w, n, e = BBOX
    print("Overpass : funiculaire et tram…")
    d = overpass(f'[out:json][timeout:180];way["railway"~"^(funicular|tram)$"]({s},{w},{n},{e});out geom;')
    g = {"funicular": Graph(), "tram": Graph()}
    for el in d["elements"]:
        if el.get("geometry"): g[el["tags"]["railway"]].add_way(el["geometry"])
    for k, v in g.items(): print(f"  {k} : {len(v.adj)} nœuds")
    return g

def load_lines():
    s, w, n, e = BBOX
    print("Overpass : lignes de métro…")
    d = overpass(f'[out:json][timeout:180];relation["route"="subway"]({s},{w},{n},{e})->.r;.r out body;way(r.r);out geom;node(r.r);out body;')
    ways = {el["id"]: el for el in d["elements"] if el["type"] == "way"}
    nodes = {el["id"]: el for el in d["elements"] if el["type"] == "node"}
    lines = {}
    for rel in (el for el in d["elements"] if el["type"] == "relation"):
        name = " ".join(filter(None, [rel["tags"].get("name:en"), rel["tags"].get("name")]))
        for key in ("Island", "Tsuen Wan", "Kwun Tong", "Tung Chung", "Tseung Kwan O", "South Island", "East Rail"):
            if key.lower() in name.lower():
                L = lines.setdefault(key, {"g": Graph(), "stops": [], "rels": []})
                L["rels"].append(f"relation {rel['id']} ({name})")
                for m in rel["members"]:
                    if m["type"] == "way" and m["ref"] in ways and ways[m["ref"]].get("geometry"):
                        L["g"].add_way(ways[m["ref"]]["geometry"])
                    if m["type"] == "node" and m["role"].startswith("stop") and m["ref"] in nodes:
                        nd = nodes[m["ref"]]; t = nd.get("tags", {})
                        L["stops"].append({"name": " / ".join(filter(None, [t.get("name:en"), t.get("name")])), "p": [nd["lat"], nd["lon"]], "id": nd["id"]})
                break
    for k, v in lines.items(): print(f"  {k} : {len(v['g'].adj)} nœuds, {len(v['stops'])} arrêts, {'; '.join(v['rels'][:2])}")
    return lines

def station(lines, name, line):
    L = lines.get(line) or sys.exit(f"Ligne introuvable : {line}")
    c = [s for s in L["stops"] if name.lower() in s["name"].lower()]
    if not c: sys.exit(f"Station introuvable : {name} ({line}). Arrêts : {sorted({s['name'] for s in L['stops']})}")
    # Plusieurs quais (un par sens) : leur milieu, recollé sur la voie.
    lat = sum(s["p"][0] for s in c) / len(c); lng = sum(s["p"][1] for s in c) / len(c)
    p = list(L["g"].nearest((lat, lng)))
    return p, f"{c[0]['name']} (OSM nœud {c[0]['id']}, ligne {line})"

def junction(a, b):
    s, w, n, e = BBOX
    d = overpass(f'[out:json][timeout:120];(way["name"="{a}"]({s},{w},{n},{e});way["name"="{b}"]({s},{w},{n},{e}););out geom;')
    A = {(round(g["lat"], 7), round(g["lon"], 7)) for el in d["elements"] if el["tags"].get("name") == a for g in el["geometry"]}
    B = {(round(g["lat"], 7), round(g["lon"], 7)) for el in d["elements"] if el["tags"].get("name") == b for g in el["geometry"]}
    common = A & B
    if common:
        p = sorted(common)[0]
        return list(p), f"carrefour {a} × {b} (OSM)"
    # Pas de nœud commun (passerelle, voie séparée) : les deux points les plus proches, s'ils sont à moins de 40 m.
    if A and B:
        da, pa, pb = min((metres(x, y), x, y) for x in A for y in B)
        if da <= 40:
            return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], f"croisement {a} × {b} (OSM, voies à {da:.0f} m)"
    sys.exit(f"Carrefour introuvable : {a} × {b}")

def geocode(g):
    """Point d'une étape sans fiche, cherché autour de « near » (1,5 km) : nom exact dans OSM, puis adresse,
    puis les géocodeurs Photon et Nominatim. Le premier résultat à moins de 1,5 km de « near » est retenu."""
    near = g.get("near"); R = 1500
    def center(el): return [el["center"]["lat"], el["center"]["lon"]] if "center" in el else [el["lat"], el["lon"]]
    def close(p): return near is None or metres(p, near) <= R
    tries = []
    if g.get("osm"):
        names = g["osm"] if isinstance(g["osm"], list) else [g["osm"]]
        q = "".join(f'nwr["{k}"="{v}"](around:{R},{near[0]},{near[1]});' for v in names for k in ("name", "name:en", "name:zh"))
        tries.append(("OSM (nom)", lambda: overpass(f"[out:json][timeout:60];({q});out center tags;")["elements"]))
    if g.get("addr"):
        st, no = g["addr"]
        tries.append(("OSM (adresse)", lambda: overpass(f'[out:json][timeout:60];nwr["addr:street"="{st}"]["addr:housenumber"="{no}"](around:{R},{near[0]},{near[1]});out center tags;')["elements"]))
    for label, fn in tries:
        try:
            els = [x for x in fn() if ("center" in x or "lat" in x) and close(center(x))]
            els.sort(key=lambda x: (x["type"] == "node", -len(x.get("tags", {}))))
            if els:
                x = els[0]; t = x.get("tags", {})
                return center(x), f"{label} : {x['type']} {x['id']} « {t.get('name') or t.get('addr:housenumber', '') + ' ' + t.get('addr:street', '')} »"
        except Exception as e: print("  ", label, e)
    if g.get("q"):
        for label, url in (("Photon", "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": g["q"], "lat": near[0], "lon": near[1], "limit": 5})),
                           ("Nominatim", "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": g["q"], "format": "geocodejson", "limit": 5}))):
            try:
                for f in json.loads(http(url, tries=2)).get("features", []):
                    lng, lat = f["geometry"]["coordinates"][:2]; pr = f.get("properties", {})
                    txt = json.dumps(pr, ensure_ascii=False)
                    if close([lat, lng]) and g.get("expect", "").lower() in txt.lower():
                        return [lat, lng], f"{label} : {pr.get('name') or pr.get('geocoding', {}).get('label', '')}"
            except Exception as e: print("  ", label, e)
            time.sleep(1.2)
    sys.exit(f"Point introuvable pour {g}")

def osrm(profile, a, b):
    base = {"foot": "https://routing.openstreetmap.de/routed-foot", "car": "https://routing.openstreetmap.de/routed-car"}[profile]
    u = f"{base}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson"
    d = json.loads(http(u)); time.sleep(1.0)
    if d.get("code") != "Ok": raise RuntimeError(f"OSRM {profile} : {d.get('code')}")
    co = d["routes"][0]["geometry"]["coordinates"]
    return [[c[1], c[0]] for c in co], d["routes"][0]["duration"]

# ---------------- tronçons ----------------

def main(day):
    spec = json.load(open(os.path.join(ROOT, f"travelos/routes/{day}.json"), encoding="utf8"))
    pack = json.load(open(os.path.join(ROOT, "travelos/pack/pack.json"), encoding="utf8"))
    places = {p["id"]: p for p in pack["places"]}
    anchors, report = {}, []

    pts = {}
    for s in spec["stops"]:
        if "lat" in s: pts[s["id"]] = [s["lat"], s["lng"]]
        elif s.get("geocode"):
            p, src = geocode(s["geocode"]); pts[s["id"]] = p
            anchors[s["id"]] = {"p": r6(p), "source": src}
        elif s["id"] in places: pts[s["id"]] = [places[s["id"]]["lat"], places[s["id"]]["lng"]]
        else: sys.exit(f"Arrêt sans point : {s['id']}")

    need_rail = any(g.get("rail") for l in spec["legs"] for g in l["segments"])
    need_line = any(g.get("line") for l in spec["legs"] for g in l["segments"])
    rails = load_rails() if need_rail else {}
    lines = load_lines() if need_line else {}

    def resolve(ref):
        if ref is None: return None, None
        if isinstance(ref, str): return pts[ref], f"arrêt {ref}"
        if "station" in ref:
            k = f"station:{ref['station']}:{ref['line']}"
            if k not in anchors:
                p, src = station(lines, ref["station"], ref["line"]); anchors[k] = {"p": r6(p), "source": src}
            return anchors[k]["p"], anchors[k]["source"]
        if "junction" in ref:
            k = "junction:" + "×".join(ref["junction"])
            if k not in anchors:
                p, src = junction(*ref["junction"]); anchors[k] = {"p": r6(p), "source": src}
            return anchors[k]["p"], anchors[k]["source"]
        if "place" in ref:
            p = places[ref["place"]]; return [p["lat"], p["lng"]], f"fiche {ref['place']} du carnet"
        sys.exit(f"Référence inconnue : {ref}")

    out = {}
    for leg in spec["legs"]:
        lid = f"{leg['from']}>{leg['to']}"
        cur = pts[leg["from"]]; segs = []
        print(f"\n{lid}")
        for i, sg in enumerate(leg["segments"]):
            last = i == len(leg["segments"]) - 1
            end, endsrc = resolve(sg.get("to")) if sg.get("to") else (pts[leg["to"]], f"arrêt {leg['to']}")
            if last and sg.get("to") and end != pts[leg["to"]]: sys.exit(f"{lid} : le dernier segment doit finir sur l'arrêt")
            start = cur
            if sg.get("from"):
                start, _ = resolve(sg["from"])
            if sg.get("path"):
                path = [list(p) for p in sg["path"]]; src = sg.get("source", "tracé du carnet")
            elif sg.get("router"):
                path, dur = osrm(sg["router"], start, end)
                src = f"OSRM {'à pied' if sg['router'] == 'foot' else 'en voiture'} sur OpenStreetMap ({round(dur / 60)} min estimées)"
            elif sg.get("rail"):
                path, ga, gb = rails[sg["rail"]].path(start, end)
                src = f"voie OSM railway={sg['rail']} (recollée à {ga:.0f} m / {gb:.0f} m des points)"
            elif sg.get("line"):
                path, ga, gb = lines[sg["line"]]["g"].path(start, end)
                src = f"voies de la ligne {sg['line']} (OSM), de {resolve(sg.get('from'))[1] if sg.get('from') else 'la station précédente'} à {endsrc}"
            else: sys.exit(f"{lid} : segment sans méthode")
            # Raccords exacts : départ = fin du segment précédent, arrivée = point visé.
            if metres(path[0], cur) > 0.5: path.insert(0, cur)
            if metres(path[-1], end) > 0.5: path.append(end)
            path[0] = list(cur); path[-1] = list(end)
            m = length(path)
            segs.append({"mode": sg["mode"], "path": [r6(p) for p in path], "source": src, "m": round(m)})
            print(f"  {sg['mode']:<9} {m:7.0f} m  {src}")
            cur = end
        out[lid] = {"segments": segs}
        report.append(f"{lid} : {sum(s['m'] for s in segs)} m en {len(segs)} segment(s)")

    dst = os.path.join(ROOT, f"travelos/routes/osm/{day}.json")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump({"day": day, "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "license": "© les contributeurs d'OpenStreetMap (ODbL)", "anchors": anchors, "legs": out, "report": report},
              open(dst, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print("\n" + "\n".join(report) + f"\n→ {dst}")

if __name__ == "__main__":
    for d in sys.argv[1:] or ["j2"]: main(d)
