# Baseline Funcional 2026-03-07

## Proposito

Este documento fija el estado real de la plataforma tras la estabilizacion del flujo critico, la puesta en produccion de `auth` real y la consolidacion de la primera slice de `operativa de despacho`.

La PRD original sigue siendo la referencia de vision de producto, pero la fuente de verdad de runtime es:

1. Este documento.
2. El codigo del repositorio.
3. La verificacion tecnica ejecutada contra produccion.

## Estado live verificado

Verificado el 2026-03-07:

- Web produccion: `https://web-tan-mu-35.vercel.app`
- Parser produccion: `https://parser-production-0827.up.railway.app`
- `GET /health` del parser responde `version: 0.2.0`
- La web exige sesion real y `GET /api/session` devuelve `401` sin autenticar
- La suite E2E productiva pasa `3/3` sobre login, navegacion, upload, intake, review y export

## Que es hoy la plataforma

Hoy la plataforma es un `MVP operativo asistido` con estas capacidades reales:

- Login real sobre Supabase Auth.
- Resolucion de perfil persistente de despacho y permisos por rol.
- Consola web con dashboard, clientes, expediente, review y configuracion.
- Alta de clientes, ficha operativa de cliente y creacion de expedientes vinculados.
- Administracion basica de usuarios y asignaciones cliente-usuario.
- Ingesta de documentos sobre expediente con cliente asociado.
- Subida segura a Supabase Storage y encolado de parseo.
- Parseo automatico con plantillas para `Pictet`, `Goldman Sachs` y `Citi`.
- Fallback semantico y escalado a revision manual.
- Persistencia de documentos, extracciones, operaciones, exportaciones y auditoria tecnica.
- Revision manual con aprobacion o rechazo.
- Generacion y descarga de artefactos AEAT base para `100`, `714` y `720`.

No es todavia una plataforma completa de campana fiscal para despacho.

## Runtime efectivo

### Aplicaciones y servicios

- `apps/web`: consola y APIs App Router.
- `services/parser`: microservicio FastAPI.
- `infra/n8n`: workflow de eventos `parse.*`.
- `infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`: schema runtime base `irpf_*`.

### Flujos validados hoy

- `GET /api/session`
- `GET /api/dashboard`
- `GET /api/clientes`
- `GET /api/clientes/[id]`
- `POST /api/clientes`
- `POST /api/expedientes`
- `GET /api/expedientes/[id]`
- `POST /api/documents/upload-urls`
- `POST /api/documents/intake`
- `GET /api/review`
- `GET /api/review/[extraction_id]`
- `PATCH /api/review/[extraction_id]`
- `GET /api/extractions`
- `GET /api/exports/[expediente_id]`
- `GET /api/exports/[expediente_id]/download`
- `POST /api/access`
- `POST /api/access/users`
- `PATCH /api/access/users/[id]`
- `PATCH /api/access/assignments/[id]`
- `DELETE /api/access/assignments/[id]`
- `POST /api/webhooks/parse-event`
- `POST /parse-document`

### E2E actual

La suite E2E cubre:

- login real y navegacion base,
- upload UI con signed URLs,
- ciclo `intake -> review -> export -> download`.

## Estado por bloque funcional

| Bloque PRD | Estado real | Evidencia principal | Comentario |
| --- | --- | --- | --- |
| Ingesta documental | Implementado | `apps/web/app/api/documents/intake/route.ts` | Flujo productivo operativo con cliente asociado. |
| Subida segura a storage | Implementado | `apps/web/app/api/documents/upload-urls/route.ts` | Operativa valida con signed URLs. |
| Parser por entidad | Parcial | `services/parser/app/parser_engine.py` | Cobertura real: `Pictet`, `Goldman Sachs`, `Citi`. |
| OCR / imagen / Excel | No completo | `services/parser/app/parser_engine.py` | Runtime real sigue centrado en PDF/texto. |
| Revision manual | Implementado parcial | `apps/web/app/api/review/[extraction_id]/route.ts`, `apps/web/components/review-board.tsx` | Existe ya edicion real por record/campo y visor de `structured_document`; sigue faltando trazabilidad estable por celda/bbox. |
| Expediente operativo | Implementado | `apps/web/app/api/expedientes/[id]/route.ts` | Estado, cliente, documentos, exportes. |
| Dashboard operativo | Implementado | `apps/web/app/api/dashboard/route.ts` | Metricas base de operacion. |
| Motor fiscal IRPF | Parcial avanzada | `apps/web/lib/rules/validation.ts`, `packages/rules/src/index.ts`, `apps/web/lib/lots.ts`, `apps/web/lib/fiscal-adjustments.ts` | Runtime fiscal con lotes, asignaciones FIFO, pérdidas bloqueadas y ajustes manuales persistidos; falta cierre de dominio completo y modulos fiscales posteriores. |
| Lotes de adquisicion | Implementado | `infra/supabase/migrations/20260307160000_irpf_lots_runtime_module.sql`, `infra/supabase/migrations/20260307134212_irpf_fiscal_adjustments_runtime_module.sql`, `apps/web/lib/lots.ts` | Runtime derivado por expediente con FIFO, transferencias de salida y adquisiciones manuales; queda pendiente el cierre fiscal completo y patrimonio. |
| Patrimonio / IP | Base canonica introducida | `infra/supabase/migrations/20260307210000_irpf_canonical_asset_registry.sql`, `apps/web/lib/asset-registry.ts`, `apps/web/lib/aeat/format.ts` | Existe ya registro canonico de bienes/derechos y eventos fiscales; sigue faltando que parser y UI operen nativamente sobre el modulo. |
| Modelo 720 | Base canonica introducida | `infra/supabase/migrations/20260307210000_irpf_canonical_asset_registry.sql`, `apps/web/lib/aeat/format.ts` | El export deja de depender conceptualmente de `irpf_operations`, pero aun mantiene fallback hasta migrar la captura. |
| Clientes y ficha cliente | Implementado | `apps/web/app/clientes/page.tsx`, `apps/web/app/clientes/[id]/page.tsx` | Alta, ficha, expedientes y equipo asignado. |
| Configuracion / acceso | Implementado en slice inicial | `apps/web/app/configuracion/page.tsx` | Admin de usuarios y asignaciones, no modulo completo de gobierno. |
| Auth real de despacho | Implementado en slice inicial | `apps/web/lib/auth.ts`, `apps/web/middleware.ts` | Supabase Auth + perfiles persistentes + permisos por rol. |
| RBAC por asignacion | Implementado de forma basica | `apps/web/lib/auth.ts`, `apps/web/lib/access-store.ts` | Scope por cliente y expediente, sin gobierno corporativo completo. |
| SSO corporativo | No implementado | Runtime actual | No hay SAML/OIDC corporativo. |
| BOE / Registro Mercantil | No implementado | `docs/prd-traceability.md` | Gap explicito. |
| Cruces AEAT 189/198 | No implementado | PRD original | No existe flujo runtime. |

## Realidad de datos que debe asumirse

La produccion viva no esta todavia totalmente alineada con el modelo moderno local. El codigo soporta dos realidades:

### Modelo moderno local

- `irpf_users`
- `irpf_user_client_assignments`
- `irpf_clients` con `reference`, `display_name`, `status`, `metadata`

### Modelo legacy actualmente presente en Supabase produccion

- `irpf_abogados`
- `irpf_asignaciones`
- `irpf_clients` con forma legacy

La aplicacion resuelve esta deriva mediante capas de compatibilidad en:

- `apps/web/lib/access-store.ts`
- `apps/web/lib/client-store.ts`

Esto permite operar en produccion hoy, pero no debe considerarse arquitectura objetivo.

## Restricciones actuales

1. La compatibilidad de acceso soporta schema legacy y moderno, pero la persistencia de asignacion de rol por cliente sigue limitada por el schema legacy.
2. La asociacion cliente-expediente es obligatoria para intake. Si el expediente no la tiene, la UI ahora exige seleccion explicita del cliente.
3. La plataforma usa auth real, pero todavia no persiste una relacion fuerte `auth.users.id -> perfil de despacho` en schema runtime moderno.
4. `714` y `720` ya tienen base de dominio canonica, pero no son todavia una solucion fiscal cerrada ni una captura operativa completa.
5. El parser no debe venderse como OCR generalista ni como cobertura abierta de entidades.
6. `Configuracion` es ya un modulo vivo, pero no cubre todavia plantillas, catalogos, reglas ni gobierno funcional completo.
7. `Docling` encaja como capa futura de `document-understanding`, no como modelo fiscal ni como reemplazo de reglas/exports deterministas.

## Principios para construir a partir de esta base

1. Mantener el flujo critico ya validado en produccion.
2. No introducir nuevas pantallas sin contrato API, persistencia y E2E.
3. No reabrir la deriva entre repo, produccion y documentacion.
4. Toda nueva funcionalidad de dominio debe aterrizar sobre `cliente -> expediente -> documento -> extraccion -> operacion -> exportacion`.
5. Build verde y E2E verde deben seguir significando estado real, no maquillaje.

## Orden recomendado de construccion

### Track 1. Operativa de despacho

Ya construido:

- clientes,
- expedientes vinculados,
- auth real,
- RBAC base,
- admin de acceso,
- intake con cliente explicito.

Siguiente foco de este track:

- relacion fuerte con `auth.users.id`,
- invitacion/alta controlada de usuarios,
- password reset y flujo de onboarding,
- eliminacion del fallback legacy cuando exista migracion de datos.

### Track 2. Modelo fiscal IRPF

Ya construido en esta primera slice:

- Persistencia rica de operaciones en `irpf_operations`.
- Lotes de adquisicion en runtime sobre `irpf_lots`.
- Vista de operaciones y lotes en `GET /api/expedientes/[id]` y en la ficha de expediente.
- Asignaciones `venta -> lote` en `irpf_sale_allocations`.
- Vista de ganancias/perdidas con coste fiscal consumido y ganancia/pérdida calculada por venta.

Siguiente foco del track:

- Cierre fiscal explicable sobre el runtime ya persistido.
- Trazabilidad estable al origen estructurado para que la revision no dependa de snippets por substring.
- Patrimonio/IP y AEAT completa como siguientes modulos de dominio.

### Track 2b. Endurecimiento parser y review

- Separar `structured_document` de `canonical_records`.
- `XLSX/CSV` por parseo determinista.
- `PDF/DOCX/IMAGE` con capa estructurada candidata en `Docling`.
- LLM solo para mapping semantico a schema cerrado.
- Review ya editable por record/campo sobre `structured_document`.
- Siguiente hueco: provenance estable por pagina/tabla/fila/celda o bbox.

### Track 3. Patrimonio e IP

- Registro canonico de bienes/derechos ya introducido.
- Falta volcar parser y UI sobre cuentas, valores cotizados/no cotizados, IIC, seguros, inmuebles y bienes muebles.
- Tipos de cambio.
- Saldos medios del ultimo trimestre.
- Modulo especifico de patrimonio.
- No cotizadas con entrada manual y luego integracion externa.

### Track 4. Modelo 720

- Identificacion por bloque de bien ya aterrizada en el schema canonico.
- Falta capturar y validar todas las claves/subclaves desde parser/review.
- Umbrales de declaracion.
- Pais, titularidad y comparativa interanual.
- Vista previa funcional antes de exportar.

## Actualizacion 2026-03-07 modelo canonico de bienes y derechos

- Se introduce `infra/supabase/migrations/20260307210000_irpf_canonical_asset_registry.sql` con:
  - catalogos maestros de pais, situacion, territorio fiscal, condicion declarante, tipo/subclave de bien, origen y representacion,
  - `irpf_declaration_profiles` como cabecera fiscal por expediente,
  - `irpf_asset_registry` como registro canonico comun,
  - tablas especificas para cuentas, valores, IIC, seguros, inmuebles y bienes muebles,
  - e `irpf_asset_fiscal_events` para intereses, dividendos, rentas, transmisiones, ganancias/perdidas y retenciones.
- `apps/web/lib/asset-registry.ts` define ya el contrato canonico de activos y eventos fiscales.
- `apps/web/lib/contracts.ts`, `packages/contracts/src/index.ts` y `services/parser/app/schemas.py` abren el contrato de parseo para `asset_records` y `fiscal_events`.
- `apps/web/app/api/exports/[expediente_id]/route.ts` y `/download` ya quedan preparados para leer `714` y `720` desde `irpf_asset_registry` cuando exista informacion canonica, manteniendo fallback temporal a `irpf_operations`.
- `apps/web/lib/aeat/format.ts` añade generadores `generateModel714FromAssets` y `generateModel720FromAssets` para que el export AEAT deje de ser solo una serializacion de operaciones.

### Track 5. Administracion y trazabilidad

- Plantillas de extraccion.
- Reglas configurables.
- Auditoria funcional.
- Tipos de cambio y catalogos.
- Alertas accionables y cierre documentado.

### Track 6. Integraciones externas

- BOE.
- Registro Mercantil.
- Cruces 189/198.
- Validacion AEAT.

## Definition of done para nuevas iteraciones

Cada bloque nuevo se considera consolidado solo si cumple estos cuatro puntos:

1. Persistencia estable en el modelo runtime.
2. UI utilizable por fiscalista, no solo endpoint.
3. E2E o integracion que cubra el flujo principal.
4. Documentacion actualizada en esta baseline y en la trazabilidad PRD.

## Actualizacion 2026-03-07 hardening review y contrato de operaciones

- `corrected_fields` ya no es solo metadata: al aprobar una extraccion se aplica sobre `normalized_payload.records` antes de reconstruir `irpf_operations`.
- Las ventas sin `realized_gain` informado dejan de persistirse con una ganancia inventada igual al importe de venta.
- La cobertura tecnica añade `apps/web/e2e/extraction-records.spec.ts` para blindar ambos contratos.
- Validacion ejecutada:
  - `npm run lint --workspace apps/web`
  - `npm run build --workspace apps/web`
  - `npm run typecheck --workspace apps/web`
  - `cd apps/web && set -a && source .env.local && set +a && npx playwright test` -> `9 passed`
- Despliegue a produccion actualizado el 2026-03-07: `https://web-tan-mu-35.vercel.app` desde `https://web-44c1ii0cb-moises-menendezs-projects.vercel.app`

## Actualizacion 2026-03-07 structured document y parser tabular

- La ingesta web ya clasifica `source_type` real para `PDF`, `CSV` y `XLSX`; el intake deja de forzar todo a PDF.
- El parser introduce una capa `structured_document` persistible y separa explícitamente:
  - documento estructurado,
  - records canónicos,
  - y fallback semántico.
- `CSV` y `XLSX` entran ya por vía determinista.
- `PDF` devuelve ya una primera estructura de texto y tablas con `pdfplumber`.
- `DOCX` e `IMAGE` quedan aceptados en contrato pero siguen degradando a revisión manual mientras no exista backend OCR/Docling operativo.
- La fase de parseo queda ahora:
  - plantilla conocida,
  - extracción determinista desde `structured_document`,
  - fallback LLM,
  - revisión manual.
- Cobertura añadida:
  - `apps/web/e2e/document-source.spec.ts`
  - `services/parser/tests/test_parser_engine.py` con casos `CSV` y `XLSX`
  - `services/parser/tests/test_extractors.py`
- Validacion ejecutada:
  - `npm run lint --workspace apps/web`
  - `npm run typecheck --workspace apps/web`
  - `npm run build --workspace apps/web`
  - `cd services/parser && uv run pytest tests/test_parser_engine.py tests/test_extractors.py` -> `7 passed`
  - `cd apps/web && set -a && source .env.local && set +a && npx playwright test` -> `11 passed`
- Despliegue ejecutado:
  - parser Railway en produccion con deployment `6305dfb2-7992-4578-9e44-824a1ffe0920`
  - health de parser verificada en `https://parser-production-0827.up.railway.app/health` con `version = 0.3.0`
  - web productiva actualizada el 2026-03-07 desde `https://web-jehea286b-moises-menendezs-projects.vercel.app`
- alias publico vigente: `https://web-tan-mu-35.vercel.app`

## Actualizacion 2026-03-07 perdidas bloqueadas operables

- `apps/web/lib/lots.ts` deriva ya `blockedLosses` desde el runtime fiscal y sincroniza alertas abiertas `fiscal.blocked_loss` en `irpf_alerts` al recalcular el expediente.
- `apps/web/app/api/expedientes/[id]/route.ts` expone el detalle `venta -> compra bloqueante` y el contador de perdidas bloqueadas dentro del payload del expediente.
- `apps/web/components/expediente-summary.tsx` muestra una seccion operativa de perdidas bloqueadas por recompra junto con el detalle de venta, recompra, perdida estimada y ventana 2 meses.
- `apps/web/app/api/exports/[expediente_id]/route.ts` y `apps/web/components/export-generator.tsx` añaden la misma trazabilidad a la previsualizacion del modelo 100; la descarga sigue permitida como `warning`, no como `error`.
- La cola de `review` pasa a recibir estas alertas desde `irpf_alerts` sin cambios adicionales en UI ni en dashboard.
- Cobertura añadida:
  - `apps/web/e2e/lots-runtime.spec.ts` valida la deteccion de perdida bloqueada por recompra y su estado `warnings` en el modelo 100.
- Validacion ejecutada:
  - `npm run typecheck --workspace apps/web`
  - `npm run lint --workspace apps/web`
  - `npm run build --workspace apps/web`
  - `cd apps/web && E2E_BASE_URL=http://127.0.0.1:3102 npx playwright test` -> `12 passed`

## Actualizacion 2026-03-07 slice ajustes fiscales manuales

- `infra/supabase/migrations/20260307134212_irpf_fiscal_adjustments_runtime_module.sql` crea `irpf_fiscal_adjustments` como tabla runtime para coste, herencia y transferencias.
- `apps/web/app/api/expedientes/[id]/adjustments/route.ts` y `apps/web/app/api/expedientes/[id]/adjustments/[adjustment_id]/route.ts` exponen CRUD real para ajustes fiscales del expediente.
- `apps/web/lib/lots.ts` incorpora los ajustes al orden de recálculo fiscal:
  - corrige compras existentes,
  - genera adquisiciones manuales,
  - permite transferencias de salida sin venta fiscal,
  - y vuelve a emitir incidencias `fiscal.adjustment` junto al resto del runtime.
- `apps/web/components/fiscal-adjustments-workspace.tsx` añade la UI operativa de alta y borrado de ajustes.
- `apps/web/app/api/expedientes/[id]/route.ts`, `apps/web/components/expediente-summary.tsx`, `apps/web/app/api/exports/[expediente_id]/route.ts`, `apps/web/app/api/exports/[expediente_id]/download/route.ts` y `apps/web/components/export-generator.tsx` muestran y validan ya el impacto de los ajustes en expediente y modelo 100.
- `apps/web/e2e/critical-flows.spec.ts`, `apps/web/e2e/lots-runtime.spec.ts` y `apps/web/playwright.config.ts` endurecen la capa de pruebas:
  - herencia manual desde UI,
  - coste/herencia/transferencia sobre runtime,
  - y Playwright serial en entornos `E2E_BASE_URL` para evitar contencion artificial.
- Supabase remoto quedo alineado el 2026-03-07 con esta migracion; el historial remoto la registra como `20260307134212`.
- Verificacion ejecutada:
  - `npm run typecheck --workspace apps/web`
  - `npm run lint --workspace apps/web`
  - `npm run build --workspace apps/web`
- `cd apps/web && E2E_BASE_URL=http://127.0.0.1:3104 npx playwright test` -> `15 passed`

## Actualizacion 2026-03-08 review editable sobre structured_document

- `apps/web/app/api/review/route.ts` devuelve ya el ultimo `extraction_id` y metadatos de parsing por documento pendiente para que la cola pueda abrir el detalle real de revision.
- `apps/web/app/api/review/[extraction_id]/route.ts` expone `GET` de detalle y admite guardar borradores con `request_correction` persistiendo `corrected_fields` en `normalized_payload.records`.
- `apps/web/lib/review-editor.ts` fija el contrato de la capa editorial:
  - normalizacion de `records`,
  - normalizacion de `structured_document`,
  - payload de correccion reusable,
  - y utilidades para relacionar registros con paginas y filas tabulares.
- `apps/web/components/review-board.tsx` pasa a ser un workspace editable:
  - seleccion de documento,
  - edicion de tipo/fields por registro,
  - guardado de borrador,
  - aprobacion con persistencia,
  - y panel lateral con paginas, tablas y snippets del `structured_document`.
- La deuda cambia de sitio:
  - la edicion real ya existe,
  - pero `source_spans` siguen siendo `page/start/end/snippet` y no referencias estables a celda o bbox.
- Cobertura añadida:
  - `apps/web/e2e/review-editor.spec.ts`
  - ampliacion de `apps/web/e2e/critical-flows.spec.ts` para editar y aprobar una compra CSV de baja confianza.
- Verificacion ejecutada:
  - `npm run typecheck --workspace apps/web`
  - `npm run lint --workspace apps/web`
  - `npm run build --workspace apps/web`
  - `cd apps/web && npx playwright test e2e/review-editor.spec.ts` -> `3 passed`
  - `cd apps/web && npx playwright test` -> `13 passed, 6 skipped`
- Esta slice queda cerrada en codigo y documentacion; falta merge/deploy si se quiere alinear produccion con este estado.

## Decision de gobierno

Mientras no se reemplace explicitamente, esta baseline debe tratarse como la referencia de:

- alcance realmente construido,
- limites del MVP,
- prioridades de roadmap,
- y criterio para aceptar o rechazar claims de funcionalidad implementada.

## Actualizacion 2026-03-07 auth despacho

Esta actualizacion cierra el track de migracion de auth de despacho a nivel de datos y de codigo de repo, con estos hechos ya ejecutados:

- Supabase recibio la migracion `infra/supabase/migrations/20260307100000_finalize_dispatch_auth_migration.sql`.
- `irpf_users` dispone ya de `auth_user_id` persistente como contrato fuerte con `auth.users.id`.
- El backfill migra perfiles desde `irpf_abogados` y asignaciones desde `irpf_asignaciones` al schema moderno.
- `irpf_clients` queda alineada con el shape moderno usado por runtime (`reference`, `display_name`, `status`, `metadata`).
- El codigo de `apps/web/lib/access-store.ts` y `apps/web/lib/client-store.ts` deja de depender de fallback legacy.

Estado de despliegue a fecha 2026-03-07:

- La base de datos remota ya esta migrada.
- La web publica vigente sigue siendo `https://web-tan-mu-35.vercel.app`.
- El deployment nuevo de web esta publicado como preview en `https://web-89q5bgnxu-moises-menendezs-projects.vercel.app`.
- Esa preview esta protegida por `Vercel Authentication`, por lo que la validacion remota se hizo con `vercel curl`.
- La promocion a `production` de la web no se ha ejecutado aun en este hilo.

Validacion ejecutada:

- `npm run typecheck --workspace apps/web`
- `npm run lint --workspace apps/web`
- `npm run build --workspace apps/web`
- `E2E_BASE_URL=https://web-tan-mu-35.vercel.app npm run test:e2e --workspace apps/web` -> `4 passed`
- `vercel curl` sobre la preview confirmando `GET /login` y `GET /api/session` con respuesta coherente tras cargar envs de preview.

## Actualizacion 2026-03-07 onboarding despacho

Esta actualizacion cierra Fase 1 de operativa de despacho a nivel de producto con estos hechos ya ejecutados:

- El alta de usuario de despacho pasa a invitacion segura sin contraseña inicial compartida.
- Existe regeneracion administrada de onboarding y reset password sobre Supabase Auth.
- El primer acceso se resuelve en `apps/web/app/onboarding/page.tsx` consumiendo la sesion real desde el hash del enlace seguro.
- La consola de accesos muestra estado de onboarding y enlace operativo para administracion.
- La suite critica de `apps/web/e2e/critical-flows.spec.ts` cubre ya el flujo admin -> invitacion -> onboarding -> sesion real.

Validacion ejecutada al cierre:

- `npm run typecheck --workspace apps/web`
- `npm run lint --workspace apps/web`
- `npm run build --workspace apps/web`
- `cd apps/web && set -a && source .env.local && set +a && npx playwright test` -> `5 passed`
- Preview verificada: `https://web-cun07csx9-moises-menendezs-projects.vercel.app`

## Actualizacion 2026-03-07 fase 2 slice lotes runtime

Esta actualizacion abre Fase 2 con una primera slice vertical ya operativa en runtime:

- `irpf_operations` persiste `description`, `amount`, `currency` y `retention`, y acepta `POSICION`.
- `irpf_lots` existe ya como tabla derivada por expediente mediante `infra/supabase/migrations/20260307160000_irpf_lots_runtime_module.sql`.
- `apps/web/lib/lots.ts` recalcula lotes FIFO basicos tras intake automatico y review aprobada.
- `GET /api/expedientes/[id]` devuelve ya `operations` y `lots`.
- La ficha de expediente muestra tablas de operaciones fiscales y lotes de adquisicion.

Hecho operativo importante de despliegue:

- Supabase remoto requirio tambien aplicar `infra/supabase/migrations/20260306130000_reconcile_irpf_operations.sql`, porque las columnas reconciliadas de `irpf_operations` todavia no estaban presentes en produccion.

Validacion ejecutada:

- `npm run lint --workspace apps/web`
- `npm run build --workspace apps/web`
- `npm run typecheck --workspace apps/web`
- `cd apps/web && set -a && source .env.local && set +a && npx playwright test` -> `6 passed`

## Actualizacion 2026-03-07 fase 2 slice asignaciones FIFO

Esta actualizacion profundiza la Fase 2 sobre el runtime ya desplegado:

- `irpf_sale_allocations` persiste el consumo FIFO de cada venta contra sus lotes de adquisicion.
- El expediente devuelve y muestra ya un resumen fiscal por venta con:
  - cantidad asignada,
  - cantidad pendiente,
  - coste fiscal consumido,
  - ganancia/pérdida calculada,
  - y estado del cuadre.
- La validacion de `GET /api/exports/[expediente_id]?model=100` usa el runtime fiscal persistido para marcar errores cuando una venta no esta cuadrada o no tiene coste fiscal.
- La descarga del modelo 100 se alimenta del resumen fiscal de ventas en vez del `realized_gain` crudo de origen.
- La descarga queda bloqueada cuando la validacion fiscal devuelve errores.

Validacion ejecutada:

- `npm run lint --workspace apps/web`
- `npm run build --workspace apps/web`
- `npm run typecheck --workspace apps/web`
- `cd apps/web && set -a && source .env.local && set +a && npx playwright test` -> `7 passed`
- Despliegue a produccion actualizado el 2026-03-07: `https://web-tan-mu-35.vercel.app` desde `https://web-ceaw42msf-moises-menendezs-projects.vercel.app`
- Despliegue a produccion actualizado el 2026-03-07: `https://web-tan-mu-35.vercel.app` desde `https://web-g45hhkd5i-moises-menendezs-projects.vercel.app`
- `vercel curl` post-deploy sobre `/login` y `/api/session` coherente sin sesion
