"""
orchestrator.py — V3 Orchestrator: classify document type and build ExtractionPlan.

Routing:
  - bank_xls / advisor_xls / structured_pdf / txt_720: OpenAI gpt-4o only
  - unstructured_pdf: Harvey AI pre-analysis → then OpenAI gpt-4o for plan construction

The orchestrator does NOT extract data — it only plans the extraction.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from openai import AsyncOpenAI

from app.schemas.canonical_v2 import (
    DocType,
    ExtractionPlan,
    PlannedSection,
    SectionType,
    ExtractionPass,
    ChunkStrategy,
    PlanRequest,
)

_openai_client: AsyncOpenAI | None = None


def _safe_enum(enum_cls: type, value: object, default: str) -> Any:
    """Safely construct an enum, falling back to default on ValueError."""
    try:
        return enum_cls(value)
    except (ValueError, KeyError):
        return enum_cls(default)


def _get_openai() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=api_key, timeout=120.0)
    return _openai_client


async def run_harvey_preanalysis(content_base64: str, filename: str) -> str:
    """
    Run Harvey AI pre-analysis on an unstructured PDF.
    Returns the Harvey analysis text for use as context in the OpenAI plan call.
    Called ONLY for unstructured_pdf doc_type.
    """
    try:
        # Import locally to avoid circular imports; harvey_engine is a top-level module
        from app.harvey_engine import HarveyCognitiveEngine  # type: ignore[import]
        engine = HarveyCognitiveEngine()
        prompt = (
            "Analyze this document and identify: "
            "1) What type of financial document is this? "
            "2) What custodian/bank issued it? "
            "3) What sections contain asset positions (POSITIONS)? "
            "4) What sections contain transactions/income (TRANSACTIONS)? "
            "5) What fiscal year does it cover? "
            "Answer concisely in structured format."
        )
        result = await engine._call_completion(prompt)
        return str(result) if result else "Harvey pre-analysis returned empty response"
    except Exception as exc:  # noqa: BLE001
        return f"Harvey pre-analysis unavailable: {exc}"


async def build_extraction_plan(request: PlanRequest) -> ExtractionPlan:
    """
    Build an ExtractionPlan for the given document.

    Steps:
      1. If unstructured_pdf: call Harvey for pre-analysis context
      2. Call OpenAI gpt-4o with JSON mode to classify doc type and plan sections
      3. Return structured ExtractionPlan
    """
    harvey_context = ""
    if request.content_base64 and _looks_like_unstructured_pdf(request.filename):
        harvey_context = await run_harvey_preanalysis(
            request.content_base64, request.filename
        )

    # Build the prompt
    sheet_info = ""
    if request.sheet_metas:
        sheet_lines = []
        for m in request.sheet_metas:
            preview_str = "; ".join(
                ", ".join(row) for row in m.preview[:2]
            )
            sheet_lines.append(
                f"  - Sheet '{m.name}': {m.row_count} rows × {m.col_count} cols. "
                f"Preview: [{preview_str}]"
            )
        sheet_info = "Sheets available:\n" + "\n".join(sheet_lines)

    harvey_section = (
        f"\nHarvey AI pre-analysis:\n{harvey_context}\n" if harvey_context else ""
    )

    system_prompt = (
        "You are a financial document classifier and extraction planner for the Spanish Modelo 720 "
        "foreign asset declaration system. Your job is to analyze a financial document and produce "
        "a structured extraction plan.\n\n"
        "DocType options: bank_xls, advisor_xls, structured_pdf, unstructured_pdf, txt_720, unknown\n"
        "SectionType options: POSITIONS, TRANSACTIONS, SUMMARY, UNKNOWN\n"
        "ExtractionPass options: patrimonio, rentas, skip\n"
        "ChunkStrategy options: full, by_date_range, by_row_group\n\n"
        "Rules:\n"
        "- POSITIONS sections → extraction_pass: patrimonio\n"
        "- TRANSACTIONS sections → extraction_pass: rentas\n"
        "- SUMMARY sections → extraction_pass: skip (they are totals, not detail)\n"
        "- For large transaction sheets (>500 rows), use chunk_strategy: by_date_range\n"
        "- For structured row groups (e.g. asset categories), use by_row_group\n"
        "- For small or single-section docs, use full\n\n"
        "Return ONLY valid JSON matching the ExtractionPlan schema."
    )

    user_prompt = (
        f"Document: {request.filename}\n"
        f"Fiscal year: {request.ejercicio}\n"
        f"{sheet_info}\n"
        f"{harvey_section}\n"
        "Produce an ExtractionPlan JSON with: doc_type, doc_type_confidence, custodian (if known), "
        "ejercicio, reference_date (YYYY-MM-DD, use Dec 31 of ejercicio if unknown), "
        "base_currency, sections (array), estimated_chunks, estimated_instruments, warnings."
    )

    client = _get_openai()
    response = await client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,
        max_tokens=2000,
    )

    raw = response.choices[0].message.content or "{}"
    data: dict[str, Any] = json.loads(raw)

    # Normalize sections
    sections: list[PlannedSection] = []
    raw_sections = data.get("sections", [])

    # If AI returned fewer sections than sheets, build sections from sheet_metas
    sheet_names = [m.name for m in request.sheet_metas] if request.sheet_metas else []
    if sheet_names and len(raw_sections) < len(sheet_names):
        # AI didn't enumerate sheets properly — build one section per sheet
        raw_sections = []
        for i, sname in enumerate(sheet_names):
            name_lower = sname.lower()
            # Heuristic: match section type by sheet name keywords
            if any(kw in name_lower for kw in ("inventario", "posicion", "cartera", "portfolio", "balance", "saldo")):
                pass_type = "patrimonio"
                sec_type = "POSITIONS"
            elif any(kw in name_lower for kw in ("movimiento", "transac", "dividendo", "renta", "operacion", "venta", "compra")):
                pass_type = "rentas"
                sec_type = "TRANSACTIONS"
            elif any(kw in name_lower for kw in ("resumen", "summary", "total", "irpf")):
                pass_type = "skip"
                sec_type = "SUMMARY"
            else:
                pass_type = "patrimonio"
                sec_type = "POSITIONS"
            raw_sections.append({
                "section_id": f"sec_{i:02d}",
                "label": sname,
                "source": sname,
                "extraction_pass": pass_type,
                "section_type": sec_type,
                "reason": f"Auto-classified from sheet name '{sname}'",
                "chunk_strategy": "full",
                "estimated_rows": (request.sheet_metas[i].row_count if request.sheet_metas else 0),
            })

    for i, s in enumerate(raw_sections):
        # Resolve source: prefer AI's value, then match to a known sheet name, then "unknown"
        source = s.get("source") or "unknown"
        if source == "unknown" and i < len(sheet_names):
            source = sheet_names[i]

        sections.append(PlannedSection(
            section_id=s.get("section_id", f"sec_{i:02d}"),
            label=s.get("label", f"Section {i}"),
            source=source,
            extraction_pass=_safe_enum(ExtractionPass, s.get("extraction_pass", "skip"), "skip"),
            section_type=_safe_enum(SectionType, s.get("section_type", "UNKNOWN"), "UNKNOWN"),
            reason=s.get("reason", ""),
            chunk_strategy=_safe_enum(ChunkStrategy, s.get("chunk_strategy", "full"), "full"),
            estimated_rows=int(s.get("estimated_rows", 0)),
        ))

    # PDF fallback: if no sheets and no patrimonio section exists, create default sections
    # so extractors have something to process against the PDF markdown content
    is_pdf = _looks_like_unstructured_pdf(request.filename)
    if is_pdf and not sheet_names:
        has_patrimonio = any(s.extraction_pass == ExtractionPass.patrimonio for s in sections)
        has_rentas = any(s.extraction_pass == ExtractionPass.rentas for s in sections)
        if not has_patrimonio:
            sections.append(PlannedSection(
                section_id=f"sec_{len(sections):02d}",
                label="PDF Positions",
                source="pdf_full",
                extraction_pass=ExtractionPass.patrimonio,
                section_type=SectionType.POSITIONS,
                reason="Default patrimonio section for PDF (no sheets available)",
                chunk_strategy=ChunkStrategy.full,
                estimated_rows=0,
            ))
        if not has_rentas:
            sections.append(PlannedSection(
                section_id=f"sec_{len(sections):02d}",
                label="PDF Transactions",
                source="pdf_full",
                extraction_pass=ExtractionPass.rentas,
                section_type=SectionType.TRANSACTIONS,
                reason="Default rentas section for PDF (no sheets available)",
                chunk_strategy=ChunkStrategy.full,
                estimated_rows=0,
            ))

    doc_type_str = data.get("doc_type", "unknown")
    try:
        doc_type = DocType(doc_type_str)
    except ValueError:
        doc_type = DocType.unknown

    return ExtractionPlan(
        doc_type=doc_type,
        doc_type_confidence=float(data.get("doc_type_confidence", 0.5)),
        custodian=data.get("custodian"),
        custodian_bic=data.get("custodian_bic"),
        client_nif=data.get("client_nif"),
        ejercicio=request.ejercicio,
        reference_date=data.get("reference_date") or f"{request.ejercicio}-12-31",
        base_currency=data.get("base_currency") or "EUR",
        sections=sections,
        estimated_chunks=int(data.get("estimated_chunks", len(sections))),
        estimated_instruments=int(data.get("estimated_instruments", 0)),
        warnings=data.get("warnings", []),
    )


def _looks_like_unstructured_pdf(filename: str) -> bool:
    """Heuristic: PDF files are potentially unstructured. XLS/CSV are always structured."""
    return filename.lower().endswith(".pdf")
