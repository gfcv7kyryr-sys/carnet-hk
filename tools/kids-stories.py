# Les 13 histoires de Xiao Long (une par jour du voyage) → travelos/kids/kids.json « stories ».
# Les images viennent du carnet interactif embarqué (android/app/src/main/assets/ui/charlie/img) :
# on les désigne par le début de leur nom. La narration audio viendra plus tard (champ « audio » par page).
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "android/app/src/main/assets/ui/charlie/img")
FILES = os.listdir(IMG)

def img(prefix):
    m = [f for f in FILES if f.startswith(prefix)]
    if len(m) != 1:
        sys.exit(f"image {prefix} : {len(m)} correspondance(s)")
    return "charlie/img/" + m[0]

S = []
def story(day, ville, titre, pages):
    S.append({
        "day": day,
        "title": f"Jour {day} · {titre}",
        "ville": ville,
        "cover": img(pages[0][0]),
        "pages": [{"img": img(i), "text": t} for i, t in pages],
    })

story(1, "Hong Kong", "Rosie, le flamant rose", [
    ("1a922b37", "Au milieu des gratte-ciel de Hong Kong, il y a un grand jardin. Et dans ce jardin, il y a un lac plein de flamants roses.\nTous les flamants dorment debout, sur une seule patte. Tous… sauf Rosie."),
    ("8e6572d1", "Rosie essaie. Elle lève une patte. Elle tangue à gauche. Elle tangue à droite… et PLOUF ! La voilà dans l'eau, toute mouillée.\n« Je n'y arriverai jamais », soupire Rosie."),
    ("9fee999e", "Une petite tête rouge sort d'un buisson de fleurs. C'est Xiao Long !\n« Je vais t'apprendre ! » Il lève une patte, il ouvre les bras… et BOUM, il tombe sur les fesses.\nLes flamants rient tout bas : hi hi hi !"),
    ("368ba0e5", "Alors Xiao Long a une idée. « On essaie à deux ? »\nIls se tiennent par l'aile et par la patte. Ils pensent à quelque chose de très doux : une plume, un nuage, une mandarine…\nUn, deux, trois… Rosie tient ! Sur une patte !\nSur la baie, une jonque aux voiles rouges passe et leur dit bravo."),
    ("d58b75dd", "Le soir, les tours s'allument en musique. Rosie dort, debout sur une patte, la tête sous son aile.\nXiao Long chuchote : « Tu vois, à deux, c'est plus facile. »\nBonne nuit, Rosie. Bonne nuit, Charlie."),
])

story(2, "Hong Kong", "Le petit tram qui avait peur", [
    ("451e5cf0", "Ce matin, Xiao Long traverse la baie sur le bateau vert et blanc. Le vent lui chatouille les moustaches.\nEn face, tout là-haut, il y a la montagne. Et pour monter, il y a un petit train rouge."),
    ("929ae064", "Le petit train rouge s'appelle Pic. Mais Pic a un secret : la montagne est si raide qu'il a peur.\n« Et si je glissais ? Et si je n'arrivais pas en haut ? »\nSes roues tremblent : cling, cling, cling."),
    ("619adde7", "Xiao Long monte à bord et colle son nez à la vitre.\n« Moi aussi, j'ai peur, des fois. Alors je dis une phrase magique : petit dragon, grand courage ! »\nPic répète tout doucement : « Petit train… grand courage. » Et il commence à grimper."),
    ("af6f5ee6", "Ça penche, ça penche ! Les immeubles ont l'air de tomber, mais non, c'est le train qui monte.\nEt tout à coup… le sommet ! La ville entière est à leurs pieds, avec la mer et les bateaux minuscules.\n« J'ai réussi ! » crie Pic. Tout le monde applaudit."),
    ("0b8a177b", "Pour rentrer, Xiao Long prend le tram à étage qui fait ding-ding. Il fait sonner la cloche, une seule fois. Promis.\nCe soir, quand tu as un peu peur, tu peux dire la phrase magique, toi aussi : petit dragon, grand courage.\nBonne nuit, Charlie."),
])

story(3, "Hong Kong", "Jiu, le neuvième dragon", [
    ("6919fc1f", "Au temple qui sent bon l'encens, il y a un mur avec neuf dragons peints. Xiao Long les compte : un, deux, trois… huit… et neuf.\nLe neuvième est le plus petit. Il s'appelle Jiu. Et Jiu lui fait un clin d'œil !"),
    ("95a74e71", "« Je m'ennuie sur mon mur, chuchote Jiu. Je peux venir avec toi, juste une journée ? »\nHop, Jiu se glisse dans la poche de Xiao Long.\nÀ la cité arc-en-ciel, ils jouent au basket sur le toit. Jiu ne marque aucun panier, mais il rit très fort."),
    ("3a4102c7", "Ensuite, ils montent un escalier plein de statues dorées. Il y en a des milliers !\nJiu propose un jeu : « Un, deux, trois, statue ! » Xiao Long ne bouge plus. Personne ne le remarque au milieu des statues… sauf un petit singe, qui lui tire la langue."),
    ("75fa5d54", "Au marché, des poissons rouges nagent dans des sacs accrochés comme des ballons.\n« Ils sont comme moi sur mon mur, dit Jiu. Ils regardent passer les gens. »\nIl leur fait coucou. Les poissons font des bulles : bloup, bloup."),
    ("3a96bb3c", "Le soir, Jiu bâille. « Il faut que je rentre. Les gens viennent faire des vœux devant mon mur. Et moi, je veille sur leurs vœux. »\nIl remonte à sa place, entre le huitième dragon et le bord du mur.\nSi tu fais un vœu ce soir, Charlie, Jiu veille sur lui. Bonne nuit."),
])

story(4, "Macao", "Pépin et la tartelette", [
    ("52ea9fdb", "Aujourd'hui, Xiao Long prend un bateau très rapide pour Macao. Il colle son museau au hublot : les vagues font des moustaches blanches sur la mer."),
    ("05028a13", "Sur la grande place, les pavés dessinent des vagues. Et sur une fontaine, il y a un pigeon tout triste.\nIl s'appelle Pépin. « Tout le monde mange des tartelettes jaunes, et moi, j'arrive toujours trop tard. Il ne reste que des miettes. »"),
    ("7e959531", "« Viens avec moi ! » dit Xiao Long. Ils marchent sur les vagues de pavés, en équilibre, comme des funambules.\nPépin sautille, Xiao Long manque de tomber. Oups ! Ils rient tous les deux."),
    ("aed45e10", "Chez le pâtissier, ça sent le chaud et le sucré. Il ne reste qu'une seule tartelette. Une seule !\nXiao Long la regarde. Il a très envie de la croquer… Puis il la coupe en deux.\n« La moitié pour toi, Pépin. » Pépin roucoule de bonheur."),
    ("a6ba2991", "Au coucher du soleil, ils regardent le grand mur de l'église, tout seul devant le ciel. Pépin s'endort sur l'épaule de Xiao Long.\nUne demi-tartelette partagée, c'est encore meilleur qu'une tartelette entière.\nBonne nuit, Charlie."),
])

story(5, "Canton", "La tour qui voulait danser", [
    ("06c61ad1", "Fiiiou ! Le train file si vite que les vaches n'ont pas le temps de dire bonjour. En moins d'une heure, Xiao Long arrive à Canton."),
    ("dcf747f1", "Au bord de la rivière, il y a une tour immense, toute fine au milieu, comme si elle se tortillait.\nXiao Long monte tout en haut dans une bulle transparente. Il entend alors une petite voix : « Tu crois que je saurai danser, un jour ? »\nC'est la tour qui parle !"),
    ("df433827", "« Je suis trop grande, dit la tour. Si je bouge, tout tombe. Alors je reste immobile, et je regarde les bateaux. »\nXiao Long réfléchit très fort, le menton dans les pattes."),
    ("bc64001d", "Le soir, il monte sur un bateau tout illuminé. La musique commence. Et là, regarde ! La tour devient rouge, puis bleue, puis verte, puis violette…\n« Mais tu danses ! crie Xiao Long. Tu danses avec tes couleurs ! »"),
    ("63afa238", "Sur le bateau, Xiao Long danse aussi, en tournant comme une toupie. La tour clignote de joie.\nOn n'est pas obligé de danser avec les pieds. On peut danser avec les couleurs, avec les mains, avec un sourire.\nBonne nuit, Charlie."),
])

story(6, "Canton", "Le bébé panda qui ne voulait pas dormir", [
    ("808ddb42", "Au parc des pandas, c'est l'heure de la sieste. Les pandas ont mangé beaucoup de bambou. Ils bâillent, ils s'étirent, ils s'endorment.\nTous, sauf le plus petit. Il s'appelle Bao, et il a les yeux grands ouverts."),
    ("f125be84", "« Je ne veux pas dormir ! dit Bao. Si je dors, je vais rater quelque chose ! »\nXiao Long s'assoit à côté de lui. « On compte les bambous ? » Un bambou, deux bambous, trois bambous… Bao compte jusqu'à cent. Toujours pas sommeil."),
    ("a8c68e21", "Xiao Long chante une berceuse de dragon : « Dodo, petit panda, la lune est là… » Bao gigote, Bao fait des roulades. Toujours pas sommeil."),
    ("955d4e8c", "Alors un grand tigre blanc s'approche. Il ne fait pas peur du tout. Il se couche tout près et se met à ronronner, très doucement.\nRrrr… rrrr… On dirait un gros chat. On dirait le bruit de la pluie."),
    ("51b285cb", "Les yeux de Bao se ferment, tout doucement. Il dort, roulé en boule, comme une peluche.\nXiao Long chuchote : « Tu vois, en dormant, on ne rate rien. On garde des forces pour demain. »\nToi aussi, Charlie, ferme les yeux. Rrrr… rrrr… Bonne nuit."),
])

story(7, "Shenzhen", "Bip, le robot qui voulait rire", [
    ("67692563", "À Shenzhen, la ville du futur, les drones livrent les repas par les airs. Bzzz ! Xiao Long lève les bras pour leur faire coucou."),
    ("196a0dac", "Dans le parc, il rencontre un petit robot blanc qui sert des glaces. Il s'appelle Bip.\nBip sait tout faire : compter jusqu'à mille, dire bonjour dans vingt langues, faire des glaces à trois boules.\nMais Bip ne sait pas rire."),
    ("67653d95", "Xiao Long essaie tout. Il fait des grimaces. Il danse la danse des canards. Il raconte l'histoire du dragon qui avait éternué dans un temple.\nBip penche la tête. « Bip. Je ne comprends pas. »"),
    ("6d3f9dd9", "Juste à ce moment-là, un drone livre une glace… et la glace tombe, SPLOTCH, pile sur le nez de Xiao Long !\nXiao Long louche sur la boule à la fraise. Et Bip… Bip se met à clignoter.\n« Bip ! Bip ! Hi hi hi ! » Bip rit !"),
    ("4f04634b", "Le soir, les gratte-ciel s'allument comme des sapins de Noël. Bip rit encore en y repensant.\nLe rire, ça ne s'apprend pas dans les livres. Ça arrive tout seul, avec un ami et un peu de glace sur le nez.\nBonne nuit, Charlie."),
])

story(8, "Canton", "Le plus petit des cinq moutons", [
    ("f23dc2a7", "Dans un parc de Canton, il y a cinq moutons de pierre. Il paraît qu'il y a très longtemps, ils sont arrivés du ciel avec des magiciens.\nLe plus petit mouton a l'air triste."),
    ("e6360c5d", "Xiao Long lui fait un câlin. La pierre est froide, mais le petit mouton chuchote : « Bêê… Je suis de pierre. Je ne peux pas me promener. Je ne goûterai jamais rien de bon. »"),
    ("5b0497ac", "Alors Xiao Long part en promenade pour deux. Il visite une grande maison avec des dragons sculptés jusque sur le toit. Il regarde tout, très fort, pour s'en souvenir."),
    ("47af1fed", "Puis il goûte un dessert blanc qui tremblote : le pudding au lait. C'est doux, c'est tiède, c'est sucré. Il en garde le goût sur la langue, et une moustache blanche sous le nez."),
    ("52cd7789", "Le soir, il revient au parc et raconte tout au petit mouton : les dragons du toit, le pudding qui tremblote, la moustache blanche.\nLe petit mouton sourit. « Bêê… C'est presque comme si j'y étais allé. »\nRaconter, c'est une façon de partager. Bonne nuit, Charlie."),
])

story(9, "Xingping", "Noiraud, le cormoran", [
    ("6c14afb8", "Sur la rivière Li, les montagnes ressemblent à des pains de sucre. Xiao Long glisse sur un radeau de bambou, tout doucement."),
    ("0be3435a", "Sur le radeau d'un vieux pêcheur, il y a des cormorans, de grands oiseaux noirs qui plongent pour attraper des poissons.\nLe plus jeune s'appelle Noiraud. Mais Noiraud ne plonge jamais. « L'eau est trop profonde, dit-il. J'ai peur. »"),
    ("4647be5a", "« Tu sais, moi aussi j'ai peur de quelque chose, dit Xiao Long. J'ai peur du noir. Le soir, je laisse une petite lumière. »\nNoiraud ouvre de grands yeux. « Un dragon qui a peur du noir ? »\n« Oui. Mais j'ai une phrase magique : petit dragon, grand courage ! »"),
    ("11cb2fd4", "Noiraud ferme les yeux. Il répète : « Petit cormoran, grand courage. »\nEt il plonge ! PLOUF !\nIl ressort, tout ébouriffé… avec un poisson argenté dans le bec. Le vieux pêcheur rit et lui gratte la tête."),
    ("99727657", "Au coucher du soleil, la rivière devient toute dorée. Noiraud se sèche les ailes à côté de Xiao Long.\n« Ce soir, dit Noiraud, je te prête ma lanterne, pour le noir. »\nAvoir peur, ce n'est pas grave. On peut avoir peur et être courageux en même temps. Bonne nuit, Charlie."),
])

story(10, "Huangyao", "Le dragon de pierre", [
    ("58ce6641", "Huangyao est un village tout vieux, tout en pierre, avec des ruelles, des canards et des ponts couverts de feuilles. Ici, il n'y a pas de voitures. On entend juste les canards : coin, coin."),
    ("b1f78e8d", "Devant le vieux théâtre, il y a des dragons de pierre. Ils ne bougent jamais. Mais l'un d'eux a l'air tout grognon.\n« Trois cents ans que je suis assis ! J'ai des fourmis dans les pattes ! »"),
    ("9bd2d920", "Xiao Long ne sait pas quoi faire. Il va demander conseil au plus vieil arbre du village, près du pont. Un arbre si gros que dix enfants ne pourraient pas en faire le tour."),
    ("73daa3d8", "L'arbre parle avec une voix de feuilles : « Shhh… Le soir, quand plus personne ne regarde, les dragons de pierre ont le droit d'étirer une patte. Une seule. »\nXiao Long fait un câlin à l'arbre. Merci !"),
    ("51a1d18f", "La nuit tombe. Xiao Long se cache parmi les dragons, immobile comme une statue. Et là… crrr… le dragon grognon étire une patte. Puis il sourit.\n« Ahhh… Ça fait du bien. »\nDemain, il sera de nouveau tout sage. Bonne nuit, Charlie."),
])

story(11, "Xingping", "Le soleil timide", [
    ("627bfa2f", "Ce matin, il fait encore nuit. Xiao Long met son sac à dos et grimpe tout en haut d'une colline, marche après marche, pour voir le soleil se lever sur la rivière."),
    ("b4255b41", "En haut, il y a beaucoup de monde qui attend avec des appareils photo. Mais le soleil ne vient pas. Il se cache derrière un gros nuage de brume.\n« Il est timide », dit une petite fille."),
    ("77cc6e2e", "Xiao Long a une idée. « On lui dit bonjour tous ensemble ? En chinois, bonjour, c'est nǐ hǎo ! »\nUn, deux, trois : « Nǐ hǎo, soleil ! »"),
    ("0faf3f60", "Le nuage s'écarte, tout doucement… et le soleil sort ! Il colore la rivière en rose et en or. Les montagnes ont l'air de flotter sur la brume.\nTout le monde dit : « Ooooh ! »"),
    ("e84e5651", "L'après-midi, Xiao Long prend le grand train blanc pour rentrer à Hong Kong. À chaque tunnel, il crie : « Tunnel ! » et il ferme les yeux.\nQuand quelqu'un est timide, un bonjour gentil, ça aide beaucoup.\nBonne nuit, Charlie."),
])

story(12, "Hong Kong", "Caramel, le cheval du carrousel", [
    ("d35ab7e7", "Aujourd'hui, Xiao Long va au parc des rêves ! Il fait la montagne russe en criant très fort. Youpiii !"),
    ("63d3ed57", "Sur le carrousel, il y a un cheval de bois doré. Il s'appelle Caramel. Il tourne, tourne, tourne toute la journée, en musique.\nMais Caramel a un rêve : voir les feux d'artifice. Le soir, le carrousel s'arrête toujours avant."),
    ("d0b48e13", "L'après-midi, c'est la parade. Les chars passent, avec des fleurs géantes et des danseurs.\nXiao Long danse au milieu de la grande rue. Mais il pense à Caramel. Comment l'aider ?"),
    ("bd3aee12", "Xiao Long va voir le monsieur du carrousel, et il demande, très poliment : « S'il vous plaît, vous pourriez faire un dernier tour, ce soir ? Un tout petit tour ? »\nLe monsieur sourit sous sa moustache. « D'accord. Juste un. »"),
    ("be246631", "Le soir, le carrousel fait son dernier tour. Caramel s'arrête juste en face du château… BOUM ! Les feux d'artifice éclatent : des fleurs, des étoiles, des cœurs de lumière.\nLes yeux de bois de Caramel brillent de bonheur.\nUn s'il vous plaît, ça peut ouvrir des portes magiques. Bonne nuit, Charlie."),
])

story(13, "Lantau", "Au revoir, les amis", [
    ("ea646098", "C'est le dernier jour. Xiao Long monte dans une petite cabine qui vole au-dessus de la mer, accrochée à un câble. Tout en bas, il voit les bateaux, les îles et les avions."),
    ("80fad44c", "De là-haut, il se souvient de tous ses amis du voyage. Rosie le flamant, qui tient sur une patte. Pic le petit tram courageux. Jiu, le neuvième dragon. Pépin le pigeon et sa demi-tartelette."),
    ("c8388840", "La tour qui danse avec ses couleurs. Bao le bébé panda. Bip le robot qui rit. Le petit mouton de pierre. Noiraud le cormoran. Le dragon aux fourmis dans les pattes. Le soleil timide. Et Caramel, le cheval du carrousel.\nEn haut des marches, devant le Grand Bouddha, Xiao Long fait un vœu : les revoir tous, un jour."),
    ("1b509334", "Le soir, dans l'avion, Xiao Long regarde par le hublot. En bas, la baie de Hong Kong brille d'une petite lueur dorée. On dirait qu'elle dit au revoir.\nEn chinois, au revoir, c'est zàijiàn. Ça veut dire : à bientôt."),
    ("dbed0856", "Les amis, ça reste dans le cœur, même quand on est loin. Il suffit de fermer les yeux pour les retrouver.\nFerme les yeux, Charlie. Tu les vois ? Rosie, Pic, Jiu, Pépin, Bao, Bip, Noiraud, Caramel… et Xiao Long, qui te fait un bisou de dragon.\nZàijiàn, et bonne nuit."),
])

path = os.path.join(ROOT, "travelos/kids/kids.json")
k = json.load(open(path))
k.pop("book", None)
k.pop("carnet", None)
k["stories"] = S
json.dump(k, open(path, "w"), ensure_ascii=False, indent=1)
print(len(S), "histoires,", sum(len(s["pages"]) for s in S), "pages,",
      sum(len(p["text"].split()) for s in S for p in s["pages"]), "mots")
