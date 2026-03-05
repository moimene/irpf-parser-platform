# Variables de Entorno - Produccion

Este documento lista las variables necesarias para desplegar el MVP IRPF Parser en produccion.
No commitear secretos reales al repositorio.

## Vercel (apps/web)

Configurar en: Vercel -> Project -> Settings -> Environment Variables.

Variables obligatorias (7):

1. `SUPABASE_URL`
2. `SUPABASE_SERVICE_ROLE_KEY`
3. `SUPABASE_PUBLISHABLE_KEY`
4. `NEXT_PUBLIC_SUPABASE_URL`
5. `N8N_WEBHOOK_URL`
6. `PARSER_SERVICE_URL`
7. `AUTO_PARSE_ON_INTAKE`

Compatibilidad adicional soportada por el codigo:

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (fallback de `SUPABASE_PUBLISHABLE_KEY`)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_STORAGE_BUCKET` (opcional, default `irpf-documents`)

Valores recomendados actuales:

- `N8N_WEBHOOK_URL=https://n8n-production-aaf5.up.railway.app/webhook/irpf/parse-events`
- `PARSER_SERVICE_URL=https://parser-production-0827.up.railway.app`
- `AUTO_PARSE_ON_INTAKE=true`

## Railway - Parser Service (`services/parser`)

Variables obligatorias:

1. `OPENAI_API_KEY`
2. `SUPABASE_URL`
3. `SUPABASE_SERVICE_ROLE_KEY`

Variable inyectada por plataforma:

- `PORT`

## Railway - n8n

Variables obligatorias:

1. `PARSER_SERVICE_URL`
2. `VERCEL_API_BASE_URL`
3. `N8N_ENCRYPTION_KEY`
4. `WEBHOOK_URL`

Workflow objetivo:

- `infra/n8n/workflows/parse-document-workflow.json`

Nota:

- En este repo, `parse-document-workflow.json` referencia el mismo flujo base que `irpf-parser-orchestration.json`.

## Supabase

Proyecto usado actualmente: `hvlsuwdqtffiilvampxq`.

Bucket esperado para documentos:

- `irpf-documents`

## Orden de despliegue recomendado

1. Supabase: aplicar `infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`.
2. Railway parser: desplegar `services/parser/` con variables configuradas.
3. Railway n8n: importar/activar workflow `infra/n8n/workflows/parse-document-workflow.json`.
4. Vercel: conectar repo GitHub y cargar variables de este documento.
