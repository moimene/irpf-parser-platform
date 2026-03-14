"""
OpenAI Universal Engine — Extractor M720 con Structured Outputs.

Motor asíncrono para extraer activos M720 de documentos bancarios usando
OpenAI gpt-4o con Structured Outputs (response_format = Pydantic model).

Patrón Map-Reduce (mismo concepto que Harvey, distinta implementación):
  1. Trocea documentos Markdown por saltos de página (Docling \\n---\\n)
  2. Lanza peticiones en paralelo con semáforo de concurrencia
  3. Fusiona resultados con validación ISIN Luhn y deduplicación

Structured Outputs garantizan JSON tipado sin necesidad de parseo manual.
Las descripciones de cada Field() en m720_boe_v2.py guían la extracción.

FORK LÓGICO: Este módulo es completamente independiente de harvey_engine.py.
No comparten código de ejecución; solo reutilizan utilidades comunes
(validate_isin_luhn, _split_text_into_chunks).

Requiere variable de entorno:
  OPENAI_API_KEY — API key de OpenAI
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Dict, List, Optional, Set

from openai import AsyncOpenAI

from app.extractors.base import validate_isin_luhn
from app.schemas.m720_boe_v2 import (
    CoverageWarning,
    ExtractionCoverage,
    M720Cuenta,
    M720DocumentExtraction,
    M720IIC,
    M720Inmueble,
    M720Seguro,
    M720Valor,
)

try:
    import ftfy as _ftfy
    _HAS_FTFY = True
except ImportError:
    _HAS_FTFY = False

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────
# System Prompt para OpenAI Structured Outputs
# ─────────────────────────────────────────────────────────────────────

M720_OPENAI_SYSTEM_PROMPT = """\
Eres un experto analista de wealth management y fiscalista español \
especializado en el Modelo 720 (declaración informativa de bienes y \
derechos en el extranjero ante la AEAT).

Analizas secciones de extractos bancarios convertidos a Markdown por OCR \
y extraes TODAS las posiciones financieras declarables a 31 de diciembre.

REGLAS DE EXTRACCIÓN:

1. SOLO saldos finales a 31 de diciembre (posiciones de cierre del \
   ejercicio fiscal). IGNORA movimientos intermedios (compras, ventas, \
   dividendos, intereses, cupones).

2. Convierte formatos numéricos europeos (1.500,50) a floats (1500.50).

3. Extrae códigos ISIN (2 letras + 9 alfanum + 1 check digit) tal cual \
   aparecen en el documento.

4. CLASIFICACIÓN:
   - Cuentas bancarias → cuentas (Clave C)
   - Acciones, ETFs, bonos, warrants, derivados → valores (Clave V)
   - Fondos de inversión (UCITS, SICAV, ICAV, hedge funds) → iics (Clave I)
   - Seguros de vida/invalidez, unit-linked → seguros (Clave S)
   - Propiedades inmobiliarias → inmuebles (Clave B)

5. REGLA V vs I (PRIORIDAD: ETF > Fund/SICAV):
   ⚠ PRIMERO comprobar si es ETF: si el nombre contiene "ETF" \
   → SIEMPRE es V (valor), aunque el ISIN sea IE/LU y el emisor \
   contenga "PLC", "Fund", "SICAV" o "UCITS":
     ETF de renta variable → V(A)
     ETF de renta fija/bonos → V(B)
     ETF de commodities/materias primas → V(A)
   Ejemplos de ETFs que son V (NO I):
     - "iShares IV PLC - iShares Edge MSCI USA Value Factor UCITS ETF" → V(A)
     - "Vanguard Funds PLC - Vanguard S&P 500 UCITS ETF" → V(A)
     - "SPDR ETFs Europe I PLC - SPDR S&P Euro Dividend UCITS ETF" → V(A)
     - "iShares II PLC - iShares USD TIPS 0-5 UCITS ETF" → V(B)
     - "Xtrackers SICAV - Xtrackers DBLCI Commodity UCITS ETF" → V(A)
   SOLO SI no es ETF: ISIN IE/LU + nombre contiene "Fund"/"SICAV"\
   /"UCITS"/"ICAV"/"PLC" → I (fondo de inversión)
   - Acción individual, ADR → V(A)
   - Bono corporativo/gubernamental → V(B)
   - Warrant, nota estructurada, derivado, tracker certificado → V(C)

6. NO inventes datos. Si un campo no es visible, devuélvelo como null.

7. NO extraigas líneas de resumen o agregación de cartera como \
   "Bonos", "Renta variable", "Renta fija", "Total cartera", etc. \
   Solo posiciones individuales con nombre específico.

8. Los importes deben estar en la MONEDA ORIGINAL del extracto, \
   sin convertir a EUR. Indica la moneda en el campo moneda_original.

9. Infiere el país de la entidad del ISIN (primeros 2 chars), de la \
   dirección de la entidad, o del código BIC/SWIFT.

10. Por defecto: condicion_declarante="Titular", origen_bien_derecho="A", \
    porcentaje_participacion=100.0 (salvo que el documento indique otra cosa).

11. INCLUIR TODAS las cuentas del extracto, incluso con saldo CERO, \
    saldo negativo (descubierto) o saldo ínfimo (ej: 1.93 CHF). \
    La AEAT exige declarar toda cuenta abierta a 31 de diciembre, \
    independientemente del saldo. Cada divisa es una cuenta separada.

12. INCLUIR posiciones con valor de mercado muy bajo o cercano a cero \
    (warrants vencidos, notas estructuradas expiradas, certificados \
    con valor residual). Si la posición aparece en el extracto a 31 \
    de diciembre con cualquier valor (incluso 0.01), debe extraerse.

13. NO extraer posiciones de Mercado de Divisas (forwards de FX, \
    swaps de divisas, spots, opciones de tipo de cambio). Estas \
    operaciones de cobertura cambiaria NO son activos declarables \
    en el Modelo 720. Identificar por secciones "Mercado de divisas", \
    "FX Forwards", "Currency hedging", etc.

14. Posiciones multi-lote: si el mismo ISIN aparece múltiples veces \
    en el documento (distintas fechas de compra, distintos lotes), \
    extraer CADA lote como una entrada SEPARADA. La deduplicación \
    y suma se hará en post-procesado, no en la extracción.

15. COMPLETITUD: es CRÍTICO extraer ABSOLUTAMENTE TODAS las posiciones \
    del fragmento. No omitir ninguna, por pequeña o rara que sea. \
    Incluir todo tipo de fondos alternativos (hedge funds, long/short, \
    systematic/quant, convertibles, materias primas, private equity, \
    real estate, etc.) — TODOS son IICs declarables en el Modelo 720. \
    También incluir posiciones con valor de mercado residual, warrants \
    expirados, notas estructuradas con valor mínimo. Preferir \
    sobre-extraer (algún falso positivo) a dejar fuera una posición real.

16. MONEDA EN CARTERAS MULTI-DIVISA: cuando el extracto tiene \
    sub-cuentas o secciones por divisa, la moneda_original de cada \
    posición es la divisa de ESA SECCIÓN, NO la divisa de referencia \
    o reporting de la cartera. Cada posición hereda la moneda del \
    contexto tabular o sección donde aparece. Buscar indicadores de \
    moneda en cabeceras de tabla, títulos de sección, columnas de \
    importe, o códigos de cuenta.

17. POSICIONES MULTI-LOTE (crítico): si el mismo ISIN aparece en \
    DIFERENTES tablas, secciones o filas del fragmento con DIFERENTES \
    importes, extraer CADA aparición como una entrada separada. \
    Esto es habitual cuando el cliente tiene múltiples lotes comprados \
    en distintas fechas o a distintos precios. NO sumar ni promediar \
    — extraer cada fila tal cual. La deduplicación y agregación se \
    realizará en post-procesado automático."""


# ─────────────────────────────────────────────────────────────────────
# Text Splitter (reutilizable, misma lógica que Harvey)
# ─────────────────────────────────────────────────────────────────────


def _split_text_into_chunks(text: str, max_chars: int) -> List[str]:
    """
    Divide texto grande en sub-chunks de ≤max_chars.

    Corta por párrafos → líneas → caracteres (último recurso).
    Preserva todo el contenido financiero.
    """
    if len(text) <= max_chars:
        return [text]

    chunks: List[str] = []
    current = ""

    paragraphs = re.split(r"\n\n+", text)

    for para in paragraphs:
        if current and len(current) + len(para) + 2 <= max_chars:
            current = f"{current}\n\n{para}"
        elif len(para) <= max_chars:
            if current:
                chunks.append(current)
            current = para
        else:
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
                    if current:
                        chunks.append(current)
                        current = ""
                    for i in range(0, len(line), max_chars):
                        chunks.append(line[i : i + max_chars])

    if current:
        chunks.append(current)

    return [c for c in chunks if c.strip()]


def _fix_encoding(text: str) -> str:
    """
    Corrige artefactos de encoding mojibake (UTF-8 leído como Latin-1).
    Ejemplo: 'TrÃ¨ves' → 'Trèves'

    Usa ftfy si está disponible. Si no, retorna el texto sin cambios.
    """
    if not text:
        return text
    if _HAS_FTFY:
        return _ftfy.fix_text(text)
    return text


# ─────────────────────────────────────────────────────────────────────
# OpenAI Universal Engine
# ─────────────────────────────────────────────────────────────────────


class OpenAIUniversalEngine:
    """
    Motor de extracción M720 con OpenAI gpt-4o y Structured Outputs.

    A diferencia de Harvey (texto libre → JSON parsing manual), OpenAI
    Structured Outputs fuerza la respuesta a cumplir el schema Pydantic
    exacto, eliminando errores de formato.

    Patrón Map-Reduce:
      1. SPLIT: por saltos de página Docling (\\n---\\n)
      2. SUB-SPLIT: páginas grandes se dividen por párrafos
      3. GROUP: agrupa páginas en bloques de ≤chunk_max_chars
      4. MAP: paralelo con semáforo + Structured Outputs
      5. MERGE: fusiona M720DocumentExtraction parciales en uno
    """

    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.model = os.getenv("OPENAI_MODEL", "gpt-4o").strip()

    @property
    def is_available(self) -> bool:
        """Comprueba si OpenAI está configurado."""
        return bool(self.api_key)

    @staticmethod
    def _find_isins_in_text(text: str) -> Set[str]:
        """Encuentra todos los ISINs en un texto usando regex."""
        return set(re.findall(r"[A-Z]{2}[A-Z0-9]{9}\d", text))

    @staticmethod
    def _extracted_isins(result: M720DocumentExtraction) -> Set[str]:
        """Extrae los ISINs que GPT-4o devolvió en un M720DocumentExtraction."""
        isins: Set[str] = set()
        for v in result.valores:
            if v.identificacion_valores:
                isins.add(v.identificacion_valores)
        for i in result.iics:
            if i.identificacion_valores:
                isins.add(i.identificacion_valores)
        return isins

    async def _extract_chunk(
        self,
        markdown_chunk: str,
        *,
        timeout: float = 120.0,
        max_retries: int = 2,
    ) -> Optional[M720DocumentExtraction]:
        """
        Envía un chunk de Markdown a OpenAI y obtiene un
        M720DocumentExtraction tipado vía Structured Outputs.

        Usa client.beta.chat.completions.parse() con response_format.
        """
        if not self.api_key:
            return None

        client = AsyncOpenAI(api_key=self.api_key)

        user_message = (
            "Analiza el siguiente extracto bancario en Markdown y extrae "
            "ABSOLUTAMENTE TODOS los activos declarables para el Modelo 720. "
            "Es CRÍTICO que no omitas ninguna posición — incluye CADA fila "
            "de CADA tabla, incluyendo posiciones multi-lote (mismo ISIN, "
            "distinto importe). Presta especial atención a la moneda: usa "
            "la divisa de la sección/tabla donde aparece cada posición, "
            "NO la divisa de referencia de la cartera.\n\n"
            "DOCUMENTO MARKDOWN:\n\n"
            f"{markdown_chunk}"
        )

        for attempt in range(max_retries + 1):
            try:
                completion = await asyncio.wait_for(
                    client.beta.chat.completions.parse(
                        model=self.model,
                        temperature=0.0,
                        messages=[
                            {"role": "system", "content": M720_OPENAI_SYSTEM_PROMPT},
                            {"role": "user", "content": user_message},
                        ],
                        response_format=M720DocumentExtraction,
                    ),
                    timeout=timeout,
                )

                parsed = completion.choices[0].message.parsed
                if parsed is not None:
                    n_assets = (
                        len(parsed.cuentas)
                        + len(parsed.valores)
                        + len(parsed.iics)
                        + len(parsed.seguros)
                        + len(parsed.inmuebles)
                    )
                    logger.info(
                        "OpenAI chunk (%d chars) → %d activos "
                        "(C:%d V:%d I:%d S:%d B:%d)",
                        len(markdown_chunk),
                        n_assets,
                        len(parsed.cuentas),
                        len(parsed.valores),
                        len(parsed.iics),
                        len(parsed.seguros),
                        len(parsed.inmuebles),
                    )
                    return parsed

                # Structured Outputs puede devolver None si refused
                refusal = completion.choices[0].message.refusal
                if refusal:
                    logger.warning(
                        "OpenAI rehusó extraer (intento %d/%d): %s",
                        attempt + 1,
                        max_retries + 1,
                        refusal,
                    )
                else:
                    logger.warning(
                        "OpenAI devolvió parsed=None sin refusal (intento %d/%d)",
                        attempt + 1,
                        max_retries + 1,
                    )

                if attempt < max_retries:
                    wait = 2 ** (attempt + 1)
                    logger.info("Reintentando OpenAI en %ds...", wait)
                    await asyncio.sleep(wait)
                    continue

                return None

            except asyncio.TimeoutError:
                logger.error(
                    "OpenAI timeout %.0fs (intento %d/%d)",
                    timeout,
                    attempt + 1,
                    max_retries + 1,
                )
                if attempt < max_retries:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return None

            except Exception as e:
                logger.error(
                    "OpenAI API error (intento %d/%d): %s",
                    attempt + 1,
                    max_retries + 1,
                    e,
                    exc_info=True,
                )
                if attempt < max_retries:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return None

        return None

    async def _rescue_missing_isins(
        self,
        markdown_chunk: str,
        missing_isins: Set[str],
        *,
        timeout: float = 120.0,
    ) -> Optional[M720DocumentExtraction]:
        """
        Verification pass: consulta focalizada sobre ISINs que GPT-4o omitió.

        Extrae solo el contexto alrededor de cada ISIN faltante (±500 chars)
        y envía una consulta específica pidiendo extraer esas posiciones.
        Esto resuelve el problema de omisión en bloques densos.
        """
        if not self.api_key or not missing_isins:
            return None

        # Extraer contexto local alrededor de cada ISIN faltante
        isin_contexts: List[str] = []
        for isin in sorted(missing_isins):
            pos = markdown_chunk.find(isin)
            if pos >= 0:
                start = max(0, pos - 500)
                end = min(len(markdown_chunk), pos + 500)
                ctx = markdown_chunk[start:end]
                isin_contexts.append(
                    f"--- Contexto del ISIN {isin} ---\n{ctx}\n"
                )

        if not isin_contexts:
            return None

        rescue_text = "\n".join(isin_contexts)

        client = AsyncOpenAI(api_key=self.api_key)

        user_message = (
            "En una primera pasada de extracción, los siguientes ISINs "
            "fueron OMITIDOS por error. Cada uno corresponde a una posición "
            "REAL declarable en el Modelo 720. Analiza el contexto de cada "
            "ISIN y extrae la posición correspondiente.\n\n"
            "IMPORTANTE: estos ISINs corresponden a posiciones reales con "
            "valor de mercado a 31 de diciembre. Pueden ser fondos (IIC), "
            "valores (V) incluyendo warrants/notas estructuradas, o "
            "cualquier otro tipo de activo declarable. NO los ignores.\n\n"
            f"{rescue_text}"
        )

        try:
            completion = await asyncio.wait_for(
                client.beta.chat.completions.parse(
                    model=self.model,
                    temperature=0.0,
                    messages=[
                        {"role": "system", "content": M720_OPENAI_SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    response_format=M720DocumentExtraction,
                ),
                timeout=timeout,
            )

            parsed = completion.choices[0].message.parsed
            if parsed is not None:
                n = (
                    len(parsed.cuentas) + len(parsed.valores)
                    + len(parsed.iics) + len(parsed.seguros)
                    + len(parsed.inmuebles)
                )
                logger.info(
                    "RESCUE: %d ISINs rescatados → %d activos "
                    "(C:%d V:%d I:%d S:%d B:%d)",
                    len(missing_isins),
                    n,
                    len(parsed.cuentas),
                    len(parsed.valores),
                    len(parsed.iics),
                    len(parsed.seguros),
                    len(parsed.inmuebles),
                )
                return parsed

        except Exception as e:
            logger.warning("RESCUE falló: %s", e)

        return None

    async def map_reduce_extraction(
        self,
        full_markdown: str,
        *,
        chunk_max_chars: int = 20_000,
        max_concurrency: int = 3,
    ) -> tuple[List[M720DocumentExtraction], ExtractionCoverage]:
        """
        Motor Map-Reduce para documentos masivos.

        GPT-4o soporta 128K contexto. Con el system prompt (~2K chars)
        + user wrapper, fijamos chunks en 20K chars para máxima completitud
        (chunks más pequeños → GPT-4o no omite posiciones por límite de output).

        1. SPLIT: por saltos de página Docling (\\n---\\n)
        2. SUB-SPLIT: páginas grandes → sub-chunks por párrafos
        3. GROUP: agrupa en bloques de ≤chunk_max_chars
        4. MAP: paralelo con asyncio.Semaphore
        5. VERIFY: rescatar ISINs omitidos
        6. COVERAGE: generar informe de cobertura para revisión humana
        7. REDUCE: filtra errores, retorna resultados + cobertura

        Retorna (resultados, cobertura) para que el caller pueda informar
        al humano qué datos deben verificarse manualmente.
        """
        coverage_warnings: List[CoverageWarning] = []

        # ── Inventario de ISINs en el markdown completo ──
        all_ocr_isins = self._find_isins_in_text(full_markdown)
        logger.info(
            "COBERTURA: %d ISINs únicos en markdown completo (%d chars): %s",
            len(all_ocr_isins),
            len(full_markdown),
            ", ".join(sorted(all_ocr_isins)),
        )

        # SPLIT
        raw_pages = full_markdown.split("\n---\n")

        # SUB-SPLIT
        pages: List[str] = []
        for page in raw_pages:
            if len(page) <= chunk_max_chars:
                pages.append(page)
            else:
                sub_chunks = _split_text_into_chunks(page, chunk_max_chars)
                logger.info(
                    "Página grande (%d chars) → %d sub-chunks de ≤%d chars",
                    len(page),
                    len(sub_chunks),
                    chunk_max_chars,
                )
                pages.extend(sub_chunks)

        # GROUP
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
            "OpenAI Map-Reduce: %d páginas → %d sub-páginas → %d bloques "
            "(max %d chars/bloque, modelo=%s)",
            len(raw_pages),
            len(pages),
            len(chunks),
            chunk_max_chars,
            self.model,
        )
        for i, chunk in enumerate(chunks):
            _chunk_isins = sorted(set(re.findall(r"[A-Z]{2}[A-Z0-9]{9}\d", chunk)))
            logger.info(
                "  Bloque %d: %d chars | ISINs: %s",
                i + 1,
                len(chunk),
                ", ".join(_chunk_isins) if _chunk_isins else "(ninguno)",
            )

        # MAP
        semaphore = asyncio.Semaphore(max_concurrency)

        async def sem_task(
            idx: int, chunk: str
        ) -> Optional[M720DocumentExtraction]:
            async with semaphore:
                logger.debug(
                    "OpenAI bloque %d/%d (%d chars)",
                    idx + 1,
                    len(chunks),
                    len(chunk),
                )
                return await self._extract_chunk(chunk)

        tasks = [sem_task(i, chunk) for i, chunk in enumerate(chunks)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # REDUCE — contar bloques exitosos/fallidos
        valid_results: List[M720DocumentExtraction] = []
        bloques_fallidos = 0
        for i, r in enumerate(results):
            if isinstance(r, Exception):
                logger.error("OpenAI bloque %d/%d falló: %s", i + 1, len(chunks), r)
                bloques_fallidos += 1
                coverage_warnings.append(CoverageWarning(
                    tipo="bloque_fallido",
                    severidad="alta",
                    bloque=i + 1,
                    mensaje=(
                        f"El bloque {i + 1}/{len(chunks)} falló completamente "
                        f"durante la extracción: {r}. Los activos de este "
                        f"bloque NO están en los resultados."
                    ),
                ))
            elif r is None:
                bloques_fallidos += 1
                coverage_warnings.append(CoverageWarning(
                    tipo="bloque_fallido",
                    severidad="alta",
                    bloque=i + 1,
                    mensaje=(
                        f"El bloque {i + 1}/{len(chunks)} no devolvió resultados "
                        f"(posible rechazo del modelo o timeout)."
                    ),
                ))
            else:
                valid_results.append(r)

        logger.info(
            "OpenAI Map-Reduce completado: %d/%d bloques exitosos",
            len(valid_results),
            len(chunks),
        )

        # ── VERIFICATION PASS: rescatar ISINs omitidos ──
        rescue_tasks: List[tuple[int, Set[str], asyncio.Task]] = []  # type: ignore[type-arg]
        rescue_meta: List[tuple[int, Set[str]]] = []  # (bloque, missing_isins)
        rescue_coros = []

        for i, chunk in enumerate(chunks):
            if i >= len(results) or isinstance(results[i], Exception):
                continue
            result = results[i]
            if result is None:
                continue

            chunk_isins = self._find_isins_in_text(chunk)
            extracted_isins = self._extracted_isins(result)
            missing = chunk_isins - extracted_isins

            if missing:
                logger.info(
                    "VERIFY bloque %d: %d ISINs en texto, %d extraídos, "
                    "%d FALTANTES: %s",
                    i + 1,
                    len(chunk_isins),
                    len(extracted_isins),
                    len(missing),
                    ", ".join(sorted(missing)),
                )
                rescue_meta.append((i + 1, missing))
                rescue_coros.append(
                    self._rescue_missing_isins(chunk, missing)
                )

        rescued_isins: Set[str] = set()
        if rescue_coros:
            logger.info(
                "Lanzando %d rescue passes para ISINs faltantes...",
                len(rescue_coros),
            )
            rescue_results = await asyncio.gather(
                *rescue_coros, return_exceptions=True
            )
            for idx, rr in enumerate(rescue_results):
                bloque_num, missing_set = rescue_meta[idx]
                if isinstance(rr, Exception):
                    logger.warning("Rescue pass falló (bloque %d): %s", bloque_num, rr)
                    coverage_warnings.append(CoverageWarning(
                        tipo="rescue_fallido",
                        severidad="alta",
                        bloque=bloque_num,
                        mensaje=(
                            f"El rescue pass para el bloque {bloque_num} falló: {rr}. "
                            f"ISINs afectados: {', '.join(sorted(missing_set))}"
                        ),
                    ))
                elif rr is not None:
                    valid_results.append(rr)
                    # Track which ISINs were actually rescued
                    rescued_isins.update(self._extracted_isins(rr))

        # ── COVERAGE ANALYSIS: identificar ISINs aún no recuperados ──
        # Recopilar todos los ISINs extraídos (primera pasada + rescue)
        all_extracted_isins: Set[str] = set()
        for vr in valid_results:
            all_extracted_isins.update(self._extracted_isins(vr))

        still_missing = all_ocr_isins - all_extracted_isins
        if still_missing:
            logger.warning(
                "COBERTURA: %d ISINs en OCR NO extraídos: %s",
                len(still_missing),
                ", ".join(sorted(still_missing)),
            )
            for isin in sorted(still_missing):
                # Extraer contexto OCR para el humano
                pos = full_markdown.find(isin)
                ctx = None
                if pos >= 0:
                    start = max(0, pos - 200)
                    end = min(len(full_markdown), pos + 200)
                    ctx = full_markdown[start:end].replace("\n", " | ")

                coverage_warnings.append(CoverageWarning(
                    tipo="isin_no_extraido",
                    severidad="alta",
                    isin=isin,
                    contexto_ocr=ctx,
                    mensaje=(
                        f"ISIN {isin} aparece en el texto OCR pero NO fue "
                        f"extraído como activo. Verificar manualmente si es "
                        f"una posición declarable a 31 de diciembre."
                    ),
                ))

        # Calcular cobertura ISIN
        n_ocr = len(all_ocr_isins)
        n_extracted = len(all_extracted_isins & all_ocr_isins)  # Solo los que estaban en OCR
        cobertura_pct = (n_extracted / n_ocr * 100.0) if n_ocr > 0 else 100.0

        coverage = ExtractionCoverage(
            isins_en_ocr=n_ocr,
            isins_extraidos=n_extracted,
            isins_rescatados=len(rescued_isins),
            isins_no_recuperados=sorted(still_missing),
            bloques_total=len(chunks),
            bloques_exitosos=len(chunks) - bloques_fallidos,
            bloques_fallidos=bloques_fallidos,
            rescue_passes=len(rescue_coros),
            cobertura_isin_pct=round(cobertura_pct, 1),
            warnings=coverage_warnings,
        )

        logger.info(
            "COBERTURA FINAL: %d/%d ISINs (%.1f%%), %d rescatados, "
            "%d no recuperados, %d warnings",
            n_extracted,
            n_ocr,
            cobertura_pct,
            len(rescued_isins),
            len(still_missing),
            len(coverage_warnings),
        )

        return valid_results, coverage


# ─────────────────────────────────────────────────────────────────────
# Singleton global
# ─────────────────────────────────────────────────────────────────────

openai_engine = OpenAIUniversalEngine()


# ─────────────────────────────────────────────────────────────────────
# Utilidades de deduplicación (análogas a Aduana Matemática de Harvey)
# ─────────────────────────────────────────────────────────────────────

# Patrones de nombres de agregación/subtotales de cartera
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

_AGGREGATION_RE = re.compile("|".join(_AGGREGATION_PATTERNS), re.IGNORECASE)


def _is_aggregation_entry(name: str) -> bool:
    """Detecta si un nombre es categoría/agregación de cartera.

    Nombres vacíos NO se consideran agregación (puede ser un activo con ISIN
    pero sin nombre de entidad). Solo matchea patrones explícitos.
    """
    cleaned = name.strip()
    if not cleaned:
        return False  # Sin nombre ≠ subtotal; los activos con ISIN pueden no tener nombre
    return bool(_AGGREGATION_RE.match(cleaned))


def _normalize_name(name: str) -> str:
    """Normaliza nombre para dedup (minúsculas, sin puntuación, sin noise words)."""
    cleaned = re.sub(r"[^a-záéíóúñüA-ZÁÉÍÓÚÑÜ0-9\s]", " ", name.lower())
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    noise = {
        "fund", "fondo", "class", "clase", "acc", "dis", "inc",
        "plc", "sicav", "ucits", "sub", "the", "de", "del", "la", "el",
    }
    words = [w for w in cleaned.split() if w not in noise and len(w) > 1]
    return " ".join(words)


def _extract_account_number(description: str) -> str:
    """Extrae el nº de cuenta de una descripción (secuencia alfanum más larga con dígitos)."""
    candidates = re.findall(r"[A-Za-z0-9]{6,}", description)
    with_digits = [c for c in candidates if re.search(r"\d", c)]
    if with_digits:
        return max(with_digits, key=len).upper()
    return re.sub(r"\s+", " ", description.strip().lower())


def _get_amount(asset: object) -> float:
    """Extrae el importe principal de cualquier tipo de asset V2."""
    for attr in (
        "saldo_31_diciembre",
        "valor_liquidativo_31_diciembre",
        "valor_rescate_capitalizacion_31_diciembre",
        "valor_adquisicion",
    ):
        val = getattr(asset, attr, None)
        if val is not None:
            return float(val)
    return 0.0


def _get_isin(asset: object) -> Optional[str]:
    """Extrae el ISIN de cualquier tipo de asset V2."""
    for attr in ("codigo_cuenta", "identificacion_valores"):
        val = getattr(asset, attr, None)
        if val and re.match(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$", val.upper().strip()):
            return val.upper().strip()
    return None


def _get_name(asset: object) -> str:
    """Extrae nombre descriptivo de cualquier tipo de asset V2."""
    for attr in (
        "denominacion_entidad",
        "denominacion_entidad_emisora",
        "denominacion_entidad_gestora",
        "denominacion_entidad_aseguradora",
        "denominacion_registro",
    ):
        val = getattr(asset, attr, None)
        if val:
            return str(val)
    return ""


def _get_currency(asset: object) -> str:
    """Obtiene moneda del asset."""
    return str(getattr(asset, "moneda_original", "EUR"))


def _get_country(asset: object) -> str:
    """Obtiene país del asset."""
    return str(getattr(asset, "pais_entidad_o_inmueble", ""))


# ─────────────────────────────────────────────────────────────────────
# Quality Checks — Data quality warnings post-merge
# ─────────────────────────────────────────────────────────────────────

# Regex para detectar artefactos de encoding mojibake (UTF-8 leído como Latin-1)
# Patrón: 'Ã' seguido de un carácter en rango 0x80-0xBF
_MOJIBAKE_RE = re.compile(r"Ã[\x80-\xbf]|Â[\x80-\xbf]")

# Regex para detectar palabras fusionadas por OCR: >10 mayúsculas consecutivas sin espacio
_OCR_FUSION_RE = re.compile(r"[A-Z]{11,}")


def _run_quality_checks(extraction: M720DocumentExtraction) -> List[CoverageWarning]:
    """
    Analiza un M720DocumentExtraction post-merge y genera advertencias de calidad.

    Detecta:
    1. calidad_encoding: artefactos mojibake en campos de texto
    2. calidad_nombre_fusion: nombres con palabras fusionadas por OCR (>10 mayúsculas consecutivas)
    3. calidad_activo_extinguido: activos con saldo=0 Y unidades=0 (derechos extinguidos)

    No modifica el extraction. Devuelve lista de CoverageWarning (puede ser vacía).
    """
    warnings: List[CoverageWarning] = []

    def _all_text_fields(asset: object) -> List[str]:
        texts: List[str] = []
        for attr in (
            "denominacion_entidad", "denominacion_entidad_emisora",
            "denominacion_entidad_gestora", "denominacion_entidad_aseguradora",
            "denominacion_registro",
        ):
            val = getattr(asset, attr, None)
            if val:
                texts.append(str(val))
        for addr_attr in ("domicilio_entidad", "domicilio_inmueble"):
            addr = getattr(asset, addr_attr, None)
            if addr:
                for field in ("calle", "poblacion", "provincia"):
                    v = getattr(addr, field, None)
                    if v:
                        texts.append(str(v))
        return texts

    all_assets: List[object] = (
        list(extraction.cuentas)
        + list(extraction.valores)
        + list(extraction.iics)
        + list(extraction.seguros)
        + list(extraction.inmuebles)
    )

    # ── Check 1: Encoding artifacts ──
    for asset in all_assets:
        for text in _all_text_fields(asset):
            if _MOJIBAKE_RE.search(text):
                name = _get_name(asset)
                warnings.append(CoverageWarning(
                    tipo="calidad_encoding",
                    severidad="media",
                    mensaje=(
                        f"Posible artefacto de encoding en '{name}': "
                        f"texto '{text}' contiene secuencias mojibake. "
                        f"Verificar manualmente la dirección/nombre."
                    ),
                ))
                break  # Un warning por asset es suficiente

    # ── Check 2: OCR-fusion names ──
    for asset in all_assets:
        name = _get_name(asset)
        if not name:
            continue
        matches = _OCR_FUSION_RE.findall(name)
        if matches:
            warnings.append(CoverageWarning(
                tipo="calidad_nombre_fusion",
                severidad="baja",
                mensaje=(
                    f"Posible nombre fusionado por OCR: '{name}'. "
                    f"Palabras sospechosas: {', '.join(matches)}. "
                    f"Verificar si falta espacio entre palabras."
                ),
            ))

    # ── Check 3: Zero-balance extinguished assets ──
    for asset in (list(extraction.valores) + list(extraction.iics)):
        amount = _get_amount(asset)
        units = getattr(asset, "numero_valores", None)
        if amount == 0.0 and (units is None or units == 0.0):
            isin = _get_isin(asset)
            name = _get_name(asset)
            warnings.append(CoverageWarning(
                tipo="calidad_activo_extinguido",
                severidad="baja",
                isin=isin,
                mensaje=(
                    f"Activo '{name}' (ISIN: {isin or 'N/A'}) tiene saldo=0 "
                    f"y unidades=0. Posible derecho extinguido no declarable. "
                    f"Verificar si debe excluirse de la declaración."
                ),
            ))

    if warnings:
        logger.info(
            "Quality checks: %d warnings (%d encoding, %d OCR-fusion, %d extinguidos)",
            len(warnings),
            sum(1 for w in warnings if w.tipo == "calidad_encoding"),
            sum(1 for w in warnings if w.tipo == "calidad_nombre_fusion"),
            sum(1 for w in warnings if w.tipo == "calidad_activo_extinguido"),
        )

    return warnings


# ─────────────────────────────────────────────────────────────────────
# Merge + Aduana Matemática V2
# ─────────────────────────────────────────────────────────────────────


def merge_extractions(
    chunks: List[M720DocumentExtraction],
) -> M720DocumentExtraction:
    """
    Fusiona múltiples M720DocumentExtraction parciales en uno,
    aplicando Aduana Matemática V2:

    1. Filtro de agregación (subtotales de cartera)
    2. Validación ISIN Luhn (ISO 6166)
    3. ISIN smart dedup: mismo importe ±1% → descartar, distinto → SUM
    4. Account dedup: misma cuenta+moneda → mayor saldo
    5. Name dedup: nombre normalizado para non-ISIN
    6. Amount dedup secundario: moneda+importe+país para residuales
    """
    if not chunks:
        return M720DocumentExtraction()

    # Colectores finales
    final_cuentas: List[M720Cuenta] = []
    final_valores: List[M720Valor] = []
    final_iics: List[M720IIC] = []
    final_seguros: List[M720Seguro] = []
    final_inmuebles: List[M720Inmueble] = []

    # Índices de dedup
    account_index: Dict[str, int] = {}
    isin_index_v: Dict[str, int] = {}  # ISIN → index en final_valores
    isin_lots_v: Dict[str, List[float]] = {}
    isin_index_i: Dict[str, int] = {}  # ISIN → index en final_iics
    isin_lots_i: Dict[str, List[float]] = {}
    seen_names: Set[str] = set()
    seen_amounts: Set[str] = set()

    stats = {
        "aggregation_filtered": 0,
        "isin_valid": 0,
        "isin_invalid": 0,
        "isin_dup_discarded": 0,
        "isin_lots_merged": 0,
        "account_dup_replaced": 0,
        "name_dup_discarded": 0,
        "amount_dup_discarded": 0,
    }

    # ── Cuentas (Clave C) ──
    for chunk in chunks:
        for cuenta in chunk.cuentas:
            name = cuenta.denominacion_entidad or ""
            if _is_aggregation_entry(name):
                stats["aggregation_filtered"] += 1
                continue

            # Dedup por nº cuenta + moneda
            acct_num = _extract_account_number(cuenta.codigo_cuenta or name)
            acct_key = f"{acct_num}|{cuenta.moneda_original}"

            if acct_key in account_index:
                idx = account_index[acct_key]
                old_balance = abs(final_cuentas[idx].saldo_31_diciembre or 0)
                new_balance = abs(cuenta.saldo_31_diciembre or 0)
                if new_balance > old_balance:
                    logger.info(
                        "Account dedup: %s reemplazando %.2f → %.2f",
                        acct_key,
                        old_balance,
                        new_balance,
                    )
                    final_cuentas[idx] = cuenta
                    stats["account_dup_replaced"] += 1
                continue

            account_index[acct_key] = len(final_cuentas)
            final_cuentas.append(cuenta)

    # ── Valores (Clave V) ──
    for chunk in chunks:
        for valor in chunk.valores:
            # Filtro de activos extinguidos: saldo=0 Y unidades=0
            if (valor.saldo_31_diciembre or 0.0) == 0.0 and \
               (valor.numero_valores is None or (valor.numero_valores or 0.0) == 0.0):
                stats["aggregation_filtered"] += 1
                logger.debug(
                    "Zero-balance extinguido filtrado: %s %s",
                    valor.identificacion_valores or "",
                    valor.denominacion_entidad_emisora or "",
                )
                continue

            name = valor.denominacion_entidad_emisora or ""
            if _is_aggregation_entry(name):
                stats["aggregation_filtered"] += 1
                continue

            isin = valor.identificacion_valores
            amount = valor.saldo_31_diciembre or 0.0

            # Validación ISIN Luhn
            if isin:
                clean = isin.upper().strip()
                if validate_isin_luhn(clean):
                    stats["isin_valid"] += 1
                    # Smart dedup
                    if clean in isin_index_v:
                        known_lots = isin_lots_v.get(clean, [])
                        is_dup = any(
                            abs(amount - lot) < max(1.0, abs(lot) * 0.01)
                            for lot in known_lots
                        )
                        if is_dup:
                            stats["isin_dup_discarded"] += 1
                            logger.debug("V dedup ISIN %s importe %.2f ya visto", clean, amount)
                            continue
                        # Nuevo lote → SUM
                        idx = isin_index_v[clean]
                        prev = final_valores[idx]
                        new_total = (prev.saldo_31_diciembre or 0) + amount
                        new_shares = (prev.numero_valores or 0) + (valor.numero_valores or 0)
                        final_valores[idx] = prev.model_copy(
                            update={
                                "saldo_31_diciembre": new_total,
                                "numero_valores": new_shares if new_shares else None,
                            }
                        )
                        isin_lots_v[clean].append(amount)
                        stats["isin_lots_merged"] += 1
                        logger.info(
                            "V ISIN SUM: %s + %.2f = %.2f",
                            clean,
                            amount,
                            new_total,
                        )
                        continue

                    isin_index_v[clean] = len(final_valores)
                    isin_lots_v[clean] = [amount]
                    final_valores.append(valor)
                    continue
                else:
                    stats["isin_invalid"] += 1
                    logger.debug("V ISIN inválido: %s", isin)
                    valor = valor.model_copy(
                        update={"identificacion_valores": None}
                    )

            # Non-ISIN dedup por nombre
            norm = _normalize_name(name)
            if norm and norm in seen_names:
                stats["name_dup_discarded"] += 1
                continue
            if norm:
                seen_names.add(norm)

            # Amount dedup
            amt_key = f"V|{amount:.2f}|{valor.moneda_original}|{_get_country(valor)}"
            if amt_key in seen_amounts:
                stats["amount_dup_discarded"] += 1
                continue
            seen_amounts.add(amt_key)

            final_valores.append(valor)

    # ── IICs (Clave I) — misma lógica que Valores ──
    for chunk in chunks:
        for iic in chunk.iics:
            # Filtro de activos extinguidos: valor=0 Y unidades=0
            if (iic.valor_liquidativo_31_diciembre or 0.0) == 0.0 and \
               (iic.numero_valores is None or (iic.numero_valores or 0.0) == 0.0):
                stats["aggregation_filtered"] += 1
                logger.debug(
                    "Zero-balance IIC extinguido filtrado: %s %s",
                    iic.identificacion_valores or "",
                    iic.denominacion_entidad_gestora or "",
                )
                continue

            name = iic.denominacion_entidad_gestora or ""
            if _is_aggregation_entry(name):
                stats["aggregation_filtered"] += 1
                continue

            isin = iic.identificacion_valores
            amount = iic.valor_liquidativo_31_diciembre or 0.0

            if isin:
                clean = isin.upper().strip()
                if validate_isin_luhn(clean):
                    stats["isin_valid"] += 1
                    if clean in isin_index_i:
                        known_lots = isin_lots_i.get(clean, [])
                        is_dup = any(
                            abs(amount - lot) < max(1.0, abs(lot) * 0.01)
                            for lot in known_lots
                        )
                        if is_dup:
                            stats["isin_dup_discarded"] += 1
                            logger.debug("I dedup ISIN %s importe %.2f ya visto", clean, amount)
                            continue
                        idx = isin_index_i[clean]
                        prev = final_iics[idx]
                        new_total = (prev.valor_liquidativo_31_diciembre or 0) + amount
                        new_shares = (prev.numero_valores or 0) + (iic.numero_valores or 0)
                        final_iics[idx] = prev.model_copy(
                            update={
                                "valor_liquidativo_31_diciembre": new_total,
                                "numero_valores": new_shares if new_shares else None,
                            }
                        )
                        isin_lots_i[clean].append(amount)
                        stats["isin_lots_merged"] += 1
                        logger.info("I ISIN SUM: %s + %.2f = %.2f", clean, amount, new_total)
                        continue

                    isin_index_i[clean] = len(final_iics)
                    isin_lots_i[clean] = [amount]
                    final_iics.append(iic)
                    continue
                else:
                    stats["isin_invalid"] += 1
                    iic = iic.model_copy(update={"identificacion_valores": None})

            norm = _normalize_name(name)
            if norm and norm in seen_names:
                stats["name_dup_discarded"] += 1
                continue
            if norm:
                seen_names.add(norm)

            amt_key = f"I|{amount:.2f}|{iic.moneda_original}|{_get_country(iic)}"
            if amt_key in seen_amounts:
                stats["amount_dup_discarded"] += 1
                continue
            seen_amounts.add(amt_key)

            final_iics.append(iic)

    # ── Seguros (Clave S) — dedup por nombre ──
    for chunk in chunks:
        for seguro in chunk.seguros:
            name = seguro.denominacion_entidad_aseguradora or ""
            norm = _normalize_name(name)
            if norm and norm in seen_names:
                stats["name_dup_discarded"] += 1
                continue
            if norm:
                seen_names.add(norm)
            final_seguros.append(seguro)

    # ── Inmuebles (Clave B) — dedup por dirección/nombre ──
    for chunk in chunks:
        for inmueble in chunk.inmuebles:
            name = inmueble.denominacion_registro or ""
            addr = ""
            if inmueble.domicilio_inmueble:
                addr = f"{inmueble.domicilio_inmueble.calle or ''} {inmueble.domicilio_inmueble.poblacion or ''}"
            dedup_key = _normalize_name(f"{name} {addr}")
            if dedup_key and dedup_key in seen_names:
                stats["name_dup_discarded"] += 1
                continue
            if dedup_key:
                seen_names.add(dedup_key)
            final_inmuebles.append(inmueble)

    # Log stats
    total = (
        len(final_cuentas) + len(final_valores) + len(final_iics)
        + len(final_seguros) + len(final_inmuebles)
    )
    logger.info(
        "Aduana V2 completada: %d activos finales "
        "(C:%d V:%d I:%d S:%d B:%d) | "
        "stats=%s",
        total,
        len(final_cuentas),
        len(final_valores),
        len(final_iics),
        len(final_seguros),
        len(final_inmuebles),
        stats,
    )

    return M720DocumentExtraction(
        cuentas=final_cuentas,
        valores=final_valores,
        iics=final_iics,
        seguros=final_seguros,
        inmuebles=final_inmuebles,
    )


# ─────────────────────────────────────────────────────────────────────
# API pública: extract_m720_openai()
# ─────────────────────────────────────────────────────────────────────


async def extract_m720_openai(
    markdown_text: str,
) -> tuple[M720DocumentExtraction, ExtractionCoverage]:
    """
    Función pública principal. Recibe el Markdown Docling completo,
    ejecuta map-reduce con OpenAI, aplica Aduana V2, y devuelve
    un M720DocumentExtraction limpio y deduplicado junto con un
    informe de cobertura para revisión humana.

    Retorna (extraction, coverage):
      - extraction: M720DocumentExtraction con activos deduplicados
      - coverage: ExtractionCoverage con warnings para el revisor humano

    Apta para ser llamada desde el endpoint V2 de main.py.
    """
    empty_coverage = ExtractionCoverage()

    if not openai_engine.is_available:
        logger.warning(
            "OpenAI no configurado (OPENAI_API_KEY ausente). "
            "Devolviendo extracción vacía."
        )
        return M720DocumentExtraction(), empty_coverage

    # Fix encoding artifacts (mojibake) before OpenAI extraction
    markdown_text = _fix_encoding(markdown_text)

    chunk_results, coverage = await openai_engine.map_reduce_extraction(
        markdown_text
    )

    if not chunk_results:
        logger.info("OpenAI no extrajo ningún resultado del documento.")
        coverage.warnings.append(CoverageWarning(
            tipo="bloque_fallido",
            severidad="alta",
            mensaje="Ningún bloque devolvió resultados. Extracción vacía.",
        ))
        return M720DocumentExtraction(), coverage

    merged = merge_extractions(chunk_results)

    # ── Quality checks: data-quality warnings post-merge ──
    quality_warnings = _run_quality_checks(merged)
    if quality_warnings:
        coverage.warnings.extend(quality_warnings)

    return merged, coverage
