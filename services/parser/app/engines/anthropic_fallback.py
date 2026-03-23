"""
Anthropic Claude Fallback Engine — M720 extraction via Claude Sonnet.

Used as fallback when OpenAI gpt-4o fails (429 quota, timeout, or
Structured Outputs rejection). Uses the same M720 system prompt and
JSON mode extraction, then validates with M720DocumentExtraction schema.

Requires:
  ANTHROPIC_API_KEY — Anthropic API key (set in Railway env vars)
  ANTHROPIC_MODEL — Model ID (default: claude-sonnet-4-20250514)
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import httpx

from app.schemas.m720_boe_v2 import (
    M720Cuenta,
    M720DocumentExtraction,
    M720IIC,
    M720Seguro,
    M720Inmueble,
    M720Valor,
)

logger = logging.getLogger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-sonnet-4-20250514"
MAX_TOKENS = 8192


def _get_api_key() -> Optional[str]:
    return os.getenv("ANTHROPIC_API_KEY")


def _get_model() -> str:
    return os.getenv("ANTHROPIC_MODEL", DEFAULT_MODEL).strip()


async def extract_with_claude(
    markdown: str,
    system_prompt: str,
    *,
    timeout_seconds: float = 180.0,
) -> Optional[M720DocumentExtraction]:
    """
    Extract M720 assets from markdown using Claude as fallback.

    Uses JSON mode via prefilled assistant response + explicit schema hint.
    Returns M720DocumentExtraction or None if extraction fails.
    """
    api_key = _get_api_key()
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — Claude fallback unavailable")
        return None

    model = _get_model()

    # Truncate to stay within context window (~180K tokens for Sonnet)
    markdown_truncated = markdown[:100000]

    schema = M720DocumentExtraction.model_json_schema()
    schema_str = json.dumps(schema, indent=2, ensure_ascii=False)[:6000]

    user_message = (
        "FALLBACK MODE (Claude): OpenAI no pudo extraer los activos. "
        "Analiza el documento COMPLETO y extrae ABSOLUTAMENTE TODOS los "
        "activos declarables para el Modelo 720.\n\n"
        "Devuelve un JSON valido con las claves: cuentas, valores, iics, "
        "seguros, inmuebles. Cada array contiene objetos con los campos "
        "del schema proporcionado.\n\n"
        "ATENCIÓN A DOCUMENTOS DE CUSTODIO MODELO 720:\n"
        "- Tablas con 'Clave tipo de bien', 'Subclave', 'Código de cuenta', "
        "'Saldo 31 Dic', 'Saldo medio 4T'\n"
        "- Tablas con 'Identificación de valores', 'Valoración 31 Dic', "
        "'Número de valores'\n"
        "- Filas C = cuentas, V = valores, I = IICs/fondos\n"
        "- Cada divisa = cuenta separada. Incluir saldos cero.\n\n"
        f"SCHEMA:\n{schema_str}\n\n"
        "DOCUMENTO:\n\n"
        f"{markdown_truncated}"
    )

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    body = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": user_message},
            # Prefill to force JSON output
            {"role": "assistant", "content": "{"},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                ANTHROPIC_API_URL,
                headers=headers,
                json=body,
            )

        if response.status_code != 200:
            logger.error(
                "Claude API error %d: %s",
                response.status_code,
                response.text[:500],
            )
            return None

        data = response.json()
        raw_text = data.get("content", [{}])[0].get("text", "")

        # Prepend the '{' we used as prefill
        raw_json = "{" + raw_text

        # Clean up: remove trailing text after the last }
        last_brace = raw_json.rfind("}")
        if last_brace > 0:
            raw_json = raw_json[: last_brace + 1]

        parsed = json.loads(raw_json)

        # Validate with Pydantic
        try:
            result = M720DocumentExtraction.model_validate(parsed)
        except Exception as val_err:
            logger.warning(
                "Claude: Pydantic full validation failed, trying per-array: %s",
                val_err,
            )
            result = M720DocumentExtraction(
                cuentas=[],
                valores=[],
                iics=[],
                seguros=[],
                inmuebles=[],
            )
            for c in parsed.get("cuentas", []):
                try:
                    result.cuentas.append(M720Cuenta.model_validate(c))
                except Exception:
                    pass
            for v in parsed.get("valores", []):
                try:
                    result.valores.append(M720Valor.model_validate(v))
                except Exception:
                    pass
            for i in parsed.get("iics", []):
                try:
                    result.iics.append(M720IIC.model_validate(i))
                except Exception:
                    pass
            for s in parsed.get("seguros", []):
                try:
                    result.seguros.append(M720Seguro.model_validate(s))
                except Exception:
                    pass
            for b in parsed.get("inmuebles", []):
                try:
                    result.inmuebles.append(M720Inmueble.model_validate(b))
                except Exception:
                    pass

        n_total = (
            len(result.cuentas)
            + len(result.valores)
            + len(result.iics)
            + len(result.seguros)
            + len(result.inmuebles)
        )

        logger.info(
            "CLAUDE FALLBACK: %d assets (C:%d V:%d I:%d S:%d B:%d) via %s",
            n_total,
            len(result.cuentas),
            len(result.valores),
            len(result.iics),
            len(result.seguros),
            len(result.inmuebles),
            model,
        )

        return result if n_total > 0 else None

    except json.JSONDecodeError as e:
        logger.error("Claude: JSON parse failed: %s", e)
        return None
    except httpx.TimeoutException:
        logger.error("Claude: timeout after %.0fs", timeout_seconds)
        return None
    except Exception as e:
        logger.error("Claude fallback failed: %s", e, exc_info=True)
        return None
