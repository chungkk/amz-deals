#!/usr/bin/env bash
# Deploy to VPS 2 (oracle-a1): rsync code, build image on the VPS, restart. Data lives in volume amz-deals-data.
set -euo pipefail
cd "$(dirname "$0")"
rsync -az --delete --exclude node_modules --exclude .next --exclude .git --exclude data --exclude .env --exclude pw.txt ./ oracle-a1:amz-deals/
ssh oracle-a1 'cd ~/amz-deals && sudo docker compose up -d --build --remove-orphans && sudo docker image prune -f >/dev/null'
