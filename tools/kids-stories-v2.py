# Histoires v2 (10 pages) : lit tools/histoires-v2.md (export du document « Les 13 histoires de Xiao Long — version finale »)
# et écrit travelos/kids/kids.json « stories ». Le texte garde les balises ElevenLabs ([softly]…) ; l'app les masque.
# Images : en attendant celles de ChatGPT (travelos/kids/histoires/jNN-pMM.webp), on reprend celles du carnet.
import json, os, re, html
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
md = html.unescape(open(os.path.join(ROOT, "tools/histoires-v2.md")).read()).replace("\\[", "[").replace("\\]", "]")
path = os.path.join(ROOT, "travelos/kids/kids.json")
k = json.load(open(path))
old = {s["day"]: [p["img"] for p in s["pages"]] for s in k.get("stories", []) if "day" in s}
S = []
for sec in re.split(r"\n## ", md):
    m = re.match(r"Jour (\d+) · (.+)", sec)
    if not m: continue
    day, title = int(m.group(1)), m.group(2).strip()
    pages = re.findall(r"^\d+\. (.+)$", sec, re.M)
    assert len(pages) == 10, (day, len(pages))
    ph = old.get(day, [])
    out = []
    for i, t in enumerate(pages):
        own = f"travelos/kids/histoires/j{day:02d}-p{i+1:02d}.webp"
        img = own[len("travelos/"):] if os.path.exists(os.path.join(ROOT, own)) else (ph[min(i // 2, len(ph) - 1)] if ph else None)
        au = f"travelos/kids/audio/j{day:02d}-p{i+1:02d}.mp3"
        pg = {"img": img, "text": t.strip()}
        if os.path.exists(os.path.join(ROOT, au)): pg["audio"] = au[len("travelos/"):]
        out.append(pg)
    S.append({"day": day, "title": f"Jour {day} · {title}", "cover": out[0]["img"], "pages": out})
k["stories"] = S
json.dump(k, open(path, "w"), ensure_ascii=False, indent=1)
print(len(S), "histoires,", sum(len(s["pages"]) for s in S), "pages,",
      sum(len(re.sub(r"\[[^\]]*\]", "", p["text"]).split()) for s in S for p in s["pages"]), "mots")
