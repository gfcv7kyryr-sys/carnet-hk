# TravelOS (Android)

Application Android native du voyage Hong Kong / Chine du Sud 2027, pour la Lenovo Tab K11 Gen 2 (TB336FU).
Cahier des charges : document « TravelOS — Cahier des charges v2 ».

## Installer sur la tablette

1. Sur la tablette, ouvrir Chrome à l'adresse :
   `https://github.com/gfcv7kyryr-sys/carnet-hk/releases/tag/travelos-dev`
2. Toucher **TravelOS.apk** pour le télécharger, puis l'ouvrir.
3. La première fois, Android demande d'autoriser Chrome à installer des applications : accepter.
4. Les versions suivantes s'installent de la même façon, par-dessus la précédente, sans perdre les données.

Chaque modification du dépôt (code, carnet, images, audios) fabrique automatiquement une nouvelle APK.

## Fonctionnement (version 0.2)

- **Moteur natif** (Kotlin) : écran d'accueil Android, base Room de l'état sur place (étapes faites),
  synchronisation du contenu, test GPS sans Google, liste des applications, liens vers les réglages.
- **Interface** : page HTML embarquée (`app/src/main/assets/ui`), style du carnet de route, verre liquide.
- **Contenu** : `travelos/pack/pack.json` + images et audios du dépôt, générés depuis le carnet par
  `node tools/build-pack.mjs`. L'APK n'embarque que le texte (pack.json, environ 200 Ko) ; les médias
  (environ 90 Mo) se téléchargent en Wi-Fi depuis *Plus › Contenu › Synchroniser*, vérifiés par SHA-256.
- **Écran d'accueil** : *Plus › Réglages › Choisir TravelOS*. La tablette démarre alors sur « Qui voyage ? ».
  Pour revenir à l'accueil Lenovo : même bouton, puis choisir l'accueil d'origine.

## Organisation du code

| Module | Rôle |
| --- | --- |
| `app` | Activité (WebView verrouillée), pont JavaScript, test GPS, icônes d'applications |
| `core` | État de la tablette (batterie, réseau, GPS, mémoire) |
| `data` | Base Room de l'état sur place, synchronisation du paquet de contenu |

## Fabriquer soi-même (facultatif)

Ouvrir le dossier `android/` dans Android Studio, puis *Build > Build APK(s)*.
En ligne de commande : `./gradlew assembleRelease` (JDK 17).

## Clé de signature

La clé `keystore/travelos-dev.jks` est une clé de prototype versionnée, pour que chaque mise à jour
s'installe sans désinstaller. Elle sera remplacée en phase 7 par une clé privée stockée en secret GitHub
et sauvegardée hors du dépôt (changement de clé = une désinstallation, une seule fois, avant le départ).
