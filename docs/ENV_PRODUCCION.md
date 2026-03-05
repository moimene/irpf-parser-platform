# Variables de Entorno — Producción

Este documento lista todas las variables de entorno necesarias para desplegar
la plataforma en producción. **Nunca commitar valores reales a git.**

---

## Vercel (apps/web)

Configurar en: Vercel Dashboard → Project → Settings → Environment Variables

| Variable | Descripción | Ejemplo |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública del proyecto Supabase | `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anónima de Supabase (pública) | `eyJhbGciOi...` |
| `SUPABASE_URL` | URL del proyecto Supabase (server-side) | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase (secreta) | `eyJhbGciOi...` |
| `PARSER_SERVICE_URL` | URL del parser service en Railway | `https://parser-xxx.railway.app` |
| `N8N_WEBHOOK_URL` | URL del webhook de n8n para orquestación | `https://n8n-xxx.railway.app/webhook/parse` |
| `AUTO_PARSE_ON_INTAKE` | Activar parseo automático al subir PDF | `true` o `false` |

---

## Railway (services/parser)

Configurar en: Railway Dashboard → Service → Variables

| Variable | Descripción | Ejemplo |
|---|---|---|
| `OPENAI_API_KEY` | Clave de OpenAI para el fallback LLM (Nivel 2/3) | `sk-proj-...` |
| `SUPABASE_URL` | URL del proyecto Supabase | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase | `eyJhbGciOi...` |
| `PORT` | Puerto del servidor (Railway lo inyecta automáticamente) | `8000` |

---

## n8n (Railway — instancia n8n)

Configurar en: n8n Settings → Environment Variables o Railway Variables

| Variable | Descripción |
|---|---|
| `PARSER_SERVICE_URL` | URL del parser service para el nodo "Call Railway Parser" |
| `SUPABASE_URL` | Para los nodos de Supabase en los workflows |
| `SUPABASE_SERVICE_ROLE_KEY` | Para escritura en tablas de Supabase |
| `N8N_ENCRYPTION_KEY` | Clave de cifrado de credenciales de n8n (generar con `openssl rand -hex 32`) |
| `WEBHOOK_URL` | URL base de n8n para webhooks (ej: `https://n8n-xxx.railway.app`) |

---

## Supabase — Configuración de Storage

Crear el bucket `irpf-documents` en Supabase Storage con las siguientes políticas RLS:

```sql
-- Política de inserción (solo service role)
CREATE POLICY "Service role puede subir documentos"
ON storage.objects FOR INSERT
TO service_role
USING (bucket_id = 'irpf-documents');

-- Política de lectura (solo service role)
CREATE POLICY "Service role puede leer documentos"
ON storage.objects FOR SELECT
TO service_role
USING (bucket_id = 'irpf-documents');
```

---

## Orden de despliegue recomendado

1. **Supabase** — Ejecutar la migración `infra/supabase/migrations/20260305162000_irpf_parser_schema.sql`
2. **Railway (parser)** — Desplegar `services/parser/` con las variables de entorno configuradas
3. **Railway (n8n)** — Importar el workflow `infra/n8n/workflows/parse-document-workflow.json`
4. **Vercel** — Conectar el repositorio GitHub, configurar `Root Directory: apps/web`, añadir variables de entorno

---

## Verificación post-despliegue

```bash
# 1. Verificar parser service
curl https://parser-xxx.railway.app/health

# 2. Verificar webhook n8n
curl -X POST https://n8n-xxx.railway.app/webhook/parse-document \
  -H "Content-Type: application/json" \
  -d '{"document_id": "test", "content_base64": ""}'

# 3. Verificar Vercel
curl https://irpf-parser.vercel.app/api/dashboard
```
