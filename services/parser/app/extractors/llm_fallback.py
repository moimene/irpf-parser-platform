"""
Extractor LLM (GPT-4o-mini) para documentos de entidad desconocida
o PDFs donde la extracción textual es insuficiente.
Activa solo si OPENAI_API_KEY está configurada.
"""
import json
import os
import re
from typing import Any, Dict, List, Optional

from app.extractors.base import ExtractedRecord

LLM_SYSTEM_PROMPT = """Eres un extractor de datos financieros especializado en documentos bancarios para IRPF español.
Tu tarea es extraer TODAS las operaciones financieras del texto proporcionado.
Responde ÚNICAMENTE con un array JSON válido. No incluyas explicaciones ni texto adicional."""

LLM_USER_PROMPT = """Del siguiente texto de extracto bancario, extrae todas las operaciones financieras.

Para cada operación, devuelve un objeto con estos campos:
- tipo: "DIVIDENDO" | "INTERES" | "VENTA" | "COMPRA" | "POSICION" | "DESCONOCIDO"
- fecha: "YYYY-MM-DD" o null
- isin: código ISIN (ej: "US0231351067") o null
- descripcion: descripción breve de la operación
- importe: número decimal o null
- divisa: "EUR" | "USD" | "GBP" | etc. (por defecto "EUR")
- retencion: importe de retención fiscal o null
- confianza: número entre 0.5 y 0.99

Texto del extracto:
{text}

Responde SOLO con el array JSON, sin markdown, sin explicación:"""

MAX_TEXT_CHARS = 6000  # Límite para no exceder el contexto del modelo


def _call_openai(text: str) -> List[Dict[str, Any]]:
    """Llama a la API de OpenAI y devuelve la lista de operaciones extraídas."""
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        return []

    try:
        import httpx

        truncated_text = text[:MAX_TEXT_CHARS]
        payload = {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": LLM_SYSTEM_PROMPT},
                {"role": "user", "content": LLM_USER_PROMPT.format(text=truncated_text)},
            ],
            "temperature": 0,
            "max_tokens": 2000,
        }

        with httpx.Client(timeout=45) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        content = data["choices"][0]["message"]["content"].strip()

        # Limpiar posible markdown ```json ... ```
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)

        parsed = json.loads(content)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict) and "operaciones" in parsed:
            return parsed["operaciones"]
        return []

    except Exception:
        return []


def _normalize_operation(op: Dict[str, Any]) -> Optional[ExtractedRecord]:
    """Convierte un dict del LLM a ExtractedRecord normalizado."""
    try:
        record_type = str(op.get("tipo", "DESCONOCIDO")).upper()
        valid_types = {"DIVIDENDO", "INTERES", "VENTA", "COMPRA", "POSICION", "DESCONOCIDO"}
        if record_type not in valid_types:
            record_type = "DESCONOCIDO"

        fecha = op.get("fecha")
        if fecha and not re.match(r"\d{4}-\d{2}-\d{2}", str(fecha)):
            fecha = None

        importe = op.get("importe")
        if importe is not None:
            try:
                importe = float(importe)
            except (ValueError, TypeError):
                importe = None

        retencion = op.get("retencion")
        if retencion is not None:
            try:
                retencion = float(retencion)
            except (ValueError, TypeError):
                retencion = None

        confianza = float(op.get("confianza", 0.72))
        confianza = max(0.50, min(0.95, confianza))

        return ExtractedRecord(
            record_type=record_type,
            operation_date=fecha,
            isin=op.get("isin"),
            description=str(op.get("descripcion", ""))[:200],
            amount=importe,
            currency=str(op.get("divisa", "EUR")).upper(),
            retention=retencion,
            quantity=None,
            page=1,
            row_text=str(op.get("descripcion", ""))[:200],
            confidence=confianza,
            extra={"template": "llm.gpt4o-mini.v1"},
        )
    except Exception:
        return None


def extract(text: str) -> List[ExtractedRecord]:
    """
    Extrae registros usando GPT-4o-mini como fallback semántico.
    Solo se activa si OPENAI_API_KEY está configurada.
    Devuelve lista vacía si no hay API key o si el texto es insuficiente.
    """
    if not text or len(text.strip()) < 30:
        return []

    if not os.environ.get("OPENAI_API_KEY", "").strip():
        return []

    raw_operations = _call_openai(text)
    records = []
    for op in raw_operations:
        record = _normalize_operation(op)
        if record:
            records.append(record)

    return records
