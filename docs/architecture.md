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
- API `GET /api/review`, `GET /api/review/:extraction_id`, `PATCH /api/review/:extraction_id`
- API `GET /api/dashboard`, `GET /api/extractions`
- UI real: dashboard, clientes, ficha de cliente, expediente y workspace de revision manual editable
- Rutas heredadas `/login` y `/configuracion` solo como compatibilidad minima

## Capa Railway (`services/parser`)

- `POST /parse-document`
- Estrategia: plantilla conocida -> extracción determinista desde `structured_document` -> fallback semántico -> revisión manual
- Soporte inicial entidades: Pictet, Goldman Sachs, Citi
- Contrato actual:
  - `source_type` ya viaja desde intake hasta el parser.
  - `POST /parse-document` devuelve `structured_document` persistible junto al resultado canónico.
  - `XLSX` y `CSV` ya entran por parser determinista.
  - `PDF` ya genera una primera capa `structured_document` con texto y tablas vía `pdfplumber`.
  - `DOCX` e imagen quedan aceptados a nivel de contrato, pero todavía degradan a revisión manual mientras no exista OCR/Docling operativo.
- Siguiente endurecimiento ya decidido:
  - `Docling` como candidato para `PDF/DOCX/IMAGE` en la capa documental por OCR, tablas y representación estructurada.
  - El LLM debe quedar restringido a clasificación semántica y mapping de columnas/campos dentro de un schema cerrado.

## Capa Supabase runtime (`infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`, `infra/supabase/migrations/20260306130000_reconcile_irpf_operations.sql`, `infra/supabase/migrations/20260306140000_clients_runtime_module.sql`, `infra/supabase/migrations/20260307134212_irpf_fiscal_adjustments_runtime_module.sql`, `infra/supabase/migrations/20260307160000_irpf_lots_runtime_module.sql`, `infra/supabase/migrations/20260307170000_irpf_sale_allocations_runtime_module.sql`, `infra/supabase/migrations/20260307210000_irpf_canonical_asset_registry.sql`)

- Tablas runtime operativas: `irpf_clients`, `irpf_expedientes`, `irpf_documents`, `irpf_extractions`, `irpf_operations`, `irpf_fiscal_adjustments`, `irpf_lots`, `irpf_sale_allocations`, `irpf_alerts`, `irpf_exports`, `irpf_audit_log`
- Registro canonico de dominio introducido para `714`/`720`/`IP`: `irpf_declaration_profiles`, `irpf_asset_registry`, `irpf_asset_accounts`, `irpf_asset_securities`, `irpf_asset_collective_investments`, `irpf_asset_insurances`, `irpf_asset_real_estate`, `irpf_asset_movable_goods`, `irpf_asset_fiscal_events`
- Catalogos maestros nuevos: pais, situacion del bien, territorio fiscal, condicion del declarante, tipo/subclave de bien, origen, identificacion/representacion, tipo de inmueble y tipo de bien mueble
- El esquema rico inicial de `0001_init.sql` existe como antecedente de diseño, pero no es la base operativa actual

## Decision de dominio

- `irpf_operations` sigue siendo el runtime vigente para IRPF transaccional y el cierre FIFO ya desplegado.
- `irpf_operations` no es ya la abstraccion objetivo para `714`, `720`, `IP` ni patrimonio general.
- El modelo canonico correcto pasa a ser:
  - perfil de declaracion,
  - registro de bienes y derechos,
  - tablas especificas por tipologia,
  - y eventos fiscales de rendimientos/transmisiones/retenciones.
- Las `entity templates` dejan de ser modelo de negocio; son solo adapters de extraccion.
- `714` y `720` deben leer del registro canonico y solo mantener fallback temporal a `irpf_operations` mientras se migra la captura.

## Capa n8n (`infra/n8n/workflows/irpf-parser-orchestration.json`)

- Eventos: `parse.started`, `parse.completed`, `parse.failed`, `manual.review.required`
- Router por evento y feedback hacia API Vercel

## Contratos

- `packages/contracts`: tipos de intake/parse/event/export
- `packages/rules`: recompras 2/12 meses y asignación FIFO

## Restriccion importante

La arquitectura actual consolida el flujo critico de expediente y documentos, pero todavia no implementa de forma completa:

- SSO corporativo,
- trazabilidad por celda/caja estable sobre el documento fuente,
- patrimonio y no cotizadas,
- configuracion de plantillas y reglas como modulo de negocio.

Nuevo matiz vigente:

- patrimonio, no cotizadas, seguros, inmuebles y bienes muebles ya tienen base de persistencia canonica,
- pero el parser y la UI todavia no vuelcan de forma nativa sobre ese registro en produccion.

La capa de revision manual ya no es solo una cola:

- `GET /api/review` lista documentos pendientes junto al ultimo `extraction_id` y metadatos de parsing.
- `GET /api/review/:extraction_id` devuelve records y `structured_document` normalizados para edicion.
- `PATCH /api/review/:extraction_id` soporta guardar borrador (`request_correction`) o aprobar/rechazar persistiendo correcciones sobre `normalized_payload.records`.
- `apps/web/components/review-board.tsx` renderiza seleccion de documento, editor por registro/campo y visor lateral del `structured_document`.
- `POST /api/documents/intake` y `PATCH /api/review/:extraction_id` proyectan ya `records` a `asset_records` y `fiscal_events`, y persisten esa capa en `irpf_asset_registry` e `irpf_asset_fiscal_events` cuando el documento queda aceptado.

Limitacion vigente de esta capa:

- la UI ya es operativa para editar,
- pero la procedencia sigue anclada a `source_spans` con `page/start/end/snippet`,
- no a celdas o bounding boxes estables del backend documental.

La trazabilidad de perdidas bloqueadas ya forma parte del runtime operativo:

- `apps/web/lib/lots.ts` deriva alertas `fiscal.blocked_loss` al recalcular `irpf_lots` e `irpf_sale_allocations`,
- `GET /api/expedientes/:id` expone el detalle `venta -> compra bloqueante`,
- `GET /api/exports/:expediente_id?model=100` incluye el detalle en la previsualizacion de validacion,
- y la cola de `review` consume esas alertas a traves de `irpf_alerts`.

Los ajustes manuales ya forman parte del runtime operativo:

- `POST|GET /api/expedientes/:id/adjustments` y `PATCH|DELETE /api/expedientes/:id/adjustments/:adjustment_id` persisten correcciones de coste, herencias y transferencias.
- `apps/web/lib/lots.ts` integra esos ajustes antes de recalcular lotes, asignaciones FIFO, perdidas bloqueadas e incidencias de runtime.
- `GET /api/expedientes/:id` expone `adjustments`, `runtime_issues` y el efecto agregado en lotes y resumen fiscal.
- `GET /api/exports/:expediente_id?model=100` y `/download` validan el modelo 100 contra ese runtime ya ajustado.

La referencia de alcance consolidado es `docs/BASELINE_FUNCIONAL_2026-03-06.md`.
