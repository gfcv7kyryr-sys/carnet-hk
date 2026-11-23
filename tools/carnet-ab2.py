# Relooking en profondeur « A+B » du carnet de Charlie.
# Les pages Matin / Lieux / Soir sont recomposées sur des gabarits A+B (contenu extrait des pages d'origine),
# les autres (couverture, prologue, cherche-et-trouve, fin, demi-pages atypiques) passent par le restylage de carnet-ab.py.
# Source : tools/carnet-pages-scrapbook.js → android/.../charlie/pages.js
import json, re, os, sys, importlib.util, html as H
from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("ab1", os.path.join(ROOT, "tools/carnet-ab.py"))
src = open(os.path.join(ROOT, "tools/carnet-pages-scrapbook.js")).read()
head = src[:src.index("{")]
end = src.rstrip().rstrip(";").rindex("}") + 1
D = json.loads(src[src.index("{"):end]); tail = src[end:]

# restyle() de la v1 (polices, couleurs) sans exécuter son écriture de fichier
ab1src = open(os.path.join(ROOT, "tools/carnet-ab.py")).read().split("for n, p in enumerate")[0]
ab1 = {"__file__": os.path.join(ROOT, "tools/carnet-ab.py")}; exec(compile(ab1src, "carnet-ab.py", "exec"), ab1)
restyle = ab1["restyle"]; fam_block = ab1["fam_block"]

STAR = "90aed01aded1dd086c542cb7d04067fb"
DAYNAME = {}

def txt(el): return re.sub(r"\s+", " ", el.get_text(" ") if isinstance(el, Tag) else str(el)).strip()
def esc(s): return H.escape(s, quote=False)
def fsize(el):
    m = re.search(r"font-size:\s*(\d+(?:\.\d+)?)px", el.get("style", "") if isinstance(el, Tag) else "")
    return float(m.group(1)) if m else 0
def maxfs(el):
    return max([fsize(el)] + [fsize(x) for x in el.find_all(True)])
def unpos(el):
    """retire position absolue, décalages et rotation d'un élément conservé tel quel"""
    st = el.get("style", "")
    st = re.sub(r"(^|;)\s*(position|left|top|right|bottom|transform)\s*:[^;]*", r"\1", st)
    el["style"] = re.sub(r";{2,}", ";", st).strip(";")
    return el
def para(el):
    ps = [txt(p) for p in el.find_all("p")]
    return [p for p in ps if p] or [txt(el)]

# ---------------------------------------------------------------- classement des éléments d'une demi-page
MARK = ("Le sais-tu", "Ta mission", "J'ai aimé", "Xiao Long t'explique")
def units(el):
    """éclate un conteneur qui regroupe plusieurs blocs (le sais-tu + mission + étoiles…)"""
    t = txt(el)
    if el.name == "div" and sum(t.count(m) for m in MARK) > 1 and not t.startswith("Xiao Long t'explique"):
        out = []
        for k in el.find_all(recursive=False):
            if isinstance(k, Tag): out += units(k)
        return out
    return [el]

def classify(half):
    out = []
    kids = []
    for ch in half.find_all(recursive=False):
        if isinstance(ch, Tag): kids += units(ch)
    for ch in kids:
        if not isinstance(ch, Tag): continue
        cls = ch.get("class") or []; st = ch.get("style", ""); t = txt(ch)
        if "tape" in cls or "hl" in cls or ch.name in ("svg", "script"): continue
        if ch.name == "img" and STAR in ch.get("src", ""): continue
        if ch.name == "img":
            alt = ch.get("alt") or ""
            if alt.startswith("Tampon"): out.append(("stamp", ch))
            elif alt: out.append(("art", ch))
            else: out.append(("decor", ch))
            continue
        if ch.find("img", src=re.compile(STAR)) or (ch.name == "img" and STAR in ch.get("src", "")): out.append(("stars", ch)); continue
        if re.fullmatch(r"J'ai aimé\s*:?", t): continue
        if not t and not ch.find(True): continue
        if "Xiao Long t'explique" in t: out.append(("explique", ch)); continue
        if t.startswith("Le sais-tu"): out.append(("sais", ch)); continue
        if re.match(r"(Ta mission|Mission)", t): out.append(("mission", ch)); continue
        if "kraft" in cls or (ch.find("b") and re.search(r"(Où|Depuis|Quand|Durée|Le chiffre|Ouvert)", t) and len(t) < 260 and "explique" not in t):
            out.append(("info", ch)); continue
        if "pola" in cls or (ch.find("img") and "#FFF" in st and "padding" in st and len(ch.find_all("img")) == 1 and len(t) < 60):
            out.append(("pola", ch)); continue
        if re.match(r"(colle ici|ta photo)", t, re.I): out.append(("photo", ch)); continue
        if re.search(r"(^|\s)[Dd]essine", t) and fsize(ch) and re.search(r"height:\s*(\d+)", st) and int(re.search(r"height:\s*(\d+)", st).group(1)) >= 80:
            out.append(("draw", ch)); continue
        if "text-stroke" in str(ch): out.append(("extra", ch)); continue
        if maxfs(ch) >= 40 and re.search(r"top:\s*(\d+)", st) and int(re.search(r"top:\s*(\d+)", st).group(1)) < 70:
            out.append(("title", ch)); continue
        if not ch.find(["img", "div"]) or (len(t) < 140 and not ch.find("img") and len(ch.find_all("div")) <= 1):
            out.append(("note", ch)); continue
        out.append(("extra", ch))
    return out

def title_parts(el):
    kids = [k for k in el.find_all(recursive=False) if isinstance(k, Tag) and "hl" not in (k.get("class") or []) and txt(k)]
    if not kids: return txt(el), ""
    big = [k for k in kids if maxfs(k) >= 40]
    t = " ".join(txt(k) for k in big) or txt(kids[0])
    sub = " ".join(txt(k) for k in kids if k not in big)
    return t, sub

def info_lines(el):
    lines = []; stop = False
    for d in el.find_all(["div", "p"]):
        if d.find(["div", "p"]): continue
        b = d.find("b"); t = txt(d)
        if not t: continue
        if t.startswith("Ta mission") or stop: stop = True; continue
        if b:
            # plusieurs <b> dans la même ligne (« Où ? … Ouvert à tous depuis ? … »)
            parts = re.split(r"(?=\b(?:Où|Depuis|Quand|Durée|Le chiffre|Ouvert à tous depuis|Le plus|Avec quoi|Combien)\b)", t)
            for part in [x.strip() for x in parts if x.strip()]:
                m = re.match(r"(.+?(?:\?|:))\s*(.*)", part)
                if m: lines.append((m.group(1).rstrip(" :"), m.group(2)))
                else: lines.append(("", part))
        elif not re.fullmatch(r"[A-ZÀ-Ý0-9 ·'’\-]+", t):
            lines.append(("", t))
    return lines

def mission_parts(el):
    t = txt(el); t = re.sub(r"^(Ta mission|Mission)\s*:?\s*", "", t)
    grid = el.find("div", style=re.compile(r"display:\s*grid"))
    return t if not grid else txt(grid.find_previous_sibling() or el).replace("Ta mission :", "").strip(), grid

# ---------------------------------------------------------------- briques HTML
PACK = json.load(open(os.path.join(ROOT, "travelos/pack/pack.json")))
CITY = {i + 1: d.get("city", "") for i, d in enumerate(PACK.get("days", []))}
NUM = [0]
CLOUD = '<svg class="lv-cl" viewBox="0 0 40 16" aria-hidden="true"><path d="M2 12c3-6 9-6 11-1 1-5 8-6 10-1 2-3 7-3 8 1 2-1 5 0 6 1"/></svg>'
def kicker(day): return f'<div class="lv-kick">Jour {day} · {esc(CITY.get(int(day), ""))}</div>'
def rule(): return '<div class="lv-rule"><i></i></div>'
def subtitle(sub): return f'<div class="lv-st">{CLOUD}<span>{esc(sub)}</span>{CLOUD}</div>' if sub else ""
def stars_html():
    return ('<div class="lv-stars"><span class="lv-sl">J\'ai aimé</span><span>' +
            "".join(f'<img src="img/{STAR}.webp" alt="" aria-hidden="true">' for _ in range(5)) + "</span></div>")
def info_strip(lines):
    lines = [(a, b) for a, b in lines if b][:3]
    if not lines: return ""
    NUM[0] += 1
    cols = "".join(f'<div class="lv-ic"><i>{esc(a or "À savoir")}</i><b>{esc(b)}</b></div>' for a, b in lines)
    return f'<div class="lv-info"><div class="lv-num"><small>N°</small><b>{NUM[0]}</b></div>{cols}</div>'
def info_html(lines, stamp=None): return info_strip(lines)
def sais_html(el):
    t = re.sub(r"^Le sais-tu\s*\?\s*", "", txt(el)); t = re.split(r"\s*Ta mission", t)[0]
    return f'<div class="lv-sais"><b>Le sais-tu ?</b><span>{esc(t)}</span></div>'
def explique_html(el, who="Xiao Long t'explique"):
    ps = para(el); ps = [re.sub(r"^Xiao Long t'explique\s*", "", p) for p in ps]
    return (f'<div class="lv-exp"><div class="lv-eh"><img src="img/livre-xiaolong-explique.webp" alt="" aria-hidden="true"><span>{esc(who)}</span></div>'
            + "".join(f"<p>{esc(p)}</p>" for p in ps if p) + "</div>")
def mission_box(text, grid=""):
    gom = '' if grid else '<div class="lv-gom"><div class="ck"></div><small>ta gommette</small></div>'
    return f'<div class="lv-mis"><div class="lv-mt"><span class="lv-tag">★ Ta mission</span><p>{esc(text)}</p>{grid}</div>{gom}</div>'
def mission_html(el):
    t, grid = mission_parts(el)
    return mission_box(t, str(unpos(grid)) if grid is not None else "")
def slot_html(el):
    """case photo à coller → polaroïd vide, la photo prendra exactement la forme du cadre"""
    cands = [d for d in [el] + el.find_all("div") if re.match(r"(colle ici|ta photo)", txt(d), re.I) and not d.find("div", string=re.compile(r"(colle ici|ta photo)", re.I))]
    z = cands[-1] if cands else el
    zt = txt(z); cap = txt(el).replace(zt, "", 1).strip()
    return (f'<div class="pola lv-pola lv-slot"><span class="lv-tape" aria-hidden="true"></span><div class="lv-phz">{esc(zt)}</div>'
            f'<div class="cap">{esc(cap)}</div></div>')
def pola_html(el):
    im = el.find("img"); cap = txt(el)
    return (f'<div class="pola lv-pola"><span class="lv-tape" aria-hidden="true"></span><img src="{im["src"]}" alt="{H.escape(im.get("alt", ""))}">'
            f'<div class="cap">{esc(cap)}</div></div>')
def art_html(el, cls="abp-art"):
    return f'<img class="{cls}" src="{el["src"]}" alt="{H.escape(el.get("alt", ""))}">'
def keep(el, cls):
    unpos(el); el["class"] = (el.get("class") or []) + [cls]; return str(el)

# ---------------------------------------------------------------- gabarit « lieu » (une demi-page)
def place_half(half, side, day, page_id):
    items = classify(half)
    kinds = [k for k, _ in items]
    if kinds.count("title") != 1 or kinds.count("explique") > 1 or kinds.count("pola") > 1: return None
    get = lambda k: [e for kk, e in items if kk == k]
    t, sub = title_parts(get("title")[0])
    hero = get("pola"); photos = get("photo"); arts = get("art"); stamps = get("stamp")
    info = get("info"); cks = [n for n in get("note") if is_ck(n)]
    notes = [txt(n) for n in get("note") if 2 < len(txt(n)) < 140 and n not in cks and not re.match(r"J\d+-T\d", txt(n))]
    longs = [n for n in get("note") if len(txt(n)) >= 140]
    cut = art_html(arts.pop(0), "lv-cut") if (arts and (hero or photos)) else ""
    h = [f'<div class="lv-h">{kicker(day)}<div class="lv-t">{esc(t)}</div>{subtitle(sub)}{cut}</div>']
    left = ""
    if hero: left = pola_html(hero[0])
    elif photos: left = slot_html(photos.pop(0))
    elif arts: left = f'<div class="lv-artf">{art_html(arts.pop(0))}</div>'
    if stamps: left += art_html(stamps[0], "lv-stamp")
    col = "".join(explique_html(e) for e in get("explique"))
    if notes: col += '<div class="lv-notes">' + "".join(f"<span>{esc(n)}</span>" for n in notes[:2]) + "</div>"
    if not get("explique") and arts: col += art_html(arts.pop(0), "lv-cut2")
    h.append(f'<div class="lv-band"><div class="lv-hero">{left}</div><div class="lv-col">{col}</div></div>')
    for a in arts: h.append(art_html(a, "lv-cut2"))
    if cks: h.append('<div class="lv-cks">' + "".join(ckline(c) for c in cks) + "</div>")
    for e in longs: h.append('<div class="lv-exp lv-tale">' + "".join(f"<p>{esc(x)}</p>" for x in para(e)) + "</div>")
    for e in get("extra"): h.append(keep(e, "abp-x"))
    for e in photos: h.append(keep(e, "abp-ph"))
    for e in get("draw"): h.append(keep(e, "abp-dr"))
    mis = "".join(mission_html(e) for e in get("mission"))
    for e in info + get("sais"):   # mission glissée dans la fiche ou dans « le sais-tu »
        m = re.search(r"Ta mission\s*:?\s*(.*)", txt(e))
        if m and not mis: mis = mission_box(m.group(1))
    bot = mis + "".join(sais_html(e) for e in get("sais"))
    if bot: h.append(f'<div class="lv-bot">{bot}</div>')
    if info: h.append(info_strip(info_lines(info[0])))
    if get("stars"): h.append(stars_html())
    return f'<div class="abp abp-place {side}"><div class="abp-in">' + "".join(h) + f'</div><div class="abp-folio">Jour {day}</div></div>'


# ---------------------------------------------------------------- gabarit « deux lieux sur une demi-page »
def topof(el):
    m = re.search(r"top:\s*(\d+)", el.get("style", "")); return int(m.group(1)) if m else (700 if "bottom" in el.get("style", "") else 0)
def heading_split(el):
    """sépare un intertitre (grosse police) du texte qui le suit"""
    big = [d for d in el.find_all(True) if fsize(d) >= 26 and txt(d) and not d.find(True, style=re.compile("font-size"))]
    if fsize(el) >= 26 and not big: return txt(el), ""
    if not big: return None, txt(el)
    h = " ".join(txt(b) for b in big); rest = txt(el)
    for b in big: rest = rest.replace(txt(b), "", 1)
    return h, rest.strip()
def is_ck(e):
    return isinstance(e, Tag) and (e.find(class_="ck") is not None or e.find("div", style=re.compile(r"width:\s*2[0-8]px;height:\s*2[0-8]px")) is not None)
def ckline(e):
    return f'<div class="abp-ckl"><div class="ck"></div><span>{esc(txt(e))}</span></div>'
def duo_half(half, side, day):
    items = classify(half)
    get = lambda k: [e for kk, e in items if kk == k]
    if len(get("title")) != 1: return None
    polas = get("pola")
    heads = [e for k, e in items if k in ("extra", "note") and heading_split(e)[0] and topof(e) > 200]
    if len(polas) < 2: return None
    split = min([topof(e) for e in heads] + ([topof(polas[1])] if len(polas) > 1 else [])) - 12
    t1, sub1 = title_parts(get("title")[0])
    secs = [{"t": t1, "sub": sub1, "els": []}, {"t": "", "sub": "", "els": []}]
    for k, e in items:
        if k in ("title", "decor", "stars"): continue
        sec = secs[0] if topof(e) < split else secs[1]
        if e in heads and not sec["t"]:
            h, rest = heading_split(e); sec["t"] = h
            if rest: sec["els"].append(("note", rest))
            continue
        sec["els"].append((k, e))
    out = []
    for i, sec in enumerate(secs):
        pic = next((e for k, e in sec["els"] if k == "pola"), None)
        body = []
        for k, e in sec["els"]:
            if e is pic: continue
            if k == "note" and isinstance(e, str): body.append(f'<p>{esc(e)}</p>')
            elif k == "mission": body.append(mission_html(e))
            elif k == "art": body.append(art_html(e, "abd-art"))
            elif k == "stamp": body.append(art_html(e, "abp-stamp"))
            elif is_ck(e) and len(txt(e)) < 80: body.append(ckline(e))
            elif e.find("div", style=re.compile("text-stroke")) or k in ("draw", "photo", "extra"): body.append(keep(e, "abd-k"))
            else: body.append(f'<p>{esc(txt(e))}</p>')
        out.append(f'<div class="abd-sec{" rev" if i else ""}">' + (kicker(day) if not i else "") + f'<div class="abd-t">{esc(sec["t"])}</div>' + (f'<div class="abd-sub">{esc(sec["sub"])}</div>' if sec["sub"] else "") +
                   f'<div class="abd-row"><div class="abd-pic">{pola_html(pic) if pic is not None else ""}</div><div class="abd-txt">{"".join(body)}</div></div></div>')
    st = stars_html() if get("stars") else ""
    return f'<div class="abp abp-duo {side}"><div class="abp-in">{out[0]}<div class="abd-sep">{rule()}</div>{out[1]}{st}</div><div class="abp-folio">Jour {day}</div></div>'

# ---------------------------------------------------------------- gabarit « matin »
def matin(p, root):
    L, R = [h for h in root.find_all(recursive=False)]
    il, ir = classify(L), classify(R)
    allit = il + ir
    get = lambda k, it=allit: [e for kk, e in it if kk == k]
    tt = get("title")
    if not tt: return None
    t, date = title_parts(tt[0])
    n = re.search(r"\d+", t).group(0)
    letter = next((e for k, e in allit if "Mon petit Xiao Long" in txt(e)), None)
    post = next((e for k, e in allit if e.find("img", alt=re.compile("Carte postale"))), None)
    mot = next((e for k, e in allit if "Le mot du jour" in txt(e)), None)
    meteo = next((e for k, e in allit if txt(e).startswith("Quel temps")), None)
    bubble = next((e for k, e in ir if k in ("note", "extra") and "border-radius" in e.get("style", "") and len(txt(e)) > 40), None)
    xl = next((e for k, e in ir if k == "art" and "Xiao Long" in e.get("alt", "")), None)
    notes = [e for k, e in allit if k == "note"]
    route = next((txt(e) for e in notes if "→" in txt(e) or e.sourceline and False), None)
    if route is None:
        route = next((txt(e) for e in notes if e in [x for kk, x in il if kk == "note"] and len(txt(e)) < 60 and "Lis-la" not in txt(e)), "")
    teaser = next((txt(e) for e in notes if "Tourne la page" in txt(e)), "")
    if not (letter and mot and meteo): return None
    # lettre de Mamie
    ps = [txt(x) for x in letter.find_all("p")]
    greet = ps[0] if ps else "Mon petit Xiao Long,"
    body = [x for x in ps[1:] if not x.startswith("Bisous")]
    sign = next((x for x in ps if x.startswith("Bisous")), "Bisous de dragon, Mamie Nainai xxx")
    timbre = letter.find("img", alt="Timbre")
    pm = next((txt(d) for d in letter.find_all("div") if re.search(r"\d\d\.\d\d\.\d\d", txt(d)) and not d.find("div")), "")
    city = CITY.get(int(n), "")
    if re.search(r"Macao", city): land, val = ("中國澳門", "MACAU"), "5 avos"
    elif re.search(r"Hong Kong|Lantau|Disney", city): land, val = ("中國香港", "HONG KONG"), "$5"
    else: land, val = ("中国", "CHINA"), "¥ 1,20"
    pic = post.find("img")["src"] if post else ""
    left = [f'<div class="abm-head"><div class="abm-seal"><small>JOUR</small><b>{n}</b></div>'
            f'<div>{kicker(n)}<div class="abm-date">{esc(date)}</div><div class="abm-route">{esc(route)}</div></div></div>']
    if post: left.append(f'<div class="abm-post"><span class="lv-tape" aria-hidden="true"></span><img src="{pic}" alt="Carte postale"></div>')
    stamp = (f'<div class="abm-stamp"><div class="abm-si">' + (f'<img src="{pic}" alt="" aria-hidden="true">' if pic else "") +
             f'<span class="abm-sv">{esc(val)}</span></div><div class="abm-sl"><b>{land[0]}</b><span>{land[1]}</span></div></div>')
    pmark = (f'<div class="abm-pm"><svg viewBox="0 0 120 40" aria-hidden="true"><path d="M0 8c10-6 20 6 30 0s20 6 30 0 20 6 30 0 20 6 30 0M0 20c10-6 20 6 30 0s20 6 30 0 20 6 30 0 20 6 30 0M0 32c10-6 20 6 30 0s20 6 30 0 20 6 30 0 20 6 30 0"/></svg>'
             f'<div class="abm-pmc"><span>{esc(city.upper() or "HONG KONG")}</span><b>{esc((re.search(r"\d\d\.\d\d\.\d\d", pm) or [pm])[0])}</b><span>✦ 小龍 ✦</span></div></div>')
    left.append('<div class="abm-letter"><div class="abm-lt">'
                f'<p class="g">{esc(greet)}</p>' + "".join(f"<p>{esc(x)}</p>" for x in body) +
                f'<p class="s">{esc(re.sub(r"Mamie Nainai.*", "", sign))}<b>Mamie Nainai</b></p></div>'
                f'<div class="abm-addr">{stamp}{pmark}'
                '<div class="abm-to"><span>Xiao Long</span><span>Le port aux parfums</span><span>Hong Kong</span></div></div></div>')
    right = ['<div class="abm-hi">' + (art_html(xl, "abm-xl") if xl else "") +
             (f'<div class="abm-bub">{esc(txt(bubble))}</div>' if bubble else "") + "</div>"]
    # mot du jour : on garde le caractère (encadré rouge) et le caractère à colorier
    zh = mot.find("div", style=re.compile("Ma Shan Zheng.*solid|solid.*Ma Shan Zheng"))
    col = mot.find("div", style=re.compile("text-stroke"))
    word = next((txt(d) for d in mot.find_all("div") if fsize(d) >= 34 and "Ma Shan" not in d.get("style", "")), "")
    small = [d for d in mot.find_all("div") if not d.find("div") and d is not zh and d is not col and fsize(d) and fsize(d) < 20]
    pin = txt(small[0]) if small else ""; expl = txt(small[1]) if len(small) > 1 else ""
    hint = next((txt(d) for d in mot.find_all("div") if "hand" in (d.get("class") or [])), "")
    nz = len(txt(zh)); zh["style"] = f"font-family:'Ma Shan Zheng',serif;border:2px solid #C23B2C;font-size:{ {1:64,2:50,3:34}.get(nz,28)}px"; zh["class"] = ["abm-zh"]
    if col is not None: col["style"] = f"font-family:'Ma Shan Zheng',serif;color:transparent;-webkit-text-stroke:1.6px #C8341F;font-size:{ {1:58,2:46,3:36}.get(nz,30)}px"; col["class"] = ["abm-col"]
    right.append('<div class="abm-mot"><div class="abm-mh">Le mot du jour</div><div class="abm-mr">' + str(zh) +
                 f'<div class="abm-mw"><b>{esc(word)}</b><span class="pin">{esc(pin)}</span><span>{esc(expl)}</span></div></div>' +
                 ('<div class="abm-cl">' + str(col) + f'<span>{esc(hint)}</span></div>' if col is not None else "") + "</div>")
    icons = []
    for d in meteo.find_all("div"):
        im = d.find("img", recursive=False); sp = d.find("span", recursive=False)
        if im and sp: icons.append(f'<div class="abm-w"><img src="{im["src"]}" alt="" aria-hidden="true"><span>{esc(txt(sp))}</span></div>')
    right.append('<div class="abm-met"><div class="abm-mth">Quel temps fait-il ?<span>entoure ou colorie</span></div><div class="abm-wr">' + "".join(icons) + "</div></div>")
    if teaser: right.append(f'<div class="abm-teaser">{esc(teaser)}</div>')
    return ('<div style="width:1118px;height:794px;display:flex">'
            f'<div class="abp abp-matin l"><div class="abp-in">{"".join(left)}</div></div>'
            f'<div class="abp abp-matin r"><div class="abp-in">{"".join(right)}</div><div class="abp-folio">Jour {n}</div></div></div>')

# ---------------------------------------------------------------- gabarit « le soir » (demi-page bleue)
def soir_right(half, day):
    items = classify(half)
    cand = [e for k, e in items if k in ("extra", "note") and len(txt(e)) > 120 and "Objet trouvé" not in txt(e)]
    story = max(cand, key=lambda e: len(txt(e)), default=None)
    if story is None: return None
    title = next((txt(e) for k, e in items if txt(e).startswith("Le soir")), "Le soir")
    sub = next((txt(e) for k, e in items if "te raconte" in txt(e) and len(txt(e)) < 80), "Xiao Long te raconte…")
    obj = next((e for k, e in items if e.find("div", style=re.compile(r"dashed #F2C14E")) or re.search(r"dashed #F2C14E", e.get("style", ""))), None)
    draws = [e for k, e in items if k == "draw"]
    photos = [e for k, e in items if k == "photo" and e is not obj and e is not story]
    wide = lambda e: int((re.search(r"width:\s*(\d+)", e.get("style", "")) or [0, 0])[1])
    scene = next((e for k, e in items if k == "art" and wide(e) >= 200), None)
    lastnight = obj is not None and "perle" in txt(obj).lower()
    if not lastnight: scene = None   # grande image décorative (gratte-ciel) : on la laisse de côté
    sleep = next((e for k, e in items if k == "art" and wide(e) < 200), None)
    night = next((e for k, e in items if k in ("decor", "art") and e is not sleep and e.name == "img"), None)
    tease = next((txt(e) for k, e in items if k == "note" and ("zzz" in txt(e) or "Demain" in txt(e) or "再见" in txt(e))), "")
    h = [f'<div class="abs-h"><div><div class="abs-t">{esc(title)}</div><div class="abs-st">{esc(sub)}</div></div>'
         + '<div class="abs-moon" aria-hidden="true"><i></i><b></b><b></b><b></b></div>' + "</div>"]
    ps = para(story) if story.find("p") else [txt(d) for d in story.find_all("div") if not d.find("div") and txt(d)] or [txt(story)]
    h.append('<div class="abs-story">' + "".join(f"<p>{esc(x)}</p>" for x in ps) + "</div>")
    if obj is not None and scene is not None:   # dernier soir : la scène + la case de la perle
        unpos(obj); obj["class"] = ["abs-pz"]
        h.append(f'<div class="abs-obj2">{art_html(scene, "abs-scene")}{str(obj)}</div>')
        obj = None
    if obj is not None:
        zone = obj.find("div", style=re.compile(r"dashed")) or obj
        unpos(zone)
        zone["style"] = re.sub(r"width:\s*\d+px", "width:150px", zone.get("style", ""))
        rest = [txt(d) for d in obj.find_all("div") if not d.find("div") and d is not zone and zone not in d.parents and txt(d)]
        rest = [r for r in rest if r not in txt(zone)]
        h.append(f'<div class="abs-obj">{str(zone)}<div class="abs-ot"><b>{esc(rest[0] if rest else "Objet trouvé !")}</b><span>{esc(" ".join(rest[1:]))}</span></div></div>')
    row = "".join(keep(d, "abs-dr") for d in draws) + "".join(keep(d, "abs-ph") for d in photos)
    if row: h.append(f'<div class="abs-row">{row}</div>')
    h.append('<div class="abs-foot">' + f'<span>{esc(tease)}</span>' + (art_html(sleep, "abs-zz") if sleep is not None else "") + "</div>")
    return f'<div class="abp abp-soir r" style="background:#2B3A67"><div class="abp-in">{"".join(h)}</div></div>'


# ---------------------------------------------------------------- cherche-et-trouve : même mise en place, habillage A+B
def cherche_page(root):
    root["class"] = (root.get("class") or []) + ["abc"]
    for el in root.find_all(class_=["tape", "hl"]): el.decompose()
    for el in root.find_all("div", style=re.compile(r"background:#F7E08A")): el.decompose()
    for ch in root.find_all(recursive=False):
        st = ch.get("style", ""); t = txt(ch)
        if t.startswith("Cherche et trouve"): ch.find("div")["class"] = ["abc-t"]
        elif "width:842px" in st: ch["class"] = ["abc-fr"]
        elif "width:196px" in st or "height:690px" in st:
            ch["class"] = ["abc-list"]
            for d in ch.find_all("div", recursive=False):
                if fsize(d) >= 22: d["class"] = ["abc-lh"]
        elif "border-radius:22px" in st: ch["class"] = ["abc-bub"]
        elif "Ouvre" in t: ch["class"] = ["abc-oe"]
        elif ch.name == "div" and t and len(t) < 60 and fsize(ch) >= 22: ch["class"] = ["abc-st"]
    return str(root)


# ---------------------------------------------------------------- pages uniques (couverture, prologue, fin) : habillage A+B
def skin_page(root, pid):
    for el in root.find_all(class_=["tape", "hl"]): el.decompose()
    for el in root.find_all("div", style=re.compile(r"background:#F7E08A")): el.decompose()
    halves = root.find_all(recursive=False)
    for h in halves:
        if pid != "Couverture" or "2B3A67" not in h.get("style", ""):
            h["class"] = (h.get("class") or []) + ["abk"]
    for el in root.find_all(style=re.compile(r"rotate\(")):
        if el.name == "img" and (el.get("alt") or "").startswith("Tampon"): continue
        el["style"] = re.sub(r"transform:\s*rotate\([^)]*\)", "transform:none", el["style"])
    return str(root)


# ---------------------------------------------------------------- couverture (1re) et 4e de couverture, d'après le livre imprimé
def cover_page(root):
    back, front = root.find_all(recursive=False)[:2]
    lined = back.find(class_="lined")
    ps = [txt(x) for x in lined.find_all("p")] if lined else []
    if lined and not ps: ps = [txt(lined).replace("Il était une fois…", "").strip()]
    stops = [x.strip() for x in re.split(r"●", txt(back.find(string=re.compile("Le grand voyage")).find_parent("div"))) if x.strip() and "Le grand voyage" not in x]
    xl = back.find("img", alt=re.compile("mandarine"))
    tease = next((txt(d) for d in back.find_all("div", recursive=False) if txt(d).startswith("Tu es prête")), "")
    fr = ('<div class="lvc lvc-front"><div class="lvc-frame"></div>'
          '<div class="lvc-art"><img src="img/livre-couverture-carte.webp" alt="Hong Kong, la baie et les îles en carte illustrée"></div>'
          '<div class="lvc-card"><div class="lvc-t">Hong Kong</div><div class="lvc-st">&amp; la Chine du Sud</div>'
          f'{rule()}<div class="lvc-k">Le carnet d\'exploratrice de Charlie</div>'
          '<div class="lvc-story">Xiao Long et la valise de Mamie Nainai</div></div>'
          '<div class="lvc-seal"><b>小龍</b><span>N°1 · 2027</span></div>'
          '<div class="lvc-date">Du 20 février au 6 mars 2027</div></div>')
    bk = ('<div class="lvc lvc-back"><div class="lvc-frame"></div>'
          '<div class="lvc-zh">小龍</div><div class="lvc-sc">Les carnets d\'exploratrice de Charlie</div>'
          f'{rule()}<div class="lvc-k">Carnet n°1 · Hong Kong &amp; la Chine du Sud · 2027</div>'
          '<div class="lvc-sum"><div class="lvc-sh">Il était une fois…</div>' + "".join(f"<p>{esc(x)}</p>" for x in ps) +
          '<div class="lvc-route">' + "".join(f"<span>{esc(x)}</span>" for x in stops) + "</div>"
          + (f'<div class="lvc-go">' + (art_html(xl, "lvc-xl") if xl is not None else "") + f'<span>{esc(tease)}</span></div>' if tease else "") +
          '</div><div class="lvc-by">Fait main par papa Jonas et papa Éric</div></div>')
    return f'<div style="width:1118px;height:794px;display:flex">{bk}{fr}</div>'

# ---------------------------------------------------------------- assemblage
stats = {"deep": 0, "half": 0, "keep": 0}
for n, p in enumerate(D["pages"]):
    so = BeautifulSoup(p["html"], "lxml"); root = so.body.find("div")
    halves = [h for h in root.find_all(recursive=False)]
    new = None
    try:
        if p["kind"] == "matin":
            new = matin(p, root)
        elif p["kind"] == "cherche":
            new = cherche_page(root)
        elif p["kind"] == "cover":
            new = cover_page(root)
        elif p["kind"] in ("prologue", "fin"):
            new = skin_page(root, p["id"])
        elif p["kind"] in ("lieux", "soir") and len(halves) == 2:
            h0 = lambda: BeautifulSoup(str(halves[0]), "lxml").body.find("div")
            a = duo_half(h0(), "l", p["day"]) or place_half(h0(), "l", p["day"], p["id"])
            if p["kind"] == "soir":
                b = soir_right(BeautifulSoup(str(halves[1]), "lxml").body.find("div"), p["day"])
            else:
                h1 = lambda: BeautifulSoup(str(halves[1]), "lxml").body.find("div")
                b = duo_half(h1(), "r", p["day"]) or place_half(h1(), "r", p["day"], p["id"])
            if a or b:
                # demi-page non recomposée : on garde l'ancienne, restylée
                a = a or str(halves[0]); b = b or str(halves[1])
                new = f'<div style="width:1118px;height:794px;display:flex">{a}{b}</div>'
                stats["deep" if (a.startswith('<div class="abp') and b.startswith('<div class="abp')) else "half"] += 1
    except Exception as e:
        print("!!", p["id"], type(e).__name__, e, file=sys.stderr); new = None
    if p["kind"] == "matin" and new: stats["deep"] += 1
    if not new: stats["keep"] += 1
    css = p.get("css", "")
    p["html"] = restyle(new or p["html"], css if n else "")
    css = re.sub(r"\{[^}]*\}", fam_block, css)
    p["css"] = css.replace("#F7F0E1", "#FAF5EA").replace("#C23B2C", "#C8102E").replace("#E8D3A8", "#F3E6CC")

open(os.path.join(ROOT, "android/app/src/main/assets/ui/charlie/pages.js"), "w").write(head + json.dumps(D, ensure_ascii=False, separators=(",", ":")) + tail)
print("ok", stats)
