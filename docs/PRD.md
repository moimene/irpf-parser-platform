# PRD — IRPF Parser Platform

**Versión:** 0.4.0-beta  
**Fecha:** 2026-03-06  
**Repositorio:** `moimene/irpf-parser-platform`

---

## 1. Visión del producto

IRPF Parser Platform es un centro de gestión fiscal para despachos profesionales. Transforma el flujo de trabajo manual de la campaña de IRPF —recepción de extractos bancarios, extracción de datos, validación fiscal y generación de modelos AEAT— en un proceso automatizado, auditable y multi-cliente.

El producto sirve a dos perfiles de usuario: el **abogado fiscalista** (usuario principal, que gestiona expedientes, revisa extracciones y genera declaraciones) y el **cliente del despacho** (usuario secundario, que en fases futuras podrá consultar el estado de su declaración a través de un portal de solo lectura).

El punto de partida es el cliente **FAGU**, cuyo patrimonio histórico (26.161 registros, ejercicios 2013–2025) está cargado como primer caso de uso real de la plataforma.

---

## 2. Contexto: de herramienta a plataforma

La versión inicial del sistema fue construida como una herramienta calibrada para un único cliente. El gap analysis estratégico de marzo 2026 identificó cinco cambios estructurales necesarios para escalar a una plataforma de despacho:

| Gap | Descripción | Estado |
|---|---|---|
| **Gap 1** — Identidad y roles | Sin autenticación ni separación de usuarios | **Completado** |
| **Gap 2** — Multi-tenancy | Sin aislamiento de datos entre clientes | **Completado** |
| **Gap 3** — Parser configurable | Extractores bancarios hard-coded | **Parcial** — tabla `irpf_entity_templates` creada; parser Railway pendiente de actualización |
| **Gap 4** — Visor patrimonial dinámico | Datos estáticos del Excel de FAGU | **Completado** — datos migrados a Supabase; visor lee de BD |
| **Gap 5** — Flujo de trabajo multi-expediente | Un único expediente demo hard-coded | **Completado** — navegación Dashboard → Clientes → Expedientes |

---

## 3. Usuarios y roles

La plataforma implementa un modelo de roles de despacho único (single-tenant) con tres niveles de acceso:

| Rol | Capacidades |
|---|---|
| **Socio** | Acceso a todos los clientes del despacho, aprobación de exportaciones, configuración de plantillas |
| **Asociado** | Acceso a los clientes asignados, ingesta de PDFs, revisión manual de extracciones |
| **Paralegal** | Solo lectura sobre los expedientes asignados, sin capacidad de aprobación |

El usuario demo `demo@irpf-parser.dev` tiene rol **Socio** y acceso a todos los clientes.

---

## 4. Flujo de trabajo principal

El flujo operativo de la plataforma sigue estas etapas para cada cliente y ejercicio fiscal:

**Etapa 1 — Ingesta.** El abogado accede a la ficha del cliente, abre el expediente del ejercicio correspondiente y sube los PDFs bancarios (extractos de Pictet, Goldman Sachs, Citi, J.P. Morgan u otras entidades). Los archivos se suben directamente a Supabase Storage mediante URLs firmadas y se encolan para parseo.

**Etapa 2 — Parseo automático.** El evento `parse.started` llega a n8n, que llama al parser de Railway con el contenido del PDF. El parser intenta tres niveles de extracción: plantilla específica por entidad (Nivel 1), extracción semántica por keywords (Nivel 2) y revisión manual (Nivel 3). El resultado se persiste en `irpf_documents` con el estado y la confianza obtenida.

**Etapa 3 — Revisión manual.** Los documentos con confianza baja o con campos ambiguos se marcan como `manual_review`. El abogado accede a la cola de revisión, valida o corrige los registros extraídos y los aprueba para continuar.

**Etapa 4 — Exportación AEAT.** Con los registros validados, el abogado genera el modelo AEAT correspondiente (100, 714 o 720) desde la pantalla de exportación del expediente. El sistema aplica las reglas fiscales (FIFO, recompras 2/12 meses) y genera el artefacto descargable.

---

## 5. Módulos implementados

### 5.1 Autenticación y autorización

Supabase Auth con email/contraseña. Middleware de Next.js que protege todas las rutas excepto `/login`. Las políticas RLS en Supabase garantizan que las consultas a la base de datos solo devuelven datos del despacho autenticado. La tabla `irpf_abogados` vincula `auth.users` con el rol del abogado.

### 5.2 Gestión de clientes

Pantalla `/clientes` con lista de todos los clientes del despacho, búsqueda por nombre o NIF, y acceso rápido al último expediente activo. La ficha de cliente (`/clientes/[id]`) muestra el resumen patrimonial, la lista de expedientes por ejercicio y el acceso directo a la ingesta de nuevos documentos.

### 5.3 Expedientes y flujo de ingesta

La página `/expedientes/[id]` centraliza el flujo operativo de un expediente. Tiene tres pestañas: **Nueva ingesta** (subida de PDFs con selección de entidad bancaria), **Documentos** (lista de todos los documentos con estado en tiempo real, barra de confianza y polling automático cada 5 segundos mientras haya documentos en proceso) y **Exportación AEAT** (generación de modelos).

### 5.4 Cola de revisión manual

La pantalla `/review` muestra todos los documentos pendientes de revisión manual en todos los expedientes del despacho. El abogado puede aprobar o rechazar extracciones individuales con comentario.

### 5.5 Patrimonio histórico

Los datos patrimoniales del cliente FAGU (26.161 registros) están almacenados en la tabla `irpf_patrimonio` con categoría, ejercicio y valores. La API `/api/patrimonio` sirve estos datos con filtro por cliente y ejercicio. El visor patrimonial del `fagu-financial-viewer` puede conectarse a esta API para mostrar datos dinámicos.

### 5.6 Configuración de plantillas bancarias

La pantalla `/configuracion` permite gestionar las plantillas de entidades bancarias almacenadas en `irpf_entity_templates`. Cada plantilla define los patrones de detección y las reglas de extracción para una entidad. Actualmente hay 4 plantillas pre-cargadas (Pictet, Goldman Sachs, Citi, J.P. Morgan).

### 5.7 Exportación AEAT

El componente `ExportGenerator` llama a la API `/api/exports/[expediente_id]` con el modelo solicitado (100, 714 o 720). La API aplica el motor de reglas fiscales (`lib/rules-core.ts`, `lib/rules/validation.ts`) y genera el artefacto con hash de integridad. La lógica de formato AEAT está en `lib/aeat/format.ts`.

---

## 6. Backlog priorizado

### Prioridad Alta — bloquea el valor principal

| ID | Tarea | Módulo | Estimación |
|---|---|---|---|
| B-01 | **Parser Engine real**: reemplazar `pypdf` por `pdfplumber` para extracción tabular precisa | Parser (Railway) | 3 días |
| B-02 | **Extractores por entidad**: implementar `pictet.py`, `goldman_sachs.py`, `citi.py` con `pdfplumber` | Parser (Railway) | 4 días |
| B-03 | **Persistencia de records**: guardar registros extraídos en `irpf_operations` tras parseo | API webhooks | 1 día |
| B-04 | **Review Board funcional**: mostrar registros individuales de cada extracción para aprobar/rechazar | UI `/review` | 2 días |
| B-05 | **Fallback LLM**: integrar `gpt-4o-mini` para documentos de entidades desconocidas | Parser (Railway) | 1 día |

### Prioridad Media — mejora la experiencia operativa

| ID | Tarea | Módulo | Estimación |
|---|---|---|---|
| B-06 | **Visor patrimonial dinámico**: conectar `fagu-financial-viewer` a la API `/api/patrimonio` en lugar de JSON estáticos | Visor | 2 días |
| B-07 | **Portal de cliente**: pantalla de solo lectura para que el cliente vea el estado de su declaración | UI nueva | 3 días |
| B-08 | **Notificaciones**: email al abogado cuando un documento requiere revisión manual | n8n | 1 día |
| B-09 | **Descarga de artefactos AEAT**: implementar la ruta `/api/exports/[id]/download` | API | 1 día |
| B-10 | **Auditoría con UUID real**: reemplazar `user_id TEXT` por `auth.uid()` en `irpf_audit_log` | BD + API | 0.5 días |

### Prioridad Baja — hardening y escalabilidad

| ID | Tarea | Módulo | Estimación |
|---|---|---|---|
| B-11 | **Multi-despacho**: añadir tabla `irpf_despachos` y RLS por despacho para soporte de múltiples firmas | BD + Auth | 3 días |
| B-12 | **SSO**: login con Azure AD / Google Workspace para despachos con directorio corporativo | Auth | 2 días |
| B-13 | **Evaluación automática**: suite de tests contra goldens en CI para validar calidad del parser | CI/CD | 2 días |
| B-14 | **Parser configurable desde UI**: que el despacho pueda definir nuevas entidades sin tocar código | UI + Parser | 4 días |
| B-15 | **Proyecto Supabase dedicado**: migrar a un proyecto Supabase exclusivo para IRPF Parser | Infra | 1 día |

---

## 7. Decisiones arquitectónicas registradas

**DA-01 — Shared schema con RLS** (2026-03-06): Se eligió un único schema PostgreSQL con políticas RLS para el aislamiento multi-tenant, en lugar de un schema por despacho. Justificación: el caso de uso inicial es un único despacho con menos de 100 clientes activos; RLS es suficiente y más simple de mantener. Revisable si se escala a múltiples despachos.

**DA-02 — Supabase Storage para PDFs** (2026-03-06): Los PDFs originales se guardan en Supabase Storage (bucket `irpf-documents`) antes de pasarlos al parser. Esto garantiza trazabilidad, permite re-ingesta sin que el cliente vuelva a subir el archivo, y desacopla la subida del parseo.

**DA-03 — IDs de expediente normalizados** (2026-03-05): Las referencias de expediente (`demo-irpf-2025`, `FAGU-2025`) se convierten a UUID determinista mediante hash estable. Las APIs devuelven ambos: `expediente_id` (UUID para FKs) y `expediente_reference` (referencia legible para URLs).

**DA-04 — Namespace `irpf_*`** (2026-03-05): Todas las tablas del proyecto usan el prefijo `irpf_` para evitar colisiones con otros sistemas en el mismo proyecto Supabase compartido.

**DA-05 — Diseño Garrigues** (2026-03-05): La interfaz usa tokens CSS `--g-*` (verde `#004438`, crema `#f5f4f0`, tipografía Montserrat) inspirados en la identidad visual de Garrigues, apropiada para un entorno de despacho profesional de alto nivel.

---

## 8. Restricciones y riesgos

El proyecto Supabase `hvlsuwdqtffiilvampxq` es compartido con otros sistemas del cliente. Aunque las tablas IRPF están aisladas con el prefijo `irpf_`, se recomienda migrar a un proyecto Supabase dedicado antes de entrar en producción real con datos de clientes.

El parser de Railway tiene extractores implementados para Pictet, Goldman Sachs, Citi y J.P. Morgan. Cualquier otro banco cae al fallback de revisión manual hasta que se implemente el extractor correspondiente (B-01, B-02) o el fallback LLM (B-05).

La variable `AUTO_PARSE_ON_INTAKE=true` activa el parseo automático al ingestar. Si el parser de Railway no está disponible, los documentos quedan en estado `queued` y pueden re-procesarse manualmente.
