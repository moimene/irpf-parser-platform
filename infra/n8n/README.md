# n8n Workflows

Workflow base: `workflows/irpf-parser-orchestration.json`

## Eventos soportados

- `parse.started`
- `parse.completed`
- `parse.failed`
- `manual.review.required`

## Variables esperadas

- `PARSER_SERVICE_URL` (Railway)
- `VERCEL_API_BASE_URL` (Vercel web/API)

## Flujo

1. Recibe evento desde API de intake.
2. En `parse.started` invoca parser de Railway.
3. Reenvía estado a `/api/webhooks/parse-event` en Vercel.
4. Centraliza alertas y confirmación de ejecución.
