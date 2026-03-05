# Extensiones Condicionales

## Multi-agent patterns (activar bajo KPI)

Activar solo si en evaluación continua ocurre al menos una condición:

- `field_extraction_accuracy < 0.95`
- `classification_accuracy < 0.90`
- latencia p95 parser > 30s en documentos individuales

Estrategia prevista:

1. Agente A: clasificación de entidad/formato
2. Agente B: extracción tabular/línea a línea
3. Agente C: validación semántica y score de confianza
4. Supervisor: consolidación + trazabilidad por `source_spans`

## Security best practices (activar on-demand)

Al pedir auditoría explícita:

1. Review de secretos, RBAC y auditoría mutable/inmutable
2. Endurecimiento de webhooks n8n (firma HMAC + nonce)
3. Reglas de acceso Supabase (RLS por tenant/expediente)
4. Reporte priorizado con fixes incrementales
