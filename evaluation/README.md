# Evaluation Framework

Este módulo implementa evaluación reproducible para:

- Precisión de extracción de campos
- Precisión de clasificación
- Recall de enrutado a revisión manual
- Consistencia de reglas fiscales (recompra 2/12 meses)

## Ejecución

```bash
python3 evaluation/scripts/run_eval.py
```

Opcionalmente, apuntar a parser real:

```bash
PARSER_SERVICE_URL=http://localhost:8001 python3 evaluation/scripts/run_eval.py
```
