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
        pts = [(round(g["lat"], 7), round(g["lon"], 7)) for g in geom]
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

def geocode(g):
    """Point d'une étape sans fiche, cherché autour de « near » (1,5 km) : nom exact dans OSM, puis adresse,
    puis les géocodeurs Photon et Nominatim. Le premier résultat à moins de 1,5 km de « near » est retenu."""
    near = g.get("near"); R = g.get("R", 1500)
    def center(el): return [el["center"]["lat"], el["center"]["lon"]] if "center" in el else [el["lat"], el["lon"]]
    def close(p): return near is None or metres(p, near) <= R
    tries = []
    if g.get("osm") and g.get("facade"):
        # Entrée d'un bâtiment sur une rue : nœud « entrance » du bâtiment le plus proche de la rue,
        # sinon milieu du côté du bâtiment qui fait face à la rue.
        names = g["osm"]; st = g["facade"]
        q = "".join(f'way["{k}"="{v}"](around:{R},{near[0]},{near[1]});' for v in names for k in ("name", "name:en", "name:zh"))
        d = overpass(f'[out:json][timeout:60];({q})->.b;.b out geom tags;node(w.b)["entrance"];out body;'
                     f'(way["name:en"="{st}"](around:{R},{near[0]},{near[1]});way["name"="{st}"](around:{R},{near[0]},{near[1]}););out geom;')
        bld = [x for x in d["elements"] if x["type"] == "way" and x.get("tags", {}).get("building") or (x["type"] == "way" and x.get("tags", {}).get("amenity") == "place_of_worship")]
        road = [(g2["lat"], g2["lon"]) for x in d["elements"] if x["type"] == "way" and st in {x.get("tags", {}).get("name:en"), x.get("tags", {}).get("name")} for g2 in x["geometry"]]
        if bld and road:
            b = bld[0]; ring = [(p["lat"], p["lon"]) for p in b["geometry"]]
            to_road = lambda p: min(metres(p, r) for r in road)
            ents = [x for x in d["elements"] if x["type"] == "node" and "entrance" in x.get("tags", {})]
            if ents:
                e = min(ents, key=lambda x: to_road((x["lat"], x["lon"])))
                return [e["lat"], e["lon"]], f"OSM : entrée (nœud {e['id']}, entrance={e['tags']['entrance']}) de « {b['tags'].get('name')} » sur {st}"
            mids = [((a[0] + c[0]) / 2, (a[1] + c[1]) / 2) for a, c in zip(ring, ring[1:])]
            m = min(mids, key=to_road)
            return list(m), f"OSM : façade de « {b['tags'].get('name')} » (way {b['id']}) côté {st}, à {to_road(m):.0f} m de la rue"
        print("   façade introuvable, repli sur le nom")
    if g.get("osm") and g.get("entrance"):
        names = g["osm"] if isinstance(g["osm"], list) else [g["osm"]]
        q = "".join(f'nwr["{k}"="{v}"](around:{R},{near[0]},{near[1]});' for v in names for k in ("name", "name:en", "name:zh"))
        d = overpass(f'[out:json][timeout:60];({q})->.b;.b out center tags;node(w.b)["entrance"];out body;node(r.b)["entrance"];out body;')
        ents = [x for x in d["elements"] if x["type"] == "node" and "entrance" in x.get("tags", {})]
        if ents:
            main = [x for x in ents if x["tags"]["entrance"] in ("main", "yes")] or ents
            e = min(main, key=lambda x: metres((x["lat"], x["lon"]), near))
            return [e["lat"], e["lon"]], f"OSM : entrée {e['tags'].get('ref') or e['tags']['entrance']} (nœud {e['id']})"
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
    raise Fail(f"point introuvable ({g.get('osm') or g.get('q')})")

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

def rail_graph(kind, a, b):
    m = 0.02 if metres(a, b) < 20000 else 0.15
    s, w, n, e = bbox_of([a, b], m)
    k = (kind, round(s, 2), round(w, 2), round(n, 2), round(e, 2))
    if k not in _rails:
        print(f"  Overpass : voies {kind}…")
        d = overpass(f'[out:json][timeout:240];{RAIL_Q[kind]}({s},{w},{n},{e});out geom;')
        g = Graph()
        for el in d["elements"]:
            if el.get("geometry"): g.add_way(el["geometry"])
        _rails[k] = g
    if not _rails[k].adj: raise Fail(f"aucune voie {kind} dans OSM")
    return _rails[k]

def line_data(rx, bb):
    """Lignes (métro, train, tram léger) dont le nom, la référence ou le réseau correspond à rx, dans la zone du jour."""
    s, w, n, e = bb
    key = (round(s, 1), round(w, 1), round(n, 1), round(e, 1))
    if key not in _lines:
        print("  Overpass : lignes de transport du jour…")
        d = overpass(f'[out:json][timeout:240];relation["route"~"^(subway|train|light_rail|monorail)$"]({s},{w},{n},{e})->.r;.r out body;way(r.r);out geom;node(r.r);out body;')
        _lines[key] = d
    d = _lines[key]
    ways = {el["id"]: el for el in d["elements"] if el["type"] == "way"}
    nodes = {el["id"]: el for el in d["elements"] if el["type"] == "node"}
    g, stops, rels = Graph(), [], []
    for rel in (el for el in d["elements"] if el["type"] == "relation"):
        t = rel["tags"]; txt = " ".join(filter(None, [t.get("name"), t.get("name:en"), t.get("name:zh"), t.get("ref"), t.get("network"), t.get("network:en")]))
        if not re.search(rx, txt, re.I): continue
        rels.append(f"relation {rel['id']} ({t.get('name:en') or t.get('name')})")
        for m in rel["members"]:
            if m["type"] == "way" and m["role"] in ("", "route", "forward", "backward") and m["ref"] in ways and ways[m["ref"]].get("geometry"):
                g.add_way(ways[m["ref"]]["geometry"])
            if m["type"] == "node" and m["role"].startswith("stop") and m["ref"] in nodes:
                nd = nodes[m["ref"]]; tg = nd.get("tags", {})
                stops.append({"name": " / ".join(filter(None, [tg.get("name:en"), tg.get("name"), tg.get("name:zh")])), "p": [nd["lat"], nd["lon"]], "id": nd["id"]})
    if not g.adj: raise Fail(f"ligne « {rx} » introuvable dans OSM")
    return g, stops, rels

def station(rx_station, rx_line, bb):
    g, stops, rels = line_data(rx_line, bb)
    c = [s for s in stops if re.search(rx_station, s["name"], re.I)]
    if not c: raise Fail(f"station « {rx_station} » absente de la ligne « {rx_line} »")
    lat = sum(s["p"][0] for s in c) / len(c); lng = sum(s["p"][1] for s in c) / len(c)
    return list(g.nearest((lat, lng))), f"{c[0]['name']} (OSM nœud {c[0]['id']}, {rels[0]})"

def exit_of(station_pt, ref):
    d = overpass(f'[out:json][timeout:60];node["railway"="subway_entrance"](around:400,{station_pt[0]},{station_pt[1]});out body;')
    c = [e for e in d["elements"] if (e.get("tags", {}).get("ref") or "").replace(" ", "").lower() == ref.replace(" ", "").lower()]
    if not c: raise Fail(f"sortie {ref} introuvable dans OSM")
    e = min(c, key=lambda x: metres((x["lat"], x["lon"]), station_pt))
    return [e["lat"], e["lon"]], f"sortie {ref} (OSM nœud {e['id']})"

_entr = {}
def entrance(st, toward):
    """Sortie de métro (railway=subway_entrance) à moins de 350 m de la station, la plus proche de « toward »."""
    k = (round(st[0], 5), round(st[1], 5))
    if k not in _entr:
        d = overpass(f'[out:json][timeout:60];node["railway"="subway_entrance"](around:350,{st[0]},{st[1]});out body;')
        _entr[k] = [([e["lat"], e["lon"]], e.get("tags", {}).get("ref") or e.get("tags", {}).get("name:en") or "") for e in d["elements"]]
    if not _entr[k]: return None, None
    p, ref = min(_entr[k], key=lambda x: metres(x[0], toward))
    return p, ref

def osrm(profile, a, b):
    base = {"foot": "https://routing.openstreetmap.de/routed-foot", "car": "https://routing.openstreetmap.de/routed-car"}[profile]
    u = f"{base}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson"
    d = json.loads(http(u)); time.sleep(1.0)
    if d.get("code") != "Ok": raise Fail(f"OSRM {profile} : {d.get('code')}")
    r = d["routes"][0]; co = r["geometry"]["coordinates"]
    path = [[c[1], c[0]] for c in co]
    # OSRM accroche départ et arrivée à la route la plus proche : si c'est loin, l'itinéraire n'est pas fiable.
    if metres(path[0], a) > 250 or metres(path[-1], b) > 250: raise Fail(f"OSRM {profile} : départ ou arrivée à plus de 250 m d'une voie")
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
            elif s.get("near"):
                pts[s["id"]] = list(s["near"]); anchors[s["id"]] = {"p": r6(s["near"]), "source": f"point approché ({e})", "confirm": True}
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
                    path, ga, gb = rail_graph(sg["rail"], start, end).path(start, end)
                    if ga > sg.get("snap", 400) or gb > sg.get("snap", 400): raise Fail(f"voie {sg['rail']} à {ga:.0f} m / {gb:.0f} m des points")
                    src = f"voie OSM {RAIL_Q[sg['rail']].split('[', 1)[1].split(']')[0]} (recollée à {ga:.0f} m / {gb:.0f} m des points)"
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
    s, w, n, e = BBOX_J
    d = overpass(f'[out:json][timeout:120];(way["name:en"="{a}"]({s},{w},{n},{e});way["name"="{a}"]({s},{w},{n},{e});'
                 f'way["name:en"="{b}"]({s},{w},{n},{e});way["name"="{b}"]({s},{w},{n},{e}););out geom tags;')
    def nm(el): return {el["tags"].get("name:en"), el["tags"].get("name")}
    A = {(round(g["lat"], 7), round(g["lon"], 7)) for el in d["elements"] if a in nm(el) for g in el["geometry"]}
    B = {(round(g["lat"], 7), round(g["lon"], 7)) for el in d["elements"] if b in nm(el) for g in el["geometry"]}
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
