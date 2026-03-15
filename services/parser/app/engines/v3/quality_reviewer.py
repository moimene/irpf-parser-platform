"""
quality_reviewer.py — V3 Quality Reviewer: cross-pass QA + YoY anomaly detection.

Checks:
  1. Consistency: each snapshot has a matching holding, non-zero amounts, valid moneda
  2. YoY anomalies: >50% change vs prior year snapshots (if provided)
  3. Cross-pass gaps: income event references instrument not in snapshots
  4. Harvey legal sub-check: only for unstructured_pdf (reinversión, exoneración flags)
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from openai import AsyncOpenAI

from app.schemas.canonical_v2 import (
    CanonicalExtraction,
    ConsistencyCheck,
    CrossPassGap,
    DocType,
    EnrichedOrphan,
    QualityReport,
    ReviewRequest,
    ReviewResponse,
    SnapshotRecord,
    YoYAnomaly,
)
from app.engines.v3.orchestrator import run_harvey_preanalysis

_openai_client: AsyncOpenAI | None = None


def _get_openai() -> AsyncOpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not set")
        _openai_client = AsyncOpenAI(api_key=api_key, timeout=120.0)
    return _openai_client


def _check_consistency(
    patrimonio: CanonicalExtraction | None,
    rentas: CanonicalExtraction | None,
) -> list[ConsistencyCheck]:
    checks: list[ConsistencyCheck] = []

    if patrimonio:
        snapshot_refs = {s.instrument_ref for s in patrimonio.snapshots}
        holding_refs = {h.instrument_ref for h in patrimonio.holdings}

        # Check: all snapshots have a matching holding
        orphan_snapshots = snapshot_refs - holding_refs
        checks.append(ConsistencyCheck(
            check_id="snapshots_have_holdings",
            description="All snapshots have a matching holding record",
            passed=len(orphan_snapshots) == 0,
            details=f"Orphan snapshot refs: {list(orphan_snapshots)[:5]}" if orphan_snapshots else None,
        ))

        # Check: no zero-value snapshots
        zero_vals = [s.instrument_ref for s in patrimonio.snapshots if s.valor_31dic == 0]
        checks.append(ConsistencyCheck(
            check_id="no_zero_snapshots",
            description="No snapshots have zero valor_31dic",
            passed=len(zero_vals) == 0,
            details=f"Zero-value refs: {zero_vals[:5]}" if zero_vals else None,
        ))

        # Check: moneda is 3-letter ISO
        bad_moneda = [
            s.instrument_ref for s in patrimonio.snapshots
            if len(s.moneda) != 3 or not s.moneda.isalpha()
        ]
        checks.append(ConsistencyCheck(
            check_id="valid_moneda",
            description="All snapshots have valid 3-letter ISO currency code",
            passed=len(bad_moneda) == 0,
            details=f"Invalid moneda refs: {bad_moneda[:5]}" if bad_moneda else None,
        ))

    if rentas:
        # Check: no future-dated events (fecha > reference_date)
        future_events = [
            e.instrument_ref for e in rentas.income_events
            if e.fecha > rentas.reference_date
        ]
        checks.append(ConsistencyCheck(
            check_id="no_future_events",
            description="No income events with future fecha",
            passed=len(future_events) == 0,
            details=f"Future event refs: {future_events[:5]}" if future_events else None,
        ))

    return checks


def _check_yoy_anomalies(
    patrimonio: CanonicalExtraction | None,
    prior_snapshots: list[SnapshotRecord] | None,
) -> list[YoYAnomaly]:
    if not patrimonio or not prior_snapshots:
        return []

    prior_map = {s.instrument_ref: s.valor_31dic for s in prior_snapshots}
    anomalies: list[YoYAnomaly] = []

    for snap in patrimonio.snapshots:
        prior = prior_map.get(snap.instrument_ref)
        if prior is None or prior == 0:
            continue
        pct_change = (snap.valor_31dic - prior) / abs(prior)
        if abs(pct_change) > 0.5:  # >50% change
            anomalies.append(YoYAnomaly(
                instrument_ref=snap.instrument_ref,
                description=f"Value changed {pct_change:+.1%} vs prior year",
                prior_value=prior,
                current_value=snap.valor_31dic,
                pct_change=round(pct_change, 4),
            ))

    return anomalies


def _check_cross_pass_gaps(
    patrimonio: CanonicalExtraction | None,
    rentas: CanonicalExtraction | None,
) -> list[CrossPassGap]:
    if not patrimonio or not rentas:
        return []

    snapshot_refs = {s.instrument_ref for s in patrimonio.snapshots}
    gaps: list[CrossPassGap] = []

    for event in rentas.income_events:
        if event.instrument_ref not in snapshot_refs:
            gaps.append(CrossPassGap(
                instrument_ref=event.instrument_ref,
                description=(
                    f"Income event ({event.event_type.value}) on {event.fecha} "
                    f"references instrument not found in snapshots"
                ),
                gap_type="event_without_snapshot",
            ))

    # Zero snapshot without matching SALE event
    sale_refs = {
        e.instrument_ref for e in rentas.income_events
        if e.event_type.value in ("SALE", "REDEMPTION")
    }
    for snap in patrimonio.snapshots:
        if snap.valor_31dic == 0 and snap.instrument_ref not in sale_refs:
            gaps.append(CrossPassGap(
                instrument_ref=snap.instrument_ref,
                description="Snapshot has zero value but no SALE/REDEMPTION event found",
                gap_type="snapshot_zero_without_sale",
            ))

    return gaps


async def _harvey_legal_check(
    content_base64: str,
    document_id: str,
) -> list[str]:
    """Run Harvey AI legal sub-check for unstructured PDFs. Returns recommendation strings."""
    context = await run_harvey_preanalysis(
        content_base64,
        f"review_{document_id}.pdf",
    )
    if not context or context.startswith("Harvey pre-analysis unavailable"):
        return []

    # Ask OpenAI to extract reinversión/exoneración signals from Harvey context
    try:
        client = _get_openai()
        response = await client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "From the Harvey AI analysis below, identify any reinversión exonerations "
                        "(art. 54 LGT), tax exemption clauses, or declarative obligation thresholds. "
                        "Return JSON: {\"recommendations\": [\"string\", ...]}"
                    ),
                },
                {"role": "user", "content": context},
            ],
            temperature=0.0,
            max_tokens=500,
        )
        raw = response.choices[0].message.content or "{}"
        data: dict[str, Any] = json.loads(raw)
        return data.get("recommendations", [])
    except Exception:  # noqa: BLE001
        return []


async def run_quality_review(request: ReviewRequest) -> ReviewResponse:
    """
    Run the quality review pass.

    1. Consistency checks (snapshots↔holdings, zero values, valid moneda)
    2. YoY anomaly detection (>50% change vs prior year)
    3. Cross-pass gap detection (events without snapshots, zero snapshots without sales)
    4. Harvey legal sub-check (unstructured_pdf only)
    5. Build merged_extraction (patrimonio as base, rentas income_events merged in)
    """
    start = time.monotonic()

    consistency = _check_consistency(request.patrimonio_extraction, request.rentas_extraction)
    yoy = _check_yoy_anomalies(request.patrimonio_extraction, request.prior_year_snapshots)
    gaps = _check_cross_pass_gaps(request.patrimonio_extraction, request.rentas_extraction)

    recommendations: list[str] = []
    if (
        request.plan.doc_type == DocType.unstructured_pdf
        and request.patrimonio_extraction
        and request.patrimonio_extraction.failed_chunk_ids
    ):
        recommendations.append("Some chunks failed — manual review of unscanned sections recommended.")

    # Harvey legal sub-check for unstructured PDFs only
    if (
        request.plan.doc_type == DocType.unstructured_pdf
        and request.content_base64
    ):
        harvey_recs = await _harvey_legal_check(
            request.content_base64,
            request.document_id,
        )
        recommendations.extend(harvey_recs)

    # Collect all orphans
    enriched_orphans: list[EnrichedOrphan] = []
    for src in [request.patrimonio_extraction, request.rentas_extraction, request.legal_extraction]:
        if src:
            for o in src.orphans:
                enriched_orphans.append(EnrichedOrphan(
                    **o.model_dump(),
                    reviewer_reason="Unclassified by extraction engine",
                ))

    passed_checks = sum(1 for c in consistency if c.passed)
    overall_confidence = (passed_checks / max(len(consistency), 1)) * (
        1.0 - min(0.3, len(gaps) * 0.05) - min(0.2, len(yoy) * 0.02)
    )

    quality_report = QualityReport(
        overall_confidence=round(max(0.0, min(1.0, overall_confidence)), 4),
        consistency_checks=consistency,
        yoy_anomalies=yoy,
        cross_pass_gaps=gaps,
        enriched_orphans=enriched_orphans,
        recommendations=recommendations,
    )

    # Build merged_extraction: patrimonio as base + rentas income_events merged in
    base = request.patrimonio_extraction
    if base is None:
        # If no patrimonio, use rentas as base
        base = request.rentas_extraction

    if base is None:
        # Fallback: empty extraction
        from app.schemas.canonical_v2 import ExtractionCoverage
        base = CanonicalExtraction(
            doc_type=request.plan.doc_type,
            reference_date=request.plan.reference_date,
            ejercicio=request.ejercicio,
            base_currency=request.plan.base_currency,
            extraction_pass="combined",
            engine="openai_v2",
            instruments=[], holdings=[], snapshots=[],
            income_events=[], orphans=[], unscanned_sections=[],
            coverage=ExtractionCoverage(rows_found=0, rows_extracted=0, rows_orphaned=0, rows_skipped=0),
            chunk_count=0, processing_time_seconds=0.0,
        )

    rentas_events = request.rentas_extraction.income_events if request.rentas_extraction else []
    legal_holdings = request.legal_extraction.holdings if request.legal_extraction else []

    merged = base.model_copy(update={
        "extraction_pass": "combined",
        "income_events": rentas_events,
        # Merge legal holdings: update existing by instrument_ref, append new ones
        "holdings": _merge_holdings(base.holdings, legal_holdings),
        "orphans": (
            base.orphans
            + (request.rentas_extraction.orphans if request.rentas_extraction else [])
            + (request.legal_extraction.orphans if request.legal_extraction else [])
        ),
        "processing_time_seconds": round(time.monotonic() - start, 2),
    })

    return ReviewResponse(document_id=request.document_id, quality_report=quality_report, merged_extraction=merged)


def _merge_holdings(
    base: list,
    legal: list,
) -> list:
    """Merge legal-pass holdings into base holdings by instrument_ref."""
    result = {h.instrument_ref: h for h in base}
    for lh in legal:
        if lh.instrument_ref in result:
            # Update role/participation from legal pass
            result[lh.instrument_ref] = result[lh.instrument_ref].model_copy(update={
                "role": lh.role,
                **({"participation_pct": lh.participation_pct} if lh.participation_pct is not None else {}),
            })
        else:
            result[lh.instrument_ref] = lh
    return list(result.values())
