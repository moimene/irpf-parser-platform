"""
Harvey AI Cognitive Engine — Universal Parser con Map-Reduce.

Motor asíncrono para extraer activos M720 de documentos bancarios desconocidos
usando Harvey AI (API REST v2 Completion) + validación ISIN Luhn.

Patrón Map-Reduce:
  1. Trocea documentos Markdown largos por saltos de página (Docling \n---\n)
  2. Lanza peticiones en paralelo con semáforo de concurrencia
  3. Fusiona resultados con validación ISIN Luhn y deduplicación

Harvey API v2 Completion:
  - Endpoint: POST /api/v2/completion
  - Content-Type: multipart/form-data
  - Auth: Bearer token
  - Docs: https://developers.harvey.ai/guides/assistant

Requiere variables de entorno:
  HARVEY_TOKEN    — Bearer token para Harvey AI
  HARVEY_BASE_URL — (opcional) default: https://eu.api.harvey.ai
"""

import asyncio
import json
import logging
import os
import re
from typing import Dict, List, Literal, Optional, Set

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.extractors.base import validate_isin_luhn

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# Pydantic Schemas para validación de respuesta Harvey
# ─────────────────────────────────────────────────────────────────────


class M720Asset(BaseModel):
    """Un activo financiero individual para declaración del Modelo 720 español."""

    isin: Optional[str] = None
    name: str = ""
    asset_type: Literal["CUENTA", "VALOR", "FONDO", "SEGURO", "DESCONOCIDO"] = "DESCONOCIDO"
    currency: str = "EUR"
    balance_dec_31: Optional[float] = None
    shares_count: Optional[float] = None
    country_code: Optional[str] = None
    entity_name: Optional[str] = None


class M720ExtractionChunk(BaseModel):
    """Resultado de extracción de un bloque/página de un documento bancario."""

    assets: List[M720Asset] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────
# System Prompt para M720 (Prompt Engineering optimizado)
# ─────────────────────────────────────────────────────────────────────

M720_SYSTEM_PROMPT = """\
Eres un experto analista de wealth management y fiscalista español \
especializado en el Modelo 720 (declaración informativa de bienes y \
derechos en el extranjero ante la AEAT).

Tu objetivo es analizar secciones de extractos bancarios en formato \
Markdown y extraer TODAS las posiciones financieras declarables a 31 \
de diciembre.

REGLAS ESTRICTAS:
1. Extrae SOLAMENTE los saldos finales a 31 de diciembre (posiciones \
   de cierre del ejercicio fiscal). NO extraigas movimientos intermedios.
2. IGNORA por completo el histórico de compras, ventas, dividendos, \
   intereses cobrados o cualquier movimiento que no sea la posición final.
3. Convierte formatos numéricos europeos (1.500,50) a floats puros \
   (1500.50). Usa punto como separador decimal.
4. Si encuentras un código ISIN (2 letras + 9 alfanuméricos + 1 dígito \
   de control), inclúyelo EXACTAMENTE como aparece en el documento.
5. Clasifica cada activo según su naturaleza financiera: CUENTA para \
   cuentas bancarias, VALOR para instrumentos con ISIN (acciones, bonos, \
   ETFs), FONDO para fondos de inversión/IIC, SEGURO para pólizas de \
   seguros de vida.
6. NO inventes datos. Si un campo no está claro, devuélvelo como null.
7. Presta especial atención a las tablas Markdown con cabeceras como \
   "ISIN", "Valor de Mercado", "Saldo", "Cantidad", "Market Value", \
   "Balance", "Position", "Posición", "NAV", "Shares", etc.
8. Si el mismo activo aparece varias veces (portada vs detalle), extrae \
   SOLO la instancia con más datos (normalmente la tabla detallada).
9. Identifica el país de la entidad financiera cuando sea posible \
   (ej: Suiza=CH, Luxemburgo=LU, Reino Unido=GB).
10. NO extraigas líneas de resumen o agregación de cartera como \
   "Bonos", "Renta variable", "Renta fija", "Inversiones alternativas", \
   "Liquidez", "Efectivo", "Total cartera", "Patrimonio neto", etc. \
   Estos son subtotales de categoría, NO activos individuales declarables. \
   Solo extrae posiciones individuales con nombre específico de producto, \
   fondo o cuenta.

FORMATO DE RESPUESTA:
Responde EXCLUSIVAMENTE con un JSON válido con esta estructura exacta:
{
  "assets": [
    {
      "isin": "string o null",
      "name": "nombre descriptivo del activo",
      "asset_type": "CUENTA|VALOR|FONDO|SEGURO|DESCONOCIDO",
      "currency": "EUR|USD|CHF|GBP|...",
      "balance_dec_31": 1234.56,
      "shares_count": 100.000,
      "country_code": "CH|LU|US|...",
      "entity_name": "nombre del banco o gestora"
    }
  ]
}

NO incluyas texto explicativo, comentarios ni markdown. Solo el JSON puro."""


# ─────────────────────────────────────────────────────────────────────
# Utilidades para parsear JSON de respuestas de texto libre
# ─────────────────────────────────────────────────────────────────────


def _extract_json_from_text(text: str) -> Optional[str]:
    """
    Extrae JSON de una respuesta de texto que puede contener markdown,
    explicaciones u otros artefactos.

    Estrategias:
      1. Intenta parsear el texto completo como JSON
      2. Busca bloques ```json ... ```
      3. Busca el primer { ... } que sea JSON válido
    """
    text = text.strip()

    # Estrategia 1: texto completo es JSON
    try:
        json.loads(text)
        return text
    except (json.JSONDecodeError, ValueError):
        pass

    # Estrategia 2: bloques de código markdown
    code_blocks = re.findall(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    for block in code_blocks:
        block = block.strip()
        try:
            json.loads(block)
            return block
        except (json.JSONDecodeError, ValueError):
            continue

    # Estrategia 3: buscar { ... } más exterior
    brace_start = text.find("{")
    if brace_start >= 0:
        depth = 0
        for i in range(brace_start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    candidate = text[brace_start : i + 1]
                    try:
                        json.loads(candidate)
                        return candidate
                    except (json.JSONDecodeError, ValueError):
                        break

    return None


# ─────────────────────────────────────────────────────────────────────
# Smart Text Splitter para páginas grandes
# ─────────────────────────────────────────────────────────────────────


def _split_text_into_chunks(text: str, max_chars: int) -> List[str]:
    """
    Divide un bloque de texto grande en sub-chunks de ≤max_chars.

    Estrategia:
      1. Intenta cortar por párrafos (doble newline)
      2. Si un párrafo es demasiado largo, corta por líneas simples
      3. Si una línea es demasiado larga, corta por caracteres (último recurso)

    Preserva todo el contenido financiero — no trunca nada.
    """
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    current = ""

    # Dividir por párrafos (doble newline) primero
    paragraphs = re.split(r"\n\n+", text)

    for para in paragraphs:
        # Si el párrafo cabe en el chunk actual
        if current and len(current) + len(para) + 2 <= max_chars:
            current = f"{current}\n\n{para}"
        elif len(para) <= max_chars:
            # Guardar el chunk anterior y empezar uno nuevo
            if current:
                chunks.append(current)
            current = para
        else:
            # Párrafo demasiado largo: dividir por líneas
            if current:
                chunks.append(current)
                current = ""

            lines = para.split("\n")
            for line in lines:
                if current and len(current) + len(line) + 1 <= max_chars:
                    current = f"{current}\n{line}"
                elif len(line) <= max_chars:
                    if current:
                        chunks.append(current)
                    current = line
                else:
                    # Línea demasiado larga: cortar por caracteres
                    if current:
                        chunks.append(current)
                        current = ""
                    for i in range(0, len(line), max_chars):
                        chunks.append(line[i : i + max_chars])

    if current:
        chunks.append(current)

    # Filtrar chunks vacíos
    return [c for c in chunks if c.strip()]


# ─────────────────────────────────────────────────────────────────────
# Harvey Cognitive Engine (Map-Reduce asíncrono con API REST v2)
# ─────────────────────────────────────────────────────────────────────


class HarveyCognitiveEngine:
    """
    Motor Cognitivo Universal para Harvey AI (API REST v2).

    Diseñado para M720 y Due Diligence masivos mediante patrón Map-Reduce:
      1. Trocea documentos Markdown por saltos de página de Docling
      2. Lanza peticiones en paralelo con semáforo de concurrencia
      3. Fusiona y valida resultados (ISIN Luhn, deduplicación)
    """

    def __init__(self) -> None:
        self.token = os.getenv("HARVEY_TOKEN", "").strip()
        self.base_url = os.getenv("HARVEY_BASE_URL", "https://eu.api.harvey.ai").rstrip("/")

    @property
    def is_available(self) -> bool:
        """Comprueba si Harvey está configurado y disponible."""
        return bool(self.token)

    async def _call_completion(
        self,
        prompt: str,
        *,
        timeout: float = 90.0,
        max_retries: int = 2,
    ) -> Optional[str]:
        """
        Llama a Harvey v2 Completion y devuelve la respuesta como texto.

        Usa multipart/form-data según la especificación Harvey API v2.
        Mode 'assist' para análisis directo (no prosa client-ready).
        Stream 'false' para respuesta completa (pipeline batch).

        Incluye retry con backoff exponencial para respuestas vacías
        (Harvey puede devolver 200 OK con body vacío por rate limiting).
        """
        if not self.token:
            return None

        headers = {"Authorization": f"Bearer {self.token}"}

        for attempt in range(max_retries + 1):
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        f"{self.base_url}/api/v2/completion",
                        headers=headers,
                        # multipart/form-data fields (Harvey v2 spec)
                        files={
                            "prompt": (None, prompt, "text/plain"),
                            "mode": (None, "assist", "text/plain"),
                            "stream": (None, "false", "text/plain"),
                        },
                        timeout=timeout,
                    )
                    response.raise_for_status()
                    result = response.json()

                # Harvey puede devolver la respuesta en varios campos
                text = (
                    result.get("response")
                    or result.get("response_with_citations")
                    or result.get("text")
                    or result.get("content")
                    or ""
                )

                if text.strip():
                    return str(text)

                # Respuesta vacía — loguear las claves del JSON para diagnóstico
                logger.warning(
                    "Harvey API 200 OK pero respuesta vacía (intento %d/%d). "
                    "Claves JSON: %s, tamaño prompt: %d chars",
                    attempt + 1,
                    max_retries + 1,
                    list(result.keys()),
                    len(prompt),
                )

                # Si quedan reintentos, esperar con backoff exponencial
                if attempt < max_retries:
                    wait = 2 ** (attempt + 1)  # 2s, 4s
                    logger.info("Reintentando Harvey en %ds...", wait)
                    await asyncio.sleep(wait)
                    continue

                return ""  # Agotados los reintentos

            except httpx.HTTPStatusError as e:
                logger.error(
                    "Harvey API error HTTP %d (intento %d/%d): %s",
                    e.response.status_code,
                    attempt + 1,
                    max_retries + 1,
                    e.response.text[:300],
                )
                if attempt < max_retries:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return None
            except httpx.TimeoutException:
                logger.error(
                    "Harvey API timeout %ds (intento %d/%d)",
                    timeout,
                    attempt + 1,
                    max_retries + 1,
                )
                if attempt < max_retries:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return None
            except Exception as e:
                logger.error("Harvey API error inesperado: %s", e, exc_info=True)
                return None

        return None  # Fallback (no debería llegar aquí)

    async def extract_structured(self, markdown_chunk: str) -> Optional[M720ExtractionChunk]:
        """
        Envía un chunk de markdown a Harvey y parsea la respuesta JSON
        como M720ExtractionChunk.
        """
        prompt = f"{M720_SYSTEM_PROMPT}\n\nDOCUMENTO MARKDOWN:\n\n{markdown_chunk}"

        logger.info("Harvey API: enviando prompt de %d chars (%d chunk + %d system)",
                     len(prompt), len(markdown_chunk), len(M720_SYSTEM_PROMPT))

        text = await self._call_completion(prompt)
        if not text:
            logger.warning("Harvey API devolvió respuesta vacía o None para chunk de %d chars", len(markdown_chunk))
            return None

        logger.info("Harvey API: respuesta recibida (%d chars)", len(text))

        # Extraer JSON de la respuesta de texto
        json_str = _extract_json_from_text(text)
        if not json_str:
            logger.warning(
                "Harvey devolvió texto sin JSON válido (%d chars): %.200s...",
                len(text),
                text,
            )
            return None

        try:
            return M720ExtractionChunk.model_validate_json(json_str)
        except ValidationError as e:
            logger.warning("Harvey JSON no pasa validación Pydantic: %s", e)
            # Intentar parseo más permisivo
            try:
                raw = json.loads(json_str)
                # Si es una lista directa de assets, envolver
                if isinstance(raw, list):
                    return M720ExtractionChunk(assets=[M720Asset(**a) for a in raw])
                # Si tiene "assets" como key
                if isinstance(raw, dict) and "assets" in raw:
                    return M720ExtractionChunk(
                        assets=[M720Asset(**a) for a in raw["assets"] if isinstance(a, dict)]
                    )
            except Exception:
                pass
            return None

    async def map_reduce_extraction(
        self,
        full_markdown: str,
        *,
        chunk_max_chars: int = 15_000,
        max_concurrency: int = 3,
    ) -> List[M720ExtractionChunk]:
        """
        Motor Map-Reduce para documentos masivos.

        Harvey API v2 tiene un límite de 20,000 chars por prompt.
        Con el system prompt (~1,500 chars) + wrapper, fijamos chunks
        en 15,000 chars para dejar margen seguro.

        1. SPLIT: trocea el Markdown por el delimitador de página de Docling (\\n---\\n)
        2. SUB-SPLIT: páginas grandes se dividen por párrafos/líneas en sub-chunks
        3. GROUP: agrupa páginas pequeñas en bloques de ~chunk_max_chars
        4. MAP: lanza peticiones en paralelo con semáforo de concurrencia
        5. REDUCE: filtra errores y retorna solo resultados exitosos
        """
        # SPLIT: por saltos de página de Docling
        raw_pages = full_markdown.split("\n---\n")

        # SUB-SPLIT: si una página excede el límite, dividirla por párrafos
        # en lugar de truncar (preservamos todo el contenido financiero)
        pages: List[str] = []
        for page in raw_pages:
            if len(page) <= chunk_max_chars:
                pages.append(page)
            else:
                sub_chunks = _split_text_into_chunks(page, chunk_max_chars)
                logger.info(
                    "Página grande (%d chars) dividida en %d sub-chunks de ≤%d chars",
                    len(page),
                    len(sub_chunks),
                    chunk_max_chars,
                )
                pages.extend(sub_chunks)

        # GROUP: agrupa páginas/sub-chunks pequeños en bloques
        chunks: List[str] = []
        current_chunk = ""

        for page in pages:
            if current_chunk and len(current_chunk) + len(page) + 5 > chunk_max_chars:
                chunks.append(current_chunk)
                current_chunk = page
            else:
                separator = "\n---\n" if current_chunk else ""
                current_chunk = f"{current_chunk}{separator}{page}"

        if current_chunk:
            chunks.append(current_chunk)

        logger.info(
            "Harvey Map-Reduce: %d páginas originales → %d sub-páginas → %d bloques (max %d chars/bloque)",
            len(raw_pages),
            len(pages),
            len(chunks),
            chunk_max_chars,
        )
        for i, chunk in enumerate(chunks):
            logger.info("  Bloque %d: %d chars", i + 1, len(chunk))

        # MAP: lanzar en paralelo con semáforo
        semaphore = asyncio.Semaphore(max_concurrency)

        async def sem_task(idx: int, chunk: str) -> Optional[M720ExtractionChunk]:
            async with semaphore:
                logger.debug("Harvey bloque %d/%d (%d chars)", idx + 1, len(chunks), len(chunk))
                return await self.extract_structured(chunk)

        tasks = [sem_task(i, chunk) for i, chunk in enumerate(chunks)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # REDUCE: filtrar errores y None
        valid_results: List[M720ExtractionChunk] = []
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                logger.error("Harvey bloque %d/%d falló: %s", i + 1, len(chunks), r)
            elif r is not None:
                valid_results.append(r)

        logger.info(
            "Harvey Map-Reduce completado: %d/%d bloques exitosos",
            len(valid_results),
            len(chunks),
        )

        return valid_results


# ─────────────────────────────────────────────────────────────────────
# Singleton global
# ─────────────────────────────────────────────────────────────────────

harvey_engine = HarveyCognitiveEngine()


# ─────────────────────────────────────────────────────────────────────
# Caso de uso: Parser Universal M720 con Aduana Matemática
# ─────────────────────────────────────────────────────────────────────

def _extract_account_number(description: str) -> str:
    """
    Extrae el número de cuenta de una descripción Harvey.

    Harvey puede generar nombres distintos para la misma cuenta:
      "Cuenta corriente EUR/000 - LU682509197751011000"
      "Cuenta EUR LU682509197751011000"

    Estrategia: buscar la secuencia alfanumérica más larga (≥6 chars)
    que contenga dígitos — eso es el número de cuenta.
    """
    # Buscar todas las secuencias alfanuméricas de 6+ chars que contengan dígitos
    candidates = re.findall(r"[A-Za-z0-9]{6,}", description)
    # Filtrar solo las que tienen al menos un dígito (evitar "Cuenta", "corriente", etc.)
    with_digits = [c for c in candidates if re.search(r"\d", c)]
    if with_digits:
        # Retornar la más larga (= número de cuenta, no prefijos como "EUR")
        return max(with_digits, key=len).upper()
    # Fallback: normalizar nombre completo
    return re.sub(r"\s+", " ", description.strip().lower())


def _normalize_name_for_dedup(name: str) -> str:
    """
    Normaliza un nombre de activo para deduplicación.

    Harvey puede describir el mismo fondo/valor de formas distintas en
    resumen vs detalle. Estrategia: eliminar ruido y quedarnos con
    las palabras clave.
    """
    # Minúsculas, eliminar puntuación, comprimir espacios
    cleaned = re.sub(r"[^a-záéíóúñüA-ZÁÉÍÓÚÑÜ0-9\s]", " ", name.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Eliminar palabras genéricas que varían entre chunks
    noise_words = {"fund", "fondo", "class", "clase", "acc", "dis", "inc",
                   "plc", "sicav", "ucits", "sub", "the", "de", "del", "la", "el"}
    words = [w for w in cleaned.split() if w not in noise_words and len(w) > 1]
    return " ".join(words)


# ─────────────────────────────────────────────────────────────────────
# Filtro de entradas de agregación/resumen de cartera
# ─────────────────────────────────────────────────────────────────────

# Nombres genéricos que representan totales de cartera, no activos individuales
_AGGREGATION_PATTERNS: List[str] = [
    r"^bonos?\s*$",
    r"^renta\s+(fija|variable)\s*$",
    r"^(inversiones?\s+)?alternativas?\s*$",
    r"^liquidez\s*$",
    r"^(total|subtotal|suma|resumen)\b",
    r"^efectivo\s*$",
    r"^cash\s*$",
    r"^money\s+market\s*$",
    r"^commodities?\s*$",
    r"^(structured|productos?\s+estructurados?)\s*$",
    r"^patrimonio\s+(total|neto)\s*$",
    r"^(cartera|portfolio|portafolio)\s*(total)?\s*$",
    r"^(acciones?|equit(y|ies))\s*$",
    r"^(obligaciones?|bonds?)\s*$",
    r"^(hedge\s+fund|private\s+equity)\s*$",
    r"^(fixed\s+income|equity|real\s+estate)\s*$",
]

_AGGREGATION_RE = re.compile(
    "|".join(_AGGREGATION_PATTERNS), re.IGNORECASE
)


def _is_aggregation_entry(name: str) -> bool:
    """
    Detecta si un nombre de activo es en realidad una categoría/agregación
    de cartera (ej: "Bonos", "Renta variable", "Inversiones alternativas").

    Estos no son activos individuales declarables en el Modelo 720 —
    son líneas resumen de una cartera que incluyen subtotales.
    """
    cleaned = name.strip()
    if not cleaned:
        return True  # Nombre vacío = no declarable

    return bool(_AGGREGATION_RE.match(cleaned))


def _is_garbage_name(name: str) -> bool:
    """
    Detecta nombres de activo basura/truncados que Harvey genera por
    fragmentación del markdown (ej: "Fund", "PLC", "SICAV").

    Criterio: después de normalizar y eliminar noise words, quedan
    menos de 5 caracteres significativos → no es un nombre real.
    """
    normalized = _normalize_name_for_dedup(name)
    return len(normalized) < 5


# Mapeo de asset_type Harvey → clave_bien M720
_ASSET_TYPE_TO_CLAVE: Dict[str, str] = {
    "CUENTA": "C",
    "VALOR": "V",
    "FONDO": "I",
    "SEGURO": "S",
    "DESCONOCIDO": "V",  # Conservador: tratamos desconocidos como valores
}


async def extract_unknown_bank_harvey(markdown_text: str) -> List[Dict[str, object]]:
    """
    Extrae activos M720 de un banco desconocido usando Harvey AI.

    Pipeline:
      1. Map-Reduce sobre el markdown del documento
      2. Aduana Matemática: validación ISIN Luhn (ISO 6166)
         - ISIN válido → confidence 0.99 (Harvey + Luhn = certeza)
         - ISIN inválido → isin=None, confidence 0.60 (revisión manual)
      3. Deduplicación por ISIN (evita duplicados portada/detalle)

    Returns:
        Lista de dicts con campos compatibles con ParsedRecord.fields
    """
    if not harvey_engine.is_available:
        logger.warning("Harvey AI no configurado (HARVEY_TOKEN ausente). Saltando motor universal.")
        return []

    # Map-Reduce: trocea y extrae en paralelo
    chunk_results = await harvey_engine.map_reduce_extraction(
        full_markdown=markdown_text,
    )

    if not chunk_results:
        logger.info("Harvey no extrajo ningún resultado del documento.")
        return []

    # Aduana Matemática: validar ISINs + deduplicar + filtrar agregaciones
    final_records: List[Dict[str, object]] = []
    # ISIN index: para M720 se declara UNA línea por ISIN con el VALOR TOTAL.
    # Si el mismo ISIN aparece en dos lotes (distintas fechas de compra),
    # SUMAMOS importes y participaciones en lugar de descartar.
    isin_index: Dict[str, int] = {}  # ISIN → index en final_records (registro acumulado)
    isin_lots: Dict[str, List[float]] = {}  # ISIN → lista de importes de lotes ya vistos
    # Dedup cuentas por nº de cuenta + moneda (sin importe — misma cuenta puede
    # aparecer con saldos distintos en resumen vs detalle). Guardamos el índice
    # en final_records para poder reemplazar con el saldo mayor.
    account_index: Dict[str, int] = {}  # account_key → index en final_records
    # Cross-ISIN name index: nombre normalizado → ISIN. Permite detectar
    # activos sin ISIN que son duplicados de uno que SÍ tiene ISIN.
    isin_name_index: Dict[str, str] = {}  # normalized_name → ISIN
    seen_names: Set[str] = set()  # Dedup fondos/valores sin ISIN por nombre normalizado
    seen_amounts: Set[str] = set()  # Dedup secundario: importe+moneda+país para non-ISIN
    aggregation_count = 0
    garbage_count = 0
    isin_merged_count = 0  # Lotes del mismo ISIN fusionados

    for chunk in chunk_results:
        for asset in chunk.assets:
            # ── Filtro de agregación: descartar totales de cartera ──
            if _is_aggregation_entry(asset.name):
                aggregation_count += 1
                logger.info(
                    "Filtro agregación: '%s' (%s, %.2f %s) descartado — es categoría/subtotal de cartera",
                    asset.name,
                    asset.asset_type,
                    asset.balance_dec_31 or 0,
                    asset.currency,
                )
                continue

            # ── Filtro de nombres basura/truncados (ej: "Fund", "PLC") ──
            if not asset.isin and _is_garbage_name(asset.name):
                garbage_count += 1
                logger.info(
                    "Filtro basura: '%s' (%s, %.2f %s) descartado — nombre demasiado genérico/truncado",
                    asset.name,
                    asset.asset_type,
                    asset.balance_dec_31 or 0,
                    asset.currency,
                )
                continue

            confidence = 0.95  # Alta confianza base por venir de Harvey
            clean_isin: Optional[str] = None

            # Validación ISIN con algoritmo Luhn (ISO 6166)
            if asset.isin:
                candidate = asset.isin.upper().replace(" ", "").replace("-", "")

                if validate_isin_luhn(candidate):
                    # Harvey + Luhn = máxima confianza
                    confidence = 0.99
                    clean_isin = candidate

                    # Dedup multi-lote inteligente: mismo ISIN puede aparecer por:
                    # a) Lotes diferentes (distinta fecha de compra) → SUMAR
                    # b) Resumen + detalle (mismo importe) → DESCARTAR duplicado
                    # Regla: si el importe ya se vio para este ISIN → duplicado.
                    #         si es un importe nuevo → lote adicional, sumar.
                    if clean_isin in isin_index:
                        add_amount = float(asset.balance_dec_31 or 0)
                        known_lots = isin_lots.get(clean_isin, [])

                        # Comprobar si este importe ya lo vimos (tolerancia ±1%)
                        is_dup = any(
                            abs(add_amount - lot) < max(1.0, abs(lot) * 0.01)
                            for lot in known_lots
                        )
                        if is_dup:
                            logger.debug(
                                "Dedup ISIN resumen/detalle: %s importe %.2f ya visto, descartando",
                                clean_isin, add_amount,
                            )
                            continue

                        # Importe nuevo → es un lote adicional → SUMAR
                        prev_idx = isin_index[clean_isin]
                        prev_rec = final_records[prev_idx]
                        prev_amount = float(prev_rec.get("amount") or 0)
                        prev_qty = (
                            float(prev_rec["quantity"])
                            if prev_rec.get("quantity") is not None
                            else None
                        )
                        add_qty = (
                            float(asset.shares_count)
                            if asset.shares_count is not None
                            else None
                        )

                        new_amount = prev_amount + add_amount
                        new_qty: Optional[float] = None
                        if prev_qty is not None and add_qty is not None:
                            new_qty = prev_qty + add_qty
                        elif add_qty is not None:
                            new_qty = add_qty
                        elif prev_qty is not None:
                            new_qty = prev_qty

                        final_records[prev_idx]["amount"] = new_amount
                        if new_qty is not None:
                            final_records[prev_idx]["quantity"] = new_qty

                        isin_lots[clean_isin].append(add_amount)
                        isin_merged_count += 1
                        logger.info(
                            "Dedup ISIN multi-lote: %s fusionado — %.2f + %.2f = %.2f %s",
                            clean_isin, prev_amount, add_amount, new_amount,
                            asset.currency,
                        )
                        continue
                    # Primer registro de este ISIN
                    isin_index[clean_isin] = len(final_records)
                    isin_lots[clean_isin] = [float(asset.balance_dec_31 or 0)]
                    # Registrar nombre normalizado → ISIN para cross-ISIN name dedup
                    norm_name = _normalize_name_for_dedup(asset.name)
                    if norm_name:
                        isin_name_index[norm_name] = clean_isin
                else:
                    # Harvey confundió un código interno del banco con un ISIN → anulamos
                    logger.warning(
                        "Harvey alucinó ISIN inválido: %s (Luhn failed) → marcando para revisión manual",
                        asset.isin,
                    )
                    clean_isin = None
                    confidence = 0.60  # Forzar revisión manual del fiscalista

            # ── Dedup para activos SIN ISIN válido ──
            if not clean_isin:
                if asset.asset_type == "CUENTA":
                    # Dedup cuentas por número de cuenta + moneda (SIN importe).
                    # La misma cuenta puede aparecer con saldos distintos en
                    # resumen vs detalle; nos quedamos con el saldo mayor.
                    account_number = _extract_account_number(asset.name)
                    account_key = f"{account_number}|{asset.currency}"
                    current_balance = abs(asset.balance_dec_31) if asset.balance_dec_31 is not None else 0.0

                    if account_key in account_index:
                        prev_idx = account_index[account_key]
                        prev_balance = abs(float(final_records[prev_idx].get("amount") or 0))
                        if current_balance > prev_balance:
                            logger.info(
                                "Dedup cuenta: '%s' reemplaza saldo %.2f → %.2f (mayor)",
                                account_key, prev_balance, current_balance,
                            )
                            # Reemplazamos el registro anterior con el saldo mayor
                            final_records[prev_idx] = None  # type: ignore[assignment]  # marcamos para limpiar
                            # NO continue: dejamos que se añada abajo con el saldo mayor
                        else:
                            logger.info(
                                "Dedup cuenta: '%s' saldo %.2f ≤ existente %.2f, descartando",
                                account_key, current_balance, prev_balance,
                            )
                            continue
                    account_index[account_key] = len(final_records)  # nuevo índice
                else:
                    # Cross-ISIN name dedup: si un activo sin ISIN tiene el mismo nombre
                    # normalizado que uno con ISIN, comprobamos si es un lote nuevo
                    # (importe diferente → SUMAR) o un duplicado (importe ya visto → DESCARTAR).
                    normalized = _normalize_name_for_dedup(asset.name)
                    if normalized and normalized in isin_name_index:
                        matched_isin = isin_name_index[normalized]
                        if matched_isin in isin_index:
                            add_amount = float(asset.balance_dec_31 or 0)
                            known_lots = isin_lots.get(matched_isin, [])

                            # ¿Importe ya visto para este ISIN? → duplicado
                            is_dup = any(
                                abs(add_amount - lot) < max(1.0, abs(lot) * 0.01)
                                for lot in known_lots
                            )
                            if is_dup:
                                logger.info(
                                    "Cross-ISIN name dedup: '%s' importe %.2f ya visto en ISIN %s, descartando",
                                    asset.name, add_amount, matched_isin,
                                )
                                continue

                            # Importe nuevo → lote adicional → SUMAR
                            prev_idx = isin_index[matched_isin]
                            prev_rec = final_records[prev_idx]
                            prev_amount = float(prev_rec.get("amount") or 0)
                            prev_qty = (
                                float(prev_rec["quantity"])
                                if prev_rec.get("quantity") is not None
                                else None
                            )
                            add_qty = (
                                float(asset.shares_count)
                                if asset.shares_count is not None
                                else None
                            )

                            new_amount = prev_amount + add_amount
                            new_qty: Optional[float] = None
                            if prev_qty is not None and add_qty is not None:
                                new_qty = prev_qty + add_qty
                            elif add_qty is not None:
                                new_qty = add_qty
                            elif prev_qty is not None:
                                new_qty = prev_qty

                            final_records[prev_idx]["amount"] = new_amount
                            if new_qty is not None:
                                final_records[prev_idx]["quantity"] = new_qty

                            isin_lots[matched_isin].append(add_amount)
                            isin_merged_count += 1
                            logger.info(
                                "Cross-ISIN name dedup: '%s' fusionado con ISIN %s — "
                                "%.2f + %.2f = %.2f %s",
                                asset.name, matched_isin, prev_amount, add_amount,
                                new_amount, asset.currency,
                            )
                            continue

                    # Dedup fondos/valores sin ISIN por nombre normalizado + moneda + importe
                    # Harvey puede describir el mismo fondo en resumen vs detalle con
                    # nombres ligeramente distintos. Normalizamos eliminando ruido.
                    amount_key = f"{asset.balance_dec_31:.2f}" if asset.balance_dec_31 is not None else "none"
                    name_key = f"{normalized}|{asset.currency}|{amount_key}"
                    if name_key in seen_names:
                        logger.info(
                            "Dedup %s sin ISIN: '%s' ya visto (key: %s), descartando duplicado",
                            asset.asset_type, asset.name, name_key,
                        )
                        continue
                    seen_names.add(name_key)

            # ── Dedup secundario por importe: captura duplicados con nombres distintos ──
            # Harvey puede generar el mismo activo con nombres completamente diferentes
            # en resumen ("Fund") vs detalle ("BlackRock Global Funds SICAV - Asian Dragon").
            # Si ya tenemos un activo con ISIN para ese mismo (moneda, importe, país),
            # descartamos este sin-ISIN como duplicado del detallado.
            if not clean_isin and asset.balance_dec_31 is not None:
                amount_dup_key = f"{asset.currency}|{asset.balance_dec_31:.2f}|{asset.country_code or ''}"
                if amount_dup_key in seen_amounts:
                    logger.info(
                        "Dedup importe: '%s' (%s %.2f %s) descartado — mismo importe/moneda/país ya visto",
                        asset.name,
                        asset.currency,
                        asset.balance_dec_31,
                        asset.country_code or "??",
                    )
                    continue
                seen_amounts.add(amount_dup_key)

            # Extraer país del ISIN si disponible, o usar el proporcionado por Harvey
            country_code = asset.country_code or ""
            if clean_isin and not country_code:
                country_code = clean_isin[:2]  # Primeros 2 chars del ISIN = país ISO

            # Registrar el importe para activos CON ISIN también (para el dedup secundario)
            if clean_isin and asset.balance_dec_31 is not None:
                amount_dup_key = f"{asset.currency}|{asset.balance_dec_31:.2f}|{country_code}"
                seen_amounts.add(amount_dup_key)

            clave_bien = _ASSET_TYPE_TO_CLAVE.get(asset.asset_type, "V")

            final_records.append(
                {
                    # Campos estándar ParsedRecord.fields
                    "isin": clean_isin,
                    "description": asset.name,
                    "amount": asset.balance_dec_31,
                    "currency": asset.currency,
                    "quantity": asset.shares_count,
                    # Campos M720 extendidos
                    "asset_type": asset.asset_type,
                    "clave_bien": clave_bien,
                    "country_code": country_code,
                    "entity_name": asset.entity_name,
                    "confidence": confidence,
                    "requires_manual_review": confidence < 0.80,
                    "strategy": "harvey_universal_parser",
                }
            )

    # Limpiar registros marcados como None (cuentas reemplazadas por saldo mayor)
    final_records = [r for r in final_records if r is not None]

    total_raw = sum(len(c.assets) for c in chunk_results)
    total_filtered = aggregation_count + garbage_count
    total_deduped = total_raw - len(final_records) - total_filtered
    logger.info(
        "Harvey M720: %d activos finales de %d brutos "
        "(%d ISINs únicos, %d lotes fusionados, %d cuentas únicas, %d fondos/valores únicos, "
        "%d agregaciones filtradas, %d basura filtrada, %d dupes descartados)",
        len(final_records),
        total_raw,
        len(isin_index),
        isin_merged_count,
        len(account_index),
        len(seen_names),
        aggregation_count,
        garbage_count,
        total_deduped,
    )

    return final_records
