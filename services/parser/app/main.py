"""
IRPF Parser Service — FastAPI v0.8.1 (Harvey AI + OpenAI Dual Engine)
Endpoints:
  GET  /health                — health check con versión y capacidades
  POST /parse-document        — parseo Harvey-first con fallback determinista (V1)
  POST /convert-document      — conversión con Docling a Markdown estructurado
  POST /api/v2/parse-universal — parseo OpenAI Structured Outputs (V2, Fork Lógico)
"""
import asyncio
import base64
import logging
import os
import time

# ── Configure logging so INFO/WARNING/ERROR all reach stdout ──
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.parser_engine import parse_document
from app.schemas import ParseDocumentRequest, ParseDocumentResponse
from app.docling_converter import (
    ConvertDocumentRequest,
    ConvertDocumentResponse,
    convert_document_endpoint,
    convert_document,
)
from fastapi.responses import Response

from app.schemas.m720_boe_v2 import M720DocumentExtraction
from app.engines.openai_universal import extract_m720_openai, openai_engine
from app.exporters.excel_m720_v2 import export_to_excel

app = FastAPI(
    title="IRPF Parser Service",
    version="0.8.1",
    description="Harvey AI + OpenAI Dual Engine — M720 extraction platform",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    has_pdfplumber = False
    has_openpyxl = False
    has_xlrd = False
    has_docling = False
    try:
        import pdfplumber  # noqa: F401
        has_pdfplumber = True
    except ImportError:
        pass
    try:
        import openpyxl  # noqa: F401
        has_openpyxl = True
    except ImportError:
        pass
    try:
        import xlrd  # noqa: F401
        has_xlrd = True
    except ImportError:
        pass
    try:
        from docling.document_converter import DocumentConverter  # noqa: F401
        has_docling = True
    except ImportError:
        pass
    has_llm = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    has_harvey = bool(os.environ.get("HARVEY_TOKEN", "").strip())
    harvey_base = os.environ.get("HARVEY_BASE_URL", "https://eu.api.harvey.ai")
    use_docling = os.environ.get("USE_DOCLING", "true").lower() in ("1", "true", "yes")
    # Motor primario: Harvey si está disponible, determinista si no
    primary_engine = "harvey_ai" if has_harvey else (
        "docling" if (use_docling and has_docling) else "pdfplumber"
    )

    return {
        "ok": True,
        "service": "irpf-parser",
        "version": "0.8.1",
        "primary_engine": primary_engine,
        "capabilities": {
            "pdfplumber": has_pdfplumber,
            "docling": has_docling,
            "docling_enabled": use_docling and has_docling,
            "docling_pipeline": {
                "layout": "Layout Heron (RT-DETR)",
                "table_structure": "TableFormer ACCURATE + cell matching",
                "ocr": "EasyOCR (es, en, fr, de, it)",
            } if (use_docling and has_docling) else None,
            "structured_document": True,
            "csv": True,
            "xlsx": has_openpyxl,
            "xls": has_xlrd,
            "pypdf_fallback": True,
            "llm_fallback": has_llm,
            "harvey_ai": {
                "available": has_harvey,
                "primary": has_harvey,
                "base_url": harvey_base if has_harvey else None,
                "api_version": "v2",
                "features": [
                    "map_reduce",
                    "completion_v2",
                    "isin_luhn_validation",
                    "all_entities",
                    "intensive_mode",
                ],
            },
            "entities": ["PICTET", "GOLDMAN_SACHS", "CITI", "JP_MORGAN"],
            "openai_v2": {
                "available": has_llm,
                "model": os.environ.get("OPENAI_MODEL", "gpt-4o"),
                "endpoint": "/api/v2/parse-universal",
                "features": [
                    "structured_outputs",
                    "map_reduce",
                    "isin_luhn_validation",
                    "aduana_v2",
                    "m720_boe_schemas",
                ],
            },
        },
    }


@app.post("/parse-document", response_model=ParseDocumentResponse)
def parse_document_endpoint(request: ParseDocumentRequest) -> ParseDocumentResponse:
    return parse_document(request)


@app.post("/convert-document", response_model=ConvertDocumentResponse)
def convert_document_api(request: ConvertDocumentRequest) -> ConvertDocumentResponse:
    """
    Convierte un documento a Markdown estructurado usando Docling.

    Este endpoint es independiente del flujo /parse-document y está
    diseñado para ser llamado desde n8n antes del triaje por entidad.
    """
    return convert_document_endpoint(request)


# ─────────────────────────────────────────────────────────────────────
# V2 — OpenAI Universal Parser (Fork Lógico)
# ─────────────────────────────────────────────────────────────────────


class ParseUniversalV2Request(BaseModel):
    """Request para el endpoint V2 de extracción con OpenAI."""

    filename: str = Field(description="Nombre del archivo PDF para inferir formato")
    content_base64: str = Field(description="Contenido del PDF en base64")
    ejercicio: int = Field(
        default=2025,
        description="Año fiscal del ejercicio (para contexto, no afecta extracción)",
    )


class ParseUniversalV2Response(BaseModel):
    """Response del endpoint V2 con M720DocumentExtraction completa."""

    engine: str = "openai_v2"
    model: str = ""
    extraction: M720DocumentExtraction
    markdown_length: int = 0
    pages_count: int = 0
    tables_count: int = 0
    docling_backend: str = ""
    processing_time_seconds: float = 0.0
    warnings: List[str] = Field(default_factory=list)


@app.post("/api/v2/parse-universal", response_model=ParseUniversalV2Response)
async def parse_universal_v2(request: ParseUniversalV2Request) -> ParseUniversalV2Response:
    """
    Endpoint V2: Extracción M720 con OpenAI Structured Outputs.

    Pipeline:
      1. Decodifica PDF base64
      2. Convierte a Markdown con Docling (misma fase que V1)
      3. Envía Markdown a OpenAI gpt-4o con Structured Outputs
      4. Aplica Aduana Matemática V2 (ISIN Luhn, smart dedup, account dedup)
      5. Devuelve M720DocumentExtraction tipada con las 5 claves BOE

    FORK LÓGICO: Este endpoint es completamente independiente de
    /parse-document (V1 Harvey). No comparten flujo de ejecución.
    """
    t0 = time.time()
    warnings: List[str] = []

    # ── 1. Validar disponibilidad ──
    if not openai_engine.is_available:
        return ParseUniversalV2Response(
            extraction=M720DocumentExtraction(),
            warnings=["OPENAI_API_KEY no configurada. Motor V2 no disponible."],
        )

    # ── 2. Decodificar PDF ──
    try:
        content_bytes = base64.b64decode(request.content_base64)
    except Exception as e:
        return ParseUniversalV2Response(
            extraction=M720DocumentExtraction(),
            warnings=[f"Error decodificando base64: {e}"],
        )

    # ── 3. Convertir a Markdown con Docling ──
    try:
        markdown, tables_count, pages_count, backend, doc_warnings = convert_document(
            content_bytes, request.filename
        )
        warnings.extend(doc_warnings)
    except Exception as e:
        return ParseUniversalV2Response(
            extraction=M720DocumentExtraction(),
            warnings=[f"Error en conversión Docling: {e}"],
        )

    if not markdown or not markdown.strip():
        return ParseUniversalV2Response(
            extraction=M720DocumentExtraction(),
            docling_backend=backend,
            warnings=["Docling no extrajo texto del documento."],
        )

    logger.info(
        "V2 Docling: %d chars, %d páginas, %d tablas, backend=%s",
        len(markdown),
        pages_count,
        tables_count,
        backend,
    )

    # ── 4. Extracción OpenAI con map-reduce + Aduana V2 ──
    try:
        extraction = await extract_m720_openai(markdown)
    except Exception as e:
        logger.error("V2 OpenAI extraction failed: %s", e, exc_info=True)
        return ParseUniversalV2Response(
            extraction=M720DocumentExtraction(),
            markdown_length=len(markdown),
            pages_count=pages_count,
            tables_count=tables_count,
            docling_backend=backend,
            warnings=[f"Error en extracción OpenAI: {e}"],
        )

    elapsed = time.time() - t0
    total_assets = (
        len(extraction.cuentas)
        + len(extraction.valores)
        + len(extraction.iics)
        + len(extraction.seguros)
        + len(extraction.inmuebles)
    )
    logger.info(
        "V2 completado: %d activos (C:%d V:%d I:%d S:%d B:%d) en %.1fs",
        total_assets,
        len(extraction.cuentas),
        len(extraction.valores),
        len(extraction.iics),
        len(extraction.seguros),
        len(extraction.inmuebles),
        elapsed,
    )

    return ParseUniversalV2Response(
        engine="openai_v2",
        model=openai_engine.model,
        extraction=extraction,
        markdown_length=len(markdown),
        pages_count=pages_count,
        tables_count=tables_count,
        docling_backend=backend,
        processing_time_seconds=round(elapsed, 2),
        warnings=warnings,
    )


@app.post("/api/v2/export-excel")
async def export_excel_v2(extraction: M720DocumentExtraction) -> Response:
    """
    Genera un XLSX a partir de un M720DocumentExtraction.

    Recibe el JSON de extracción (output de /api/v2/parse-universal)
    y devuelve un archivo Excel con 5 hojas (una por clave BOE).

    Se puede llamar directamente desde el frontend con el resultado
    de la extracción, sin necesidad de re-parsear el PDF.
    """
    xlsx_bytes = export_to_excel(extraction)

    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="m720_extraction_v2.xlsx"',
        },
    )
