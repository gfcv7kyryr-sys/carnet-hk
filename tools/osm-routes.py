#!/usr/bin/env python3
"""
Trace les tronçons des Plans du jour sur les données OpenStreetMap.

    python3 tools/osm-routes.py            (toutes les journées décrites dans travelos/routes/)
    python3 tools/osm-routes.py j2 j12     (seulement celles-ci)

Lit travelos/routes/<jour>.json et écrit travelos/routes/osm/<jour>.json :
  anchors : points trouvés (étapes sans numéro géocodées, stations, carrefours)
  legs    : pour chaque tronçon « from>to », la suite de segments {mode, path, source, m}

Règles :
  - tout est en WGS-84 (OpenStreetMap) ; aucune conversion ;
  - chaque segment commence exactement au point où le précédent s'arrête, et le dernier finit
    exactement sur le point de l'arrêt d'arrivée : carte et « Y aller » désignent le même lieu ;
  - marche, taxi, voiture : OSRM (routing.openstreetmap.de) ;
    funiculaire, tram, TGV, train, téléphérique, ferry : voies OSM (railway=*, aerialway=*, route=ferry) ;
    métro et trains de ligne : voies de la ligne (relation OSM repérée par son nom), de station en station ;
  - un segment qu'on ne peut pas tracer de façon fiable est marqué « confirm » (Trajet à confirmer) :
    pas de ligne, seulement ses points de départ et d'arrivée. Jamais de ligne droite inventée.

À lancer là où Internet est ouvert (workflow GitHub « Données carte »).
"""
import heapq, json, math, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "TravelOS/0.11 (carnet de voyage familial; github travelos-socle)"
BBOX = (22.255, 114.12, 22.335, 114.235)  # sud, ouest, nord, est : île de Hong Kong et Kowloon
OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

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

class Fail(Exception): pass

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
        pts = [(round(g["lat"], 7), round(g["lon"], 7)) if isinstance(g, dict) else (round(g[0], 7), round(g[1], 7)) for g in geom]
        for a, b in zip(pts, pts[1:]):
            w = metres(a, b)
            self.adj.setdefault(a, []).append((b, w)); self.adj.setdefault(b, []).append((a, w))
    def main_part(self):
        """Nœuds de la plus grande partie connexe (on écarte quais, dépôts et voies isolées)."""
        if getattr(self, "_main", None) is None:
            seen, best = set(), set()
            for n0 in self.adj:
                if n0 in seen: continue
                comp, stack = {n0}, [n0]
                while stack:
                    u = stack.pop()
                    for v, _ in self.adj[u]:
                        if v not in comp: comp.add(v); stack.append(v)
                seen |= comp
                if len(comp) > len(best): best = comp
            self._main = best
        return self._main
    def nearest(self, p):
        return min(self.main_part(), key=lambda n: metres(n, p))
    def comp(self):
        if getattr(self, "_comp", None) is None:
            self._comp = {}; c = 0
            for n0 in self.adj:
                if n0 in self._comp: continue
                c += 1; stack = [n0]; self._comp[n0] = c
                while stack:
                    u = stack.pop()
                    for v, _ in self.adj[u]:
                        if v not in self._comp: self._comp[v] = c; stack.append(v)
        return self._comp
    def path_any(self, a, b, radius=1500):
        """Comme path, mais en cherchant, parmi les nœuds proches des deux points, une paire reliée par la voie."""
        comp = self.comp()
        ca = sorted((metres(n, a), n) for n in self.adj if abs(n[0] - a[0]) < 0.02 and abs(n[1] - a[1]) < 0.02)
        cb = sorted((metres(n, b), n) for n in self.adj if abs(n[0] - b[0]) < 0.02 and abs(n[1] - b[1]) < 0.02)
        ca = [x for x in ca if x[0] <= radius][:400]; cb = [x for x in cb if x[0] <= radius][:400]
        best = None
        for da, na in ca:
            for db, nb in cb:
                if comp[na] == comp[nb] and (best is None or da + db < best[0]): best = (da + db, na, nb, da, db)
            if best and da > best[0]: break
        if not best: raise Fail("aucune voie continue entre les deux points")
        _, na, nb, da, db = best
        dist = {na: 0}; prev = {}; pq = [(0, na)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == nb: break
            if d > dist[u]: continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = u; heapq.heappush(pq, (nd, v))
        out = [nb]
        while out[-1] != na: out.append(prev[out[-1]])
        return [list(x) for x in reversed(out)], da, db
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

_L = None
def L():
    global _L
    if _L is None:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from osmlocal import OSM
        _L = OSM()
    return _L

def tag_name(e):
    t = e["tags"]; return t.get("name:en") or t.get("name") or t.get("name:zh") or f"{e['t']}{e['id']}"

def geocode(g):
    """Point d'un lieu dans OSM (extraits locaux), cherché autour de « near » : entrée d'un bâtiment sur une rue
    (facade), nœud entrance du lieu (entrance), ou le lieu lui-même ; à défaut, géocodeurs Photon puis Nominatim."""
    near = g.get("near"); R = g.get("R", 1500)
    names = g.get("osm") or []
    names = names if isinstance(names, list) else [names]
    found = L().named(names, near, R) if names and near else []
    if g.get("tag"): found = [e for e in found if all(e["tags"].get(k) == v for k, v in g["tag"].items())]
    if found and g.get("facade"):
        st = g["facade"]
        road = [p for w in L().named_ways(st, near, R) for p in w["geom"]]
        b = next((e for e in found if e["t"] == "w"), None)
        if b and road:
            to_road = lambda p: min(metres(p, r) for r in road)
            ents = L().entrances_of(b)
            if ents:
                e = min(ents, key=lambda x: to_road(x["p"]))
                return e["p"], f"OSM : entrée (nœud {e['id']}) de « {tag_name(b)} » sur {st}"
            ring = b["geom"]; mids = [((p[0] + q[0]) / 2, (p[1] + q[1]) / 2) for p, q in zip(ring, ring[1:])]
            m = min(mids, key=to_road)
            return list(m), f"OSM : façade de « {tag_name(b)} » (way {b['id']}) côté {st}, à {to_road(m):.0f} m de la rue"
    if found and g.get("entrance"):
        for e in found[:3]:
            ents = L().entrances_of(e)
            if ents:
                main = [x for x in ents if x["tags"].get("entrance") in ("main", "yes")] or ents
                x = min(main, key=lambda x: metres(x["p"], near))
                return x["p"], f"OSM : entrée {x['tags'].get('ref') or x['tags'].get('name') or x['tags']['entrance']} (nœud {x['id']}) de « {tag_name(e)} »"
    if found:
        e = found[0]; c = L().center(e)
        return c, f"OSM : {e['t']}{e['id']} « {tag_name(e)} »{' (sans entrée cartographiée)' if g.get('entrance') else ''}"
    if g.get("q"):
        for label, url in (("Photon", "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": g["q"], "lat": near[0], "lon": near[1], "limit": 5})),
                           ("Nominatim", "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": g["q"], "format": "geocodejson", "limit": 5}))):
            try:
                for f in json.loads(http(url, tries=2)).get("features", []):
                    lng, lat = f["geometry"]["coordinates"][:2]; pr = f.get("properties", {})
                    if metres([lat, lng], near) <= R and g.get("expect", "").lower() in json.dumps(pr, ensure_ascii=False).lower():
                        return [lat, lng], f"{label} : {pr.get('name') or pr.get('geocoding', {}).get('label', '')}"
            except Exception as e: print("  ", label, e)
            time.sleep(1.2)
    raise Fail(f"« {' / '.join(names) or g.get('q')} » introuvable dans OSM")

# ---------------- voies et lignes par journée ----------------

RAIL_Q = {
    "funicular": 'way["railway"="funicular"]', "tram": 'way["railway"="tram"]',
    "highspeed": 'way["railway"="rail"]["highspeed"="yes"]', "rail": 'way["railway"~"^(rail|light_rail|subway)$"]',
    "aerialway": 'way["aerialway"~"^(cable_car|gondola|mixed_lift)$"]', "ferry": 'way["route"="ferry"]',
}
_rails, _lines = {}, {}
def bbox_of(pts, margin):
    la = [p[0] for p in pts]; ln = [p[1] for p in pts]
    return (min(la) - margin, min(ln) - margin, max(la) + margin, max(ln) + margin)

RAIL_P = {
    "funicular": lambda t: t.get("railway") == "funicular", "tram": lambda t: t.get("railway") == "tram",
    "highspeed": lambda t: t.get("railway") == "rail" and t.get("highspeed") == "yes", "rail": lambda t: t.get("railway") in ("rail", "light_rail", "subway"),
    "aerialway": lambda t: t.get("aerialway") in ("cable_car", "gondola", "mixed_lift"), "ferry": lambda t: t.get("route") == "ferry",
}
def rail_graph(kind, a, b):
    m = 0.02 if metres(a, b) < 20000 else 0.25
    bb = bbox_of([a, b], m)
    k = (kind,) + tuple(round(x, 2) for x in bb)
    if k not in _rails:
        g = Graph()
        for w in L().ways_where(RAIL_P[kind], bb): g.add_way(w["geom"])
        _rails[k] = g
    if not _rails[k].adj: raise Fail(f"aucune voie {kind} dans OSM")
    return _rails[k]

def line_data(rx, bb):
    """Lignes (métro, train, tram léger) dont le nom, la référence ou le réseau correspond à rx, près de la zone du jour."""
    k = (rx,) + tuple(round(x, 1) for x in bb)
    if k in _lines: return _lines[k]
    g, stops, rels = Graph(), [], []
    for rel in L().route_relations(rx, bb):
        rels.append(f"relation {rel['id']} ({rel['tags'].get('name:en') or rel['tags'].get('name')})")
        for (ty, ref, role) in rel["members"]:
            if ty == "w" and role in ("", "route", "forward", "backward") and ref in L().ways: g.add_way(L().ways[ref]["geom"])
            if ty == "n" and role.startswith("stop") and ref in L().nodes:
                nd = L().nodes[ref]; tg = nd["tags"]
                stops.append({"name": " / ".join(filter(None, [tg.get("name:en"), tg.get("name"), tg.get("name:zh")])), "p": nd["p"], "id": nd["id"]})
    if not g.adj: raise Fail(f"ligne « {rx} » introuvable dans OSM")
    _lines[k] = (g, stops, rels)
    return _lines[k]

def station(rx_station, rx_line, bb):
    g, stops, rels = line_data(rx_line, bb)
    c = [s for s in stops if re.search(rx_station, s["name"], re.I)]
    if not c: raise Fail(f"station « {rx_station} » absente de la ligne « {rx_line} »")
    lat = sum(s["p"][0] for s in c) / len(c); lng = sum(s["p"][1] for s in c) / len(c)
    return list(g.nearest((lat, lng))), f"{c[0]['name']} (OSM nœud {c[0]['id']}, {rels[0]})"

def exit_of(station_pt, ref):
    c = [e for e in L().subway_entrances(station_pt, 400) if (e["tags"].get("ref") or "").replace(" ", "").lower() == ref.replace(" ", "").lower()]
    if not c: raise Fail(f"sortie {ref} introuvable dans OSM")
    e = min(c, key=lambda x: metres(x["p"], station_pt))
    return e["p"], f"sortie {ref} (OSM nœud {e['id']})"

def entrance(st, toward):
    """Sortie de métro (railway=subway_entrance) à moins de 350 m de la station, la plus proche de « toward »."""
    c = L().subway_entrances(st, 350)
    if not c: return None, None
    e = min(c, key=lambda x: metres(x["p"], toward))
    return e["p"], e["tags"].get("ref") or e["tags"].get("name:en") or ""

def osrm(profile, a, b):
    base = {"foot": "https://routing.openstreetmap.de/routed-foot", "car": "https://routing.openstreetmap.de/routed-car"}[profile]
    u = f"{base}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson"
    d = json.loads(http(u)); time.sleep(1.0)
    if d.get("code") != "Ok": raise Fail(f"OSRM {profile} : {d.get('code')}")
    r = d["routes"][0]; co = r["geometry"]["coordinates"]
    path = [[c[1], c[0]] for c in co]
    # OSRM accroche départ et arrivée à la route la plus proche : si c'est loin, l'itinéraire n'est pas fiable.
    lim = 250 if profile == "foot" else 400
    if metres(path[0], a) > lim or metres(path[-1], b) > lim: raise Fail(f"OSRM {profile} : départ ou arrivée à plus de {lim} m d'une voie")
    return path, r["duration"]

# ---------------- tronçons ----------------

def main(day):
    spec = json.load(open(os.path.join(ROOT, f"travelos/routes/{day}.json"), encoding="utf8"))
    pack = json.load(open(os.path.join(ROOT, "travelos/pack/pack.json"), encoding="utf8"))
    places = {p["id"]: p for p in pack["places"]}
    anchors, report, pts, flags = {}, [], {}, {}
    hint = [[places[s["id"]]["lat"], places[s["id"]]["lng"]] for s in spec["stops"] if s["id"] in places]
    hint += [s["near"] for s in spec["stops"] if s.get("near")] + [s["geocode"]["near"] for s in spec["stops"] if s.get("geocode", {}).get("near")]
    bb = bbox_of(hint, 0.04)

    def resolve(ref, cur=None):
        if ref is None: return None, None
        if isinstance(ref, str): return pts[ref], f"arrêt {ref}"
        if "ll" in ref: return list(ref["ll"]), ref.get("src", "coordonnées fixées")
        if "exit" in ref:
            st, _ = resolve({"station": ref["station"], "line": ref["line"]})
            k = f"exit:{ref['station']}:{ref['exit']}"
            if k not in anchors:
                p, src = exit_of(st, ref["exit"]); anchors[k] = {"p": r6(p), "source": src}
            return anchors[k]["p"], anchors[k]["source"]
        if "station" in ref:
            k = f"station:{ref['station']}:{ref['line']}"
            if k not in anchors:
                p, src = station(ref["station"], ref["line"], bb); anchors[k] = {"p": r6(p), "source": src}
            return anchors[k]["p"], anchors[k]["source"]
        if "junction" in ref:
            k = "junction:" + "×".join(ref["junction"])
            if k not in anchors:
                try: p, src = junction(*ref["junction"])
                except SystemExit as e: raise Fail(str(e))
                anchors[k] = {"p": r6(p), "source": src}
            return anchors[k]["p"], anchors[k]["source"]
        if "place" in ref:
            p = places[ref["place"]]; return [p["lat"], p["lng"]], f"fiche {ref['place']} du carnet"
        if "osm" in ref or "q" in ref:
            k = "osm:" + json.dumps(ref, ensure_ascii=False, sort_keys=True)
            if k not in anchors:
                p, src = geocode(ref); anchors[k] = {"p": r6(p), "source": src}
            return anchors[k]["p"], anchors[k]["source"]
        raise Fail(f"référence inconnue : {ref}")

    for s in spec["stops"]:
        ref = s.get("point") or s.get("geocode")
        try:
            if "lat" in s: pts[s["id"]] = [s["lat"], s["lng"]]
            elif ref:
                p, src = resolve(ref); pts[s["id"]] = p; anchors[s["id"]] = {"p": r6(p), "source": src}
            elif s["id"] in places: pts[s["id"]] = [places[s["id"]]["lat"], places[s["id"]]["lng"]]
            else: raise Fail("aucun point")
        except (Fail, RuntimeError) as e:
            if s["id"] in places:
                pts[s["id"]] = [places[s["id"]]["lat"], places[s["id"]]["lng"]]
                anchors[s["id"]] = {"p": r6(pts[s["id"]]), "source": f"point du carnet ({e})", "confirm": True}
                print(f"  ⚠ arrêt {s['id']} : {e} → point du carnet, à confirmer")
            elif s.get("near") or (isinstance(ref, dict) and ref.get("near")):
                nr = list(s.get("near") or ref["near"])
                pts[s["id"]] = nr; anchors[s["id"]] = {"p": r6(nr), "source": f"point approché ({e})", "confirm": True}
                print(f"  ⚠ arrêt {s['id']} : {e} → point approché, à confirmer")
            else:
                print(f"  ✗ arrêt {s['id']} : {e}"); flags[s["id"]] = str(e)

    out = {}
    for leg in spec["legs"]:
        lid = f"{leg['from']}>{leg['to']}"
        if leg["from"] not in pts or leg["to"] not in pts: print(f"\n{lid} : arrêt sans point, ignoré"); continue
        cur = pts[leg["from"]]; segs = []; cur_station = False
        print(f"\n{lid}")
        for i, sg in enumerate(leg["segments"]):
            try:
                end, endsrc = resolve(sg["to"]) if sg.get("to") else (pts[leg["to"]], f"arrêt {leg['to']}")
            except Fail as e:
                end, endsrc = None, str(e)
            last = i == len(leg["segments"]) - 1
            try:
                if end is None: raise Fail(endsrc)
                if sg.get("confirm"): raise Fail(sg["confirm"])
                start = cur
                if sg.get("from"): start, _ = resolve(sg["from"])
                if sg.get("path"):
                    path = [list(p) for p in sg["path"]]; src = sg.get("source", "tracé du carnet")
                elif sg.get("router"):
                    a, b, via = start, end, ""
                    if sg["router"] == "foot" and cur_station:
                        e2, ref = entrance(start, end)
                        if e2: a, via = e2, f", sortie {ref} de la station" if ref else ", sortie de la station"
                    if sg["router"] == "foot" and isinstance(sg.get("to"), dict) and "station" in sg["to"]:
                        e2, ref = entrance(end, start)
                        if e2: b, via = e2, via + (f", entrée {ref} de la station" if ref else ", entrée de la station")
                    path, dur = osrm(sg["router"], a, b)
                    if a is not start: path.insert(0, list(a))
                    if b is not end: path.append(list(b))
                    src = f"OSRM {'à pied' if sg['router'] == 'foot' else 'en voiture'} sur OpenStreetMap ({round(dur / 60)} min estimées{via})"
                elif sg.get("rail"):
                    try: path, ga, gb = rail_graph(sg["rail"], start, end).path_any(start, end, sg.get("snap", 400))
                    except (Fail, RuntimeError):
                        if sg["rail"] != "highspeed": raise
                        path, ga, gb = rail_graph("rail", start, end).path_any(start, end, sg.get("snap", 400))  # voie non marquée « grande vitesse »
                    if ga > sg.get("snap", 400) or gb > sg.get("snap", 400): raise Fail(f"voie {sg['rail']} à {ga:.0f} m / {gb:.0f} m des points")
                    src = f"voies OSM ({sg['rail']}), recollées à {ga:.0f} m / {gb:.0f} m des points"
                elif sg.get("line"):
                    g, _, rels = line_data(sg["line"], bb)
                    path, ga, gb = g.path(start, end)
                    if ga > 400 or gb > 400: raise Fail(f"ligne {sg['line']} à {ga:.0f} m / {gb:.0f} m des stations")
                    src = f"voies de la ligne {sg['line']} ({rels[0]}) jusqu'à {endsrc}"
                else: raise Fail("segment sans méthode")
                if metres(path[0], cur) > 0.5: path.insert(0, list(cur))
                if metres(path[-1], end) > 0.5: path.append(list(end))
                path[0] = list(cur); path[-1] = list(end)
                m = length(path)
                segs.append({"mode": sg["mode"], "path": [r6(p) for p in path], "source": src, "m": round(m)})
                print(f"  {sg['mode']:<9} {m:8.0f} m  {src}")
            except (Fail, RuntimeError) as e:
                tgt = end if end is not None else (pts[leg["to"]] if last else None)
                segs.append({"mode": sg["mode"], "path": None, "from": r6(cur), "to": r6(tgt) if tgt else None, "confirm": str(e)})
                print(f"  {sg['mode']:<9}  ⚠ à confirmer : {e}")
                end = tgt if tgt else cur
            cur = end
            cur_station = isinstance(sg.get("to"), dict) and ("station" in sg["to"] or "exit" in sg["to"])
        if metres(cur, pts[leg["to"]]) > 0.5 and segs and segs[-1].get("path"):
            segs.append({"mode": "walk", "path": None, "from": r6(cur), "to": r6(pts[leg["to"]]), "confirm": "fin de tronçon non reliée à l'arrêt"})
        out[lid] = {"segments": segs}
        ok = sum(1 for s in segs if s.get("path")); ko = len(segs) - ok
        report.append(f"{lid} : {ok} segment(s) tracé(s){f', {ko} à confirmer' if ko else ''}")

    dst = os.path.join(ROOT, f"travelos/routes/osm/{day}.json")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump({"day": day, "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "license": "© les contributeurs d'OpenStreetMap (ODbL)", "anchors": anchors, "legs": out, "report": report, "flags": flags},
              open(dst, "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print("\n" + "\n".join(report) + f"\n→ {dst}")

def junction(a, b):
    near = [22.2840, 114.1520]
    A = {(round(p[0], 7), round(p[1], 7)) for w in L().named_ways(a, near, 3000) for p in w["geom"]}
    B = {(round(p[0], 7), round(p[1], 7)) for w in L().named_ways(b, near, 3000) for p in w["geom"]}
    common = A & B
    if common: return list(sorted(common)[0]), f"carrefour {a} × {b} (OSM)"
    if A and B:
        da, pa, pb = min((metres(x, y), x, y) for x in A for y in B)
        if da <= 40: return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], f"croisement {a} × {b} (OSM, voies à {da:.0f} m)"
    raise Fail(f"carrefour introuvable : {a} × {b}")
BBOX_J = (22.255, 114.12, 22.335, 114.235)

if __name__ == "__main__":
    days = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, "travelos/routes")) if re.fullmatch(r"j\d+\.json", f))
    for d in days:
        print(f"\n================ {d} ================")
        main(d)
