#!/usr/bin/env bash
# Télécharge les extraits OpenStreetMap (Geofabrik) des régions du voyage et ne garde que ce qui sert aux
# Plans du jour : lieux nommés, entrées, gares et lignes, voies ferrées, ferries, téléphériques, rues.
#   tools/osm-prepare.sh            → .osm/*.filtre.osm.pbf
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .osm && cd .osm
BASE=https://download.geofabrik.de/asia/china
get() { # get <région> : télécharge si absent (les fichiers sont gardés en cache d'une semaine sur l'autre)
  [ -s "$1.osm.pbf" ] || curl -sfL --retry 3 -o "$1.osm.pbf" "$BASE/$1-latest.osm.pbf" || { rm -f "$1.osm.pbf"; return 1; }
}
URBAN="nwr/name nwr/railway nwr/aerialway nwr/public_transport n/entrance w/route=ferry r/route=subway,train,light_rail,monorail,tram,ferry"
for r in hong-kong macau; do
  get "$r"
  osmium tags-filter -O -o "$r.filtre.osm.pbf" "$r.osm.pbf" $URBAN w/highway
done
# Guangdong et Guangxi : les villes visitées en détail, et toutes les voies ferrées (TGV) de la province.
get guangdong
osmium extract -O -b 113.10,22.85,113.55,23.25 -o gz.osm.pbf guangdong.osm.pbf
osmium extract -O -b 113.75,22.40,114.25,22.70 -o sz.osm.pbf guangdong.osm.pbf
for r in gz sz; do osmium tags-filter -O -o "$r.filtre.osm.pbf" "$r.osm.pbf" $URBAN; done
osmium tags-filter -O -o guangdong-rail.filtre.osm.pbf guangdong.osm.pbf w/railway=rail
get guangxi
osmium extract -O -b 110.30,24.70,110.75,25.05 -o xp.osm.pbf guangxi.osm.pbf
osmium extract -O -b 111.05,24.10,111.35,24.40 -o hy.osm.pbf guangxi.osm.pbf
for r in xp hy; do osmium tags-filter -O -o "$r.filtre.osm.pbf" "$r.osm.pbf" $URBAN; done
osmium tags-filter -O -o guangxi-rail.filtre.osm.pbf guangxi.osm.pbf w/railway=rail
rm -f gz.osm.pbf sz.osm.pbf xp.osm.pbf hy.osm.pbf
ls -la *.filtre.osm.pbf
