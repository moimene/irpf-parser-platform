# Matriz de Trazabilidad PRD -> Implementacion

Referencia principal de estado consolidado: `docs/BASELINE_FUNCIONAL_2026-03-06.md`

## Componentes PRD

- **Extractor OCR Adaptativo**
  - Implementado: `services/parser/app/parser_engine.py`
  - Estado: baseline con plantillas por entidad + fallback semantico + revision manual
  - Gap actual: OCR real e ingesta completa de imagen/Excel siguen pendientes

- **Motor de Reglas**
  - Implementado: `packages/rules/src/index.ts`, `apps/web/lib/rules/validation.ts`
  - Estado: recompras 2/12 meses + runtime FIFO con lotes, asignaciones de venta, perdidas bloqueadas y ajustes manuales persistidos

- **Operativa de despacho**
  - Implementado: `apps/web/app/clientes`, `apps/web/app/configuracion`, `apps/web/lib/auth.ts`
  - Estado: clientes, expedientes, auth real, RBAC base, migracion al schema moderno, auditoria funcional de accesos e invitaciones/onboarding ya estan vivos
  - Gap actual: faltan gobierno corporativo completo y SSO corporativo

- **Integrador RM / no cotizadas**
  - Implementado: solo como antecedente de diseno en `infra/supabase/migrations/0001_init.sql`
  - Estado: no presente en runtime `irpf_*`

## APIs requeridas

- `GET /api/clientes` -> implementada
- `GET /api/clientes/:id` -> implementada
- `POST /api/clientes` -> implementada
- `POST /api/expedientes` -> implementada
- `GET /api/expedientes/:id` -> implementada
- `POST /api/documents/intake` -> implementada
- `POST /api/documents/upload-urls` -> implementada
- `GET /api/session` -> implementada
- `POST /parse-document` -> implementada
- Webhooks n8n `parse.*` -> implementados
- `GET /api/exports/:expediente_id?model=100|714|720` -> implementada
- `GET /api/review/:extraction_id` -> implementada
- `PATCH /api/review/:extraction_id` -> implementada
- `POST /api/access/users` -> implementada

## Historias criticas cubiertas

- HU-001 (ingesta multiple hasta 20): cubierta por validacion API + E2E
- HU-005 (navegacion por clientes/expedientes): cubierta
- HU-009/012 (previsualizacion/generacion): cubierta por `ExportGenerator`
- HU-014 (alertas): cubierta por `review` + `alerts`
- HU-008 (perdidas bloqueadas): cubierta en motor de reglas base + runtime de expediente + preview modelo 100
- HU-operativa-01 (login real y acceso por rol): cubierta en slice inicial de auth
- HU-operativa-02 (seleccion explicita de cliente en intake): cubierta en UI + API + E2E

## Gaps explicitos para proxima iteracion

1. OCR real sobre PDF escaneado / imagen / Excel y backend documental mas rico para `structured_document`
2. Cierre fiscal explicable y overrides avanzados sobre el runtime fiscal ya persistido
3. Integracion oficial BOE y Registro Mercantil
4. Export AEAT plenamente conforme por modelo y ejercicio
5. SSO corporativo y gobierno operativo completo
6. Trazabilidad estable de revision por celda/bbox y provenance auditable
7. Patrimonio y configuracion como modulos completos de despacho
