# Relooking « A+B » des 60 pages du carnet de Charlie : papier de riz, rouge laqué, or, Fraunces + Nunito.
# Source : tools/carnet-pages-scrapbook.js (version scrapbook d'origine) → android/.../charlie/pages.js
import json, re, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, "tools/carnet-pages-scrapbook.js")).read()
head, body = src[:src.index("{")], src[src.index("{"):src.rstrip().rstrip(";").rindex("}") + 1]
tail = src[src.rstrip().rstrip(";").rindex("}") + 1:]
d = json.loads(body)

def fam(m):
    style = m.group(0)
    def scale(st, k, extra):
        st = re.sub(r"font-size:\s*(\d+(?:\.\d+)?)px", lambda x: f"font-size:{float(x.group(1))*k:.1f}px", st)
        return st + extra
    if "'Caveat Brush'" in style:
        big = re.search(r"font-size:\s*(\d+)", style); big = big and int(big.group(1)) >= 40
        style = style.replace("'Caveat Brush',cursive", "'Fraunces',serif")
        style = scale(style, 0.74, ";font-weight:700;letter-spacing:-0.01em" + (";color:#C8341F" if big else ""))
    elif "'Caveat'" in style:
        style = style.replace("'Caveat',cursive", "'Fraunces',serif")
        style = scale(style, 0.8, ";font-style:italic;font-variation-settings:'opsz' 14")
    elif "'Special Elite'" in style:
        style = style.replace("'Special Elite',monospace", "'Nunito',sans-serif")
        style = scale(style, 0.92, ";font-weight:800;letter-spacing:.08em;text-transform:uppercase")
    style = style.replace("'Andika',sans-serif", "'Nunito',sans-serif")
    return style

KF = {"Caveat Brush": 0.74, "Caveat'": 0.8, "Special Elite": 0.92}
UL = ";text-decoration:underline;text-decoration-color:#D9A441;text-decoration-thickness:3px;text-underline-offset:7px;text-decoration-skip-ink:none"

def restyle(h, css=""):
    # tailles inline des éléments dont la police vient d'une classe CSS de la page (.h1, .hand…)
    kinds = {m.group(1): KF[m.group(2)] for m in re.finditer(r"\.([\w-]+)\{[^}]*(Caveat Brush|Caveat'|Special Elite)", css)}
    def cls(m):
        k = kinds.get(m.group(1).split()[0]) if m.group(1) else None
        if not k: return m.group(0)
        return re.sub(r"font-size:\s*(\d+(?:\.\d+)?)px", lambda x: f"font-size:{float(x.group(1))*k:.1f}px", m.group(0))
    h = re.sub(r'class="([^"]*)"[^>]*style="[^"]*"', cls, h)
    # surligneur jaune sous les titres → supprimé ; le titre qui suit est souligné d'un filet doré
    band = r'<div (?:class="hl" style="[^"]*"|style="[^"]*background:#F7E08A;opacity:\.85[^"]*")></div>\s*(<div [^>]*?style=")([^"]*)"'
    h = re.sub(band, lambda m: m.group(1) + m.group(2) + UL + '"', h)
    # polices (chaque attribut style est traité en entier)
    h = re.sub(r'style="[^"]*"', fam, h)
    # papier de riz, rouge laqué, kraft doré
    h = h.replace("#F7F0E1", "#FBF5E9").replace("#C23B2C", "#C8341F").replace("#E8D3A8", "#F3E6CC")
    # cadres photo et cartes : droits, avec un liseré doré (fini le scotch de travers)
    def card(m):
        st = m.group(0)
        if re.search(r"background:\s*#(FFF|FFFCF5)\b", st) and "box-shadow" in st:
            st = re.sub(r"transform:\s*rotate\([^)]*\)", "transform:none", st)
            st = st.replace("box-shadow:0 3px 10px rgba(59,47,40,.25)", "box-shadow:inset 0 0 0 2px #D9A441,0 6px 16px rgba(80,40,10,.18)")
        return st
    h = re.sub(r'style="[^"]*"', card, h)
    return h

def fam_block(m):
    class M:  # même traitement que pour un attribut style, appliqué à un bloc de règle CSS
        def __init__(s, t): s.t = t
        def group(s, i): return s.t
    return fam(M(m.group(0)))
for n, p in enumerate(d["pages"]):
    p["html"] = restyle(p["html"], p.get("css", "") if n else "")  # couverture : tailles d'origine
    css = p.get("css", "")
    css = re.sub(r"\{[^}]*\}", fam_block, css)
    p["css"] = css.replace("#F7F0E1", "#FBF5E9").replace("#C23B2C", "#C8341F").replace("#E8D3A8", "#F3E6CC")
open(os.path.join(ROOT, "android/app/src/main/assets/ui/charlie/pages.js"), "w").write(head + json.dumps(d, ensure_ascii=False, separators=(",", ":")) + tail)
print("ok", len(d["pages"]), "pages")
