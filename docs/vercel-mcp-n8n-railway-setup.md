# Vercel MCP + n8n + Railway Setup

## 1) MCP servers configured (Codex)

Your `~/.codex/config.toml` now includes:

- `mcp_servers.vercel` -> `https://mcp.vercel.com`
- `mcp_servers.railway_mcp` -> `npx -y @railway/mcp-server`
- `mcp_servers.n8n_mcp` -> `/Users/moisesmenendez/.codex/bin/n8n-mcp-gateway.sh`

Check status:

```bash
./scripts/mcp-doctor.sh
```

After editing `~/.codex/config.toml`, restart Codex/Desktop so new MCP servers are loaded.

For n8n MCP, export credentials in your shell before starting Codex:

```bash
export N8N_MCP_URL="https://YOUR-N8N-DOMAIN/mcp/<path>"
export N8N_MCP_TOKEN="YOUR_N8N_TOKEN"
```

## 2) Railway services

Authenticate first:

```bash
railway login
```

Bootstrap services once:

```bash
./scripts/railway-bootstrap-services.sh
```

Deploy parser service:

```bash
./scripts/railway-deploy-parser.sh
```

Deploy n8n service:

```bash
export N8N_ENCRYPTION_KEY="a-long-random-secret"
./scripts/railway-deploy-n8n.sh
```

Note:

- `railway-bootstrap-services.sh` creates `Postgres`; `railway-deploy-n8n.sh` wires n8n to that DB automatically.
- With Postgres configured, n8n setup/API keys/workflows persist across restarts.
- Do not downgrade n8n major/minor versions against an already-migrated DB unless you plan a DB reset.

## 3) n8n workflow import

After n8n is live and API key is created:

```bash
export N8N_BASE_URL="https://YOUR-N8N-DOMAIN"
export N8N_API_KEY="YOUR_N8N_API_KEY"
export N8N_ACTIVATE_AFTER_IMPORT=true
./scripts/n8n-import-workflow.sh
```

This imports:

- `infra/n8n/workflows/irpf-parser-orchestration.json`

Importer behavior:

- Ensures every webhook node has explicit `webhookId` before import (prevents n8n saving `null` and breaking route registration).
- Can auto-activate imported workflow when `N8N_ACTIVATE_AFTER_IMPORT=true`.

Quick recovery (after restart / fresh n8n):

```bash
export N8N_BASE_URL="https://YOUR-N8N-DOMAIN"
export N8N_OWNER_EMAIL="you@example.com"
export N8N_OWNER_PASSWORD="your-strong-password"
export N8N_API_KEY_OUT="/tmp/n8n_api_key.txt"
./scripts/n8n-bootstrap.sh
```

This command:

- sets owner (if first run),
- creates a new API key,
- imports + activates `infra/n8n/workflows/irpf-parser-orchestration.json`.

## 4) Wire Web -> Parser -> n8n

Set these env vars in Vercel project:

- `PARSER_SERVICE_URL` -> Railway parser URL
- `N8N_WEBHOOK_URL` -> n8n webhook endpoint
- `AUTO_PARSE_ON_INTAKE=true`

And in n8n:

- `PARSER_SERVICE_URL` -> Railway parser URL
- `VERCEL_API_BASE_URL` -> Vercel deployment URL

## 5) Sources (official)

- Vercel MCP docs: https://vercel.com/docs/mcp/vercel-mcp
- n8n MCP docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/
- Railway MCP docs: https://docs.railway.com/guides/mcp
- Railway MCP server package: https://github.com/railwayapp/mcp-server
