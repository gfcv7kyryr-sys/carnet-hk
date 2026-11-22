#!/usr/bin/env python3
"""
Écrit travelos/routes/jN.json pour les 13 journées, à partir du programme du carnet.

    python3 tools/make-routes.py

Chaque journée : les arrêts dans l'ordre du programme (numérotés = lieux du programme ; sans numéro = hôtel,
gare, quai, repas), puis les tronçons découpés en segments par mode. Les points sont décrits par ce qu'il faut
trouver dans OpenStreetMap (entrée d'un lieu, station d'une ligne, sortie de métro, quai) : tools/osm-routes.py
les résout et trace les segments ; ce qui n'est pas fiable devient « Trajet à confirmer ».
« proposé » dans un libellé : le carnet ne précise pas le mode ; c'est le trajet le plus simple, à valider.
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pack = json.load(open(os.path.join(ROOT, "travelos/pack/pack.json"), encoding="utf8"))
PL = {p["id"]: p for p in pack["places"]}

# ---------- lignes (noms OSM, expressions régulières) ----------
TW, ISL, KTL, EAL = "Tsuen Wan Line|荃灣綫", "Island Line|港島綫", "Kwun Tong Line|觀塘綫", "East Rail Line|東鐵綫"
TCL, AEL, DRL = "Tung Chung Line|東涌綫", "Airport Express|機場快綫", "Disneyland Resort Line|迪士尼綫"
APM = "APM|旅客自动输送"
def szl(n): return rf"^(?=.*(深圳|Shenzhen))(?=.*(?<!\d){n}(?!\d))"
SZ1, SZ5, SZ11, SZ13 = szl(1), szl(5), szl(11), szl(13)

def st(name, line): return {"station": name, "line": line}
def ex(name, line, ref): return {"exit": ref, "station": name, "line": line}
def osm(names, near, entrance=True, R=600): return {"osm": names, "near": near, "entrance": entrance, "R": R}
def place(pid, names=None, entrance=True, R=600):
    p = PL[pid]; return osm(names or [p["name"], p.get("nameZh") or p["name"]], [p["lat"], p["lng"]], entrance, R)

HOTELS = {
    "nathan": ("Nathan Hotel", "弥敦酒店", osm(["Nathan Hotel", "彌敦酒店"], [22.3047, 114.1715])),
    "voco": ("voco Guangzhou Shifu", "广州十甫voco酒店", {**osm(["voco Guangzhou Shifu", "广州十甫voco酒店", "voco酒店"], [23.1225, 113.2500], R=2500), "q": "广州市荔湾区第十甫路188号", "expect": "第十甫"}),
    "lijiang": ("Lijiang Island Riverside Resort", "漓江岛江畔度假酒店", {**osm(["Lijiang Island Riverside Resort", "漓江岛江畔度假酒店"], [24.9200, 110.5200], R=4000), "q": "阳朔县兴坪镇莲岛湾", "expect": "兴坪"}),
    "hollywood": ("Disney's Hollywood Hotel", "迪士尼好萊塢酒店", osm(["Disney's Hollywood Hotel", "迪士尼好萊塢酒店"], [22.3090, 114.0369], R=800)),
}
def hotel(sid, key, step=None, label=None):
    n, zh, pt = HOTELS[key]
    return {"id": sid, "minor": True, "kind": "hotel", "name": label or n, "short": "Hôtel", "zh": zh, "point": pt, **({"step": step} if step else {})}
def minor(sid, kind, name, zh, point, step=None, short=None):
    return {"id": sid, "minor": True, "kind": kind, "name": name, "short": short or name, "zh": zh, "point": point, **({"step": step} if step else {})}
def stop(pid, short, zh=None, point=None, step=None, place_id=None, name=None):
    p = PL[place_id or pid]
    d = {"id": pid, "short": short, "zh": zh or (p.get("nameZh") or "").split(" ")[0], "point": point or place(place_id or pid)}
    if place_id: d["place"] = place_id
    if step: d["step"] = step
    if name: d["name"] = name
    return d

# ---------- segments ----------
def walk(to=None): return {"mode": "walk", "router": "foot", **({"to": to} if to else {})}
def taxi(to=None): return {"mode": "taxi", "router": "car", **({"to": to} if to else {})}
def car(to=None): return {"mode": "car", "router": "car", **({"to": to} if to else {})}
def bus(to=None): return {"mode": "bus", "router": "car", **({"to": to} if to else {})}
def metro(line, to, frm=None): return {"mode": "metro", "line": line, "to": to, **({"from": frm} if frm else {})}
def train(line, to, frm=None): return {"mode": "train", "line": line, "to": to, **({"from": frm} if frm else {})}
def tgv(to=None): return {"mode": "train", "rail": "highspeed", "snap": 600, **({"to": to} if to else {})}
def ferry(to=None): return {"mode": "ferry", "rail": "ferry", "snap": 600, **({"to": to} if to else {})}
def cable(to=None): return {"mode": "cablecar", "rail": "aerialway", **({"to": to} if to else {})}
def confirm(mode, why, to=None): return {"mode": mode, "confirm": why, **({"to": to} if to else {})}
def leg(a, b, mode, label, *segs, note=None): return {"from": a, "to": b, "mode": mode, "label": label, "segments": list(segs), **({"note": note} if note else {})}
def metro_trip(a_station, a_line, b_station, b_line=None, via=None):
    """Marche jusqu'à la station, métro (avec une correspondance éventuelle), sans la dernière marche."""
    segs = [walk(st(a_station, a_line))]
    if via:
        segs += [metro(a_line, st(via, a_line)), metro(b_line, st(b_station, b_line), st(via, b_line))]
    else:
        segs += [metro(a_line, st(b_station, a_line))]
    return segs

DAYS = {}

# ===== Jour 1 · Hong Kong : arrivée =====
DAYS["j1"] = {
  "stops": [
    minor("aeroport", "station", "Aéroport · Airport Express", "機場站", st("Airport", AEL), step="j1:1", short="Aéroport"),
    stop("kowloon-station", "Gare de Kowloon", point=st("Kowloon", AEL), step="j1:1"),
    hotel("hotel-a", "nathan", step="j1:1"),
    stop("kowloon-park", "Parc de Kowloon"),
    hotel("hotel-b", "nathan", step="j1:3", label="Déjeuner, puis sieste à l'hôtel"),
    stop("pier1", "Pier 1 · Aqua Luna", point=place("pier1", ["Tsim Sha Tsui Public Pier No. 1", "尖沙咀1號公眾碼頭", "Tsim Sha Tsui Pier 1", "Public Pier No. 1"], entrance=False)),
    stop("avenue-stars", "Avenue des Stars"),
    stop("k11", "K11 Musea"),
    hotel("hotel-c", "nathan", step="j1:8", label="Retour à l'hôtel"),
  ],
  "legs": [
    leg("aeroport", "kowloon-station", "train", "Airport Express · 24 min", train(AEL, st("Kowloon", AEL))),
    leg("kowloon-station", "hotel-a", "taxi", "Taxi jusqu'au Nathan Hotel", taxi()),
    leg("hotel-a", "kowloon-park", "walk", "À pied (proposé)", walk()),
    leg("kowloon-park", "hotel-b", "walk", "À pied jusqu'à l'hôtel", walk()),
    leg("hotel-b", "pier1", "metro", "Métro Jordan → Tsim Sha Tsui, puis à pied (proposé)", *metro_trip("Jordan", TW, "Tsim Sha Tsui"), walk()),
    leg("pier1", "avenue-stars", "walk", "À pied le long du port", walk()),
    leg("avenue-stars", "k11", "walk", "À pied", walk()),
    leg("k11", "hotel-c", "taxi", "Taxi jusqu'à l'hôtel (proposé)", taxi()),
  ],
}

# ===== Jour 2 · Hong Kong : on garde le fichier existant, avec l'aller et le retour depuis l'hôtel =====
j2 = json.load(open(os.path.join(ROOT, "travelos/routes/j2.json"), encoding="utf8"))
if not any(s["id"] == "hotel-matin" for s in j2["stops"]):
    j2["stops"].insert(0, hotel("hotel-matin", "nathan", step="j2:0", label="Départ du Nathan Hotel"))
    j2["stops"].append(hotel("hotel-soir", "nathan", step="j2:12", label="Retour à l'hôtel"))
    j2["legs"].insert(0, leg("hotel-matin", "star-ferry-tst", "metro", "Métro Jordan → Tsim Sha Tsui, puis à pied (proposé)", *metro_trip("Jordan", TW, "Tsim Sha Tsui"), walk()))
    j2["legs"].append(leg("hopewell", "hotel-soir", "taxi", "Taxi jusqu'à l'hôtel (proposé)", taxi()))
for s in j2["stops"]:
    if s["id"] == "hotel": s["point"] = HOTELS["nathan"][2]; s.pop("geocode", None)
DAYS["j2"] = j2

# ===== Jour 3 · Hong Kong : Wong Tai Sin, Nan Lian, Sha Tin, Mong Kok =====
DAYS["j3"] = {
  "stops": [
    hotel("hotel-matin", "nathan", step="j3:0", label="Départ du Nathan Hotel"),
    stop("wong-tai-sin", "Wong Tai Sin"),
    stop("choi-hung", "Choi Hung"),
    stop("nan-lian", "Nan Lian"),
    hotel("hotel-sieste", "nathan", step="j3:4", label="Sieste à l'hôtel"),
    stop("ten-thousand", "Dix Mille Bouddhas"),
    stop("goldfish", "Poissons rouges"),
    stop("temple-street", "Temple Street"),
    hotel("hotel-soir", "nathan", step="j3:7", label="Retour à l'hôtel"),
    stop("neon-lights", "Neon Lights"),
    stop("changsha", "Changsha Street"),
    hotel("hotel-nuit", "nathan", step="j3:9", label="Retour à l'hôtel"),
  ],
  "legs": [
    leg("hotel-matin", "wong-tai-sin", "metro", "Métro par Prince Edward (proposé)", *metro_trip("Jordan", TW, "Wong Tai Sin", KTL, via="Prince Edward"), walk()),
    leg("wong-tai-sin", "choi-hung", "metro", "Métro, deux stations", *metro_trip("Wong Tai Sin", KTL, "Choi Hung"), walk()),
    leg("choi-hung", "nan-lian", "metro", "Métro jusqu'à Diamond Hill", *metro_trip("Choi Hung", KTL, "Diamond Hill"), walk()),
    leg("nan-lian", "hotel-sieste", "metro", "Métro jusqu'à Yau Ma Tei, puis à pied (proposé)", *metro_trip("Diamond Hill", KTL, "Yau Ma Tei"), walk()),
    leg("hotel-sieste", "ten-thousand", "train", "Métro, puis East Rail jusqu'à Sha Tin", *metro_trip("Yau Ma Tei", KTL, "Kowloon Tong"),
        train(EAL, st("Sha Tin", EAL), st("Kowloon Tong", EAL)), walk()),
    leg("ten-thousand", "goldfish", "train", "East Rail jusqu'à Mong Kok East", walk(st("Sha Tin", EAL)), train(EAL, st("Mong Kok East", EAL)), walk()),
    leg("goldfish", "temple-street", "metro", "Métro Mong Kok → Yau Ma Tei, puis à pied (proposé)", *metro_trip("Mong Kok", TW, "Yau Ma Tei"), walk()),
    leg("temple-street", "hotel-soir", "walk", "À pied", walk()),
    leg("hotel-soir", "neon-lights", "metro", "Métro Jordan → Mong Kok (proposé)", *metro_trip("Jordan", TW, "Mong Kok"), walk()),
    leg("neon-lights", "changsha", "walk", "À pied · 5 min", walk()),
    leg("changsha", "hotel-nuit", "walk", "À pied (proposé)", walk()),
  ],
}

# ===== Jour 4 · Macao =====
SHUNTAK = osm(["Hong Kong-Macau Ferry Terminal", "港澳碼頭", "Shun Tak Centre"], [22.2878, 114.1517], entrance=False)
OUTER = osm(["Outer Harbour Ferry Terminal", "外港客運碼頭", "Macau Outer Harbour Ferry Terminal", "外港碼頭"], [22.1975, 113.5585], entrance=False, R=1200)
TAIPAF = osm(["Taipa Ferry Terminal", "氹仔客運碼頭"], [22.1640, 113.5730], entrance=False, R=1500)
DAYS["j4"] = {
  "zones": [{"name": "Hong Kong", "stops": ["hotel-matin", "terminal-hk", "macau-ferry", "hotel-soir"]},
            {"name": "Macao", "stops": ["outer-harbour", "senado", "a-ma", "taipa", "cotai", "terminal-taipa"]}],
  "stops": [
    hotel("hotel-matin", "nathan", step="j4:0", label="Départ du Nathan Hotel"),
    minor("terminal-hk", "pier", "Terminal des ferries de Macao, Sheung Wan", "港澳碼頭", SHUNTAK, step="j4:0", short="Ferry, Sheung Wan"),
    minor("outer-harbour", "pier", "Terminal de l'Outer Harbour, Macao", "外港客运码头", OUTER, step="j4:1", short="Outer Harbour"),
    stop("senado", "Place du Sénat", point=place("senado", ["Largo do Senado", "議事亭前地", "議事亭前地 Largo do Senado"], entrance=False)),
    stop("a-ma", "Temple A-Ma"),
    stop("taipa", "Village de Taipa", point=place("taipa", ["Rua do Cunha", "官也街", "官也街 Rua do Cunha"], entrance=False, R=900)),
    stop("cotai", "Cotai Strip", point=place("cotai", ["The Parisian Macao", "澳門巴黎人", "Parisian Macao", "巴黎人"], R=1200)),
    minor("terminal-taipa", "pier", "Terminal des ferries de Taipa", "氹仔客运码头", TAIPAF, step="j4:6", short="Ferry, Taipa"),
    stop("macau-ferry", "Ferry, Tsim Sha Tsui", step="j4:7", point=osm(["China Ferry Terminal", "中港碼頭"], [22.2990, 114.1665], entrance=False, R=800)),
    hotel("hotel-soir", "nathan", step="j4:8", label="Dîner à Tsim Sha Tsui, puis l'hôtel"),
  ],
  "legs": [
    leg("hotel-matin", "terminal-hk", "metro", "Métro jusqu'à Sheung Wan, changement à Admiralty", *metro_trip("Jordan", TW, "Sheung Wan", ISL, via="Admiralty"), walk()),
    leg("terminal-hk", "outer-harbour", "ferry", "Ferry pour Macao · 1 h", ferry()),
    leg("outer-harbour", "senado", "taxi", "Taxi · 10 min", taxi()),
    leg("senado", "a-ma", "taxi", "Taxi (option)", taxi()),
    leg("a-ma", "taipa", "taxi", "Taxi jusqu'au village de Taipa", taxi()),
    leg("taipa", "cotai", "walk", "À pied jusqu'au Cotai Strip", walk()),
    leg("cotai", "terminal-taipa", "taxi", "Taxi · 10 min", taxi()),
    leg("terminal-taipa", "macau-ferry", "ferry", "Cotai Water Jet jusqu'à Tsim Sha Tsui", ferry()),
    leg("macau-ferry", "hotel-soir", "taxi", "Dîner chez One Dim Sum, puis taxi (proposé)", taxi()),
  ],
}

# ===== Jour 5 · Hong Kong → Canton =====
WK = osm(["Hong Kong West Kowloon Station", "香港西九龍站", "West Kowloon Station", "香港西九龙站"], [22.3040, 114.1650], R=900)
GZS = osm(["广州南站", "Guangzhou South Railway Station", "Guangzhou South"], [22.9890, 113.2690], R=1500)
DAYS["j6"] = {
  "zones": [{"name": "Hong Kong", "stops": ["hotel-hk", "west-kowloon"]},
            {"name": "Canton", "stops": ["gz-south", "hotel-gz", "huacheng", "canton-tower", "croisiere", "hotel-soir"]}],
  "stops": [
    hotel("hotel-hk", "nathan", step="j6:0", label="Départ du Nathan Hotel, avec les valises"),
    stop("west-kowloon", "West Kowloon", point=WK),
    stop("gz-south", "Guangzhou South", point=GZS),
    hotel("hotel-gz", "voco", step="j6:2", label="voco Guangzhou Shifu : valises et sieste"),
    stop("huacheng", "Place Huacheng", point=place("huacheng", ["花城广场", "Huacheng Square"], entrance=False)),
    stop("canton-tower", "Tour de Canton", point=place("canton-tower", ["广州塔", "Canton Tower"])),
    stop("croisiere", "Croisière", point=place("croisiere", ["广州塔财富码头", "广州塔码头", "Canton Tower Pier"], entrance=False)),
    hotel("hotel-soir", "voco", step="j6:9", label="Retour à l'hôtel"),
  ],
  "legs": [
    leg("hotel-hk", "west-kowloon", "taxi", "Taxi · 10 min", taxi()),
    leg("west-kowloon", "gz-south", "train", "TGV · 48 à 85 min", tgv()),
    leg("gz-south", "hotel-gz", "taxi", "Taxi · 30 à 40 min", taxi()),
    leg("hotel-gz", "huacheng", "taxi", "Taxi · 20 à 30 min", taxi()),
    leg("huacheng", "canton-tower", "metro", "APM de l'opéra à la tour", walk(st("大剧院|Opera House", APM)), metro(APM, st("广州塔|Canton Tower", APM)), walk()),
    leg("canton-tower", "croisiere", "walk", "À pied jusqu'au quai", walk()),
    leg("croisiere", "hotel-soir", "taxi", "Taxi jusqu'à l'hôtel (proposé)", taxi()),
  ],
}

# ===== Jour 6 · Canton : Chimelong =====
DAYS["j7"] = {
  "stops": [
    hotel("hotel-matin", "voco", step="j7:0", label="Départ en voiture avec siège enfant"),
    stop("chimelong", "Chimelong Safari", point=place("chimelong", ["长隆野生动物世界", "Chimelong Safari Park"], R=1500)),
    hotel("hotel-soir", "voco", step="j7:5", label="Retour à l'hôtel"),
  ],
  "legs": [
    leg("hotel-matin", "chimelong", "car", "Voiture · environ 1 h", car()),
    leg("chimelong", "hotel-soir", "car", "Voiture · environ 1 h", car()),
  ],
}

# ===== Jour 7 · Shenzhen =====
FUTIAN = {**osm(["福田站", "福田", "Futian Railway Station", "Futian Station", "Futian"], [22.5383, 114.0567], R=700), "tag": {"railway": "station"}}
DAYS["j5"] = {
  "zones": [{"name": "Canton", "stops": ["hotel-matin", "gz-south", "gz-south-retour", "hotel-soir"]},
            {"name": "Shenzhen", "stops": ["futian", "talent-park", "inno100", "zhongshuge", "gangxia-north", "mocaup", "children-palace", "one-avenue", "orbit-one", "civic-center", "futian-retour"]}],
  "stops": [
    hotel("hotel-matin", "voco", step="j5:0", label="Départ de l'hôtel"),
    stop("gz-south", "Guangzhou South", point=GZS),
    stop("futian", "Gare de Futian", point=FUTIAN),
    stop("talent-park", "Talent Park"),
    stop("inno100", "INNO100", point=place("inno100", ["深圳湾文化广场", "Shenzhen Bay Cultural Plaza", "Shenzhen Bay Culture Square"])),
    stop("zhongshuge", "Zhongshuge", point=place("zhongshuge", ["欢乐港湾", "Happiness Harbor"], entrance=False)),
    stop("gangxia-north", "Gangxia North", point={**place("gangxia-north", ["岗厦北", "Gangxia North"], entrance=False), "tag": {"railway": "station"}}),
    stop("mocaup", "MOCAUP", point=place("mocaup", ["深圳市当代艺术与城市规划馆", "The Museum of Contemporary Art & Planning Exhibition (MOCAPE)"])),
    stop("children-palace", "Palais des enfants", point=place("children-palace", ["深圳市少年宫", "Shenzhen Children's Palace"])),
    stop("one-avenue", "One Avenue", point=place("one-avenue", ["卓悦中心西区", "One Avenue West", "卓悦中心"])),
    stop("orbit-one", "Orbit One"),
    stop("civic-center", "Centre civique", point=place("civic-center", ["深圳市民中心", "市民中心广场", "市民中心"], entrance=False)),
    stop("futian-retour", "Gare de Futian", point=FUTIAN, step="j5:14", place_id="futian"),
    stop("gz-south-retour", "Guangzhou South", point=GZS, step="j5:15", place_id="gz-south"),
    hotel("hotel-soir", "voco", step="j5:15", label="Retour à l'hôtel vers 22 h"),
  ],
  "legs": [
    leg("hotel-matin", "gz-south", "taxi", "Taxi · 30 à 40 min", taxi()),
    leg("gz-south", "futian", "train", "TGV G6579 · 1 h", tgv()),
    leg("futian", "talent-park", "metro", "Métro 11 puis 13, sortie B1", walk(st("福田|Futian", SZ11)), metro(SZ11, st("后海|Houhai", SZ11)),
        metro(SZ13, ex("人才公园|Talent Park", SZ13, "B1"), st("后海|Houhai", SZ13)), walk()),
    leg("talent-park", "inno100", "walk", "À pied · 5 min", walk()),
    leg("inno100", "zhongshuge", "taxi", "Robot-taxi Pony.ai ou DiDi jusqu'à Happy Harbour", taxi()),
    leg("zhongshuge", "gangxia-north", "metro", "Métro ligne 5, puis ligne 11 jusqu'au terminus", confirm("metro", "station de départ près de Happy Harbour à préciser")),
    leg("gangxia-north", "mocaup", "walk", "À pied", walk()),
    leg("mocaup", "children-palace", "walk", "À pied (option)", walk()),
    leg("children-palace", "one-avenue", "walk", "Balade par le Centre civique", walk()),
    leg("one-avenue", "orbit-one", "metro", "Métro ligne 1, Gangxia → Science Museum", *metro_trip("岗厦|Gangxia", SZ1, "科学馆|Science Museum"), walk()),
    leg("orbit-one", "civic-center", "taxi", "Taxi · 10 à 15 min", taxi()),
    leg("civic-center", "futian-retour", "walk", "À pied · 15 min", walk()),
    leg("futian-retour", "gz-south-retour", "train", "TGV G6588", tgv()),
    leg("gz-south-retour", "hotel-soir", "taxi", "Taxi jusqu'à l'hôtel", taxi()),
  ],
}

# ===== Jour 8 · Canton : le vieux Canton =====
DAYS["j8"] = {
  "stops": [
    hotel("hotel-matin", "voco", step="j8:0", label="Départ de l'hôtel"),
    stop("yuexiu", "Parc Yuexiu", point=place("yuexiu", ["越秀公园", "Yuexiu Park"])),
    stop("chen", "Chen Clan Academy", point=place("chen", ["陈家祠", "Chen Clan Academy", "陈氏书院"])),
    stop("yongqingfang", "Yongqingfang", point=place("yongqingfang", ["永庆坊", "Yongqingfang"], entrance=False)),
    stop("shamian", "Shamian", point=place("shamian", ["沙面公园", "Shamian Park", "沙面岛"], entrance=False, R=900)),
    minor("nanxin", "meal", "Goûter chez Nanxin, 47 Dishifu Lu", "南信牛奶甜品专家", {**osm(["南信牛奶甜品专家", "南信", "Nanxin"], [23.1220, 113.2510], entrance=False, R=2500), "q": "南信牛奶甜品专家 第十甫路", "expect": "南信"}, step="j8:6", short="Nanxin"),
    stop("dafo", "Temple Dafo", point=place("dafo", ["大佛寺", "Dafo Temple"])),
    stop("beijing-road", "Beijing Road", point=place("beijing-road", ["北京路步行街", "北京路"], entrance=False)),
    hotel("hotel-soir", "voco", step="j8:10", label="Retour à l'hôtel"),
  ],
  "legs": [
    leg("hotel-matin", "yuexiu", "taxi", "Taxi · 15 min (option)", taxi()),
    leg("yuexiu", "chen", "taxi", "Taxi · 10 min", taxi()),
    leg("chen", "yongqingfang", "walk", "À pied · 1,5 km", walk()),
    leg("yongqingfang", "shamian", "taxi", "Déjeuner au Panxi, puis taxi jusqu'à Shamian", taxi()),
    leg("shamian", "nanxin", "taxi", "Taxi jusqu'à la rue de l'hôtel (proposé)", taxi()),
    leg("nanxin", "dafo", "taxi", "Taxi jusqu'au temple Dafo", taxi()),
    leg("dafo", "beijing-road", "walk", "À pied", walk()),
    leg("beijing-road", "hotel-soir", "taxi", "Taxi · 15 min", taxi()),
  ],
}

# ===== Jour 9 · Canton → Xingping =====
# Gare TGV « Yangshuo » : dans les collines à environ 6 km à l'est du bourg de Xingping (饭甑山村)
YANGSHUO = {**osm(["阳朔", "阳朔站", "Yangshuo"], [24.9636, 110.5634], entrance=False, R=800), "tag": {"railway": "station"}}
DAYS["j9"] = {
  "zones": [{"name": "Canton", "stops": ["hotel-gz", "gz-south"]},
            {"name": "Xingping", "stops": ["yangshuo-station", "hotel-xp", "xingping", "vingt-yuans", "cormorans", "hotel-soir"]}],
  "stops": [
    hotel("hotel-gz", "voco", step="j9:0", label="Départ de l'hôtel, avec les valises"),
    stop("gz-south", "Guangzhou South", point=GZS),
    stop("yangshuo-station", "Gare de Yangshuo", point=YANGSHUO),
    hotel("hotel-xp", "lijiang", step="j9:2", label="Lijiang Island Riverside Resort"),
    stop("xingping", "Vieux Xingping", point=place("xingping", ["兴坪古镇", "Xingping Ancient Town", "兴坪老街"], entrance=False, R=900)),
    stop("vingt-yuans", "Billet de 20 yuans", point=place("vingt-yuans", ["二十元人民币背景", "黄布倒影", "20元人民币背景图"], entrance=False, R=900)),
    stop("cormorans", "Ponton", point=place("cormorans", ["兴坪码头", "Xingping Pier"], entrance=False, R=900)),
    hotel("hotel-soir", "lijiang", step="j9:7", label="Dîner dans la vieille ville, puis l'hôtel"),
  ],
  "legs": [
    leg("hotel-gz", "gz-south", "taxi", "Taxi · 30 à 40 min", taxi()),
    leg("gz-south", "yangshuo-station", "train", "TGV direct · environ 2 h 20", tgv()),
    leg("yangshuo-station", "hotel-xp", "car", "Navette de l'hôtel ou chauffeur · 20 min", car()),
    leg("hotel-xp", "xingping", "walk", "De l'hôtel au vieux bourg (proposé)", walk()),
    leg("xingping", "vingt-yuans", "walk", "À pied le long de la rivière · 10 min", walk()),
    leg("vingt-yuans", "cormorans", "walk", "Retour au ponton principal", walk()),
    leg("cormorans", "hotel-soir", "walk", "Dîner dans la vieille ville, puis l'hôtel (proposé)", walk()),
  ],
}

# ===== Jour 10 · Huangyao =====
HYPARK = osm(["黄姚古镇停车场", "黄姚古镇游客中心", "Huangyao Parking"], [24.2500, 111.2000], entrance=False, R=1500)
DAYS["j10"] = {
  "zones": [{"name": "Xingping", "stops": ["hotel-matin", "hotel-soir"]},
            {"name": "Huangyao", "stops": ["huangyao", "hy-theatre", "hy-banian", "hy-dailong", "hy-anle", "huangyao-depart"]}],
  "stops": [
    hotel("hotel-matin", "lijiang", step="j10:0", label="Départ avec le chauffeur"),
    stop("huangyao", "Parking du bourg", point=HYPARK, name="Huangyao, parking et accueil"),
    stop("hy-theatre", "Théâtre ancien", point=place("hy-theatre", ["黄姚戏台", "Huangyao Theatre", "黄姚古戏台", "宝珠观"], R=700)),
    stop("hy-banian", "Banian", point=place("hy-banian", ["龙爪榕"], entrance=False, R=500)),
    stop("hy-dailong", "Pont Dailong", point=place("hy-dailong", ["带龙桥"], entrance=False, R=500)),
    stop("hy-anle", "Rue Anle", point=place("hy-anle", ["安乐街"], entrance=False, R=500)),
    minor("huangyao-depart", "parking", "Retour au parking", "黄姚古镇停车场", HYPARK, step="j10:7", short="Parking"),
    hotel("hotel-soir", "lijiang", step="j10:8", label="Retour à Xingping"),
  ],
  "legs": [
    leg("hotel-matin", "huangyao", "car", "Voiture · 2 h à 4 h selon les travaux", car()),
    leg("huangyao", "hy-theatre", "walk", "À pied · 10 min, entrée par le nord", walk()),
    leg("hy-theatre", "hy-banian", "walk", "À pied", walk()),
    leg("hy-banian", "hy-dailong", "walk", "À pied", walk()),
    leg("hy-dailong", "hy-anle", "walk", "À pied", walk()),
    leg("hy-anle", "huangyao-depart", "walk", "Déjeuner, jardin Nongqu, puis retour au parking", walk()),
    leg("huangyao-depart", "hotel-soir", "car", "Voiture · environ 2 h", car()),
  ],
}

# ===== Jour 11 · Xingping → Hong Kong (Disneyland) =====
DAYS["j11"] = {
  "zones": [{"name": "Xingping", "stops": ["hotel-matin", "xianggong", "hotel-valises", "yangshuo-station"]},
            {"name": "Hong Kong", "stops": ["west-kowloon", "hotel-disney"]}],
  "stops": [
    hotel("hotel-matin", "lijiang", step="j11:0", label="Départ de l'hôtel"),
    stop("xianggong", "Colline Xianggong", point=osm(["相公山", "Xianggong Hill"], [24.9258, 110.4790], entrance=False, R=600)),
    hotel("hotel-valises", "lijiang", step="j11:2", label="Retour à l'hôtel, valises"),
    stop("yangshuo-station", "Gare de Yangshuo", point=YANGSHUO, step="j11:3"),
    stop("west-kowloon", "West Kowloon", point=WK, step="j11:5"),
    hotel("hotel-disney", "hollywood", step="j11:5", label="Disney's Hollywood Hotel"),
  ],
  "legs": [
    leg("hotel-matin", "xianggong", "car", "Bac (5 min), transfert (25 min), puis les marches", confirm("car", "bac et transfert vers Xianggong à confirmer sur place")),
    leg("xianggong", "hotel-valises", "car", "Retour à l'hôtel", confirm("car", "bac et transfert vers Xianggong à confirmer sur place")),
    leg("hotel-valises", "yangshuo-station", "car", "Chauffeur ou navette · 20 min", car()),
    leg("yangshuo-station", "west-kowloon", "train", "TGV jusqu'à Hong Kong (par Shenzhen Nord) · environ 3 h", tgv()),
    leg("west-kowloon", "hotel-disney", "metro", "Métro jusqu'à Sunny Bay, puis le train Disneyland Resort",
        walk(st("Kowloon", TCL)), metro(TCL, st("Sunny Bay", TCL)), metro(DRL, st("Disneyland Resort", DRL), st("Sunny Bay", DRL)), bus()),
  ],
}

# ===== Jour 12 · Hong Kong Disneyland (points dans le parc : voir hkdl-points ci-dessous) =====
HKDL = [22.3125, 114.0415]
def dl(names, near=HKDL, entrance=True, R=900): return osm(names, near, entrance, R)
INTERCHANGE = dl(["Disneyland Bus Terminus", "迪士尼樂園巴士總站"], [22.3165, 114.0457], entrance=False, R=400)
DAYS["j12"] = {
  "illustration": {"name": "Plan du parc", "calage": "travelos/routes/osm/hkdl-calage.json"},
  # Le parc d'abord (le plan illustré), l'accès depuis l'hôtel ensuite.
  "zones": [{"name": "Le parc", "stops": ["dl-main", "dl-frozen", "dl-castle", "dl-fantasy", "fairy-tale", "philharmagic", "plaza-inn", "dl-adventure",
                                           "dl-toy", "dl-mystic", "cinema", "jungle", "dl-tomorrow"]},
            {"name": "Accès", "stops": ["hotel-matin", "disney", "dl-main", "hotel-soir"]}],
  "stops": [
    hotel("hotel-matin", "hollywood", step="j12:0", label="Départ du Disney's Hollywood Hotel"),
    stop("disney", "Interchange", point=INTERCHANGE, name="Interchange de Disneyland (navette)"),
    stop("dl-main", "Entrée du parc", point=dl(["Main Street, USA"], [22.3131, 114.0441], entrance=False, R=300), name="Entrée du parc, sous la gare de Main Street"),
    stop("dl-frozen", "Frozen Ever After", point=dl(["Frozen Ever After", "魔雪奇幻之旅"], [22.3121, 114.0385], R=400)),
    stop("dl-castle", "Château", point=dl(["Castle of Magical Dreams", "奇妙夢想城堡"], [22.3128, 114.0406], entrance=False)),
    stop("dl-fantasy", "Winnie l'ourson", point=dl(["The Many Adventures of Winnie the Pooh", "小熊維尼歷險之旅"], [22.3133, 114.0393])),
    minor("fairy-tale", "attraction", "Fairy Tale Forest", "童話森林", dl(["Fairy Tale Forest", "童話森林"], [22.3125, 114.0385], entrance=False), step="j12:5"),
    minor("philharmagic", "attraction", "Mickey's PhilharMagic", "米奇幻想曲", dl(["Mickey's PhilharMagic", "米奇幻想曲"], [22.3127, 114.0395]), step="j12:6"),
    minor("plaza-inn", "meal", "Déjeuner au Plaza Inn", "美國小鎮大街 Plaza Inn", dl(["Plaza Inn", "廣場飯店"], [22.3122, 114.0418]), step="j12:7", short="Plaza Inn"),
    stop("dl-adventure", "Adventureland", point=dl(["Jungle Junction", "樂韻叢林"], [22.3118, 114.0416], entrance=False, R=400), name="Adventureland, allées ombragées (Jungle Junction)"),
    stop("dl-toy", "Toy Story Land", point=dl(["Slinky Dog Spin", "胡迪轉轉轉", "Toy Story Land"], [22.3108, 114.0378])),
    stop("dl-mystic", "Mystic Manor", point=dl(["Mystic Manor", "迷離莊園"], [22.3100, 114.0395])),
    minor("cinema", "attraction", "Main Street Cinema : Mickey, puis la parade", "大街電影院", dl(["Emporium", "百貨店"], [22.3128, 114.0432], R=300), step="j12:11", short="Mickey"),
    minor("jungle", "attraction", "Jungle River Cruise", "森林河流之旅", dl(["Jungle River Cruise", "森林河流之旅"], [22.3112, 114.0400]), step="j12:12", short="Jungle Cruise"),
    stop("dl-tomorrow", "Tomorrowland", point=dl(["Tomorrowland Stage", "明日世界舞台"], [22.3141, 114.0418], entrance=False, R=300), name="Tomorrowland : l'Orbitron, puis Ant-Man"),
    hotel("hotel-soir", "hollywood", step="j12:17", label="Retour à l'hôtel"),
  ],
  "legs": [
    leg("hotel-matin", "disney", "bus", "Navette gratuite de l'hôtel · 5 min", bus()),
    leg("disney", "dl-main", "walk", "Promenade jusqu'aux grilles", walk()),
    leg("dl-main", "dl-frozen", "walk", "Tout droit vers Arendelle", walk()),
    leg("dl-frozen", "dl-castle", "walk", "À pied jusqu'au château (Magic Snaps)", walk()),
    leg("dl-castle", "dl-fantasy", "walk", "À pied", walk()),
    leg("dl-fantasy", "fairy-tale", "walk", "À pied", walk()),
    leg("fairy-tale", "philharmagic", "walk", "À pied", walk()),
    leg("philharmagic", "plaza-inn", "walk", "À pied jusqu'au bout de Main Street", walk()),
    leg("plaza-inn", "dl-adventure", "walk", "Sieste en poussette dans les allées", walk()),
    leg("dl-adventure", "dl-toy", "walk", "À pied jusqu'à Toy Story Land", walk()),
    leg("dl-toy", "dl-mystic", "walk", "Mystic Point, juste à côté", walk()),
    leg("dl-mystic", "cinema", "walk", "À pied jusqu'à Main Street", walk()),
    leg("cinema", "jungle", "walk", "À pied", walk()),
    leg("jungle", "dl-tomorrow", "walk", "Dîner, puis Tomorrowland", walk()),
    leg("dl-tomorrow", "hotel-soir", "bus", "Momentous, sortie, puis navette jusqu'à l'hôtel", walk(INTERCHANGE), bus()),
  ],
}

# ===== Jour 13 · Lantau, puis le vol de nuit =====
NP_TC = osm(["Ngong Ping 360 Tung Chung Terminal", "昂坪360東涌纜車站", "Tung Chung Cable Car Terminal", "東涌纜車站"], [22.2890, 113.9420], entrance=False, R=700)
NP_NP = osm(["Ngong Ping 360 Ngong Ping Terminal", "昂坪纜車站", "Ngong Ping Cable Car Terminal", "昂坪纜車站"], [22.2565, 113.9015], entrance=False, R=900)
AIRPORT = st("Airport", AEL)  # gare Airport Express, au pied du terminal 1 (consigne)
DAYS["j13"] = {
  "stops": [
    hotel("hotel", "hollywood", step="j13:0", label="Check-out du Disney's Hollywood Hotel"),
    stop("airport", "Aéroport, consigne", point=AIRPORT),
    stop("ngong-ping", "Téléphérique, Tung Chung", point=NP_TC),
    minor("ngong-ping-haut", "station", "Ngong Ping, arrivée du téléphérique", "昂坪纜車站", NP_NP, step="j13:1", short="Ngong Ping"),
    stop("big-buddha", "Grand Bouddha", point=place("big-buddha", ["Tian Tan Buddha", "天壇大佛"], entrance=False, R=800)),
    stop("tai-o", "Tai O", point=place("tai-o", ["Tai O", "大澳"], entrance=False, R=1200)),
    minor("tung-chung", "station", "Tung Chung, derniers achats", "東涌", st("Tung Chung", TCL), step="j13:6", short="Tung Chung"),
    stop("airport-soir", "Aéroport", point=AIRPORT, step="j13:7", place_id="airport"),
  ],
  "legs": [
    leg("hotel", "airport", "taxi", "Taxi jusqu'à l'aéroport", taxi()),
    leg("airport", "ngong-ping", "bus", "Bus jusqu'à Tung Chung · 10 min (proposé)", bus()),
    leg("ngong-ping", "ngong-ping-haut", "cablecar", "Ngong Ping 360 · 25 min", cable()),
    leg("ngong-ping-haut", "big-buddha", "walk", "À pied", walk()),
    leg("big-buddha", "tai-o", "bus", "Bus 21 · 20 min (option)", bus()),
    leg("tai-o", "tung-chung", "bus", "Bus 11 jusqu'à Tung Chung (proposé)", bus()),
    leg("tung-chung", "airport-soir", "bus", "Bus S1 ou métro jusqu'à l'aéroport (proposé)", bus()),
  ],
}

for d, spec in DAYS.items():
    if spec is None: continue
    spec["day"] = d
    spec.setdefault("_doc", "Plan du jour : arrêts dans l'ordre du programme, tronçons en segments par mode. Généré par tools/make-routes.py, puis tracé par tools/osm-routes.py.")
    json.dump(spec, open(os.path.join(ROOT, f"travelos/routes/{d}.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(d, len(spec["stops"]), "arrêts,", len(spec["legs"]), "tronçons")
