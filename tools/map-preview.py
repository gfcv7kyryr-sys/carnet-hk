#!/usr/bin/env python3
"""
Photographie la Carte du jour 2 avec les vraies tuiles OpenStreetMap, comme sur la tablette.

    python3 tools/map-preview.py

Sert l'interface comme l'appli (/assets/, /pack/, et /osm/ qui relaie OpenFreeMap comme OsmTiles.kt),
ouvre la carte du jour 2 au 22 février 9 h 50 (prochaine étape : Peak Tram), puis enregistre dans
travelos/preview/ : paysage, portrait, portrait replié et un zoom sur l'après-midi. Vérifie aussi que le
panneau, l'en-tête, la légende et les boutons ne masquent aucun repère au cadrage initial.
"""
import asyncio, http.server, json, os, sys, threading, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "travelos/preview")
BASE = "https://tiles.openfreemap.org"
UA = {"User-Agent": "TravelOS-preview/0.11"}
tile_tpl = None

def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r: return r.read()
    except Exception as e:
        print("  ✗", url[:100], e); return None

class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        global tile_tpl
        p = self.path.split("?")[0]
        if p.startswith("/osm/"):
            rel = p[5:]
            if rel.startswith("t/"):
                if tile_tpl is None:
                    tj = get(f"{BASE}/planet")
                    if tj: tile_tpl = json.loads(tj)["tiles"][0]; print("  tuiles :", tile_tpl)
                z, x, y = rel[2:-4].split("/")
                b = get(tile_tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y)) if tile_tpl else None
            elif rel.startswith("fonts/"): b = get(f"{BASE}/{rel}")
            else: b = None
            self.send_response(200 if b else 204); self.send_header("Content-Type", "application/x-protobuf"); self.end_headers()
            if b: self.wfile.write(b)
            return
        return super().do_GET()
    def translate_path(self, path):
        path = path.split("?")[0]
        for pre, base in (("/assets/", "android/app/src/main/assets/"), ("/pack/", "")):
            if path.startswith(pre): return os.path.join(ROOT, base, urllib.request.unquote(path[len(pre):]))
        return "/nonexistent"
    def log_message(self, *a): pass

async def open_map(b, w, h, day, when):
    ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1.25)
    pg = await ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    await pg.goto("http://127.0.0.1:8799/assets/ui/index.html"); await pg.wait_for_timeout(400)
    await pg.evaluate(f"localStorage.setItem('tos.simDate', JSON.stringify('{when}'))")
    await pg.click('[data-profile="pilote"]'); await pg.wait_for_timeout(1000)
    await pg.evaluate(f"go('programme','map','{day}')")
    await pg.wait_for_function("typeof glMap !== 'undefined' && glMap && glMap.loaded()", timeout=60000)
    await pg.wait_for_timeout(700)
    return ctx, pg, errs

async def settle(pg):
    await pg.evaluate("new Promise(r => { const t = setTimeout(r, 25000); glMap.once('idle', () => { clearTimeout(t); r(); }); glMap.triggerRepaint(); })")
    await pg.wait_for_timeout(900)

async def shoot():
    os.makedirs(OUT, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    pack = json.load(open(os.path.join(ROOT, "travelos/pack/pack.json"), encoding="utf8"))
    summary, bad = [], 0
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for d in pack["days"]:
            m = d.get("map") or {}
            zones = m.get("zones") or []
            for zi in (range(len(zones)) if len(zones) > 1 else [None]):
                ctx, pg, errs = await open_map(b, 1280, 800, d["id"], f"{d['date']}T07:30")
                if zi is not None:
                    await pg.evaluate(f"mapFit(false, {zi})"); await pg.wait_for_timeout(500)
                chk = await pg.evaluate("__mapCheck()") or []
                await settle(pg)
                tag = f"j{d['number']:02d}" + (f"-{zi + 1}" if zi is not None else "")
                await pg.screenshot(path=os.path.join(OUT, f"plan-{tag}.png"))
                inzone = [c for c in chk if zi is None or c["id"] in zones[zi]["stops"]]
                ko = [c for c in inzone if not c["inView"] or c["hidden"] or c["overlap"] or c["off"] > 2]
                bad += len(ko)
                print(f"Jour {d['number']}{'' if zi is None else ' · ' + zones[zi]['name']} : repères OK {len(inzone) - len(ko)}/{len(inzone)}",
                      *(f"\n  ✗ {c}" for c in ko), *(f"\n  erreur page : {e}" for e in errs[:3]))
                await ctx.close()
            legs = m.get("legs") or []
            summary.append({"jour": d["number"], "id": d["id"], "ville": d["city"], "arrets": len(m.get("stops") or []),
                            "troncons": len(legs), "traces": sum(1 for l in legs if l["segments"] and all(s.get("path") for s in l["segments"])),
                            "a_confirmer": [f"{l['from']} → {l['to']} : " + "; ".join(s.get("confirm", "") for s in l["segments"] if not s.get("path")) for l in legs if l.get("confirm")],
                            "points_a_confirmer": [s["id"] for s in m.get("stops") or [] if s.get("confirm")]})
        # Disneyland : le parc de près, plan illustré et fond standard.
        for name, illu in (("j12-parc-illustre", True), ("j12-parc-standard", False)):
            ctx, pg, errs = await open_map(b, 1280, 800, "j12", "2027-03-04T07:30")
            if not illu: await pg.click("[data-mapillu]")
            await pg.evaluate("glMap.jumpTo({center:[114.0405,22.3122],zoom:16.2})")
            await settle(pg)
            await pg.screenshot(path=os.path.join(OUT, f"plan-{name}.png")); await ctx.close()
        # Onglet Plan intégré (jour 2), portrait.
        ctx = await b.new_context(viewport={"width": 800, "height": 1280}, device_scale_factor=1.25); pg = await ctx.new_page()
        await pg.goto("http://127.0.0.1:8799/assets/ui/index.html"); await pg.wait_for_timeout(400)
        await pg.evaluate("localStorage.setItem('tos.simDate', JSON.stringify('2027-02-22T09:50'))")
        await pg.click('[data-profile="pilote"]'); await pg.wait_for_timeout(1000)
        await pg.evaluate("store.set('daySec','plan'); go('programme','day','j2')")
        await pg.wait_for_function("typeof glMap !== 'undefined' && glMap && glMap.loaded()", timeout=60000); await settle(pg)
        await pg.screenshot(path=os.path.join(OUT, "plan-j02-onglet-portrait.png")); await ctx.close()
        await b.close()
    srv.shutdown()
    json.dump(summary, open(os.path.join(OUT, "plans.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
    for x in summary:
        print(f"Jour {x['jour']} ({x['ville']}) : {x['traces']}/{x['troncons']} tronçons tracés ; à confirmer : {len(x['a_confirmer'])} ; points à confirmer : {x['points_a_confirmer']}")
        for c in x["a_confirmer"]: print("    -", c)
    if bad: sys.exit(f"{bad} repère(s) masqué(s) ou chevauchés au cadrage initial")

asyncio.run(shoot())
