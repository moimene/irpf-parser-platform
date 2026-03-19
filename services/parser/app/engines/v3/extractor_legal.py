"""
extractor_legal.py — V3 Pass 3: Extract legal annotations.

Extracts:
  - Declarative roles (TITULAR, AUTORIZADO, TITULAR_REAL, BENEFICIARIO)
  - Reinversión exonerations (art. 54 LGT)
  - Tax exemptions and thresholds
  - Updates holding role percentages where explicitly stated

Harvey AI is called ONLY for unstructured_pdf to provide pre-analysis context.
For all other doc types, Harvey context is empty.
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
    ExtractLegalRequest,
    HoldingRecord,
    OrphanRecord,
    SectionReference,
    DocType,
    ExtractionPass,
)
from app.engines.v3.orchestrator import run_harvey_preanalysis

_openai_client: AsyncOpenAI | None = None
_SEMAPHORE_LIMIT = 3


def _get_openai() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=api_key, timeout=120.0)
    return _openai_client


async def extract_legal(request: ExtractLegalRequest) -> CanonicalExtraction:
    """
    Run Pass 3 (legal) extraction.

    For unstructured_pdf: calls Harvey AI for pre-analysis, then uses that context
    with OpenAI gpt-4o to extract legal annotations.
    For all other doc types: OpenAI only, no Harvey call.
    """
    start = time.monotonic()

    # Harvey pre-analysis only for unstructured PDFs
    harvey_context = ""
    if (
        request.plan.doc_type == DocType.unstructured_pdf
        and request.content_base64
    ):
        harvey_context = await run_harvey_preanalysis(
            request.content_base64,
            f"doc_{request.document_id}.pdf",
        )

    # Build legal extraction prompt
    patrimonio_summary = ""
    if request.patrimonio_extraction:
        holding_count = len(request.patrimonio_extraction.holdings)
        instrument_count = len(request.patrimonio_extraction.instruments)
        patrimonio_summary = (
            f"Patrimonio extraction found {holding_count} holdings "
            f"and {instrument_count} instruments."
        )

    harvey_section = (
        f"\nHarvey AI pre-analysis:\n{harvey_context}\n"
        if harvey_context
        else ""
    )

    system_prompt = (
        "You are a legal annotation extraction engine for the Spanish Modelo 720. "
        "Extract declarative role information, reinversión exonerations, and tax exemptions. "
        "Return JSON with: holdings (array of updated holding roles), orphans (array).\n\n"
        "For each holding: instrument_ref, role (TITULAR|AUTORIZADO|TITULAR_REAL|BENEFICIARIO), "
        "participation_pct (0-100 numeric, if stated), custodian (if stated).\n"
        "Only include holdings where you can identify a specific role or participation percentage.\n"
        "Return ONLY valid JSON. No markdown."
    )

    user_prompt = (
        f"Document ID: {request.document_id}\n"
        f"Fiscal year: {request.ejercicio}\n"
        f"{patrimonio_summary}\n"
        f"{harvey_section}\n"
        "Extract legal annotations (roles, exonerations) from the above context."
    )

    semaphore = asyncio.Semaphore(_SEMAPHORE_LIMIT)
    holdings_out: list[HoldingRecord] = []
    orphans_out: list[OrphanRecord] = []
    failed = False

    async with semaphore:
        try:
            client = _get_openai()
            response = await client.chat.completions.create(
                model=get_model_for_role("legal"),
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,
                max_tokens=2000,
            )
            raw_text = response.choices[0].message.content or "{}"
            data: dict[str, Any] = json.loads(raw_text)

            for raw in data.get("holdings", []):
                try:
                    holdings_out.append(HoldingRecord(**raw))
                except Exception:  # noqa: BLE001
                    orphans_out.append(OrphanRecord(
                        raw_data=raw, reason="holding parse error",
                        source_section="legal", confidence=0.3,
                    ))
            for raw in data.get("orphans", []):
                try:
                    orphans_out.append(OrphanRecord(**raw))
                except Exception:  # noqa: BLE001
                    pass

        except Exception:  # noqa: BLE001
            failed = True

    unscanned = [
        SectionReference(
            section_id=s.section_id,
            label=s.label,
            source_type="sheet",
            location=s.source,
        )
        for s in request.plan.sections
        if s.extraction_pass != ExtractionPass.skip
    ]

    elapsed = time.monotonic() - start

    return CanonicalExtraction(
        doc_type=request.plan.doc_type,
        custodian=request.plan.custodian,
        custodian_bic=request.plan.custodian_bic,
        reference_date=request.plan.reference_date,
        ejercicio=request.ejercicio,
        base_currency=request.plan.base_currency,
        extraction_pass="combined",   # legal pass augments both
        engine="harvey_v1" if harvey_context else "openai_v2",
        instruments=[],
        holdings=holdings_out,
        snapshots=[],
        income_events=[],
        orphans=orphans_out,
        unscanned_sections=unscanned,
        coverage=ExtractionCoverage(
            rows_found=0,
            rows_extracted=len(holdings_out),
            rows_orphaned=len(orphans_out),
            rows_skipped=0,
        ),
        warnings=["Legal extraction failed"] if failed else [],
        chunk_count=1,
        partial_extraction=failed,
        failed_chunk_ids=["legal_0"] if failed else [],
        processing_time_seconds=round(elapsed, 2),
    )
