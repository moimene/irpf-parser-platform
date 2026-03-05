#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_PATH="${1:-$ROOT_DIR/infra/n8n/workflows/irpf-parser-orchestration.json}"
ACTIVATE_AFTER_IMPORT="${N8N_ACTIVATE_AFTER_IMPORT:-false}"

if [[ -z "${N8N_BASE_URL:-}" ]]; then
  echo "N8N_BASE_URL is required. Example: https://n8n-production.up.railway.app" >&2
  exit 1
fi

if [[ -z "${N8N_API_KEY:-}" ]]; then
  echo "N8N_API_KEY is required." >&2
  exit 1
fi

if [[ ! -f "$WORKFLOW_PATH" ]]; then
  echo "Workflow file not found: $WORKFLOW_PATH" >&2
  exit 1
fi

echo "Importing workflow: $WORKFLOW_PATH"

TMP_WORKFLOW="$(mktemp)"
cp "$WORKFLOW_PATH" "$TMP_WORKFLOW"

# n8n can persist missing webhook IDs as null, which breaks webhook registration.
# Ensure every webhook trigger has a stable explicit webhookId before import.
jq '
  .nodes |= map(
    if .type == "n8n-nodes-base.webhook" and ((.webhookId // "") == "") then
      (
        ((.id // .name // "webhook-node")
          | ascii_downcase
          | gsub("[^a-z0-9]+"; "-")
          | gsub("(^-|-$)"; "")
        ) as $generated
        | . + { webhookId: (if $generated == "" then "webhook-node" else $generated end) }
      )
    else .
    end
  )
' "$TMP_WORKFLOW" > "${TMP_WORKFLOW}.json"
mv "${TMP_WORKFLOW}.json" "$TMP_WORKFLOW"

IMPORT_RESPONSE="$(
curl --fail --silent --show-error \
  -X POST "$N8N_BASE_URL/api/v1/workflows" \
  -H "Content-Type: application/json" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  --data-binary "@$TMP_WORKFLOW"
)"

rm -f "$TMP_WORKFLOW"

WORKFLOW_ID="$(echo "$IMPORT_RESPONSE" | jq -r '.id // empty')"

if [[ -n "$WORKFLOW_ID" && "$ACTIVATE_AFTER_IMPORT" == "true" ]]; then
  echo "Activating imported workflow: $WORKFLOW_ID"
  curl --fail --silent --show-error \
    -X POST "$N8N_BASE_URL/api/v1/workflows/$WORKFLOW_ID/activate" \
    -H "X-N8N-API-KEY: $N8N_API_KEY" \
    >/dev/null
fi

echo
if [[ -n "$WORKFLOW_ID" ]]; then
  echo "Workflow import completed. ID: $WORKFLOW_ID"
else
  echo "Workflow import completed."
fi
