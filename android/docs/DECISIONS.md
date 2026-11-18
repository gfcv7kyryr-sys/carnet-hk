# Journal des décisions techniques

## 2026-11-18 — Phase 0 (audit) et phase 1 (socle)

**Tablette relevée** : Lenovo TB336FU, Android 16, 8 Go de RAM, 111 Go libres, pas de microSD,
Play Store présent, GPS fonctionnel. Le premier point en « quelques millisecondes » relevé avec
Google Maps vient sans doute de la position réseau ou d'une position récente : la mesure réaliste
se fait avec l'écran Diagnostic (puce GPS seule, Wi-Fi coupé, dehors).

| Décision | Raison |
| --- | --- |
| Kotlin natif, Compose pour les écrans natifs, WebView locale pour le carnet | Moteur natif fiable, style du carnet de route conservé à l'identique |
| `compileSdk`/`targetSdk` 35, `minSdk` 30 | Versions stables d'AGP 8.7 ; fonctionne sur Android 16 ; API 36 à adopter quand la chaîne d'outils sera mise à jour |
| Room + DataStore | Bibliothèques officielles, sans réseau |
| Injection manuelle (`AppContainer`) | Pas de bibliothèque supplémentaire pour une application personnelle |
| WebViewAssetLoader, réseau bloqué dans la WebView | Aucun script externe ; liens externes ouverts hors de l'application |
| Carnet embarqué dans l'APK (phase 1 seulement) | Prototype complet tout de suite ; le contenu passera par paquet ZIP en phase 6 |
| Position lue sur `GPS_PROVIDER` d'Android | Aucune dépendance aux services Google, indisponibles en Chine continentale |
| Amap : navigation externe facultative, pas source de position | Coordonnées GCJ-02, compte et réseau requis par son kit développeur |
| Fabrication par GitHub Actions, publication `travelos-dev` | Aucun abonnement, installation directe depuis la tablette |
| Clé de signature de prototype versionnée | Mises à jour sans désinstallation pendant le développement ; clé privée en phase 7 |

## À trancher

- Cartes hors ligne : MapLibre Native (PMTiles) ou Mapsforge — comparaison en début de phase 3.
- Géorepérage : service natif sur `GPS_PROVIDER` en priorité ; `GeofencingClient` testé en complément.
- Passage à `compileSdk` 36 (Android 16) avec une version d'AGP qui le prend en charge.
