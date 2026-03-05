# Matriz de Trazabilidad PRD -> Implementación

## Componentes PRD

- **Extractor OCR Adaptativo**
  - Implementado: `services/parser/app/parser_engine.py`
  - Estado: baseline con plantillas + fallback semántico

- **Motor de Reglas**
  - Implementado: `packages/rules/src/index.ts`, `apps/web/lib/rules/validation.ts`
  - Estado: recompras 2/12 meses + FIFO inicial

- **Integrador RM / no cotizadas**
  - Implementado: esquema de datos en `infra/supabase/migrations/0001_init.sql`
  - Estado: pendiente lógica de ingestión de fuente externa

## APIs requeridas

- `POST /api/documents/intake` -> implementada
- `POST /parse-document` -> implementada
- Webhooks n8n `parse.*` -> implementados (workflow + endpoint receptor)
- `GET /api/exports/:expediente_id?model=100|714|720` -> implementada

## Historias críticas cubiertas

- HU-001 (ingesta múltiple hasta 20): cubierta por validación API + e2e
- HU-009/012 (previsualización/generación): cubierta por `ExportGenerator`
- HU-014 (alertas): cubierta por `review` + `alerts`
- HU-008 (pérdidas bloqueadas): cubierta en motor de reglas base

## Gaps explícitos para próxima iteración

1. OCR real sobre PDF escaneado/imágenes (actualmente baseline textual)
2. Persistencia completa de operaciones/lotes desde respuesta parser
3. Integración oficial BOE y Registro Mercantil
4. Export binario AEAT real (`.100/.714/.720`) más allá de artefacto lógico
5. RBAC y SSO corporativo
