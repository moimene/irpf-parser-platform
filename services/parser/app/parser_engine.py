"""
Motor de parseo adaptativo en 3 niveles:
  Nivel 1 — Plantillas por entidad (Pictet, Goldman Sachs, Citi) con pdfplumber
  Nivel 2 — Fallback LLM (GPT-4o-mini) para entidades desconocidas o baja extracción
  Nivel 3 — Escalado a revisión manual si confianza < umbral
"""
import base64
from io import BytesIO
from typing import List, Optional, Tuple

from app.extractors import base as base_utils
from app.extractors import citi, goldman, pictet
from app.extractors.base import ExtractedRecord, extract_text_from_pdf
from app.extractors.llm_fallback import extract as llm_extract
from app.schemas import (
    ParseDocumentRequest,
    ParseDocumentResponse,
    ParsedRecord,
    SourceSpan,
)

MANUAL_REVIEW_THRESHOLD = 0.85
MIN_RECORDS_FOR_SUCCESS = 1


def detect_entity(filename: str, entity_hint: Optional[str], text: str) -> str:
    candidate = f"{entity_hint or ''} {filename} {text[:800]}".lower()
    if "pictet" in candidate:
        return "PICTET"
    if any(k in candidate for k in ["goldman", "gs ", "gs-", "gsam", "gs284", "gsx"]):
        return "GOLDMAN_SACHS"
    if "citi" in candidate:
        return "CITI"
    return "UNKNOWN"


def decode_pdf_bytes(content_base64: Optional[str]) -> Optional[bytes]:
    if not content_base64:
        return None
    try:
        return base64.b64decode(content_base64)
    except Exception:
        return None


def normalize_text(request: ParseDocumentRequest) -> Tuple[str, Optional[bytes]]:
    if request.content_base64:
        pdf_bytes = decode_pdf_bytes(request.content_base64)
        if pdf_bytes:
            pages_text, has_text = extract_text_from_pdf(pdf_bytes)
            full_text = "\n".join(pages_text).strip()
            return full_text, pdf_bytes
        return "", None
    if request.text and request.text.strip():
        return request.text.strip(), None
    return "", None


def _make_source_span(text: str, keyword: str, page: int = 1) -> SourceSpan:
    idx = text.lower().find(keyword.lower())
    if idx < 0:
        return SourceSpan(page=page, start=0, end=0, snippet="")
    end = min(idx + 100, len(text))
    snippet = text[idx:end].replace("\n", " ")
    return SourceSpan(page=page, start=idx, end=end, snippet=snippet)


def _to_parsed_record(rec: ExtractedRecord, full_text: str) -> Tuple[ParsedRecord, SourceSpan]:
    fields = {
        "description": rec.description,
        "operation_date": rec.operation_date,
        "isin": rec.isin,
        "amount": rec.amount,
        "currency": rec.currency,
        "retention": rec.retention,
        "quantity": rec.quantity,
    }
    fields = {k: v for k, v in fields.items() if v is not None}
    span = _make_source_span(full_text, rec.description[:40] if rec.description else "", rec.page)
    parsed = ParsedRecord(
        record_type=rec.record_type,  # type: ignore[arg-type]
        fields=fields,
        confidence=rec.confidence,
        source_spans=[span],
    )
    return parsed, span


def _extract_from_text(entity: str, text: str) -> List[ExtractedRecord]:
    """Extrae registros desde texto plano (sin PDF bytes) usando el extractor correcto."""
    records = []
    if entity == "GOLDMAN_SACHS":
        import app.extractors.goldman as gs_mod
        current_section = None
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 10:
                continue
            section = gs_mod._detect_section_type(line)
            if section:
                current_section = section
                continue
            op_type = current_section
            if not op_type:
                op_type, _ = base_utils.detect_operation_type(line)
                if op_type == "DESCONOCIDO":
                    continue
            records.append(ExtractedRecord(
                record_type=op_type,
                operation_date=base_utils.parse_date(line),
                isin=base_utils.extract_isin(line),
                description=line[:120],
                amount=base_utils.parse_amount(line),
                currency=base_utils.extract_currency(line) or "USD",
                retention=None, quantity=None, page=1, row_text=line,
                confidence=base_utils.confidence_from_fields(
                    base_utils.parse_date(line) is not None,
                    base_utils.parse_amount(line) is not None,
                    base_utils.extract_isin(line) is not None,
                    0.85 if current_section else 0.78,
                ),
                extra={"template": "goldman.text.v2", "section": current_section},
            ))
    elif entity == "CITI":
        import app.extractors.citi as citi_mod
        current_section = None
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 10:
                continue
            section = citi_mod._detect_citi_section(line)
            if section:
                current_section = section
                continue
            op_type = current_section
            if not op_type:
                op_type, _ = base_utils.detect_operation_type(line)
                if op_type == "DESCONOCIDO":
                    continue
            records.append(ExtractedRecord(
                record_type=op_type,
                operation_date=base_utils.parse_date(line),
                isin=base_utils.extract_isin(line),
                description=line[:120],
                amount=base_utils.parse_amount(line),
                currency=base_utils.extract_currency(line) or "USD",
                retention=None, quantity=None, page=1, row_text=line,
                confidence=base_utils.confidence_from_fields(
                    base_utils.parse_date(line) is not None,
                    base_utils.parse_amount(line) is not None,
                    base_utils.extract_isin(line) is not None,
                    0.83 if current_section else 0.75,
                ),
                extra={"template": "citi.text.v2", "section": current_section},
            ))
    else:  # PICTET o UNKNOWN
        for line in text.splitlines():
            line = line.strip()
            if len(line) < 15:
                continue
            op_type, base_conf = base_utils.detect_operation_type(line)
            if op_type == "DESCONOCIDO":
                continue
            records.append(ExtractedRecord(
                record_type=op_type,
                operation_date=base_utils.parse_date(line),
                isin=base_utils.extract_isin(line),
                description=line[:120],
                amount=base_utils.parse_amount(line),
                currency=base_utils.extract_currency(line),
                retention=None, quantity=None, page=1, row_text=line,
                confidence=base_utils.confidence_from_fields(
                    base_utils.parse_date(line) is not None,
                    base_utils.parse_amount(line) is not None,
                    base_utils.extract_isin(line) is not None,
                    base_conf - 0.05,
                ),
                extra={"template": "pictet.text.v2"},
            ))
    return records


def parse_document(request: ParseDocumentRequest) -> ParseDocumentResponse:
    warnings: List[str] = []
    full_text, pdf_bytes = normalize_text(request)
    entity = detect_entity(request.filename, request.entity_hint, full_text)

    extracted_records: List[ExtractedRecord] = []
    strategy = "manual"
    template_used = "unknown.v0"

    # Nivel 1: Plantillas por entidad
    if entity != "UNKNOWN":
        try:
            if pdf_bytes:
                if entity == "PICTET":
                    extracted_records = pictet.extract(pdf_bytes)
                    template_used = "pictet.v2"
                elif entity == "GOLDMAN_SACHS":
                    extracted_records = goldman.extract(pdf_bytes)
                    template_used = "goldman.v2"
                elif entity == "CITI":
                    extracted_records = citi.extract(pdf_bytes)
                    template_used = "citi.v2"
            else:
                extracted_records = _extract_from_text(entity, full_text)
                template_used = f"{entity.lower()}.text.v2"

            if extracted_records:
                strategy = "template"
            else:
                warnings.append(
                    f"Plantilla {entity} reconocida pero sin registros; activando fallback LLM."
                )
        except Exception as exc:
            warnings.append(f"Error en extractor {entity}: {exc}")

    # Nivel 2: Fallback LLM
    if len(extracted_records) < MIN_RECORDS_FOR_SUCCESS:
        if full_text and len(full_text.strip()) >= 30:
            try:
                llm_records = llm_extract(full_text)
                if llm_records:
                    extracted_records = llm_records
                    strategy = "semantic"
                    template_used = "llm.gpt4o-mini.v1"
                else:
                    warnings.append("Fallback LLM sin resultados.")
            except Exception as exc:
                warnings.append(f"Error en fallback LLM: {exc}")
        else:
            warnings.append("Texto insuficiente para extracción semántica.")

    # Calcular confianza global
    if not extracted_records:
        global_confidence = 0.40
        strategy = "manual"
        template_used = "none.v0"
        warnings.append("Sin registros extraídos. Documento requiere revisión manual completa.")
    else:
        global_confidence = round(
            sum(r.confidence for r in extracted_records) / len(extracted_records), 3
        )

    requires_manual_review = global_confidence < MANUAL_REVIEW_THRESHOLD or not extracted_records
    if requires_manual_review and extracted_records:
        warnings.append(
            f"Confianza media {global_confidence:.2f} < {MANUAL_REVIEW_THRESHOLD}; "
            "enviando a validación manual."
        )

    # Convertir a formato de salida
    parsed_records: List[ParsedRecord] = []
    all_spans: List[SourceSpan] = []
    for rec in extracted_records:
        pr, span = _to_parsed_record(rec, full_text)
        parsed_records.append(pr)
        all_spans.append(span)

    return ParseDocumentResponse(
        document_id=request.document_id,
        expediente_id=request.expediente_id,
        parser_strategy=strategy,  # type: ignore[arg-type]
        template_used=template_used,
        confidence=global_confidence,
        requires_manual_review=requires_manual_review,
        records=parsed_records,
        source_spans=all_spans,
        warnings=warnings,
    )
