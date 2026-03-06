# IRPF Parser Platform

**Última actualización:** 2026-03-06 | **Versión:** 0.4.0-beta

Plataforma de despacho profesional para extracción, normalización y validación fiscal de extractos financieros. Transforma PDFs bancarios en datos estructurados listos para los modelos AEAT 100, 714 y 720.

---

## Entornos activos

| Servicio | URL | Estado |
|---|---|---|
| **Web (Vercel)** | [web-tan-mu-35.vercel.app](https://web-tan-mu-35.vercel.app) | Activo |
| **Parser (Railway)** | `https://parser-production-0827.up.railway.app` | Activo |
| **n8n (Railway)** | `https://n8n-production-aaf5.up.railway.app` | Activo |
| **Supabase** | `hvlsuwdqtffiilvampxq.supabase.co` | Activo |

**Credenciales demo:** `demo@irpf-parser.dev` / `Demo2025!`

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                        VERCEL (apps/web)                    │
│  Next.js 14 App Router · Supabase Auth · Diseño Garrigues   │
│                                                             │
│  /login  /clientes  /clientes/[id]  /expedientes/[id]       │
│  /review  /configuracion                                    │
│                                                             │
│  API Routes:                                                │
│  POST /api/documents/intake        ← ingesta de PDFs        │
│  POST /api/documents/upload-urls   ← URLs firmadas Storage  │
│  GET  /api/expedientes/[id]        ← expediente + docs      │
│  GET  /api/clientes                ← lista de clientes      │
│  GET  /api/clientes/[id]           ← ficha + expedientes    │
│  GET  /api/dashboard               ← métricas operativas    │
│  GET  /api/review                  ← cola revisión manual   │
│  POST /api/review/[id]             ← aprobar/rechazar       │
│  GET  /api/exports/[id]            ← generar modelo AEAT    │
│  POST /api/webhooks/parse-event    ← eventos del parser     │
│  GET  /api/entity-templates        ← plantillas bancarias   │
│  GET  /api/patrimonio              ← datos patrimoniales    │
└──────────────────┬──────────────────────────────────────────┘
                   │ eventos parse.* (n8n webhook)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                     RAILWAY (n8n + Parser)                  │
│                                                             │
│  n8n workflow: parse.started → Railway Parser → Vercel      │
│  Parser FastAPI: /parse-document (Pictet, GS, Citi, JPM)   │
└──────────────────┬──────────────────────────────────────────┘
                   │ persistencia
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                    │
│                                                             │
│  Auth: auth.users + irpf_abogados (roles)                  │
│  Datos: irpf_expedientes, irpf_documents, irpf_extractions  │
│         irpf_operations, irpf_exports, irpf_audit_log       │
│  Multi-cliente: irpf_clients, irpf_asignaciones             │
│  Patrimonio: irpf_patrimonio, irpf_hojas, irpf_categorias   │
│  Config: irpf_entity_templates                              │
│  Storage: bucket irpf-documents (PDFs originales)           │
└─────────────────────────────────────────────────────────────┘
```

---

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 App Router, React 18, TypeScript |
| Estilos | CSS custom con tokens `--g-*` (diseño Garrigues), Montserrat |
| Auth | Supabase Auth (email/contraseña) + middleware Next.js |
| Base de datos | Supabase PostgreSQL con RLS |
| Storage | Supabase Storage (bucket `irpf-documents`) |
| Orquestación | n8n en Railway |
| Parser | FastAPI en Railway (pdfplumber, pypdf) |
| Despliegue web | Vercel (monorepo, directorio raíz `apps/web`) |

---

## Estructura del repositorio

```
irpf-parser-platform/
├── apps/
│   └── web/                    ← Next.js 14 (Vercel)
│       ├── app/                ← Pages + API Routes (App Router)
│       │   ├── api/            ← 16 rutas API
│       │   ├── clientes/       ← Lista y ficha de cliente
│       │   ├── expedientes/    ← Flujo de ingesta y documentos
│       │   ├── review/         ← Cola de revisión manual
│       │   └── configuracion/  ← Plantillas de entidades
│       ├── components/         ← IntakeForm, ReviewBoard, ExportGenerator
│       ├── lib/                ← Supabase, Auth, AEAT, reglas fiscales
│       └── middleware.ts       ← Protección de rutas
├── services/
│   └── parser/                 ← FastAPI (Railway)
│       └── app/
│           ├── main.py         ← Endpoint /parse-document
│           └── parser_engine.py ← Extractores por entidad
├── infra/
│   ├── supabase/migrations/    ← 5 migraciones SQL
│   └── n8n/workflows/          ← Workflow de orquestación
├── packages/
│   ├── contracts/              ← Tipos TypeScript compartidos
│   └── rules/                  ← Motor de reglas fiscales
├── scripts/                    ← Deploy, bootstrap, migración Excel
├── docs/                       ← Arquitectura, roadmap, setup
└── evaluation/                 ← Framework de evaluación y goldens
```

---

## Variables de entorno

### Web — Vercel (`apps/web`)

| Variable | Descripción | Requerida |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (browser) | Sí |
| `SUPABASE_URL` | URL del proyecto Supabase (server-side) | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (admin, server-side) | Sí |
| `SUPABASE_PUBLISHABLE_KEY` | Alternativa a `ANON_KEY` | No |
| `N8N_WEBHOOK_URL` | URL del webhook de n8n para eventos parse.* | Sí |
| `PARSER_SERVICE_URL` | URL del parser en Railway | Sí |
| `AUTO_PARSE_ON_INTAKE` | `true` para parsear automáticamente al ingestar | No |

### n8n — Railway

| Variable | Descripción |
|---|---|
| `PARSER_SERVICE_URL` | URL del parser en Railway |
| `VERCEL_API_BASE_URL` | URL base de la web en Vercel |
| `N8N_ENCRYPTION_KEY` | Clave de cifrado de n8n |

### Parser — Railway

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (default: 8001) |
| `OPENAI_API_KEY` | Para fallback LLM en documentos desconocidos (opcional) |

---

## Desarrollo local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example apps/web/.env.local
# Editar apps/web/.env.local con los valores de Supabase
```

### 3. Levantar la web

```bash
npm run dev --workspace apps/web
# → http://localhost:3000
```

### 4. Levantar el parser (opcional)

```bash
cd services/parser
uv sync
uv run uvicorn app.main:app --reload --port 8001
```

### 5. Verificar calidad

```bash
npm run typecheck --workspace apps/web
npm run lint --workspace apps/web
npm run build --workspace apps/web
npm run test:e2e --workspace apps/web
```

---

## Despliegue

### Web (Vercel)

```bash
./scripts/deploy-production.sh
```

El proyecto Vercel está configurado con `rootDirectory: apps/web`. El build se dispara automáticamente con cada push a `main`.

### Parser + n8n (Railway)

```bash
./scripts/railway-deploy-parser.sh
./scripts/railway-deploy-n8n.sh
./scripts/n8n-import-workflow.sh
```

Guía completa: [`docs/vercel-mcp-n8n-railway-setup.md`](docs/vercel-mcp-n8n-railway-setup.md)

---

## Migraciones Supabase

Las migraciones deben ejecutarse en orden desde el SQL Editor de Supabase:

| Archivo | Descripción | Estado |
|---|---|---|
| `0001_init.sql` | Schema base inicial | Aplicada |
| `20260305162000_irpf_parser_schema.sql` | Tablas `irpf_*` principales (7 tablas) | Aplicada |
| `20260306100000_auth_rls_single_despacho.sql` | Auth + RLS + roles de abogados | Aplicada |
| `20260306110000_superusuario_test.sql` | Usuario demo `demo@irpf-parser.dev` | Aplicada |
| `20260306120000_plataforma_patrimonio.sql` | Tablas multi-cliente y patrimonio (7 tablas) | Aplicada |

---

## Datos de demostración

El cliente **FAGU** está cargado como primer cliente de la plataforma con **26.161 registros patrimoniales** migrados desde el Excel `datosRPFFAGU2025.xlsx` (157 hojas, ejercicios 2013–2025):

| Categoría | Registros |
|---|---|
| Goldman Sachs | 12.700 |
| Inventario / Posiciones | 8.140 |
| Tipos de Cambio | 1.619 |
| Citi Brokerage | 2.698 |
| Obras de Arte | 433 |
| Inmuebles | 297 |
| Derivados / Forwards | 237 |
| Private Equity | 37 |

Script de migración: [`scripts/migrate_excel_to_supabase.py`](scripts/migrate_excel_to_supabase.py)

---

## Notas de seguridad

El proyecto Supabase `hvlsuwdqtffiilvampxq` es compartido con otros sistemas. Las tablas IRPF usan el prefijo `irpf_` para evitar colisiones. Las políticas RLS están activas para las tablas de la migración `20260306100000`. Para un entorno de producción real se recomienda un proyecto Supabase dedicado exclusivamente a IRPF Parser.
