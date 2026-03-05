#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_PATH="${1:-$ROOT_DIR/infra/n8n/workflows/irpf-parser-orchestration.json}"

if [[ -z "${N8N_BASE_URL:-}" ]]; then
  echo "N8N_BASE_URL is required. Example: https://n8n-production.up.railway.app" >&2
  exit 1
fi

if [[ -z "${N8N_OWNER_EMAIL:-}" || -z "${N8N_OWNER_PASSWORD:-}" ]]; then
  echo "N8N_OWNER_EMAIL and N8N_OWNER_PASSWORD are required." >&2
  exit 1
fi

N8N_OWNER_FIRST_NAME="${N8N_OWNER_FIRST_NAME:-Owner}"
N8N_OWNER_LAST_NAME="${N8N_OWNER_LAST_NAME:-Admin}"
N8N_API_KEY_LABEL="${N8N_API_KEY_LABEL:-codex-irpf-$(date +%s)}"
N8N_API_KEY_OUT="${N8N_API_KEY_OUT:-}"
N8N_API_KEY_SCOPES="${N8N_API_KEY_SCOPES:-[\"workflow:create\",\"workflow:read\",\"workflow:list\",\"workflow:update\",\"workflow:activate\",\"workflow:deactivate\",\"workflow:execute\",\"workflow:delete\",\"tag:list\",\"tag:read\"]}"

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

SHOW_SETUP="$(curl --fail --silent --show-error "$N8N_BASE_URL/rest/settings" | jq -r '.data.userManagement.showSetupOnFirstLoad')"
if [[ "$SHOW_SETUP" == "true" ]]; then
  echo "Setting up n8n owner user..."
  OWNER_SETUP_STATUS="$(
    curl --silent --show-error \
      -o /tmp/n8n-owner-setup.json \
      -w "%{http_code}" \
      -X POST "$N8N_BASE_URL/rest/owner/setup" \
      -H "Content-Type: application/json" \
      --data "{\"email\":\"$N8N_OWNER_EMAIL\",\"firstName\":\"$N8N_OWNER_FIRST_NAME\",\"lastName\":\"$N8N_OWNER_LAST_NAME\",\"password\":\"$N8N_OWNER_PASSWORD\"}"
  )"

  if [[ "$OWNER_SETUP_STATUS" != "200" && "$OWNER_SETUP_STATUS" != "201" ]]; then
    echo "Owner setup returned HTTP $OWNER_SETUP_STATUS" >&2
    cat /tmp/n8n-owner-setup.json >&2
    exit 1
  fi
fi

echo "Logging into n8n..."
curl --fail --silent --show-error \
  -c "$COOKIE_JAR" \
  -X POST "$N8N_BASE_URL/rest/login" \
  -H "Content-Type: application/json" \
  --data "{\"emailOrLdapLoginId\":\"$N8N_OWNER_EMAIL\",\"password\":\"$N8N_OWNER_PASSWORD\"}" \
  >/dev/null

echo "Creating API key..."
API_KEY_RESPONSE="$(
curl --fail --silent --show-error \
  -b "$COOKIE_JAR" \
  -X POST "$N8N_BASE_URL/rest/api-keys" \
  -H "Content-Type: application/json" \
  --data "{\"label\":\"$N8N_API_KEY_LABEL\",\"scopes\":$N8N_API_KEY_SCOPES,\"expiresAt\":null}"
)"

N8N_API_KEY="$(echo "$API_KEY_RESPONSE" | jq -r '.data.rawApiKey // empty')"
if [[ -z "$N8N_API_KEY" ]]; then
  echo "Failed to create API key (rawApiKey missing)." >&2
  exit 1
fi

echo "Importing and activating workflow..."
N8N_API_KEY="$N8N_API_KEY" N8N_BASE_URL="$N8N_BASE_URL" N8N_ACTIVATE_AFTER_IMPORT=true \
  "$ROOT_DIR/scripts/n8n-import-workflow.sh" "$WORKFLOW_PATH"

if [[ -n "$N8N_API_KEY_OUT" ]]; then
  printf "%s" "$N8N_API_KEY" > "$N8N_API_KEY_OUT"
  echo "API key saved to: $N8N_API_KEY_OUT"
else
  echo "N8N API key:"
  echo "$N8N_API_KEY"
fi
