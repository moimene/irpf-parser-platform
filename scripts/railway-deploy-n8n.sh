#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N8N_DIR="$ROOT_DIR/infra/n8n"
SERVICE_NAME="${RAILWAY_N8N_SERVICE:-n8n}"
DB_SERVICE_NAME="${RAILWAY_N8N_DB_SERVICE:-Postgres}"

if ! railway whoami >/dev/null 2>&1; then
  echo "Railway CLI is not authenticated. Run: railway login" >&2
  exit 1
fi

if [[ -z "${N8N_ENCRYPTION_KEY:-}" ]]; then
  echo "N8N_ENCRYPTION_KEY is required for n8n deployments." >&2
  exit 1
fi

DB_HOST_REF="DB_POSTGRESDB_HOST=\${{${DB_SERVICE_NAME}.PGHOST}}"
DB_PORT_REF="DB_POSTGRESDB_PORT=\${{${DB_SERVICE_NAME}.PGPORT}}"
DB_NAME_REF="DB_POSTGRESDB_DATABASE=\${{${DB_SERVICE_NAME}.PGDATABASE}}"
DB_USER_REF="DB_POSTGRESDB_USER=\${{${DB_SERVICE_NAME}.PGUSER}}"
DB_PASS_REF="DB_POSTGRESDB_PASSWORD=\${{${DB_SERVICE_NAME}.PGPASSWORD}}"

echo "Setting baseline env vars on Railway service '$SERVICE_NAME' (skip deploy)"
railway variable set --service "$SERVICE_NAME" --skip-deploys \
  "N8N_HOST=0.0.0.0" \
  "N8N_PORT=5678" \
  "N8N_PROTOCOL=https" \
  "N8N_ENCRYPTION_KEY=$N8N_ENCRYPTION_KEY" \
  "N8N_PROXY_HOPS=1" \
  "N8N_BLOCK_ENV_ACCESS_IN_NODE=false" \
  "N8N_LOG_LEVEL=info" \
  "N8N_DIAGNOSTICS_ENABLED=false" \
  "N8N_PERSONALIZATION_ENABLED=false" \
  "DB_TYPE=postgresdb" \
  "$DB_HOST_REF" \
  "$DB_PORT_REF" \
  "$DB_NAME_REF" \
  "$DB_USER_REF" \
  "$DB_PASS_REF" \
  "DB_POSTGRESDB_SCHEMA=public" \
  >/dev/null

railway variable delete --service "$SERVICE_NAME" N8N_RUNNERS_ENABLED >/dev/null 2>&1 || true

echo "Deploying n8n service to Railway service '$SERVICE_NAME'"
railway up --service "$SERVICE_NAME" --path-as-root "$N8N_DIR"
