"""
aduana_v2.py — Aduana Matemática v2 dedup pipeline for canonical ingestion.

Extends the V1 dedup pipeline (app/aduana.py) with:
  - income_event dedup rules (exact dedup + ambiguity warnings)
  - Operates on Pydantic V2 CanonicalExtraction data structures

V1 dedup pipeline (app/aduana.py) is NOT modified.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypeVar

from app.schemas.canonical_v2 import (
    SnapshotRecord,
    IncomeEventRecord,
)


@dataclass
class DeduplicationWarning:
    """A non-fatal deduplication warning that should surface in QualityReport."""
    instrument_ref: str
    message: str
    record_type: str  # "snapshot" | "income_event"


T = TypeVar("T", SnapshotRecord, IncomeEventRecord)


# ──────────────────────────────────────────────────────────────────────
# Snapshot dedup
# ──────────────────────────────────────────────────────────────────────

def dedup_snapshots(
    snapshots: list[SnapshotRecord],
) -> tuple[list[SnapshotRecord], list[DeduplicationWarning]]:
    """
    Dedup snapshot records by (instrument_ref, moneda).

    Rules (applied in order):
      1. Same instrument_ref + moneda + amount within 1% → discard duplicate (summary/detail dup)
      2. Same instrument_ref + moneda + amount outside 1% → SUM (multi-lot position)
      3. Different instrument_ref or different moneda → always kept

    Returns (deduped_list, warnings).
    """
    warnings: list[DeduplicationWarning] = []
    # Group by (instrument_ref, moneda)
    groups: dict[tuple[str, str], list[SnapshotRecord]] = {}
    for s in snapshots:
        key = (s.instrument_ref, s.moneda)
        groups.setdefault(key, []).append(s)

    result: list[SnapshotRecord] = []
    for (instrument_ref, moneda), group in groups.items():
        if len(group) == 1:
            result.append(group[0])
            continue

        # Check if all amounts are within 1% of the first
        base = group[0].valor_31dic
        all_within_1pct = all(
            abs(s.valor_31dic - base) / max(abs(base), 0.01) <= 0.01
            for s in group[1:]
        )

        if all_within_1pct:
            # Summary/detail duplicate — keep one (highest value wins for safety)
            best = max(group, key=lambda s: s.valor_31dic)
            result.append(best)
        else:
            # Multi-lot: SUM all amounts, use first record as template
            total = sum(s.valor_31dic for s in group)
            merged = group[0].model_copy(update={"valor_31dic": round(total, 2)})
            result.append(merged)

    return result, warnings


# ──────────────────────────────────────────────────────────────────────
# Income event dedup
# ──────────────────────────────────────────────────────────────────────

def dedup_income_events(
    events: list[IncomeEventRecord],
) -> tuple[list[IncomeEventRecord], list[DeduplicationWarning]]:
    """
    Dedup income event records.

    Rules:
      1. Exact duplicate (same instrument_ref + fecha + importe + event_type + moneda) → discard
      2. Same instrument_ref + fecha + importe + moneda, but different event_type → keep both
         and emit DeduplicationWarning (ambiguous classification)
    """
    warnings: list[DeduplicationWarning] = []
    seen_exact: set[tuple[str, str, float, str, str]] = set()
    result: list[IncomeEventRecord] = []

    # Group by (instrument_ref, fecha, importe, moneda) to detect ambiguous cases
    ambiguity_keys: dict[tuple[str, str, float, str], list[str]] = {}

    for e in events:
        exact_key = (e.instrument_ref, e.fecha, e.importe, e.event_type.value, e.moneda)
        ambiguity_key = (e.instrument_ref, e.fecha, e.importe, e.moneda)

        if exact_key in seen_exact:
            continue  # exact duplicate — discard

        seen_exact.add(exact_key)
        result.append(e)

        types_for_key = ambiguity_keys.setdefault(ambiguity_key, [])
        if e.event_type.value not in types_for_key:
            types_for_key.append(e.event_type.value)

    # Emit warnings for ambiguous groups (same date/amount but different types)
    for (instrument_ref, fecha, importe, moneda), types in ambiguity_keys.items():
        if len(types) > 1:
            warnings.append(DeduplicationWarning(
                instrument_ref=instrument_ref,
                message=(
                    f"Ambiguous income events on same date {fecha} with same amount "
                    f"{importe} {moneda}: types {types}. Manual review recommended."
                ),
                record_type="income_event",
            ))

    return result, warnings


# ──────────────────────────────────────────────────────────────────────
# Aggregate filter
# ──────────────────────────────────────────────────────────────────────

def filter_aggregates(snapshots: list[SnapshotRecord]) -> list[SnapshotRecord]:
    """
    Remove portfolio totals and subtotals from snapshot list.
    Convention: instrument_ref starting with '__' marks aggregate rows.
    """
    return [s for s in snapshots if not s.instrument_ref.startswith("__")]
