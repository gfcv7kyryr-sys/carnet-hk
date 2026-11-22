#!/usr/bin/env bash
# Récupère, une fois par semaine, les données OpenStreetMap utiles aux Plans du jour, zone par zone, en une
# requête Overpass par zone (lieux nommés, entrées, gares et lignes, voies ferrées, ferries, téléphériques).
#   tools/osm-prepare.sh            → .osm/<zone>.overpass.json
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .osm
python3 -u tools/osm-fetch.py
ls -la .osm
