#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

cd "$WEB_DIR"
if command -v vercel >/dev/null 2>&1; then
  vercel deploy -y
else
  npx vercel deploy -y
fi
