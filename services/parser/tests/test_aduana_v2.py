"""
test_aduana_v2.py — TDD tests for Aduana Matemática v2 dedup module.

Tests cover:
  - Snapshot dedup: same ISIN + same amount → discard (summary/detail duplicate)
  - Snapshot dedup: same ISIN + different amount → SUM (multi-lot position)
  - Snapshot dedup: same ISIN + within 1% amount → discard (floating point tolerance)
  - Income event dedup: exact duplicate → discard
  - Income event dedup: same date + amount + different event_type → WARNING tag
  - Aggregate filter: remove portfolio total rows (instrument_ref starts with "__")
"""

import pytest
from app.schemas.canonical_v2 import (
    SnapshotRecord,
    IncomeEventRecord,
    IncomeEventType,
    CanonicalStatus,
)
from app.engines.v3.aduana_v2 import (
    dedup_snapshots,
    dedup_income_events,
    filter_aggregates,
    DeduplicationWarning,
)


# ──────────────────────────────────────────────────────────────────────
# Snapshot dedup
# ──────────────────────────────────────────────────────────────────────

def make_snapshot(instrument_ref: str, valor: float, moneda: str = "EUR") -> SnapshotRecord:
    return SnapshotRecord(
        instrument_ref=instrument_ref,
        ejercicio=2024,
        valor_31dic=valor,
        moneda=moneda,
    )


def test_snapshot_same_amount_discards_duplicate():
    """Same ISIN + same amount → keep one (discard summary/detail duplicate)."""
    snapshots = [
        make_snapshot("IE00B4L5Y983", 50000.00),
        make_snapshot("IE00B4L5Y983", 50000.00),
    ]
    result, warnings = dedup_snapshots(snapshots)
    assert len(result) == 1
    assert result[0].instrument_ref == "IE00B4L5Y983"
    assert result[0].valor_31dic == 50000.00


def test_snapshot_different_amount_sums_multi_lot():
    """Same ISIN + different amounts → SUM (multi-lot position)."""
    snapshots = [
        make_snapshot("IE00B4L5Y983", 35686.00),
        make_snapshot("IE00B4L5Y983", 66810.00),
    ]
    result, warnings = dedup_snapshots(snapshots)
    assert len(result) == 1
    assert result[0].valor_31dic == pytest.approx(102496.00, abs=1.0)


def test_snapshot_within_1pct_discards():
    """Same ISIN + amounts within 1% → discard as floating-point duplicate."""
    snapshots = [
        make_snapshot("IE00B4L5Y983", 100000.00),
        make_snapshot("IE00B4L5Y983", 100500.00),  # 0.5% difference
    ]
    result, warnings = dedup_snapshots(snapshots)
    assert len(result) == 1


def test_snapshot_different_isins_kept():
    """Different ISINs are always kept."""
    snapshots = [
        make_snapshot("IE00B4L5Y983", 50000.00),
        make_snapshot("LU0360863863", 30000.00),
    ]
    result, warnings = dedup_snapshots(snapshots)
    assert len(result) == 2


def test_snapshot_different_currencies_kept():
    """Same ISIN but different currencies → keep both (different asset instances)."""
    snapshots = [
        make_snapshot("IE00B4L5Y983", 50000.00, moneda="EUR"),
        make_snapshot("IE00B4L5Y983", 50000.00, moneda="USD"),
    ]
    result, warnings = dedup_snapshots(snapshots)
    assert len(result) == 2


# ──────────────────────────────────────────────────────────────────────
# Income event dedup
# ──────────────────────────────────────────────────────────────────────

def make_income_event(
    instrument_ref: str,
    fecha: str,
    importe: float,
    event_type: IncomeEventType = IncomeEventType.DIVIDEND,
    moneda: str = "EUR",
) -> IncomeEventRecord:
    return IncomeEventRecord(
        instrument_ref=instrument_ref,
        event_type=event_type,
        fecha=fecha,
        importe=importe,
        moneda=moneda,
        ejercicio=2024,
    )


def test_income_event_exact_duplicate_discarded():
    """Exact duplicate (same ref + date + amount + type) → keep one."""
    events = [
        make_income_event("IE00B4L5Y983", "2024-03-15", 1500.00),
        make_income_event("IE00B4L5Y983", "2024-03-15", 1500.00),
    ]
    result, warnings = dedup_income_events(events)
    assert len(result) == 1


def test_income_event_same_date_amount_different_type_warns():
    """Same date + amount + different event_type → keep both but add WARNING tag."""
    events = [
        make_income_event("IE00B4L5Y983", "2024-03-15", 1500.00, IncomeEventType.DIVIDEND),
        make_income_event("IE00B4L5Y983", "2024-03-15", 1500.00, IncomeEventType.INTEREST),
    ]
    result, warnings = dedup_income_events(events)
    assert len(result) == 2  # keep both
    assert len(warnings) >= 1
    assert any("ambiguous" in w.message.lower() or "same date" in w.message.lower() for w in warnings)


def test_income_event_different_dates_kept():
    """Same instrument + different dates → keep both."""
    events = [
        make_income_event("IE00B4L5Y983", "2024-03-15", 1500.00),
        make_income_event("IE00B4L5Y983", "2024-09-15", 1500.00),
    ]
    result, warnings = dedup_income_events(events)
    assert len(result) == 2


# ──────────────────────────────────────────────────────────────────────
# Aggregate filter
# ──────────────────────────────────────────────────────────────────────

def test_aggregate_filter_removes_totals():
    """Rows with instrument_ref starting with '__' are portfolio totals → discard."""
    snapshots = [
        make_snapshot("__TOTAL_PORTFOLIO", 999999.00),
        make_snapshot("IE00B4L5Y983", 50000.00),
        make_snapshot("__SUBTOTAL_EQUITIES", 200000.00),
    ]
    result = filter_aggregates(snapshots)
    assert len(result) == 1
    assert result[0].instrument_ref == "IE00B4L5Y983"
