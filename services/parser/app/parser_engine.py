"""
Motor de parseo adaptativo — Harvey AI First.

Pipeline de extracción:
  Nivel 0   — Harvey AI Cognitive Engine (PRIMARIO para todos los documentos)
              Map-Reduce + ISIN Luhn. Se usa intensivamente sin restricción de tokens.
  Nivel 1   — Fallback: Plantillas por entidad (Pictet, Goldman, Citi, JP Morgan)
  Nivel 1.5 — Fallback: Extracción determinista desde structured_document
  Nivel 2   — Fallback: LLM (GPT-4o-mini)
  Nivel 3   — Escalado a revisión manual si confianza < umbral

Harvey AI es el motor principal de calidad. Los parsers deterministas solo actúan
cuando Harvey no está disponible (sin token) o falla por error técnico.
"""
import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.canonical_registry import derive_canonical_registry
from app.extractors import base as base_utils
from app.extractors import citi, goldman, jpmorgan, pictet
from app.extractors.base import ExtractedRecord
from app.extractors.llm_fallback import extract as llm_extract
from app.schemas import (
    ParseDocumentRequest,
    ParseDocumentResponse,
    ParsedRecord,
    SourceSpan,
)
from app.structured_document import (
    build_structured_document,
    flatten_structured_text,
    infer_source_type,
    iter_structured_lines,
)

logger = logging.getLogger(__name__)

MANUAL_REVIEW_THRESHOLD = 0.85
MIN_RECORDS_FOR_SUCCESS = 1

# Mapeo Harvey asset_type → ParsedRecord record_type
_HARVEY_TYPE_MAP: Dict[str, str] = {
    "CUENTA": "CUENTA",
    "VALOR": "VALOR",
    "FONDO": "IIC",
    "SEGURO": "SEGURO",
    "DESCONOCIDO": "POSICION",
}


def detect_entity(filename: str, entity_hint: Optional[str], text: str) -> str:
    candidate = f"{entity_hint or ''} {filename} {text[:800]}".lower()
    if "pictet" in candidate:
        return "PICTET"
    if any(k in candidate for k in ["goldman", "gs ", "gs-", "gsam", "gs284", "gsx"]):
        return "GOLDMAN_SACHS"
    if "citi" in candidate:
        return "CITI"
    if any(k in candidate for k in ["j.p. morgan", "jpmorgan", "jp morgan", "chaslulx", "account opening"]):
        return "JP_MORGAN"
    return "UNKNOWN"


def _template_prefix(entity: str) -> str:
    return {
        "PICTET": "pictet",
        "GOLDMAN_SACHS": "goldman",
        "CITI": "citi",
        "JP_MORGAN": "jpmorgan",
    }.get(entity, "generic")


def _template_name(entity: str, suffix: str) -> str:
    return f"{_template_prefix(entity)}.{suffix}"


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


def _build_record(
    *,
    line: str,
    page: int,
    op_type: str,
    base_confidence: float,
    template_name: str,
    section: Optional[str] = None,
    default_currency: Optional[str] = None,
) -> ExtractedRecord:
    return ExtractedRecord(
        record_type=op_type,
        operation_date=base_utils.parse_date(line),
        isin=base_utils.extract_isin(line),
        description=line[:120],
        amount=base_utils.parse_amount(line),
        currency=base_utils.extract_currency(line) or (default_currency or "EUR"),
        retention=None,
        quantity=None,
        page=page,
        row_text=line,
        confidence=base_utils.confidence_from_fields(
            base_utils.parse_date(line) is not None,
            base_utils.parse_amount(line) is not None,
            base_utils.extract_isin(line) is not None,
            base_confidence,
        ),
        extra={
            "template": template_name,
            **({"section": section} if section else {}),
        },
    )


def _extract_from_lines(
    entity: str,
    lines: List[Tuple[str, int]],
    *,
    template_name: str,
) -> List[ExtractedRecord]:
    records: List[ExtractedRecord] = []

    if entity == "GOLDMAN_SACHS":
        current_section = None
        for raw_line, page in lines:
            line = raw_line.strip()
            if len(line) < 10:
                continue
            section = goldman._detect_section_type(line)
            if section:
                current_section = section
                continue
            op_type = current_section
            if not op_type:
                op_type, _ = base_utils.detect_operation_type(line)
                if op_type == "DESCONOCIDO":
                    continue
            records.append(
                _build_record(
                    line=line,
                    page=page,
                    op_type=op_type,
                    base_confidence=0.85 if current_section else 0.78,
                    template_name=template_name,
                    section=current_section,
                    default_currency="USD",
                )
            )
        return records

    if entity == "CITI":
        current_section = None
        for raw_line, page in lines:
            line = raw_line.strip()
            if len(line) < 10:
                continue
            section = citi._detect_citi_section(line)
            if section:
                current_section = section
                continue
            op_type = current_section
            if not op_type:
                op_type, _ = base_utils.detect_operation_type(line)
                if op_type == "DESCONOCIDO":
                    continue
            records.append(
                _build_record(
                    line=line,
                    page=page,
                    op_type=op_type,
                    base_confidence=0.83 if current_section else 0.75,
                    template_name=template_name,
                    section=current_section,
                    default_currency="USD",
                )
            )
        return records

    for raw_line, page in lines:
        line = raw_line.strip()
        if len(line) < 15:
            continue
        op_type, base_conf = base_utils.detect_operation_type(line)
        if op_type == "DESCONOCIDO":
            continue
        confidence_base = base_conf + 0.02 if entity == "PICTET" else base_conf - 0.05
        records.append(
            _build_record(
                line=line,
                page=page,
                op_type=op_type,
                base_confidence=confidence_base,
                template_name=template_name,
            )
        )

    return records


def _extract_from_text(entity: str, text: str, *, template_name: str) -> List[ExtractedRecord]:
    lines = [(line, 1) for line in text.splitlines()]
    return _extract_from_lines(entity, lines, template_name=template_name)


def _harvey_dicts_to_parsed(
    harvey_records: List[Dict[str, Any]],
) -> Tuple[List[ParsedRecord], List[SourceSpan]]:
    """Convierte los dicts de Harvey a ParsedRecord + SourceSpan."""
    parsed: List[ParsedRecord] = []
    spans: List[SourceSpan] = []

    for idx, rec in enumerate(harvey_records):
        record_type = _HARVEY_TYPE_MAP.get(
            str(rec.get("asset_type", "DESCONOCIDO")), "POSICION"
        )
        fields: Dict[str, Any] = {
            k: v
            for k, v in {
                "description": rec.get("description"),
                "isin": rec.get("isin"),
                "amount": rec.get("amount"),
                "currency": rec.get("currency"),
                "quantity": rec.get("quantity"),
                "clave_bien": rec.get("clave_bien"),
                "country_code": rec.get("country_code"),
                "entity_name": rec.get("entity_name"),
                "strategy": rec.get("strategy"),
            }.items()
            if v is not None
        }

        confidence = float(rec.get("confidence", 0.95))
        span = SourceSpan(page=1, start=0, end=0, snippet=f"Harvey AI #{idx + 1}")

        parsed.append(
            ParsedRecord(
                record_type=record_type,  # type: ignore[arg-type]
                fields=fields,
                confidence=confidence,
                source_spans=[span],
            )
        )
        spans.append(span)

    return parsed, spans


def parse_document(request: ParseDocumentRequest) -> ParseDocumentResponse:
    structured_document, content_bytes, structure_warnings = build_structured_document(request)
    warnings: List[str] = list(structure_warnings)
    full_text = flatten_structured_text(structured_document)
    source_type = infer_source_type(request)
    entity = detect_entity(request.filename, request.entity_hint, full_text)

    # ─────────────────────────────────────────────────────────────────
    # Nivel 0: Harvey AI — Motor PRIMARIO
    # Harvey se usa intensivamente para todos los documentos (sin
    # restricción de tokens). Solo se salta si no hay HARVEY_TOKEN
    # o si falla por error técnico.
    # ─────────────────────────────────────────────────────────────────
    try:
        from app.harvey_engine import extract_unknown_bank_harvey, harvey_engine

        if harvey_engine.is_available:
            # Construir markdown rico para Harvey: usar page.text cuando
            # existe, pero para páginas con text vacío (Docling no siempre
            # genera page breaks → todo el texto va en página 1), incluir
            # contenido de tablas como texto.
            page_markdowns: List[str] = []
            for page in structured_document.pages:
                page_md = (page.text or "").strip()
                if not page_md and page.tables:
                    # Página sin texto OCR pero con tablas estructuradas:
                    # convertir tablas a markdown para que Harvey las analice
                    table_lines: List[str] = []
                    for table in page.tables:
                        if table.header:
                            table_lines.append(
                                "| " + " | ".join(c or "" for c in table.header) + " |"
                            )
                            table_lines.append(
                                "| " + " | ".join("---" for _ in table.header) + " |"
                            )
                        for row in table.rows:
                            table_lines.append(
                                "| " + " | ".join(c or "" for c in row) + " |"
                            )
                    if table_lines:
                        page_md = "\n".join(table_lines)
                if page_md:
                    page_markdowns.append(page_md)

            harvey_markdown = "\n---\n".join(page_markdowns)

            logger.info(
                "Harvey markdown construction: %d páginas con contenido de %d totales, %d chars",
                len(page_markdowns),
                len(structured_document.pages),
                len(harvey_markdown),
            )

            if harvey_markdown and len(harvey_markdown.strip()) >= 100:
                logger.info(
                    "Harvey AI Motor Primario: entidad=%s, %d chars de markdown, %d páginas",
                    entity,
                    len(harvey_markdown),
                    len(structured_document.pages),
                )

                # asyncio.run() es seguro aquí: FastAPI ejecuta endpoints sync
                # en un thread pool que no tiene event loop propio
                harvey_records = asyncio.run(
                    extract_unknown_bank_harvey(harvey_markdown)
                )

                if harvey_records:
                    harvey_parsed, harvey_spans = _harvey_dicts_to_parsed(harvey_records)

                    global_confidence = round(
                        sum(r.confidence for r in harvey_parsed) / len(harvey_parsed), 3
                    )
                    requires_manual_review = global_confidence < MANUAL_REVIEW_THRESHOLD

                    if requires_manual_review:
                        warnings.append(
                            f"Harvey AI: confianza media {global_confidence:.2f} < "
                            f"{MANUAL_REVIEW_THRESHOLD}; requiere validación."
                        )

                    asset_records, fiscal_events = derive_canonical_registry(harvey_parsed)

                    logger.info(
                        "Harvey AI OK: %d activos, confianza %.2f, entidad detectada=%s",
                        len(harvey_parsed),
                        global_confidence,
                        entity,
                    )

                    return ParseDocumentResponse(
                        document_id=request.document_id,
                        expediente_id=request.expediente_id,
                        parser_strategy="harvey_universal",
                        template_used="harvey.universal.v1",
                        confidence=global_confidence,
                        requires_manual_review=requires_manual_review,
                        records=harvey_parsed,
                        asset_records=asset_records,
                        fiscal_events=fiscal_events,
                        source_spans=harvey_spans,
                        structured_document=structured_document,
                        warnings=warnings,
                    )
                else:
                    warnings.append(
                        "Harvey AI no extrajo resultados; activando fallback determinista."
                    )
            else:
                warnings.append("Markdown insuficiente para Harvey AI (<100 chars).")
        else:
            logger.info("Harvey AI no configurado (HARVEY_TOKEN ausente). Usando pipeline determinista.")
    except Exception as exc:
        logger.error("Error en Harvey AI Motor Primario: %s", exc, exc_info=True)
        warnings.append(f"Error en Harvey AI: {exc}; activando fallback determinista.")

    # ─────────────────────────────────────────────────────────────────
    # FALLBACK: pipeline determinista (solo si Harvey falla o no está)
    # ─────────────────────────────────────────────────────────────────
    extracted_records: List[ExtractedRecord] = []
    strategy = "manual"
    template_used = "unknown.v0"

    # Nivel 1 (Fallback): Plantillas por entidad
    if entity != "UNKNOWN":
        try:
            if source_type == "PDF" and content_bytes:
                if entity == "PICTET":
                    extracted_records = pictet.extract(content_bytes)
                    template_used = "pictet.v2"
                elif entity == "GOLDMAN_SACHS":
                    extracted_records = goldman.extract(content_bytes)
                    template_used = "goldman.v2"
                elif entity == "CITI":
                    extracted_records = citi.extract(content_bytes)
                    template_used = "citi.v2"
                elif entity == "JP_MORGAN":
                    extracted_records = jpmorgan.extract(content_bytes)
                    template_used = "jpmorgan.v1"
            else:
                fallback_suffix = "structured.v1" if source_type in {"CSV", "XLSX"} else "text.v2"
                extracted_records = _extract_from_lines(
                    entity,
                    iter_structured_lines(structured_document),
                    template_name=_template_name(entity, fallback_suffix),
                )
                template_used = _template_name(entity, fallback_suffix)

            if extracted_records:
                strategy = "template"
            else:
                warnings.append(
                    f"Plantilla {entity} reconocida pero sin registros."
                )
        except Exception as exc:
            warnings.append(f"Error en extractor {entity}: {exc}")

    # Nivel 1.5 (Fallback): Extracción determinista desde structured_document
    if len(extracted_records) < MIN_RECORDS_FOR_SUCCESS and structured_document.pages:
        structured_records = _extract_from_lines(
            entity,
            iter_structured_lines(structured_document),
            template_name=(
                _template_name(entity, "structured.v1")
                if entity != "UNKNOWN"
                else f"{str(source_type).lower()}.structured.v1"
            ),
        )
        if structured_records:
            extracted_records = structured_records
            strategy = "template"
            template_used = (
                _template_name(entity, "structured.v1")
                if entity != "UNKNOWN"
                else f"{str(source_type).lower()}.structured.v1"
            )

    # Nivel 2 (Fallback): LLM
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

    # Nivel 3: Sin resultados → revisión manual
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

    parsed_records: List[ParsedRecord] = []
    all_spans: List[SourceSpan] = []
    for rec in extracted_records:
        parsed_record, span = _to_parsed_record(rec, full_text)
        parsed_records.append(parsed_record)
        all_spans.append(span)

    asset_records, fiscal_events = derive_canonical_registry(parsed_records)

    return ParseDocumentResponse(
        document_id=request.document_id,
        expediente_id=request.expediente_id,
        parser_strategy=strategy,  # type: ignore[arg-type]
        template_used=template_used,
        confidence=global_confidence,
        requires_manual_review=requires_manual_review,
        records=parsed_records,
        asset_records=asset_records,
        fiscal_events=fiscal_events,
        source_spans=all_spans,
        structured_document=structured_document,
        warnings=warnings,
    )
