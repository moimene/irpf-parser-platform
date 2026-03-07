# Arquitectura Implementada

## Capa Vercel (`apps/web`)

- API `GET /api/clientes`
- API `GET /api/clientes/:id`
- API `POST /api/documents/intake`
- API `POST /api/documents/upload-urls`
- API `POST /api/expedientes`
- API `GET /api/exports/:expediente_id?model=100|714|720`
- API `GET /api/expedientes/:id`
- API `POST /api/webhooks/parse-event`
- API `GET /api/review`, `PATCH /api/review/:extraction_id`
- API `GET /api/dashboard`, `GET /api/extractions`
- UI real: dashboard, clientes, ficha de cliente, expediente y cola de revision manual
- Rutas heredadas `/login` y `/configuracion` solo como compatibilidad minima

## Capa Railway (`services/parser`)

- `POST /parse-document`
- Estrategia: plantilla conocida -> fallback semántico -> revisión manual
- Soporte inicial entidades: Pictet, Goldman Sachs, Citi
- Endurecimiento siguiente ya decidido:
  - `XLSX` y `CSV` deben entrar por parser determinista, no por OCR/LLM.
  - `PDF`, `DOCX` e imagen deben pasar por una capa `structured_document` antes del mapping fiscal.
  - `Docling` es candidato para esa capa documental por OCR, tablas y representación estructurada, pero no como motor fiscal ni como fuente directa de exportación AEAT.
  - El LLM debe quedar restringido a clasificación semántica y mapping de columnas/campos dentro de un schema cerrado.

## Capa Supabase runtime (`infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`, `infra/supabase/migrations/20260306130000_reconcile_irpf_operations.sql`, `infra/supabase/migrations/20260306140000_clients_runtime_module.sql`, `infra/supabase/migrations/20260307160000_irpf_lots_runtime_module.sql`, `infra/supabase/migrations/20260307170000_irpf_sale_allocations_runtime_module.sql`)

- Tablas runtime: `irpf_clients`, `irpf_expedientes`, `irpf_documents`, `irpf_extractions`, `irpf_operations`, `irpf_lots`, `irpf_sale_allocations`, `irpf_alerts`, `irpf_exports`, `irpf_audit_log`
- El esquema rico inicial de `0001_init.sql` existe como antecedente de diseño, pero no es la base operativa actual

## Capa n8n (`infra/n8n/workflows/irpf-parser-orchestration.json`)

- Eventos: `parse.started`, `parse.completed`, `parse.failed`, `manual.review.required`
- Router por evento y feedback hacia API Vercel

## Contratos

- `packages/contracts`: tipos de intake/parse/event/export
- `packages/rules`: recompras 2/12 meses y asignación FIFO

## Restriccion importante

La arquitectura actual consolida el flujo critico de expediente y documentos, pero todavia no implementa de forma completa:

- SSO corporativo,
- ajustes manuales de coste/herencia/transferencia y trazabilidad de bloqueo de perdidas,
- editor de revisión con trazabilidad por celda/caja estable sobre el documento fuente,
- patrimonio y no cotizadas,
- configuracion de plantillas y reglas como modulo de negocio.

La referencia de alcance consolidado es `docs/BASELINE_FUNCIONAL_2026-03-06.md`.
