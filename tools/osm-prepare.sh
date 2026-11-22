#!/usr/bin/env bash
# Télécharge les extraits OpenStreetMap (Geofabrik) des régions du voyage et ne garde que ce qui sert aux
# Plans du jour : lieux nommés, entrées, gares et lignes, voies ferrées, ferries, téléphériques, rues.
#   tools/osm-prepare.sh            → .osm/*.filtre.osm.pbf
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .osm && cd .osm
BASE=https://download.geofabrik.de/asia/china
get() { # get <région> <bbox> : télécharge si absent (gardé en cache d'une semaine sur l'autre) ;
        # si Geofabrik n'a pas la région, on la découpe dans l'extrait de toute la Chine.
  [ -s "$1.osm.pbf" ] && { echo "· $1 (cache)"; return 0; }
  if curl -sfL --retry 3 -o "$1.osm.pbf" "$BASE/$1-latest.osm.pbf"; then echo "· $1 téléchargé ($(du -h "$1.osm.pbf" | cut -f1))"; return 0; fi
  rm -f "$1.osm.pbf"; echo "· $1 absent de Geofabrik : découpe dans l'extrait de la Chine"
  [ -s china.osm.pbf ] || curl -sfL --retry 3 -o china.osm.pbf https://download.geofabrik.de/asia/china-latest.osm.pbf
  osmium extract -O -b "$2" -o "$1.osm.pbf" china.osm.pbf
}
URBAN="nwr/name nwr/railway nwr/aerialway nwr/public_transport n/entrance w/route=ferry r/route=subway,train,light_rail,monorail,tram,ferry"
get hong-kong 113.80,22.13,114.45,22.58
get macau 113.52,22.10,113.62,22.22
for r in hong-kong macau; do
  osmium tags-filter -O -o "$r.filtre.osm.pbf" "$r.osm.pbf" $URBAN w/highway
done
# Guangdong et Guangxi : les villes visitées en détail, et toutes les voies ferrées (TGV) de la province.
get guangdong 109.6,20.1,117.4,25.6
osmium extract -O -b 113.10,22.85,113.55,23.25 -o gz.osm.pbf guangdong.osm.pbf
osmium extract -O -b 113.75,22.40,114.25,22.70 -o sz.osm.pbf guangdong.osm.pbf
for r in gz sz; do osmium tags-filter -O -o "$r.filtre.osm.pbf" "$r.osm.pbf" $URBAN; done
osmium tags-filter -O -o guangdong-rail.filtre.osm.pbf guangdong.osm.pbf w/railway=rail
get guangxi 104.4,20.9,112.1,26.4
osmium extract -O -b 110.30,24.70,110.75,25.05 -o xp.osm.pbf guangxi.osm.pbf
osmium extract -O -b 111.05,24.10,111.35,24.40 -o hy.osm.pbf guangxi.osm.pbf
for r in xp hy; do osmium tags-filter -O -o "$r.filtre.osm.pbf" "$r.osm.pbf" $URBAN; done
osmium tags-filter -O -o guangxi-rail.filtre.osm.pbf guangxi.osm.pbf w/railway=rail
rm -f gz.osm.pbf sz.osm.pbf xp.osm.pbf hy.osm.pbf
ls -la *.filtre.osm.pbf
