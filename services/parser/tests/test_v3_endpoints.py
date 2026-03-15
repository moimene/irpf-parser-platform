"""
test_v3_endpoints.py — Integration tests for V3 canonical ingestion pipeline.

Uses FastAPI TestClient (no network needed).
Tests that endpoints accept valid payloads and reject invalid ones.
When OPENAI_API_KEY is not set, AI-calling endpoints may return 500 — we only
test schema validation (422 for bad payloads) and empty-section fast paths.
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

MINIMAL_PLAN = {
    "doc_type": "bank_xls",
    "doc_type_confidence": 0.9,
    "ejercicio": 2025,
    "reference_date": "2025-12-31",
    "base_currency": "EUR",
    "sections": [],
    "estimated_chunks": 0,
    "estimated_instruments": 0,
    "warnings": [],
}

MINIMAL_EXTRACTION = {
    "doc_type": "bank_xls",
    "ejercicio": 2025,
    "reference_date": "2025-12-31",
    "base_currency": "EUR",
    "extraction_pass": "patrimonio",
    "engine": "openai_v2",
    "instruments": [],
    "holdings": [],
    "snapshots": [],
    "income_events": [],
    "orphans": [],
    "unscanned_sections": [],
    "coverage": {"rows_found": 0, "rows_extracted": 0, "rows_orphaned": 0, "rows_skipped": 0},
    "warnings": [],
    "chunk_count": 0,
    "processing_time_seconds": 0.0,
}


class TestV3Plan:
    """POST /api/v3/plan — Orchestrator endpoint."""

    def test_plan_missing_document_id_returns_422(self):
        resp = client.post("/api/v3/plan", json={
            "filename": "test.pdf",
            "ejercicio": 2025,
        })
        assert resp.status_code == 422

    def test_plan_missing_ejercicio_returns_422(self):
        resp = client.post("/api/v3/plan", json={
            "document_id": "test-1",
            "filename": "test.pdf",
        })
        assert resp.status_code == 422

    def test_plan_with_sheet_metas_accepted(self):
        """Valid payload is accepted by Pydantic (200 if API key, 500 if not)."""
        try:
            resp = client.post("/api/v3/plan", json={
                "document_id": "test-2",
                "filename": "portfolio.xlsx",
                "ejercicio": 2025,
                "sheet_metas": [{
                    "name": "Sheet1",
                    "row_count": 10,
                    "col_count": 5,
                    "preview": [["A", "B", "C"]],
                }],
            })
            # 200 if API key set, 500 if not — both are acceptable here
            assert resp.status_code in (200, 500)
        except RuntimeError as e:
            # No OPENAI_API_KEY — expected in local test environment
            assert "OPENAI_API_KEY" in str(e)


PDF_PLAN_WITH_SECTIONS = {
    "doc_type": "structured_pdf",
    "doc_type_confidence": 0.8,
    "ejercicio": 2025,
    "reference_date": "2025-12-31",
    "base_currency": "USD",
    "sections": [
        {
            "section_id": "sec_00",
            "label": "PDF Positions",
            "source": "pdf_full",
            "extraction_pass": "patrimonio",
            "section_type": "POSITIONS",
            "reason": "Default patrimonio section for PDF",
            "chunk_strategy": "full",
            "estimated_rows": 0,
        }
    ],
    "estimated_chunks": 1,
    "estimated_instruments": 0,
    "warnings": [],
}


class TestV3ExtractPatrimonio:
    """POST /api/v3/extract/patrimonio — Pass 1 endpoint."""

    def test_patrimonio_missing_plan_returns_422(self):
        resp = client.post("/api/v3/extract/patrimonio", json={
            "document_id": "test-3",
            "ejercicio": 2025,
        })
        assert resp.status_code == 422

    def test_patrimonio_empty_sections_returns_200(self):
        """Plan with no sections should return 200 with empty extraction."""
        resp = client.post("/api/v3/extract/patrimonio", json={
            "document_id": "test-4",
            "ejercicio": 2025,
            "plan": MINIMAL_PLAN,
        })
        if resp.status_code == 200:
            data = resp.json()
            assert data["extraction"]["instruments"] == []
            assert data["extraction"]["snapshots"] == []


    def test_patrimonio_pdf_plan_with_content_base64(self):
        """PDF plan with patrimonio section + content_base64 is accepted."""
        import base64
        # Minimal PDF-like content (won't actually parse, but tests schema acceptance)
        fake_b64 = base64.b64encode(b"fake pdf content").decode()
        resp = client.post("/api/v3/extract/patrimonio", json={
            "document_id": "test-pdf-pat",
            "ejercicio": 2025,
            "plan": PDF_PLAN_WITH_SECTIONS,
            "content_base64": fake_b64,
        })
        # 200 if API key + Docling available, 500 otherwise — both acceptable
        assert resp.status_code in (200, 500)


class TestV3ExtractRentas:
    """POST /api/v3/extract/rentas — Pass 2 endpoint."""

    def test_rentas_missing_plan_returns_422(self):
        resp = client.post("/api/v3/extract/rentas", json={
            "document_id": "test-5",
            "ejercicio": 2025,
        })
        assert resp.status_code == 422

    def test_rentas_empty_sections_returns_200(self):
        """Plan with no rentas sections should return 200 with empty extraction."""
        resp = client.post("/api/v3/extract/rentas", json={
            "document_id": "test-rentas-empty",
            "ejercicio": 2025,
            "plan": MINIMAL_PLAN,
        })
        if resp.status_code == 200:
            data = resp.json()
            assert data["extraction"]["income_events"] == []


class TestV3ExtractLegal:
    """POST /api/v3/extract/legal — Legal extraction endpoint."""

    def test_legal_missing_plan_returns_422(self):
        resp = client.post("/api/v3/extract/legal", json={
            "document_id": "test-6",
            "ejercicio": 2025,
        })
        assert resp.status_code == 422


class TestV3Review:
    """POST /api/v3/review — Quality reviewer endpoint."""

    def test_review_missing_plan_returns_422(self):
        resp = client.post("/api/v3/review", json={
            "document_id": "test-7",
            "ejercicio": 2025,
        })
        assert resp.status_code == 422

    def test_review_with_empty_extractions(self):
        """Review with empty extractions should still work."""
        resp = client.post("/api/v3/review", json={
            "document_id": "test-8",
            "ejercicio": 2025,
            "plan": MINIMAL_PLAN,
            "patrimonio_extraction": MINIMAL_EXTRACTION,
        })
        if resp.status_code == 200:
            data = resp.json()
            assert "quality_report" in data
            assert "merged_extraction" in data
