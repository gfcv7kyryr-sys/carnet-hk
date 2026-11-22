#!/usr/bin/env python3
"""
OpenStreetMap en local : les extraits Geofabrik filtrés (tools/osm-prepare.sh) chargés en mémoire, avec les
recherches dont les Plans du jour ont besoin (lieu par son nom, entrées d'un bâtiment, sorties de métro, lignes
de transport et leurs stations, voies ferrées, ferries, téléphériques, rues nommées). Remplace Overpass : rapide,
sans limite de requêtes, et le même résultat d'un calcul à l'autre.
"""
import glob, math, os, re
import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.environ.get("OSM_DIR", os.path.join(ROOT, ".osm"))
KEEP_N = ("name", "entrance", "railway", "public_transport", "aerialway", "amenity", "tourism", "historic", "man_made", "leisure", "ref")

def metres(a, b):
    k = math.pi / 180
    return math.hypot((a[1] - b[1]) * 111320 * math.cos((a[0] + b[0]) / 2 * k), (a[0] - b[0]) * 111320)

class _H(osmium.SimpleHandler):
    def __init__(self, db):
        super().__init__(); self.db = db
    def node(self, n):
        if not n.location.valid(): return
        t = {x.k: x.v for x in n.tags}
        if t and any(k in t for k in KEEP_N):
            self.db.nodes[n.id] = {"t": "n", "id": n.id, "tags": t, "p": [n.location.lat, n.location.lon]}
    def way(self, w):
        try: pts = [[nd.location.lat, nd.location.lon] for nd in w.nodes]
        except osmium.InvalidLocationError: pts = [[nd.location.lat, nd.location.lon] for nd in w.nodes if nd.location.valid()]
        if len(pts) < 1: return
        self.db.ways[w.id] = {"t": "w", "id": w.id, "tags": {x.k: x.v for x in w.tags}, "geom": pts, "nodes": [nd.ref for nd in w.nodes]}
    def relation(self, r):
        self.db.rels[r.id] = {"t": "r", "id": r.id, "tags": {x.k: x.v for x in r.tags}, "members": [(m.type, m.ref, m.role) for m in r.members]}

class OSM:
    def __init__(self, d=DIR):
        self.nodes, self.ways, self.rels = {}, {}, {}
        files = sorted(glob.glob(os.path.join(d, "*.filtre.osm.pbf")))
        if not files: raise RuntimeError(f"aucun extrait OSM dans {d} (lancer tools/osm-prepare.sh)")
        for f in files:
            print(f"  chargement {os.path.basename(f)}…", flush=True)
            _H(self).apply_file(f, locations=True, idx="flex_mem")
        self.grid = {}
        for col in (self.nodes, self.ways):
            for e in col.values():
                if not e["tags"]: continue
                p = self.center(e)
                if p: self.grid.setdefault((int(p[0] * 100), int(p[1] * 100)), []).append(e)
        print(f"  OSM local : {len(self.nodes)} nœuds, {len(self.ways)} voies, {len(self.rels)} relations", flush=True)

    # ---------- géométrie ----------
    def center(self, e):
        if e["t"] == "n": return e["p"]
        if e["t"] == "w":
            g = e["geom"]; return [sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)] if g else None
        pts = [p for (ty, ref, _) in e["members"] if ty == "w" and ref in self.ways for p in self.ways[ref]["geom"]]
        return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)] if pts else None

    def around(self, p, R, pred=lambda e: True):
        dc = int(R / 1000) + 1
        cy, cx = int(p[0] * 100), int(p[1] * 100)
        out = []
        for y in range(cy - dc, cy + dc + 1):
            for x in range(cx - dc, cx + dc + 1):
                for e in self.grid.get((y, x), ()):
                    c = self.center(e)
                    if c and metres(c, p) <= R and pred(e): out.append(e)
        return out

    # ---------- recherches ----------
    @staticmethod
    def names(e):
        t = e["tags"]; return {v.lower() for k, v in t.items() if k == "name" or k.startswith("name:") or k in ("alt_name", "official_name", "old_name")}

    def named(self, names, near, R):
        want = {n.lower() for n in names}
        c = self.around(near, R, lambda e: bool(self.names(e) & want))
        # Aussi les relations (parcs, sites en plusieurs morceaux).
        for r in self.rels.values():
            if self.names(r) & want:
                cc = self.center(r)
                if cc and metres(cc, near) <= R: c.append(r)
        c.sort(key=lambda e: (e["t"] == "n", metres(self.center(e), near)))
        return c

    def entrances_of(self, e):
        ids = set()
        if e["t"] == "w": ids = set(e["nodes"])
        elif e["t"] == "r": ids = {n for (ty, ref, _) in e["members"] if ty == "w" and ref in self.ways for n in self.ways[ref]["nodes"]}
        return [self.nodes[i] for i in ids if i in self.nodes and "entrance" in self.nodes[i]["tags"]]

    def subway_entrances(self, p, R):
        return [e for e in self.around(p, R, lambda e: e["t"] == "n" and e["tags"].get("railway") == "subway_entrance")]

    def ways_where(self, pred, bbox):
        s, w, n, e_ = bbox
        return [x for x in self.ways.values() if x["tags"] and pred(x["tags"]) and any(s <= p[0] <= n and w <= p[1] <= e_ for p in x["geom"][:: max(1, len(x["geom"]) // 8)] + [x["geom"][-1]])]

    def route_relations(self, rx, bbox):
        s, w, n, e_ = bbox
        out = []
        for r in self.rels.values():
            t = r["tags"]
            if t.get("route") not in ("subway", "train", "light_rail", "monorail", "tram"): continue
            txt = " ".join(filter(None, [t.get("name"), t.get("name:en"), t.get("name:zh"), t.get("ref"), t.get("network"), t.get("network:en")]))
            if not re.search(rx, txt, re.I): continue
            c = self.center(r)
            if c and s - 0.3 <= c[0] <= n + 0.3 and w - 0.3 <= c[1] <= e_ + 0.3: out.append(r)
        return out

    def named_ways(self, name, near, R):
        return [x for x in self.ways.values() if x["tags"].get("highway") and name in (x["tags"].get("name:en"), x["tags"].get("name"))
                and x["geom"] and metres(x["geom"][0], near) <= R + 3000]
