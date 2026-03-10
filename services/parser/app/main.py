"""
IRPF Parser Service — FastAPI v0.4.0
Endpoints:
  GET  /health            — health check con versión y capacidades
  POST /parse-document    — parseo de documento y structured_document
  POST /convert-document  — conversión con Docling a Markdown estructurado
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.parser_engine import parse_document
from app.schemas import ParseDocumentRequest, ParseDocumentResponse
from app.docling_converter import (
    ConvertDocumentRequest,
    ConvertDocumentResponse,
    convert_document_endpoint,
)

app = FastAPI(
    title="IRPF Parser Service",
    version="0.4.0",
    description="Parser adaptativo con Docling para documentos bancarios IRPF/IP/720",
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
    use_docling = os.environ.get("USE_DOCLING", "true").lower() in ("1", "true", "yes")
    return {
        "ok": True,
        "service": "irpf-parser",
        "version": "0.4.0",
        "capabilities": {
            "pdfplumber": has_pdfplumber,
            "docling": has_docling,
            "docling_enabled": use_docling and has_docling,
            "structured_document": True,
            "csv": True,
            "xlsx": has_openpyxl,
            "xls": has_xlrd,
            "pypdf_fallback": True,
            "llm_fallback": has_llm,
            "entities": ["PICTET", "GOLDMAN_SACHS", "CITI", "JP_MORGAN"],
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
