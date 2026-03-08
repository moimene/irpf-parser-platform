# Matriz de Trazabilidad PRD -> Implementacion

Referencia principal de estado consolidado: `docs/BASELINE_FUNCIONAL_2026-03-06.md`

## Estado operativo actual

- App pública estabilizada en `main@5db75d8` y desplegada en `https://web-tan-mu-35.vercel.app`.
- El perímetro estable de esta iteración es la web: auth, expediente, review, export y registro canónico editable.
- El parser queda conscientemente fuera de esta estabilización; su revisión funcional profunda se hará en otra conversación y no debe mezclar cambios con la web pública mientras no cierre esa auditoría.

## Componentes PRD

- **Extractor OCR Adaptativo**
  - Implementado: `services/parser/app/parser_engine.py`
  - Estado: `structured_document` operativo, `CSV/XLSX` determinista, `PDF` estructurado y fallback semantico + revision manual
  - Gap actual: falta la auditoria funcional profunda del parser y el cierre de OCR real / `DOCX` / `IMAGE` con backend documental mas rico

- **Motor de Reglas**
  - Implementado: `packages/rules/src/index.ts`, `apps/web/lib/rules/validation.ts`
  - Estado: recompras 2/12 meses + runtime FIFO con lotes, asignaciones de venta, perdidas bloqueadas y ajustes manuales persistidos

- **Operativa de despacho**
  - Implementado: `apps/web/app/clientes`, `apps/web/app/configuracion`, `apps/web/lib/auth.ts`
  - Estado: clientes, expedientes, auth real, RBAC base, migracion al schema moderno, auditoria funcional de accesos e invitaciones/onboarding ya estan vivos
  - Gap actual: faltan gobierno corporativo completo y SSO corporativo

- **Integrador RM / no cotizadas**
  - Implementado: base canonica en `infra/supabase/migrations/20260307210000_irpf_canonical_asset_registry.sql`
  - Estado: el runtime ya soporta valores cotizados/no cotizados, IIC, seguros, inmuebles y bienes muebles; parser, review y expediente ya proyectan y editan ese registro manualmente, y el modelo `100` ya consume eventos canónicos de valores/IIC cuando existen

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
- `GET|PUT /api/expedientes/:id/canonical` -> implementada
- `POST|PATCH|DELETE /api/expedientes/:id/assets*` -> implementada
- `POST|PATCH|DELETE /api/expedientes/:id/fiscal-events*` -> implementada

## Historias criticas cubiertas

- HU-001 (ingesta multiple hasta 20): cubierta por validacion API + E2E
- HU-005 (navegacion por clientes/expedientes): cubierta
- HU-009/012 (previsualizacion/generacion): cubierta por `ExportGenerator`
- HU-014 (alertas): cubierta por `review` + `alerts`
- HU-008 (perdidas bloqueadas): cubierta en motor de reglas base + runtime de expediente + preview modelo 100
- HU-operativa-01 (login real y acceso por rol): cubierta en slice inicial de auth
- HU-operativa-02 (seleccion explicita de cliente en intake): cubierta en UI + API + E2E

## Gaps explicitos para proxima iteracion

1. Auditoria funcional profunda del parser sobre corpus real antes de tocar Railway producción
2. OCR real sobre PDF escaneado / imagen / `DOCX` y backend documental mas rico para `structured_document`
3. Cierre fiscal explicable y overrides avanzados sobre el runtime fiscal ya persistido
4. Integracion oficial BOE y Registro Mercantil
5. Export AEAT plenamente conforme por modelo y ejercicio usando el registro canonico como fuente de verdad mas alla del cierre base ya operativo en `100`
6. SSO corporativo y gobierno operativo completo
7. Trazabilidad estable de revision por celda/bbox y provenance auditable
8. Patrimonio y configuracion como modulos completos de despacho
