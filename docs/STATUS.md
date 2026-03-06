# Estado del proyecto — IRPF Parser Platform

**Fecha de actualización:** 2026-03-06  
**Commit de referencia:** `635bab7`  
**Versión:** 0.4.0-beta

Este documento describe el estado real de cada módulo del sistema, distinguiendo entre lo que está implementado y funcionando, lo que está implementado pero no verificado en producción, y lo que está pendiente.

---

## Resumen ejecutivo

| Módulo | Estado | Notas |
|---|---|---|
| Autenticación (Supabase Auth) | ✅ Funcionando | Login demo verificado en Vercel |
| Dashboard operativo | ✅ Funcionando | Métricas reales desde Supabase |
| Gestión de clientes | ✅ Funcionando | FAGU como primer cliente |
| Ficha de cliente + expedientes | ✅ Funcionando | Corrección de columnas aplicada (2026-03-06) |
| Ingesta de PDFs | ✅ Implementado | Requiere `SUPABASE_SERVICE_ROLE_KEY` en Vercel |
| Parseo automático | ⚠️ Parcial | Parser Railway activo; extractores por entidad son esqueletos |
| Cola de revisión manual | ✅ Implementado | UI funcional; aprobación de registros individuales pendiente |
| Exportación AEAT | ✅ Implementado | Modelos 100, 714, 720; descarga de artefactos pendiente |
| Patrimonio histórico FAGU | ✅ Funcionando | 26.161 registros en Supabase |
| Configuración de plantillas | ✅ Implementado | 4 plantillas bancarias pre-cargadas |
| n8n orquestación | ✅ Desplegado | Workflow activo en Railway |
| Tests e2e | ✅ Pasan | 2/2 en verde localmente |

---

## Estado detallado por módulo

### Capa de autenticación

**Archivos clave:** `apps/web/middleware.ts`, `apps/web/lib/supabase-auth.ts`, `apps/web/app/login/page.tsx`, `apps/web/app/api/auth/`

La autenticación está completamente implementada con Supabase Auth. El middleware de Next.js protege todas las rutas excepto `/login` y `/api/auth/callback`. La función `getAbogadoActual()` recupera el perfil del abogado autenticado desde `irpf_abogados` y lo inyecta en todas las rutas de API. El login con credenciales demo (`demo@irpf-parser.dev` / `Demo2025!`) está verificado en producción.

El usuario demo tiene rol `socio`, lo que le da acceso a todos los clientes sin restricciones de RLS. Las políticas RLS están definidas en la migración `20260306100000` pero solo cubren las tablas nuevas (clientes, abogados, asignaciones, patrimonio). Las tablas originales (`irpf_documents`, `irpf_expedientes`, etc.) no tienen RLS activo — todos los abogados autenticados pueden ver todos los expedientes.

**Deuda técnica:** Activar RLS en las tablas `irpf_documents`, `irpf_expedientes`, `irpf_extractions` y `irpf_operations` para aislamiento real por abogado/cliente (backlog B-10).

---

### Capa de datos (Supabase)

**Migraciones aplicadas:** 5 de 5

El schema de Supabase tiene 14 tablas activas en el namespace `irpf_*`:

| Tabla | Registros actuales | Descripción |
|---|---|---|
| `irpf_clients` | 1 (FAGU) | Clientes del despacho |
| `irpf_abogados` | 1 (demo) | Perfiles de abogados vinculados a `auth.users` |
| `irpf_asignaciones` | 1 | Asignaciones abogado-cliente |
| `irpf_expedientes` | 1 (FAGU-2025) | Expedientes por cliente y ejercicio |
| `irpf_documents` | 0 | Documentos PDF ingestados |
| `irpf_extractions` | 0 | Resultados del parser |
| `irpf_operations` | 0 | Operaciones fiscales validadas |
| `irpf_exports` | 0 | Artefactos AEAT generados |
| `irpf_audit_log` | ~50 | Eventos del sistema |
| `irpf_alerts` | 0 | Alertas de validación fiscal |
| `irpf_patrimonio` | 26.161 | Datos patrimoniales históricos de FAGU |
| `irpf_hojas` | 157 | Metadatos de hojas del Excel de FAGU |
| `irpf_categorias_patrimonio` | 10 | Categorías patrimoniales |
| `irpf_entity_templates` | 4 | Plantillas de entidades bancarias |

---

### Capa web (Vercel — apps/web)

**Commit actual en producción:** `635bab7` (pendiente de deploy tras push)

#### Páginas implementadas

La página de **login** (`/login`) muestra el formulario de autenticación con un banner de credenciales demo. Redirige al dashboard tras autenticación exitosa.

El **dashboard** (`/`) muestra métricas operativas reales desde Supabase: número de clientes, expedientes activos, documentos en revisión manual, alertas pendientes y exportaciones generadas. Los datos se cargan desde la API `/api/dashboard`.

La **lista de clientes** (`/clientes`) muestra todos los clientes del despacho con búsqueda por nombre o NIF. Cada cliente muestra el número de expedientes activos. El botón "Nuevo cliente" abre un formulario de alta.

La **ficha de cliente** (`/clientes/[id]`) tiene tres pestañas: Resumen (datos del cliente y estadísticas), Documentos (lista de expedientes con estado y botón de nueva ingesta) y Patrimonio (datos históricos del cliente). La corrección de nombres de columna (`ejercicio→fiscal_year`, `estado→status`) se aplicó el 2026-03-06.

La **página de expediente** (`/expedientes/[id]`) es el centro operativo del flujo. Muestra el contexto del cliente (breadcrumb), las estadísticas del expediente (número de documentos por estado) y tres pestañas: Nueva ingesta (formulario de subida de PDFs), Documentos (tabla con estado en tiempo real, barra de confianza y polling cada 5s) y Exportación AEAT.

La **cola de revisión** (`/review`) muestra todos los documentos con estado `manual_review` en todos los expedientes. La aprobación de registros individuales está pendiente (backlog B-04).

La **configuración** (`/configuracion`) permite gestionar las plantillas de entidades bancarias. Muestra las 4 plantillas pre-cargadas y permite crear nuevas.

#### APIs implementadas (16 rutas)

Todas las rutas de API están implementadas y desplegadas. Las rutas que requieren `SUPABASE_SERVICE_ROLE_KEY` (upload-urls, intake) están verificadas localmente. La ruta de descarga de artefactos (`/api/exports/[id]/download`) está implementada pero no verificada en producción.

---

### Capa de parseo (Railway — services/parser)

**URL:** `https://parser-production-0827.up.railway.app`

El parser service está desplegado y responde. El endpoint `POST /parse-document` acepta el payload correcto (document_id, expediente_id, filename, content_base64, entity_hint). Sin embargo, la implementación interna de `parser_engine.py` tiene limitaciones importantes:

El método de extracción usa `pypdf` para extraer texto plano. Esto funciona para PDFs con texto seleccionable, pero falla con PDFs escaneados o con texto en capas de imagen (frecuentes en extractos bancarios). La librería `pdfplumber`, más precisa para tablas financieras, no está integrada todavía (backlog B-01).

Los extractores por entidad (Pictet, Goldman Sachs, Citi, J.P. Morgan) están implementados como módulos Python pero con lógica de extracción básica basada en keywords línea a línea. No extraen ISIN, divisa, retención ni tipo de cambio de forma fiable (backlog B-02).

El fallback LLM (`llm_fallback.py`) está diseñado pero requiere `OPENAI_API_KEY` en Railway (backlog B-05).

---

### Capa de orquestación (Railway — n8n)

**URL:** `https://n8n-production-aaf5.up.railway.app`

El workflow `irpf-parser-orchestration.json` está importado y activo. Recibe eventos `parse.*` desde el webhook de Vercel, enruta por tipo de evento y llama al parser de Railway. El nodo de callback hacia Vercel (`/api/webhooks/parse-event`) está configurado con la URL de producción.

La variable `N8N_WEBHOOK_URL` está configurada en Vercel. El flujo completo (Vercel → n8n → Railway Parser → Vercel webhook) no ha sido verificado de extremo a extremo con un PDF real en producción.

---

## Deuda técnica registrada

La siguiente tabla recoge los problemas conocidos que no bloquean el uso actual pero deben resolverse antes de entrar en producción real con datos de clientes:

| ID | Problema | Impacto | Prioridad |
|---|---|---|---|
| DT-01 | RLS no activo en tablas `irpf_documents`, `irpf_expedientes`, `irpf_operations` | Cualquier abogado autenticado ve todos los expedientes | Alta |
| DT-02 | `user_id TEXT` en `irpf_audit_log` almacena `"fiscalista.demo"` en lugar de UUID | Auditoría no trazable a usuarios reales | Media |
| DT-03 | Parser usa `pypdf` en lugar de `pdfplumber` | Extracción falla en PDFs escaneados | Alta |
| DT-04 | Extractores por entidad no extraen ISIN, divisa ni retención | Datos incompletos para modelos AEAT | Alta |
| DT-05 | `irpf_operations` nunca se escribe desde el flujo automático | Modelo 100 no tiene datos reales | Alta |
| DT-06 | Proyecto Supabase compartido con otros sistemas | Riesgo de colisión de datos | Media |
| DT-07 | `output: standalone` en `next.config.mjs` causa warnings en build | No bloquea pero genera ruido en logs | Baja |
| DT-08 | Tests e2e solo verifican flujos de UI, no integración real con Supabase | Cobertura insuficiente para producción | Media |

---

## Historial de cambios relevantes

| Fecha | Commit | Cambio |
|---|---|---|
| 2026-03-05 | `ac60839` | Superusuario demo en pantalla de login |
| 2026-03-05 | `baseline` | Persistencia total en Supabase, eliminación de in-memory store |
| 2026-03-06 | `4754c70` | Fix errores de prerender en build Next.js 14 |
| 2026-03-06 | `635bab7` | Conectar ficha de cliente, expedientes y flujo de ingesta |
| 2026-03-06 | Supabase | Migraciones Auth+RLS y plataforma patrimonio aplicadas |
| 2026-03-06 | Supabase | 26.161 registros patrimoniales de FAGU migrados |
