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

## Ce que contient la phase 1 (prototype)

- Écran « Qui voyage ? » : profils Pilote et Carnet.
- Accueil Pilote : heure de Hong Kong et de Paris, compte à rebours, journée en cours et prochaine étape,
  progression, état de la batterie, du réseau et du GPS, raccourcis.
- Programme : les 13 journées et leurs étapes, à cocher (terminée, ignorée), enregistrées dans la base locale.
- Carnet de route complet, embarqué et lisible sans réseau (WebView locale verrouillée).
- Profil Carnet : page d'attente au style scrapbook ; sortie par appui long sur le dragon en haut à gauche.
- Diagnostic : caractéristiques de la tablette, test GPS sans les services Google, contenu de la base.

## Organisation du code

| Module | Rôle |
| --- | --- |
| `app` | Activité, navigation, écrans (Compose), WebView du carnet |
| `core` | Modèles communs, état de la tablette, calculs de dates |
| `data` | Base Room (voyages, journées, étapes, lieux, hôtels, phrases, détections), réglages DataStore, chargement du voyage embarqué |

Les modules `location`, `maps`, `media`, `tools`, `notifications`, `widgets` et `importexport`
seront ajoutés avec les phases qui les utilisent.

Les données du voyage viennent du carnet de route : `node tools/extract-pack.mjs` lit `index.html`
et écrit `app/src/main/assets/seed/*.json`. On ne saisit rien deux fois.

## Fabriquer soi-même (facultatif)

Ouvrir le dossier `android/` dans Android Studio, puis *Build > Build APK(s)*.
En ligne de commande : `./gradlew assembleRelease` (JDK 17).

## Clé de signature

La clé `keystore/travelos-dev.jks` est une clé de prototype versionnée, pour que chaque mise à jour
s'installe sans désinstaller. Elle sera remplacée en phase 7 par une clé privée stockée en secret GitHub
et sauvegardée hors du dépôt (changement de clé = une désinstallation, une seule fois, avant le départ).
