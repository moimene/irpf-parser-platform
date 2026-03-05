import base64
import re
from dataclasses import dataclass
from io import BytesIO
from typing import List, Literal, Optional, Tuple

from pypdf import PdfReader

from app.schemas import ParsedRecord, ParseDocumentRequest, ParseDocumentResponse, SourceSpan


DIVIDEND_KEYS = ["dividend", "dividendo", "gross dividend", "div recv", "bruttodividende"]
INTEREST_KEYS = ["interest", "interes", "interés", "credit interest", "interest earned"]
SALE_KEYS = ["realized", "gain", "loss", "proceeds", "sell", "disposed"]


@dataclass
class ParseContext:
    text: str
    entity: str
    warnings: List[str]


def detect_entity(filename: str, entity_hint: Optional[str], text: str) -> str:
    candidate = f"{filename} {entity_hint or ''} {text[:600]}".lower()
    if "pictet" in candidate:
        return "PICTET"
    if "goldman" in candidate or "gs " in candidate:
        return "GOLDMAN_SACHS"
    if "citi" in candidate:
        return "CITI"
    return "UNKNOWN"


def decode_pdf_base64(content_base64: Optional[str]) -> str:
    if not content_base64:
        return ""

    try:
        payload = base64.b64decode(content_base64)
        reader = PdfReader(BytesIO(payload))
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
    except Exception:
        return ""


def normalize_text(request: ParseDocumentRequest) -> str:
    if request.text and request.text.strip():
        return request.text

    text = decode_pdf_base64(request.content_base64)
    return text.strip()


def make_span(text: str, keyword: str, page: int = 1) -> SourceSpan:
    index = text.lower().find(keyword.lower())
    if index < 0:
        return SourceSpan(page=page, start=0, end=0, snippet="")

    end = min(index + 80, len(text))
    snippet = text[index:end].replace("\n", " ")
    return SourceSpan(page=page, start=index, end=end, snippet=snippet)


def parse_amount(line: str) -> Optional[float]:
    match = re.search(r"(-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2}))", line)
    if not match:
        return None

    token = match.group(1).replace(".", "").replace(",", ".")
    try:
        return float(token)
    except ValueError:
        return None


def parse_date(line: str) -> Optional[str]:
    match = re.search(r"(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}-\d{2}-\d{2})", line)
    if not match:
        return None

    raw = match.group(1).replace("/", "-")
    if len(raw) == 10 and raw[4] == "-":
        return raw

    day, month, year = raw.split("-")
    return f"{year}-{month}-{day}"


def parse_keyword_records(
    text: str,
    keywords: List[str],
    record_type: Literal["DIVIDENDO", "INTERES", "VENTA"],
    base_confidence: float,
) -> List[ParsedRecord]:
    records: List[ParsedRecord] = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for line in lines:
        lowered = line.lower()
        matched_key = next((key for key in keywords if key in lowered), None)
        if not matched_key:
            continue

        amount = parse_amount(line)
        date = parse_date(line)
        confidence = base_confidence
        if amount is None:
            confidence -= 0.15
        if date is None:
            confidence -= 0.1

        records.append(
            ParsedRecord(
                record_type=record_type,
                fields={
                    "description": line,
                    "amount": amount,
                    "operation_date": date,
                },
                confidence=max(0.45, min(0.99, confidence)),
                source_spans=[make_span(text, matched_key)],
            )
        )

    return records


def parse_template(context: ParseContext) -> Tuple[List[ParsedRecord], float, str]:
    dividends = parse_keyword_records(context.text, DIVIDEND_KEYS, "DIVIDENDO", 0.93)
    interests = parse_keyword_records(context.text, INTEREST_KEYS, "INTERES", 0.91)
    sales = parse_keyword_records(context.text, SALE_KEYS, "VENTA", 0.88)

    records = dividends + interests + sales

    if context.entity == "PICTET":
        template_used = "pictet.statement.v1"
    elif context.entity == "GOLDMAN_SACHS":
        template_used = "goldman.statement.v1"
    else:
        template_used = "citi.statement.v1"

    confidence = 0.9 if records else 0.78
    if not records:
        context.warnings.append("Plantilla reconocida sin campos extraidos; evaluar fallback semantico.")

    return records, confidence, template_used


def parse_semantic(context: ParseContext) -> Tuple[List[ParsedRecord], float, str]:
    words = context.text.split()
    if len(words) < 10:
        context.warnings.append("Texto insuficiente para reconocimiento semantico.")
        return [], 0.4, "semantic.fallback.v1"

    records = []
    for key in DIVIDEND_KEYS[:2] + INTEREST_KEYS[:2] + SALE_KEYS[:2]:
        if key in context.text.lower():
            records.append(
                ParsedRecord(
                    record_type="DESCONOCIDO",
                    fields={
                        "semantic_hint": key,
                        "description": f"Coincidencia semantica detectada para '{key}'"
                    },
                    confidence=0.69,
                    source_spans=[make_span(context.text, key)]
                )
            )

    confidence = 0.74 if records else 0.52
    if not records:
        context.warnings.append("Fallback semantico sin coincidencias de renta/patrimonio.")

    return records, confidence, "semantic.fallback.v1"


def parse_document(request: ParseDocumentRequest) -> ParseDocumentResponse:
    warnings: List[str] = []
    text = normalize_text(request)
    entity = detect_entity(request.filename, request.entity_hint, text)

    context = ParseContext(text=text, entity=entity, warnings=warnings)

    if entity in {"PICTET", "GOLDMAN_SACHS", "CITI"}:
        records, confidence, template_used = parse_template(context)
        strategy = "template"
        if confidence < 0.85:
            semantic_records, semantic_confidence, semantic_template = parse_semantic(context)
            if semantic_confidence > confidence:
                records, confidence, template_used = semantic_records, semantic_confidence, semantic_template
                strategy = "semantic"
    else:
        records, confidence, template_used = parse_semantic(context)
        strategy = "semantic" if confidence >= 0.6 else "manual"

    requires_manual_review = confidence < 0.85 or len(records) == 0

    if requires_manual_review:
        warnings.append("Confianza por debajo de umbral 0.85; enviar a validacion manual.")

    source_spans: List[SourceSpan] = []
    for record in records:
        source_spans.extend(record.source_spans)

    return ParseDocumentResponse(
        document_id=request.document_id,
        expediente_id=request.expediente_id,
        parser_strategy=strategy,
        template_used=template_used,
        confidence=round(confidence, 3),
        requires_manual_review=requires_manual_review,
        records=records,
        source_spans=source_spans,
        warnings=warnings,
    )
