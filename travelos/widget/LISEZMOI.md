# Images du widget « photo du jour »

Une image carrée par journée, nommée d'après le numéro du jour dans TravelOS :
`jour01.png` (21 février, Hong Kong) … `jour13.png` (5 mars).

- Format carré, 1024 × 1024 au minimum (1536 ou 2048 idéalement).
- Tiers supérieur assez dégagé (ciel, fond doux) : l'heure s'y affiche en transparence.
- Le sujet principal peut monter dans ce tiers : il passera devant l'heure.
- Détourage automatique (`python3 tools/make-depth.py`). Pour imposer un détourage fait main :
  `jour01-fg.png` (même cadrage, fond transparent).

Ensuite : `python3 tools/make-depth.py && node tools/build-pack.mjs`, puis synchroniser la tablette.
