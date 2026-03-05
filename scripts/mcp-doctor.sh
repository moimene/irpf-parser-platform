#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${1:-$HOME/.codex/config.toml}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

echo "Using config: $CONFIG_FILE"

for section in "mcp_servers.vercel" "mcp_servers.railway_mcp" "mcp_servers.n8n_mcp"; do
  if rg -q "\[$section\]" "$CONFIG_FILE"; then
    echo "[ok] $section configured"
  else
    echo "[missing] $section"
  fi
done

echo "Checking binaries"
command -v npx >/dev/null && echo "[ok] npx"
command -v railway >/dev/null && echo "[ok] railway"
command -v curl >/dev/null && echo "[ok] curl"

echo "n8n MCP env vars"
[[ -n "${N8N_MCP_URL:-}" ]] && echo "[ok] N8N_MCP_URL" || echo "[missing] N8N_MCP_URL"
[[ -n "${N8N_MCP_TOKEN:-}" ]] && echo "[ok] N8N_MCP_TOKEN" || echo "[missing] N8N_MCP_TOKEN"
