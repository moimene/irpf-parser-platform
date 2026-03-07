"""
IRPF Parser Service — FastAPI v0.3.0
Endpoints:
  GET  /health            — health check con versión y capacidades
  POST /parse-document    — parseo de documento y structured_document
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.parser_engine import parse_document
from app.schemas import ParseDocumentRequest, ParseDocumentResponse

app = FastAPI(
    title="IRPF Parser Service",
    version="0.3.0",
    description="Parser adaptativo de 3 niveles para documentos bancarios IRPF/IP/720",
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
    has_llm = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    return {
        "ok": True,
        "service": "irpf-parser",
        "version": "0.3.0",
        "capabilities": {
            "pdfplumber": has_pdfplumber,
            "structured_document": True,
            "csv": True,
            "xlsx": has_openpyxl,
            "pypdf_fallback": True,
            "llm_fallback": has_llm,
            "entities": ["PICTET", "GOLDMAN_SACHS", "CITI"],
        },
    }


@app.post("/parse-document", response_model=ParseDocumentResponse)
def parse_document_endpoint(request: ParseDocumentRequest) -> ParseDocumentResponse:
    return parse_document(request)
