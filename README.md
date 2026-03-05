# IRPF Parser Platform (MVP Multiusuario)

Ultima actualizacion: 2026-03-05

Plataforma para extraccion, normalizacion y validacion fiscal de extractos financieros con stack:

- `Vercel` para frontend + APIs (`apps/web`)
- `Railway` para parser service y n8n (`services/parser`, `infra/n8n`)
- `Supabase` para persistencia compartida (`infra/supabase`)
- `n8n` para orquestacion de eventos de parseo

## Estado actual (Produccion)

- Web (alias productivo): `https://web-moises-menendezs-projects.vercel.app`
- Ultimo deployment productivo: `https://web-ndhzlmjic-moises-menendezs-projects.vercel.app`
- Parser Railway: `https://parser-production-0827.up.railway.app`
- n8n Railway: `https://n8n-production-aaf5.up.railway.app`
- Supabase project ref: `hvlsuwdqtffiilvampxq`

Nota operativa: el proyecto Vercel tiene `Deployment Protection` activa, por lo que para smoke tests CLI en produccion se usa `vercel curl`.

## Resumen de lo ejecutado

### 1) Arquitectura y contratos base (Vercel + n8n + Railway + Supabase)

- Se validaron y mantuvieron los contratos principales:
- `POST /api/documents/intake` (ingesta)
- `POST /parse-document` (parser en Railway)
- `POST /api/webhooks/parse-event` (eventos parse.*)
- `GET /api/exports/:expediente_id?model=100|714|720` (exportacion)
- Se desplego y verifico conectividad entre servicios.

### 2) UX corporativa inspirada en Garrigues

- Se rediseno la consola con tokens de diseño corporativos (`--g-*`) y layout sobrio orientado a operativa legal/fiscal.
- Se aplicaron cambios sobre:
- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/review/page.tsx`
- `apps/web/app/expedientes/[id]/page.tsx`

### 3) Persistencia total en Supabase (MVP equipo multiusuario)

Cambio clave: se elimino la dependencia del store en memoria para operacion real multiusuario.

- Eliminado `apps/web/lib/in-memory-store.ts`.
- Persistencia directa en Supabase para:
- Dashboard (`/api/dashboard`)
- Review board (`/api/review`)
- Intake + ciclo de parseo (`/api/documents/intake`)
- Webhooks parse.* (`/api/webhooks/parse-event`)
- Exportes (`/api/exports/[expediente_id]`)
- Auditoria de eventos en `irpf_audit_log`.

### Aislamiento de datos: tablas `irpf_*`

Se detecto colision con tablas existentes del proyecto Supabase (`public.documents` de otro dominio), por lo que el MVP IRPF usa namespace dedicado:

- `irpf_expedientes`
- `irpf_documents`
- `irpf_extractions`
- `irpf_operations`
- `irpf_alerts`
- `irpf_exports`
- `irpf_audit_log`

Esto evita acoplamiento con otros sistemas ya presentes en ese proyecto Supabase.

### Migracion aplicada

- Archivo migration: `infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`
- Estado remoto confirmado via CLI: version `20260305162000` aplicada.

### 4) Normalizacion de IDs de expediente

Se implemento normalizacion para soportar referencias amigables en URLs (`demo-irpf-2025`, `mvp-team-prod`) sin romper FKs UUID en DB.

- Helper: `apps/web/lib/expediente-id.ts`
- Regla:
- Si `expediente_id` ya es UUID, se usa tal cual.
- Si no es UUID, se convierte a UUID determinista (hash estable).
- Las APIs devuelven:
- `expediente_id`: UUID persistente
- `expediente_reference`: referencia funcional original

### 5) Hardening de entorno

- Se sanean variables de entorno con `trim` y limpieza de `\\n` escapados (`apps/web/lib/env.ts`) para evitar fallos con valores exportados por Vercel.
- `apps/web/lib/supabase.ts` soporta `SUPABASE_SERVICE_ROLE_KEY` (preferido) y fallback `SUPABASE_PUBLISHABLE_KEY`.
- Scripts de deploy preparados para entornos sin binario global de Vercel:
- `scripts/deploy-preview.sh`
- `scripts/deploy-production.sh`

### 6) Validaciones ejecutadas

Local:

- `npm run typecheck --workspace apps/web`
- `npm run lint --workspace apps/web`
- `npm run build --workspace apps/web`
- `npm run test:e2e --workspace apps/web` (2/2 en verde)

Infra:

- `./scripts/railway-deploy-parser.sh` ejecutado
- `railway redeploy --service n8n --yes` ejecutado
- Webhook n8n validado (HTTP 200)

Produccion:

- Deploy productivo en Vercel ejecutado
- Smoke tests en APIs protegidas usando `vercel curl`:
- `/api/dashboard`
- `POST /api/documents/intake`
- `/api/review?expediente_id=mvp-team-prod`
- `/api/exports/mvp-team-prod?model=100`

## Estructura del repositorio

- `apps/web`: consola operativa y APIs App Router
- `services/parser`: microservicio FastAPI `/parse-document`
- `packages/contracts`: contratos TypeScript compartidos
- `packages/rules`: motor de reglas fiscales inicial
- `infra/n8n/workflows`: workflow base `irpf-parser-orchestration.json`
- `infra/supabase/migrations`: migraciones de persistencia IRPF
- `evaluation`: framework de evaluacion y umbrales
- `docs`: documentacion de arquitectura y setup

## Variables de entorno

### Web (Vercel / Next.js)

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (recomendado para backend)
- `SUPABASE_PUBLISHABLE_KEY` (fallback)
- `N8N_WEBHOOK_URL`
- `PARSER_SERVICE_URL`
- `AUTO_PARSE_ON_INTAKE=true|false`

### n8n

- `PARSER_SERVICE_URL`
- `VERCEL_API_BASE_URL`
- `N8N_ENCRYPTION_KEY`

### Parser (Railway)

- `PORT` (default 8001)

## Runbook rapido

### 1) Instalar dependencias

```bash
npm install
```

### 2) Levantar web en local

```bash
npm run dev
```

### 3) Levantar parser local (opcional)

```bash
cd services/parser
uv sync
uv run uvicorn app.main:app --reload --port 8001
```

### 4) Verificar calidad

```bash
npm run typecheck --workspace apps/web
npm run lint --workspace apps/web
npm run build --workspace apps/web
npm run test:e2e --workspace apps/web
```

### 5) Despliegue

Preview:

```bash
./scripts/deploy-preview.sh
```

Produccion:

```bash
./scripts/deploy-production.sh
```

### 6) Operacion Railway + n8n

```bash
./scripts/railway-deploy-parser.sh
./scripts/railway-deploy-n8n.sh
./scripts/n8n-import-workflow.sh
```

Guia completa: `docs/vercel-mcp-n8n-railway-setup.md`

## Riesgos y notas abiertas

- El proyecto Supabase compartido contiene otros dominios; por eso IRPF se aisla en tablas `irpf_*`.
- Si se quiere endurecimiento enterprise, siguiente paso recomendado:
- activar RLS por equipo/tenant en tablas `irpf_*`
- firmar webhooks n8n con HMAC
- usar un proyecto Supabase dedicado exclusivamente a IRPF Parser

## Archivos clave modificados en esta ejecucion

- `apps/web/app/globals.css`
- `apps/web/app/layout.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/review/page.tsx`
- `apps/web/app/expedientes/[id]/page.tsx`
- `apps/web/lib/env.ts`
- `apps/web/lib/supabase.ts`
- `apps/web/lib/events.ts`
- `apps/web/lib/expediente-id.ts`
- `apps/web/lib/db-tables.ts`
- `apps/web/app/api/dashboard/route.ts`
- `apps/web/app/api/review/route.ts`
- `apps/web/app/api/documents/intake/route.ts`
- `apps/web/app/api/webhooks/parse-event/route.ts`
- `apps/web/app/api/exports/[expediente_id]/route.ts`
- `apps/web/tsconfig.json`
- `scripts/deploy-preview.sh`
- `scripts/deploy-production.sh`
- `infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`
