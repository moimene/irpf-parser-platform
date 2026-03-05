# Parser Service (Railway)

Servicio FastAPI para parsing adaptativo en tres niveles:

1. Plantillas conocidas (`PICTET`, `GOLDMAN_SACHS`, `CITI`)
2. Fallback semántico
3. Escalado a revisión manual por confianza

## Ejecutar en local

```bash
uv sync
uv run uvicorn app.main:app --reload --port 8001
```

## Endpoint

- `POST /parse-document`
- `GET /health`
