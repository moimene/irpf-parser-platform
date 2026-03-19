"""
extractor_patrimonio.py — V3 Pass 1: Extract holdings, snapshots, and instruments.

Processes POSITIONS sections from the ExtractionPlan.
Uses OpenAI gpt-4o with JSON mode.
Runs chunks in parallel (asyncio.gather, semaphore=3).
Applies Aduana Matemática v2 dedup post-extraction.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from openai import AsyncOpenAI

from app.services.model_policy import get_model_for_role
from app.schemas.canonical_v2 import (
    CanonicalExtraction,
    ExtractionCoverage,
    ExtractionPlan,
    ExtractPatrimonioRequest,
    HoldingRecord,
    IncomeEventRecord,
    InstrumentRecord,
    OrphanRecord,
    PlannedSection,
    SectionReference,
    SnapshotRecord,
    SectionType,
    ExtractionPass,
)
from app.engines.v3.aduana_v2 import dedup_snapshots, filter_aggregates

_openai_client: AsyncOpenAI | None = None
_CHUNK_SIZE = 20_000    # max characters per chunk
_SEMAPHORE_LIMIT = 3    # max concurrent OpenAI calls


def _get_openai() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=api_key, timeout=120.0)
    return _openai_client


def _chunk_section(rows: list[list[str]], chunk_size: int = _CHUNK_SIZE) -> list[str]:
    """
    Split sheet rows into text chunks of at most chunk_size characters.
    Each chunk is a CSV-like string of rows.
    """
    chunks: list[str] = []
    current_lines: list[str] = []
    current_len = 0

    for row in rows:
        line = ",".join(cell.replace(",", ";") for cell in row)
        line_len = len(line) + 1  # +1 for newline

        if current_len + line_len > chunk_size and current_lines:
            chunks.append("\n".join(current_lines))
            current_lines = []
            current_len = 0

        current_lines.append(line)
        current_len += line_len

    if current_lines:
        chunks.append("\n".join(current_lines))

    return chunks


def _chunk_section_text(text: str, chunk_size: int = _CHUNK_SIZE) -> list[str]:
    """Split markdown text into chunks, breaking at page separators or paragraphs."""
    if len(text) <= chunk_size:
        return [text] if text.strip() else []

    # Try splitting by page separator first
    pages = text.split("\n---\n")
    if len(pages) > 1:
        chunks: list[str] = []
        current = ""
        for page in pages:
            if len(current) + len(page) + 5 > chunk_size and current:
                chunks.append(current)
                current = page
            else:
                current = current + "\n---\n" + page if current else page
        if current.strip():
            chunks.append(current)
        return chunks

    # Fallback: split by paragraphs
    paragraphs = text.split("\n\n")
    chunks = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) + 2 > chunk_size and current:
            chunks.append(current)
            current = para
        else:
            current = current + "\n\n" + para if current else para
    if current.strip():
        chunks.append(current)
    return chunks


async def _extract_chunk(
    chunk_text: str,
    chunk_id: str,
    section: PlannedSection,
    ejercicio: int,
    semaphore: asyncio.Semaphore,
) -> tuple[str, dict[str, Any] | None]:
    """
    Extract assets from a single chunk. Returns (chunk_id, parsed_dict | None).
    Returns None on failure (chunk_id is added to failed_chunk_ids).
    """
    system_prompt = (
        "You are a financial asset extraction engine for the Spanish Modelo 720. "
        "Extract ALL asset positions from the provided data. "
        "Return JSON with arrays: instruments, holdings, snapshots, orphans.\n\n"
        "For each snapshot include: instrument_ref (ISIN/IBAN/account), ejercicio, "
        "valor_31dic (numeric), moneda (3-letter ISO), and optional: cantidad, precio_unitario, "
        "fecha_adquisicion (YYYY-MM-DD), canonical_status ('extracted' or 'needs_review').\n"
        "For each instrument: instrument_type, description, jurisdiction, identifiers [{type, value}].\n"
        "For each holding: instrument_ref, custodian, custodian_country, role (TITULAR/etc), "
        "participation_pct.\n"
        "Orphans: rows you saw but couldn't classify — include raw_data, reason, source_section, confidence.\n"
        "Return ONLY valid JSON. No markdown. No explanation."
    )

    user_prompt = (
        f"Section: {section.label} ({section.section_type.value})\n"
        f"Fiscal year: {ejercicio}\n"
        f"Chunk ID: {chunk_id}\n\n"
        f"{chunk_text}"
    )

    async with semaphore:
        try:
            client = _get_openai()
            response = await client.chat.completions.create(
                model=get_model_for_role("patrimonio"),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,
                max_tokens=16000,
            )
            raw = response.choices[0].message.content or "{}"
            return chunk_id, json.loads(raw)
        except Exception:  # noqa: BLE001
            return chunk_id, None


async def _pdf_to_markdown(content_base64: str) -> str:
    """Convert base64-encoded PDF to markdown text using Docling/pdfplumber."""
    import base64
    from app.docling_converter import convert_document

    content_bytes = base64.b64decode(content_base64)
    markdown, _tables, _pages, _backend, _warnings = convert_document(
        content_bytes, "document.pdf"
    )
    return markdown


async def _extract_pdf_via_v2(
    request: ExtractPatrimonioRequest,
    start: float,
    skipped_sections: list[PlannedSection],
) -> CanonicalExtraction:
    """
    PDF extraction via V2 engine bridge.

    Uses the proven V2 pipeline (Docling → OpenAI map-reduce → Aduana Matemática)
    which achieves 64/64 on the EFG Bank benchmark, then maps the result to V3
    canonical schema.
    """
    import base64
    from app.docling_converter import convert_document
    from app.engines.openai_universal import extract_m720_openai
    from app.engines.v3.v2_bridge import map_v2_to_canonical

    content_bytes = base64.b64decode(request.content_base64)
    markdown, _tables, _pages, _backend, _warnings = convert_document(
        content_bytes, "document.pdf"
    )

    if not markdown or not markdown.strip():
        elapsed = time.monotonic() - start
        return CanonicalExtraction(
            doc_type=request.plan.doc_type,
            custodian=request.plan.custodian,
            reference_date=request.plan.reference_date,
            ejercicio=request.ejercicio,
            base_currency=request.plan.base_currency,
            extraction_pass="patrimonio",
            engine="openai_v2_bridge",
            instruments=[], holdings=[], snapshots=[],
            income_events=[], orphans=[], unscanned_sections=[],
            coverage=ExtractionCoverage(
                rows_found=0, rows_extracted=0, rows_orphaned=0, rows_skipped=0,
            ),
            warnings=["Docling returned empty markdown for PDF"],
            chunk_count=0,
            processing_time_seconds=round(elapsed, 2),
        )

    v2_extraction, _coverage = await extract_m720_openai(markdown)

    elapsed = time.monotonic() - start
    result = map_v2_to_canonical(
        v2_extraction,
        ejercicio=request.ejercicio,
        custodian=request.plan.custodian,
        reference_date=request.plan.reference_date,
        base_currency=request.plan.base_currency,
        processing_time=round(elapsed, 2),
    )
    return result


async def extract_patrimonio(request: ExtractPatrimonioRequest) -> CanonicalExtraction:
    """
    Run Pass 1 (patrimonio) extraction.

    Processes all POSITIONS sections from the plan.
    Chunks each section, runs all chunks in parallel (semaphore=3).
    Applies Aduana v2 dedup after merging results.
    """
    start = time.monotonic()
    semaphore = asyncio.Semaphore(_SEMAPHORE_LIMIT)

    # Collect POSITIONS sections
    patrimonio_sections = [
        s for s in request.plan.sections
        if s.extraction_pass == ExtractionPass.patrimonio
    ]
    skipped_sections = [
        s for s in request.plan.sections
        if s.extraction_pass != ExtractionPass.patrimonio
    ]

    # Build (section, chunk_text, chunk_id) tuples
    chunk_tasks: list[tuple[PlannedSection, str, str]] = []
    rows_source: dict[str, list[list[str]]] = {}

    if request.sheets:
        for sheet in request.sheets:
            rows_source[sheet["name"]] = sheet["rows"]

    # For PDFs: use V2 engine bridge (proven map-reduce + Aduana pipeline)
    if not rows_source and request.content_base64:
        return await _extract_pdf_via_v2(request, start, skipped_sections)

    pdf_markdown: str | None = None

    for sec in patrimonio_sections:
        sheet_rows = rows_source.get(sec.source, [])
        if not sheet_rows and pdf_markdown:
            # PDF: chunk the markdown text (smaller chunks than XLS to avoid
            # hitting max_tokens on dense financial tables)
            pdf_chunks = _chunk_section_text(pdf_markdown, chunk_size=8_000)
            for i, chunk_text in enumerate(pdf_chunks):
                chunk_tasks.append((sec, chunk_text, f"{sec.section_id}_{i}"))
            continue
        chunks = _chunk_section(sheet_rows)
        for i, chunk_text in enumerate(chunks):
            chunk_tasks.append((sec, chunk_text, f"{sec.section_id}_{i}"))

    # Run all chunks in parallel
    coroutines = [
        _extract_chunk(ct, cid, sec, request.ejercicio, semaphore)
        for sec, ct, cid in chunk_tasks
    ]
    results = await asyncio.gather(*coroutines)

    # Merge results
    all_instruments: list[InstrumentRecord] = []
    all_holdings: list[HoldingRecord] = []
    all_snapshots: list[SnapshotRecord] = []
    all_orphans: list[OrphanRecord] = []
    failed_chunk_ids: list[str] = []

    for chunk_id, data in results:
        if data is None:
            failed_chunk_ids.append(chunk_id)
            continue
        for raw in data.get("instruments", []):
            try:
                all_instruments.append(InstrumentRecord(**raw))
            except Exception:  # noqa: BLE001
                all_orphans.append(OrphanRecord(
                    raw_data=raw, reason="instrument parse error",
                    source_section="unknown", confidence=0.3,
                ))
        for raw in data.get("holdings", []):
            try:
                all_holdings.append(HoldingRecord(**raw))
            except Exception:  # noqa: BLE001
                all_orphans.append(OrphanRecord(
                    raw_data=raw, reason="holding parse error",
                    source_section="unknown", confidence=0.3,
                ))
        for raw in data.get("snapshots", []):
            try:
                all_snapshots.append(SnapshotRecord(**raw))
            except Exception:  # noqa: BLE001
                all_orphans.append(OrphanRecord(
                    raw_data=raw, reason="snapshot parse error",
                    source_section="unknown", confidence=0.3,
                ))
        for raw in data.get("orphans", []):
            try:
                all_orphans.append(OrphanRecord(**raw))
            except Exception:  # noqa: BLE001
                pass

    # Apply Aduana v2 dedup
    all_snapshots = filter_aggregates(all_snapshots)
    all_snapshots, _snap_warnings = dedup_snapshots(all_snapshots)

    unscanned = [
        SectionReference(
            section_id=s.section_id,
            label=s.label,
            source_type="sheet",
            location=s.source,
        )
        for s in skipped_sections
    ]

    rows_found = sum(len(rows_source.get(s.source, [])) for s in patrimonio_sections)
    rows_extracted = len(all_snapshots) + len(all_holdings)

    elapsed = time.monotonic() - start

    return CanonicalExtraction(
        doc_type=request.plan.doc_type,
        custodian=request.plan.custodian,
        custodian_bic=request.plan.custodian_bic,
        reference_date=request.plan.reference_date,
        ejercicio=request.ejercicio,
        base_currency=request.plan.base_currency,
        extraction_pass="patrimonio",
        engine="openai_v2",
        instruments=all_instruments,
        holdings=all_holdings,
        snapshots=all_snapshots,
        income_events=[],
        orphans=all_orphans,
        unscanned_sections=unscanned,
        coverage=ExtractionCoverage(
            rows_found=rows_found,
            rows_extracted=rows_extracted,
            rows_orphaned=len(all_orphans),
            rows_skipped=max(0, rows_found - rows_extracted - len(all_orphans)),
        ),
        warnings=[f"Failed chunks: {failed_chunk_ids}"] if failed_chunk_ids else [],
        chunk_count=len(chunk_tasks),
        partial_extraction=len(failed_chunk_ids) > 0,
        failed_chunk_ids=failed_chunk_ids,
        processing_time_seconds=round(elapsed, 2),
    )
