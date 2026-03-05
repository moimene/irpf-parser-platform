#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARSER_DIR="$ROOT_DIR/services/parser"
SERVICE_NAME="${RAILWAY_PARSER_SERVICE:-parser}"

if ! railway whoami >/dev/null 2>&1; then
  echo "Railway CLI is not authenticated. Run: railway login" >&2
  exit 1
fi

if [[ ! -f "$PARSER_DIR/railway.toml" ]]; then
  echo "Missing $PARSER_DIR/railway.toml" >&2
  exit 1
fi

echo "Deploying parser service to Railway service '$SERVICE_NAME'"
railway up --service "$SERVICE_NAME" --path-as-root "$PARSER_DIR"
