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
| Revision manual | Implementado | `apps/web/app/api/review/[extraction_id]/route.ts` | Aprobacion o rechazo funcional. |
| Expediente operativo | Implementado | `apps/web/app/api/expedientes/[id]/route.ts` | Estado, cliente, documentos, exportes. |
| Dashboard operativo | Implementado | `apps/web/app/api/dashboard/route.ts` | Metricas base de operacion. |
| Motor fiscal IRPF | Parcial | `apps/web/lib/rules/validation.ts`, `packages/rules/src/index.ts`, `apps/web/lib/lots.ts` | Runtime fiscal con lotes y asignaciones FIFO persistidas; faltan ajustes manuales y cierre de dominio completo. |
| Lotes de adquisicion | Implementado en slice inicial | `infra/supabase/migrations/20260307160000_irpf_lots_runtime_module.sql`, `apps/web/lib/lots.ts` | Runtime derivado por expediente con FIFO basico y vista en expediente; faltan ajustes manuales y cierre fiscal completo. |
| Patrimonio / IP | Parcial muy inicial | `apps/web/lib/aeat/format.ts` | Export base, no modulo fiscal completo. |
| Modelo 720 | Parcial muy inicial | `apps/web/lib/aeat/format.ts` | Export simplificado, no solucion completa. |
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
4. `714` y `720` existen como exportadores base, no como solucion fiscal cerrada.
5. El parser no debe venderse como OCR generalista ni como cobertura abierta de entidades.
6. `Configuracion` es ya un modulo vivo, pero no cubre todavia plantillas, catalogos, reglas ni gobierno funcional completo.

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

- Ajustes manuales de coste, herencia y transferencia.
- Bloqueos de perdidas con trazabilidad operativa.
- Vistas de ganancias/perdidas y cierre fiscal explicable.

### Track 3. Patrimonio e IP

- Cuentas, posiciones y valoracion a cierre.
- Tipos de cambio.
- Saldos medios del ultimo trimestre.
- Modulo especifico de patrimonio.
- No cotizadas con entrada manual y luego integracion externa.

### Track 4. Modelo 720

- Identificacion por bloque de bien.
- Umbrales de declaracion.
- Pais, titularidad y comparativa interanual.
- Vista previa funcional antes de exportar.

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
