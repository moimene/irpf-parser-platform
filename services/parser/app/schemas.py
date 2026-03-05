from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional


class SourceSpan(BaseModel):
    page: int
    start: int
    end: int
    snippet: Optional[str] = None


class ParsedRecord(BaseModel):
    record_type: Literal["DIVIDENDO", "INTERES", "COMPRA", "VENTA", "POSICION", "DESCONOCIDO"]
    fields: Dict[str, Any]
    confidence: float = Field(ge=0.0, le=1.0)
    source_spans: List[SourceSpan]


class ParseDocumentRequest(BaseModel):
    document_id: str
    expediente_id: str
    filename: str
    mime_type: Optional[str] = "application/pdf"
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
    warnings: List[str]
