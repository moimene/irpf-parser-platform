# IRPF Parser Platform

**Última actualización:** 2026-03-08 | **Versión:** 0.5.0-beta

Plataforma de despacho profesional para extracción, normalización y validación fiscal de documentación financiera y patrimonial. Convierte documentos y ediciones manuales en un registro canónico operativo para los modelos AEAT 100, 714 y 720.

---

## Estado actual

- **Web pública estabilizada:** [web-tan-mu-35.vercel.app](https://web-tan-mu-35.vercel.app)
- **Git alineado con producción:** `origin/main` en commit `5db75d8`
- **Registro canónico operativo:** perfil declarativo, activos `C/V/I/S/B/M` y eventos fiscales editables desde expediente
- **Modelo 100:** prefiere `irpf_asset_fiscal_events` para compras y ventas canónicas de valores e IIC, con fallback a `irpf_operations`
- **Parser:** sigue activo en producción, pero queda fuera del perímetro de esta estabilización; su revisión funcional profunda se hará en una conversación y rama aparte

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
│  Parser FastAPI: /parse-document → structured_document      │
│  PDF estructurado + CSV/XLSX determinista + fallback review │
└──────────────────┬──────────────────────────────────────────┘
                   │ persistencia
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (PostgreSQL)                    │
│                                                             │
│  Auth: auth.users + irpf_users                              │
│  Operativa: irpf_clients, irpf_user_client_assignments      │
│  Expediente: irpf_expedientes, irpf_documents,              │
│              irpf_extractions, irpf_exports, irpf_audit_log │
│  Runtime fiscal: irpf_operations, irpf_lots,                │
│                  irpf_sale_allocations,                     │
│                  irpf_fiscal_adjustments                    │
│  Registro canónico: irpf_declaration_profiles,              │
│                     irpf_asset_registry,                    │
│                     irpf_asset_fiscal_events + subtables    │
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
| Parser | FastAPI en Railway (`structured_document`, `pdfplumber`, `openpyxl`, `xlrd`) |
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
│       ├── components/         ← Intake, review, export y workspace canónico
│       ├── lib/                ← Supabase, Auth, AEAT, reglas fiscales, registro canónico
│       └── middleware.ts       ← Protección de rutas
├── services/
│   └── parser/                 ← FastAPI (Railway)
│       └── app/
│           ├── main.py         ← Endpoint /parse-document
│           ├── parser_engine.py ← Parseo y normalización
│           └── structured_document.py ← Capa documental estructurada
├── infra/
│   ├── supabase/migrations/    ← Migraciones runtime y modelo canónico
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

La producción pública actual corresponde a `main@5db75d8`.

### Parser + n8n (Railway)

```bash
./scripts/railway-deploy-parser.sh
./scripts/railway-deploy-n8n.sh
./scripts/n8n-import-workflow.sh
```

Guía completa: [`docs/vercel-mcp-n8n-railway-setup.md`](docs/vercel-mcp-n8n-railway-setup.md)

---

## Migraciones Supabase

La base remota activa ya incluye las migraciones de auth moderna, runtime fiscal y registro canónico. Las piezas más relevantes del estado actual son:

| Archivo | Descripción |
|---|---|
| `20260307100000_finalize_dispatch_auth_migration.sql` | auth real de despacho y retirada del fallback legacy |
| `20260307134212_irpf_fiscal_adjustments_runtime_module.sql` | ajustes fiscales manuales |
| `20260307160000_irpf_lots_runtime_module.sql` | lotes y runtime FIFO |
| `20260307210000_irpf_canonical_asset_registry.sql` | registro canónico de bienes/derechos y eventos fiscales |
| `20260307233000_irpf_capital_operation_catalog.sql` | catálogo granular de operaciones de capital |

Referencia operativa consolidada: [docs/BASELINE_FUNCIONAL_2026-03-06.md](docs/BASELINE_FUNCIONAL_2026-03-06.md)

---

## Perímetro estabilizado

Lo que queda explícitamente estabilizado en esta iteración:

- web pública
- auth y operativa de despacho
- expediente, review y export base
- registro canónico editable
- runtime fiscal de `100` sobre fuente canónica o legacy según disponibilidad

Lo que queda deliberadamente fuera de esta estabilización:

- revisión funcional profunda del parser
- cambios de dependencias Python o `uv.lock`
- redeploy del parser sin auditoría previa específica

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
