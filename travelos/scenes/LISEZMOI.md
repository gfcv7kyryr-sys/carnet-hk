# Scènes du widget photo

Trois scènes par journée : matin (5 h – 12 h), après-midi (12 h – 18 h), soir (18 h – 5 h), à l'heure de Hong Kong.
L'accueil et l'économiseur d'écran changent de scène tout seuls, y compris accueil ouvert ou au sortir de veille.

Sources (non versionnées, 2000 × 2000, cadrées selon le gabarit : chiffres de 14 % à 28,7 % de la hauteur) :
`jNM.png` et `jNM détouré.png`, N = jour, M = moment (1, 2, 3). Exemple : `j103.png` = jour 10, soir.

    python3 tools/make-scenes.py "<dossier des sources>"
    node tools/build-pack.mjs
