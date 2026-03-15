"""
extractor_rentas.py — V3 Pass 2: Extract income events / transactions.

Processes TRANSACTIONS sections from the ExtractionPlan.
Uses by_date_range chunking for large sheets (repeats header_rows in each chunk).
Applies Aduana Matemática v2 income_event dedup post-extraction.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from openai import AsyncOpenAI

from app.schemas.canonical_v2 import (
    CanonicalExtraction,
    ExtractionCoverage,
    ExtractionPlan,
    ExtractRentasRequest,
    IncomeEventRecord,
    IncomeEventType,
    OrphanRecord,
    PlannedSection,
    SectionReference,
    ExtractionPass,
    CanonicalStatus,
)
from app.engines.v3.aduana_v2 import dedup_income_events

_openai_client: AsyncOpenAI | None = None
_CHUNK_SIZE = 20_000
_SEMAPHORE_LIMIT = 3
_DATE_COL_KEYWORDS = ("fecha", "date", "datum", "data", "date de")


def _get_openai() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=api_key, timeout=120.0)
    return _openai_client


def _find_date_column(header: list[str]) -> int:
    """Return the index of the most likely date column, or 0 if not found."""
    for i, cell in enumerate(header):
        if any(kw in cell.lower() for kw in _DATE_COL_KEYWORDS):
            return i
    return 0


def _split_by_date_range(
    rows: list[list[str]],
    chunk_size: int = _CHUNK_SIZE,
) -> list[tuple[list[str], list[list[str]]]]:
    """
    Split transaction rows into chunks by date range.
    Returns list of (header_rows_as_strings, data_rows) tuples.
    header_rows are the first 1-2 rows (column headers).
    Each chunk is at most chunk_size characters of data rows.
    """
    if not rows:
        return []

    # Detect header rows (first 1-2 rows that don't look like data)
    header_cutoff = 1
    if len(rows) > 1:
        # If second row also looks like a header (mostly non-numeric), include it
        first_data_row = rows[1] if len(rows) > 1 else []
        numeric_count = sum(1 for c in first_data_row if c.replace(".", "").replace("-", "").replace(",", "").isdigit())
        if numeric_count < len(first_data_row) // 3:
            header_cutoff = 2

    header_rows = [rows[i] for i in range(min(header_cutoff, len(rows)))]
    data_rows = rows[header_cutoff:]

    header_text = "\n".join(",".join(cell.replace(",", ";") for cell in r) for r in header_rows)

    chunks: list[tuple[list[str], list[list[str]]]] = []
    current_data: list[list[str]] = []
    current_len = len(header_text)

    for row in data_rows:
        line = ",".join(cell.replace(",", ";") for cell in row)
        line_len = len(line) + 1

        if current_len + line_len > chunk_size and current_data:
            chunks.append((header_rows, current_data))
            current_data = []
            current_len = len(header_text)

        current_data.append(row)
        current_len += line_len

    if current_data:
        chunks.append((header_rows, current_data))

    return chunks


async def _extract_rentas_chunk(
    header_rows: list[list[str]],
    data_rows: list[list[str]],
    chunk_id: str,
    section: PlannedSection,
    ejercicio: int,
    semaphore: asyncio.Semaphore,
) -> tuple[str, dict[str, Any] | None]:
    """Extract income events from a single transaction chunk."""
    header_text = "\n".join(",".join(cell.replace(",", ";") for cell in r) for r in header_rows)
    data_text = "\n".join(",".join(cell.replace(",", ";") for cell in r) for r in data_rows)
    chunk_text = f"{header_text}\n{data_text}"

    system_prompt = (
        "You are a financial income event extraction engine for the Spanish Modelo 720 / IRPF. "
        "Extract ALL income events (dividends, interest, sales, purchases, redemptions, etc.) "
        "from the transaction data. Return JSON with: income_events (array), orphans (array).\n\n"
        "For each income_event: instrument_ref (ISIN/IBAN/account), event_type "
        "(DIVIDEND|INTEREST|COUPON|CAPITAL_GAIN|SALE|PURCHASE|REDEMPTION|SUBSCRIPTION|"
        "WITHHOLDING|LOAN_INTEREST|RENTAL_INCOME|OTHER), fecha (YYYY-MM-DD), importe (numeric), "
        "moneda (3-letter ISO), importe_eur (optional numeric), retencion (optional numeric), "
        "ejercicio (integer), canonical_status ('extracted' or 'needs_review').\n"
        "Orphans: rows you saw but couldn't classify.\n"
        "Return ONLY valid JSON. No markdown."
    )

    user_prompt = (
        f"Section: {section.label}\n"
        f"Fiscal year: {ejercicio}\n"
        f"Chunk ID: {chunk_id}\n\n"
        f"{chunk_text}"
    )

    async with semaphore:
        try:
            client = _get_openai()
            response = await client.chat.completions.create(
                model="gpt-4o",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,
                max_tokens=4000,
            )
            raw = response.choices[0].message.content or "{}"
            return chunk_id, json.loads(raw)
        except Exception:  # noqa: BLE001
            return chunk_id, None


async def extract_rentas(request: ExtractRentasRequest) -> CanonicalExtraction:
    """
    Run Pass 2 (rentas) extraction.

    Processes all TRANSACTIONS sections from the plan.
    Uses date-range chunking for large sheets (repeats header rows in each chunk).
    Applies Aduana v2 income_event dedup after merging.
    """
    start = time.monotonic()
    semaphore = asyncio.Semaphore(_SEMAPHORE_LIMIT)

    rentas_sections = [
        s for s in request.plan.sections
        if s.extraction_pass == ExtractionPass.rentas
    ]
    skipped_sections = [
        s for s in request.plan.sections
        if s.extraction_pass != ExtractionPass.rentas
    ]

    rows_source: dict[str, list[list[str]]] = {}
    if request.sheets:
        for sheet in request.sheets:
            rows_source[sheet["name"]] = sheet["rows"]

    # For PDFs: convert base64 to markdown once
    pdf_markdown: str | None = None
    if not rows_source and request.content_base64:
        import base64
        from app.docling_converter import convert_document
        content_bytes = base64.b64decode(request.content_base64)
        pdf_markdown, _t, _p, _b, _w = convert_document(content_bytes, "document.pdf")

    # Build chunk tasks
    chunk_tasks: list[tuple[PlannedSection, list[str], list[list[str]], str]] = []
    for sec in rentas_sections:
        sheet_rows = rows_source.get(sec.source, [])
        if not sheet_rows:
            if pdf_markdown:
                # Convert markdown to rows-like structure for the chunk extractor
                pdf_lines = pdf_markdown.split("\n")
                chunk_tasks.append((sec, [], [pdf_lines], f"{sec.section_id}_0"))
            continue

        date_chunks = _split_by_date_range(sheet_rows)
        for i, (header_rows, data_rows) in enumerate(date_chunks):
            chunk_tasks.append((sec, header_rows, data_rows, f"{sec.section_id}_{i}"))

    # Run all chunks in parallel
    coroutines = [
        _extract_rentas_chunk(hdr, data, cid, sec, request.ejercicio, semaphore)
        for sec, hdr, data, cid in chunk_tasks
    ]
    results = await asyncio.gather(*coroutines)

    all_income_events: list[IncomeEventRecord] = []
    all_orphans: list[OrphanRecord] = []
    failed_chunk_ids: list[str] = []

    for chunk_id, data in results:
        if data is None:
            failed_chunk_ids.append(chunk_id)
            continue
        for raw in data.get("income_events", []):
            try:
                # Ensure ejercicio is set from request if missing
                if not raw.get("ejercicio"):
                    raw["ejercicio"] = request.ejercicio
                # Validate event_type enum
                raw_type = raw.get("event_type", "OTHER")
                try:
                    IncomeEventType(raw_type)
                except ValueError:
                    raw["event_type"] = "OTHER"
                    raw["canonical_status"] = CanonicalStatus.needs_review.value
                all_income_events.append(IncomeEventRecord(**raw))
            except Exception:  # noqa: BLE001
                all_orphans.append(OrphanRecord(
                    raw_data=raw, reason="income_event parse error",
                    source_section="unknown", confidence=0.3,
                ))
        for raw in data.get("orphans", []):
            try:
                all_orphans.append(OrphanRecord(**raw))
            except Exception:  # noqa: BLE001
                pass

    # Apply Aduana v2 income_event dedup
    all_income_events, _warnings = dedup_income_events(all_income_events)

    unscanned = [
        SectionReference(
            section_id=s.section_id,
            label=s.label,
            source_type="sheet",
            location=s.source,
        )
        for s in skipped_sections
    ]

    rows_found = sum(len(rows_source.get(s.source, [])) for s in rentas_sections)
    rows_extracted = len(all_income_events)
    elapsed = time.monotonic() - start

    return CanonicalExtraction(
        doc_type=request.plan.doc_type,
        custodian=request.plan.custodian,
        custodian_bic=request.plan.custodian_bic,
        reference_date=request.plan.reference_date,
        ejercicio=request.ejercicio,
        base_currency=request.plan.base_currency,
        extraction_pass="rentas",
        engine="openai_v2",
        instruments=[],
        holdings=[],
        snapshots=[],
        income_events=all_income_events,
        orphans=all_orphans,
        unscanned_sections=unscanned,
        coverage=ExtractionCoverage(
            rows_found=rows_found,
            rows_extracted=rows_extracted,
            rows_orphaned=len(all_orphans),
            rows_skipped=rows_found - rows_extracted - len(all_orphans),
        ),
        warnings=[f"Failed chunks: {failed_chunk_ids}"] if failed_chunk_ids else [],
        chunk_count=len(chunk_tasks),
        partial_extraction=len(failed_chunk_ids) > 0,
        failed_chunk_ids=failed_chunk_ids,
        processing_time_seconds=round(elapsed, 2),
    )
