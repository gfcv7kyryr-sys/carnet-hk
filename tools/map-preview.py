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

async def shoot():
    os.makedirs(OUT, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8799), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, w, h, extra in [("paysage", 1280, 800, None), ("portrait", 800, 1280, None), ("portrait-etapes", 800, 1280, "list"),
                                  ("matin-zoom", 1280, 800, "am"), ("apres-midi", 1280, 800, "pm"),
                                  ("onglet-plan-portrait", 800, 1280, "embed"), ("onglet-plan-paysage", 1280, 800, "embed")]:
            ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1.5)
            pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.goto("http://127.0.0.1:8799/assets/ui/index.html"); await pg.wait_for_timeout(400)
            await pg.evaluate("localStorage.setItem('tos.simDate', JSON.stringify('2027-02-22T09:50'))")
            await pg.click('[data-profile="pilote"]'); await pg.wait_for_timeout(1200)
            if extra == "embed":
                await pg.evaluate("store.set('daySec','plan'); go('programme','day','j2')")
            else:
                await pg.click("[data-daymap]")
            await pg.wait_for_function("typeof glMap !== 'undefined' && glMap && glMap.loaded()", timeout=60000)
            await pg.wait_for_timeout(600)
            if extra == "list": await pg.click(".dm-card [data-maplist]"); await pg.wait_for_timeout(900)
            chk = await pg.evaluate("__mapCheck()")
            if extra == "am": await pg.evaluate("glMap.jumpTo({center:[114.1535,22.2842],zoom:15.4})")
            if extra == "pm": await pg.evaluate("glMap.jumpTo({center:[114.196,22.2835],zoom:14.6})")
            await pg.evaluate("new Promise(r => { const t = setTimeout(r, 25000); glMap.once('idle', () => { clearTimeout(t); r(); }); glMap.triggerRepaint(); })")
            await pg.wait_for_timeout(900)
            await pg.screenshot(path=os.path.join(OUT, f"carte-j2-{name}.png"))
            ko = [c for c in chk if not c["inView"] or c["hidden"] or c["overlap"] or c["off"] > 2]
            mm = next((c for c in chk if c["id"] == "man-mo"), None)
            if not extra or extra in ("list", "embed"):
                bad += len(ko) + (0 if mm and mm["label"] else 1)
            print(f"{name} : zoom {await pg.evaluate('glMap.getZoom().toFixed(2)')}, repères OK {len(chk) - len(ko)}/{len(chk)}, Man Mo libellé : {mm and mm['label']}",
                  *(f"\n  ✗ {c}" for c in ko), *(f"\n  erreur page : {e}" for e in errs[:3]))
            await ctx.close()
        await b.close()
    srv.shutdown()
    if bad: sys.exit(f"{bad} problème(s) de repères au cadrage initial")

asyncio.run(shoot())
