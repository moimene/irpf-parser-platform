from fastapi import FastAPI

from app.parser_engine import parse_document
from app.schemas import ParseDocumentRequest, ParseDocumentResponse

app = FastAPI(title="IRPF Parser Service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "irpf-parser", "version": "0.1.0"}


@app.post("/parse-document", response_model=ParseDocumentResponse)
def parse_document_endpoint(request: ParseDocumentRequest) -> ParseDocumentResponse:
    return parse_document(request)
