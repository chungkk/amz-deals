#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${AMZ_DEALS_ENV:-$HOME/.config/amz-deals.env}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /opt/homebrew/bin/node)}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -Iseconds) [error] Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

export PUSH_SOURCE="${PUSH_SOURCE:-mac-auto}"
echo "$(date -Iseconds) [start] amz-deals push"
"$NODE_BIN" "$PROJECT_DIR/scripts/push.mjs"
echo "$(date -Iseconds) [done] amz-deals push"
