from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional

DocumentSourceType = Literal["PDF", "IMAGE", "CSV", "XLSX", "DOCX"]
StructuredBackend = Literal["pdfplumber", "csv", "xlsx", "text", "docling", "unknown"]


class SourceSpan(BaseModel):
    page: int
    start: int
    end: int
    snippet: Optional[str] = None


class ParsedRecord(BaseModel):
    record_type: Literal["DIVIDENDO", "INTERES", "COMPRA", "VENTA", "POSICION", "CUENTA_BANCARIA", "MOVIMIENTO", "DESCONOCIDO"]
    fields: Dict[str, Any]
    confidence: float = Field(ge=0.0, le=1.0)
    source_spans: List[SourceSpan]


class StructuredTable(BaseModel):
    table_id: str
    page: int
    source: str
    header: List[Optional[str]]
    rows: List[List[Optional[str]]]


class StructuredPage(BaseModel):
    page: int
    text: str
    tables: List[StructuredTable]


class StructuredDocument(BaseModel):
    source_type: Literal["PDF", "IMAGE", "CSV", "XLSX", "DOCX", "TEXT", "UNKNOWN"]
    backend: StructuredBackend
    pages: List[StructuredPage]
    metadata: Dict[str, Any]


class ParseDocumentRequest(BaseModel):
    document_id: str
    expediente_id: str
    filename: str
    mime_type: Optional[str] = None
    source_type: Optional[DocumentSourceType] = None
    content_base64: Optional[str] = None
    text: Optional[str] = None
    entity_hint: Optional[str] = None


class ParseDocumentResponse(BaseModel):
    document_id: str
    expediente_id: str
    parser_strategy: Literal["template", "semantic", "manual"]
    template_used: str
    confidence: float = Field(ge=0.0, le=1.0)
    requires_manual_review: bool
    records: List[ParsedRecord]
    source_spans: List[SourceSpan]
    structured_document: Optional[StructuredDocument] = None
    warnings: List[str]
