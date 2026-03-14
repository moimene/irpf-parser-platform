"""
canonical_v2.py — Pydantic schemas for the V2 canonical ingestion pipeline.

These schemas define:
  - Input/output for each of the 5 /api/v3/* endpoints
  - Internal exchange format between Orchestrator, Extractor passes, and Quality Reviewer
  - Reused by main.py endpoint handlers and all v3 engine modules

Engine strategy:
  - bank_xls / advisor_xls / structured_pdf / txt_720: OpenAI gpt-4o with JSON mode
  - unstructured_pdf: Harvey AI v1 for orchestration pre-analysis + OpenAI for canonical mapping
  - Harvey AI is NOT called for bank_xls / advisor_xls / structured_pdf / txt_720
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator


# ─────────────────────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────────────────────

class DocType(str, Enum):
    bank_xls = "bank_xls"
    advisor_xls = "advisor_xls"
    structured_pdf = "structured_pdf"
    unstructured_pdf = "unstructured_pdf"
    txt_720 = "txt_720"
    unknown = "unknown"


class SectionType(str, Enum):
    POSITIONS = "POSITIONS"
    TRANSACTIONS = "TRANSACTIONS"
    SUMMARY = "SUMMARY"
    UNKNOWN = "UNKNOWN"


class ExtractionPass(str, Enum):
    patrimonio = "patrimonio"
    rentas = "rentas"
    skip = "skip"


class ChunkStrategy(str, Enum):
    full = "full"
    by_date_range = "by_date_range"
    by_row_group = "by_row_group"


class CanonicalStatus(str, Enum):
    extracted = "extracted"
    needs_review = "needs_review"


class IncomeEventType(str, Enum):
    DIVIDEND = "DIVIDEND"
    INTEREST = "INTEREST"
    COUPON = "COUPON"
    CAPITAL_GAIN = "CAPITAL_GAIN"
    SALE = "SALE"
    PURCHASE = "PURCHASE"
    REDEMPTION = "REDEMPTION"
    SUBSCRIPTION = "SUBSCRIPTION"
    WITHHOLDING = "WITHHOLDING"
    LOAN_INTEREST = "LOAN_INTEREST"
    RENTAL_INCOME = "RENTAL_INCOME"
    OTHER = "OTHER"


# ─────────────────────────────────────────────────────────────
# Shared sub-models
# ─────────────────────────────────────────────────────────────

class SheetMeta(BaseModel):
    name: str
    row_count: int
    col_count: int
    preview: list[list[str]] = Field(default_factory=list)  # first 3 rows, up to 6 cols


class PlannedSection(BaseModel):
    section_id: str
    label: str
    source: str                        # sheet name or page range string
    extraction_pass: ExtractionPass
    section_type: SectionType
    reason: str
    chunk_strategy: ChunkStrategy
    estimated_rows: int


class SectionReference(BaseModel):
    section_id: str
    label: str
    source_type: str                   # "sheet" | "page_range"
    location: str                      # sheet name or "pages 12-15"


class InstrumentIdentifier(BaseModel):
    type: str                          # "ISIN", "IBAN", "account_number", etc.
    value: str


class InstrumentRecord(BaseModel):
    instrument_type: str
    description: str
    jurisdiction: str
    identifiers: list[InstrumentIdentifier] = Field(default_factory=list)


class HoldingRecord(BaseModel):
    instrument_ref: str                # ISIN / IBAN / account_number
    custodian: Optional[str] = None
    custodian_country: Optional[str] = None
    role: str = "TITULAR"             # TITULAR | AUTORIZADO | TITULAR_REAL | BENEFICIARIO
    participation_pct: Optional[float] = None
    account_number: Optional[str] = None


class SnapshotRecord(BaseModel):
    instrument_ref: str
    ejercicio: int
    valor_31dic: float
    moneda: str = "EUR"
    tipo_cambio: Optional[float] = None
    cantidad: Optional[float] = None
    precio_unitario: Optional[float] = None
    fecha_adquisicion: Optional[str] = None   # ISO 8601 date string
    canonical_status: CanonicalStatus = CanonicalStatus.extracted


class IncomeEventRecord(BaseModel):
    instrument_ref: str
    event_type: IncomeEventType
    fecha: str                         # ISO 8601 date string
    importe: float
    moneda: str = "EUR"
    importe_eur: Optional[float] = None
    retencion: Optional[float] = None
    ejercicio: int
    canonical_status: CanonicalStatus = CanonicalStatus.extracted


class OrphanRecord(BaseModel):
    raw_data: dict[str, Any]
    reason: str
    source_section: str
    confidence: float


class ExtractionCoverage(BaseModel):
    rows_found: int
    rows_extracted: int
    rows_orphaned: int
    rows_skipped: int


# ─────────────────────────────────────────────────────────────
# ExtractionPlan (output of /api/v3/plan)
# ─────────────────────────────────────────────────────────────

class ExtractionPlan(BaseModel):
    doc_type: DocType
    doc_type_confidence: float = Field(ge=0.0, le=1.0)
    custodian: Optional[str] = None
    custodian_bic: Optional[str] = None
    client_nif: Optional[str] = None
    ejercicio: int
    reference_date: str                # ISO 8601 date string
    base_currency: str = "EUR"
    sections: list[PlannedSection] = Field(default_factory=list)
    estimated_chunks: int = 0
    estimated_instruments: int = 0
    warnings: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# CanonicalExtraction (output of /api/v3/extract/patrimonio and /rentas)
# ─────────────────────────────────────────────────────────────

class CanonicalExtraction(BaseModel):
    doc_type: DocType
    custodian: Optional[str] = None
    custodian_bic: Optional[str] = None
    reference_date: str
    ejercicio: int
    base_currency: str = "EUR"
    extraction_pass: str               # "patrimonio" | "rentas" | "combined"
    engine: str                        # "openai_v2" | "harvey_v1"
    instruments: list[InstrumentRecord] = Field(default_factory=list)
    holdings: list[HoldingRecord] = Field(default_factory=list)
    snapshots: list[SnapshotRecord] = Field(default_factory=list)
    income_events: list[IncomeEventRecord] = Field(default_factory=list)
    orphans: list[OrphanRecord] = Field(default_factory=list)
    unscanned_sections: list[SectionReference] = Field(default_factory=list)
    coverage: ExtractionCoverage
    warnings: list[str] = Field(default_factory=list)
    chunk_count: int = 0
    partial_extraction: bool = False
    failed_chunk_ids: list[str] = Field(default_factory=list)
    processing_time_seconds: float = 0.0


# ─────────────────────────────────────────────────────────────
# QualityReport (output of /api/v3/review)
# ─────────────────────────────────────────────────────────────

class ConsistencyCheck(BaseModel):
    check_id: str
    description: str
    passed: bool
    details: Optional[str] = None


class YoYAnomaly(BaseModel):
    instrument_ref: str
    description: str
    prior_value: Optional[float] = None
    current_value: Optional[float] = None
    pct_change: Optional[float] = None


class CrossPassGap(BaseModel):
    instrument_ref: str
    description: str
    gap_type: str  # "event_without_snapshot" | "snapshot_zero_without_sale" | "other"


class EnrichedOrphan(BaseModel):
    raw_data: dict[str, Any]
    reason: str
    source_section: str
    confidence: float
    reviewer_reason: str


class QualityReport(BaseModel):
    overall_confidence: float = Field(ge=0.0, le=1.0)
    consistency_checks: list[ConsistencyCheck] = Field(default_factory=list)
    yoy_anomalies: list[YoYAnomaly] = Field(default_factory=list)
    cross_pass_gaps: list[CrossPassGap] = Field(default_factory=list)
    enriched_orphans: list[EnrichedOrphan] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────
# Request / Response wrappers for each endpoint
# ─────────────────────────────────────────────────────────────

# POST /api/v3/plan
class PlanRequest(BaseModel):
    """Input for the Orchestrator: raw document content as base64 or structured sheets."""
    document_id: str
    filename: str
    ejercicio: int = Field(description="Fiscal year being processed (e.g. 2024). Required — no silent default.")
    content_base64: Optional[str] = None          # For PDF/TXT documents
    sheets: Optional[list[dict[str, Any]]] = None  # For XLS: [{name, rows: [[cell, ...]]}]
    sheet_metas: Optional[list[SheetMeta]] = None
    selected_sheet_names: Optional[list[str]] = None

    @field_validator("ejercicio")
    @classmethod
    def ejercicio_range(cls, v: int) -> int:
        if not (2010 <= v <= 2035):
            raise ValueError(f"ejercicio must be between 2010 and 2035, got {v}")
        return v


class PlanResponse(BaseModel):
    document_id: str
    plan: ExtractionPlan


# POST /api/v3/extract/patrimonio
class ExtractPatrimonioRequest(BaseModel):
    document_id: str
    ejercicio: int = Field(description="Fiscal year. Required — no silent default.")
    plan: ExtractionPlan
    content_base64: Optional[str] = None
    sheets: Optional[list[dict[str, Any]]] = None

    @field_validator("ejercicio")
    @classmethod
    def ejercicio_range(cls, v: int) -> int:
        if not (2010 <= v <= 2035):
            raise ValueError(f"ejercicio must be between 2010 and 2035, got {v}")
        return v


class ExtractPatrimonioResponse(BaseModel):
    document_id: str
    extraction: CanonicalExtraction


# POST /api/v3/extract/rentas
class ExtractRentasRequest(BaseModel):
    document_id: str
    ejercicio: int = Field(description="Fiscal year. Required — no silent default.")
    plan: ExtractionPlan
    content_base64: Optional[str] = None
    sheets: Optional[list[dict[str, Any]]] = None

    @field_validator("ejercicio")
    @classmethod
    def ejercicio_range(cls, v: int) -> int:
        if not (2010 <= v <= 2035):
            raise ValueError(f"ejercicio must be between 2010 and 2035, got {v}")
        return v


class ExtractRentasResponse(BaseModel):
    document_id: str
    extraction: CanonicalExtraction


# POST /api/v3/extract/legal
class ExtractLegalRequest(BaseModel):
    """
    Input for the Legal extractor. ejercicio is explicit and required —
    the orchestrator must pass it; it must NOT default silently.
    Harvey AI is called only for unstructured_pdf doc_type.
    """
    document_id: str
    ejercicio: int = Field(description="Fiscal year. Required — must be passed explicitly by orchestrator.")
    plan: ExtractionPlan
    patrimonio_extraction: Optional[CanonicalExtraction] = None
    content_base64: Optional[str] = None

    @field_validator("ejercicio")
    @classmethod
    def ejercicio_range(cls, v: int) -> int:
        if not (2010 <= v <= 2035):
            raise ValueError(f"ejercicio must be between 2010 and 2035, got {v}")
        return v


class ExtractLegalResponse(BaseModel):
    document_id: str
    extraction: CanonicalExtraction


# POST /api/v3/review
class ReviewRequest(BaseModel):
    document_id: str
    ejercicio: int = Field(description="Fiscal year. Required — no silent default.")
    plan: ExtractionPlan
    patrimonio_extraction: Optional[CanonicalExtraction] = None
    rentas_extraction: Optional[CanonicalExtraction] = None
    legal_extraction: Optional[CanonicalExtraction] = None
    prior_year_snapshots: Optional[list[SnapshotRecord]] = None
    content_base64: Optional[str] = None

    @field_validator("ejercicio")
    @classmethod
    def ejercicio_range(cls, v: int) -> int:
        if not (2010 <= v <= 2035):
            raise ValueError(f"ejercicio must be between 2010 and 2035, got {v}")
        return v


class ReviewResponse(BaseModel):
    document_id: str
    quality_report: QualityReport
    merged_extraction: CanonicalExtraction
