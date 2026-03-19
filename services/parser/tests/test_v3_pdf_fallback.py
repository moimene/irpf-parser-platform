"""
test_v3_pdf_fallback.py — Unit tests for V3 PDF fallback logic.

Tests orchestrator PDF section generation and extractor text chunking.
No OPENAI_API_KEY required — tests internal logic only.
"""

import pytest
from unittest.mock import AsyncMock, patch
import asyncio
import json

from app.schemas.canonical_v2 import (
    ExtractionPass,
    ExtractionPlan,
    PlannedSection,
    SectionType,
    ChunkStrategy,
    PlanRequest,
    DocType,
)
from app.engines.v3.extractor_patrimonio import _chunk_section_text


# ─────────────────────────────────────────────────────────────
# Orchestrator PDF fallback section generation
# ─────────────────────────────────────────────────────────────

class TestOrchestratorPdfFallback:
    """Test that the orchestrator creates default sections for PDFs."""

    def test_pdf_gets_default_patrimonio_section(self):
        """When AI returns 0 sections for a PDF, orchestrator adds patrimonio + rentas defaults."""
        ai_response = {
            "doc_type": "structured_pdf",
            "doc_type_confidence": 0.8,
            "custodian": "EFG Bank",
            "ejercicio": 2025,
            "reference_date": "2025-12-31",
            "base_currency": "USD",
            "sections": [],  # AI returned no sections
            "estimated_chunks": 0,
            "estimated_instruments": 0,
            "warnings": [],
        }

        with patch("app.engines.v3.orchestrator._get_openai") as mock_openai:
            mock_client = AsyncMock()
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = json.dumps(ai_response)
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_openai.return_value = mock_client

            from app.engines.v3.orchestrator import build_extraction_plan

            request = PlanRequest(
                document_id="test-pdf-1",
                filename="portfolio.pdf",
                ejercicio=2025,
            )
            plan = asyncio.run(build_extraction_plan(request))

            # Should have at least patrimonio + rentas default sections
            patrimonio = [s for s in plan.sections if s.extraction_pass == ExtractionPass.patrimonio]
            rentas = [s for s in plan.sections if s.extraction_pass == ExtractionPass.rentas]
            assert len(patrimonio) >= 1, "PDF should get default patrimonio section"
            assert len(rentas) >= 1, "PDF should get default rentas section"
            assert patrimonio[0].source == "pdf_full"
            assert rentas[0].source == "pdf_full"

    def test_pdf_keeps_ai_sections_when_present(self):
        """When AI returns patrimonio sections for PDF, no extra defaults are added."""
        ai_response = {
            "doc_type": "structured_pdf",
            "doc_type_confidence": 0.9,
            "custodian": "UBS",
            "ejercicio": 2025,
            "reference_date": "2025-12-31",
            "base_currency": "CHF",
            "sections": [
                {
                    "section_id": "sec_00",
                    "label": "Portfolio Positions",
                    "source": "pages_1_5",
                    "extraction_pass": "patrimonio",
                    "section_type": "POSITIONS",
                    "reason": "AI identified positions",
                    "chunk_strategy": "full",
                    "estimated_rows": 20,
                },
                {
                    "section_id": "sec_01",
                    "label": "Transaction History",
                    "source": "pages_6_10",
                    "extraction_pass": "rentas",
                    "section_type": "TRANSACTIONS",
                    "reason": "AI identified transactions",
                    "chunk_strategy": "full",
                    "estimated_rows": 50,
                },
            ],
            "estimated_chunks": 2,
            "estimated_instruments": 10,
            "warnings": [],
        }

        with patch("app.engines.v3.orchestrator._get_openai") as mock_openai:
            mock_client = AsyncMock()
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = json.dumps(ai_response)
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_openai.return_value = mock_client

            from app.engines.v3.orchestrator import build_extraction_plan

            request = PlanRequest(
                document_id="test-pdf-2",
                filename="portfolio.pdf",
                ejercicio=2025,
            )
            plan = asyncio.run(build_extraction_plan(request))

            # Should keep AI sections, no extra defaults
            patrimonio = [s for s in plan.sections if s.extraction_pass == ExtractionPass.patrimonio]
            rentas = [s for s in plan.sections if s.extraction_pass == ExtractionPass.rentas]
            assert len(patrimonio) == 1
            assert len(rentas) == 1
            assert patrimonio[0].source == "pages_1_5"  # AI's source, not "pdf_full"

    def test_xls_does_not_get_pdf_defaults(self):
        """XLS files should NOT get PDF default sections even if AI returns 0 sections."""
        ai_response = {
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

        with patch("app.engines.v3.orchestrator._get_openai") as mock_openai:
            mock_client = AsyncMock()
            mock_response = AsyncMock()
            mock_response.choices = [AsyncMock()]
            mock_response.choices[0].message.content = json.dumps(ai_response)
            mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
            mock_openai.return_value = mock_client

            from app.engines.v3.orchestrator import build_extraction_plan

            request = PlanRequest(
                document_id="test-xls-1",
                filename="portfolio.xlsx",
                ejercicio=2025,
                sheet_metas=[],  # Empty but present
            )
            plan = asyncio.run(build_extraction_plan(request))

            # XLS should NOT get pdf_full sections
            pdf_sections = [s for s in plan.sections if s.source == "pdf_full"]
            assert len(pdf_sections) == 0


# ─────────────────────────────────────────────────────────────
# Text chunking for PDFs
# ─────────────────────────────────────────────────────────────

class TestChunkSectionText:
    """Test _chunk_section_text used by PDF extraction paths."""

    def test_small_text_single_chunk(self):
        text = "Line 1\nLine 2\nLine 3"
        chunks = _chunk_section_text(text)
        assert len(chunks) == 1
        assert chunks[0] == text

    def test_empty_text_no_chunks(self):
        assert _chunk_section_text("") == []
        assert _chunk_section_text("   ") == []

    def test_page_separator_splitting(self):
        pages = ["Page 1 content"] * 5
        text = "\n---\n".join(pages)
        # With a small chunk size, should split into multiple chunks
        chunks = _chunk_section_text(text, chunk_size=40)
        assert len(chunks) > 1

    def test_paragraph_fallback_splitting(self):
        paragraphs = ["Paragraph " + str(i) * 50 for i in range(10)]
        text = "\n\n".join(paragraphs)
        chunks = _chunk_section_text(text, chunk_size=200)
        assert len(chunks) > 1
        # All content should be preserved
        reassembled = "\n\n".join(chunks)
        for p in paragraphs:
            assert p in reassembled
