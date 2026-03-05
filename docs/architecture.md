# Arquitectura Implementada (Baseline)

## Capa Vercel (`apps/web`)

- API `POST /api/documents/intake`
- API `GET /api/exports/:expediente_id?model=100|714|720`
- API `POST /api/webhooks/parse-event`
- API `GET /api/review`, `GET /api/dashboard`
- UI: dashboard, expediente y cola de revisión manual

## Capa Railway (`services/parser`)

- `POST /parse-document`
- Estrategia: plantilla conocida -> fallback semántico -> revisión manual
- Soporte inicial entidades: Pictet, Goldman Sachs, Citi

## Capa Supabase (`infra/supabase/migrations/0001_init.sql`)

- Tablas: `documents`, `extractions`, `operations`, `lots`, `alerts`, `exports`, `audit_log`, `template_versions`, `rule_configs`
- Entidades soporte: `clients`, `expedientes`

## Capa n8n (`infra/n8n/workflows/irpf-parser-orchestration.json`)

- Eventos: `parse.started`, `parse.completed`, `parse.failed`, `manual.review.required`
- Router por evento y feedback hacia API Vercel

## Contratos

- `packages/contracts`: tipos de intake/parse/event/export
- `packages/rules`: recompras 2/12 meses y asignación FIFO
