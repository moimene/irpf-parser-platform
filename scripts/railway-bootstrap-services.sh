#!/usr/bin/env bash
set -euo pipefail

# Creates baseline Railway services used by this project.
# Safe to re-run: if service already exists, command may fail and continue.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! railway whoami >/dev/null 2>&1; then
  echo "Railway CLI is not authenticated. Run: railway login" >&2
  exit 1
fi

echo "Creating/ensuring Railway service: parser"
railway add --service parser >/dev/null 2>&1 || true

echo "Creating/ensuring Railway service: Postgres database"
railway add --database postgres --service Postgres >/dev/null 2>&1 || true

echo "Creating/ensuring Railway service: n8n (image)"
railway add --service n8n --image n8nio/n8n:latest >/dev/null 2>&1 || true

echo "Done. Next: run deploy scripts for each service."
