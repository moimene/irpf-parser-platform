"""
Tests para docling_converter.py

Estos tests verifican:
  - Modelos ConvertDocumentRequest/ConvertDocumentResponse
  - Detección rápida de entidad
  - Extracción de tablas Markdown
  - Fallback a pdfplumber cuando Docling no está disponible
"""
import base64

import pytest

from app.docling_converter import (
    ConvertDocumentRequest,
    ConvertDocumentResponse,
    _extract_markdown_tables,
    _parse_markdown_table,
    _quick_detect_entity,
    convert_document_endpoint,
)


class TestQuickDetectEntity:
    def test_detects_pictet(self) -> None:
        assert _quick_detect_entity("Pictet & Cie Annual Report 2025") == "PICTET"

    def test_detects_goldman(self) -> None:
        assert _quick_detect_entity("Goldman Sachs Group 2025 Statement") == "GOLDMAN_SACHS"

    def test_detects_citi(self) -> None:
        assert _quick_detect_entity("Citi Private Bank Account Summary") == "CITI"

    def test_detects_jpmorgan(self) -> None:
        assert _quick_detect_entity("J.P. Morgan Securities LLC Report") == "JP_MORGAN"

    def test_returns_none_for_unknown(self) -> None:
        assert _quick_detect_entity("Random Bank Statement") is None


class TestMarkdownTableExtraction:
    def test_extracts_simple_table(self) -> None:
        text = """Some text before

| Date | Description | Amount |
| --- | --- | --- |
| 2025-01-15 | Dividend | 123.45 |
| 2025-02-20 | Interest | 67.89 |

Some text after"""

        tables = _extract_markdown_tables(text, page_num=1)
        assert len(tables) == 1
        assert tables[0].table_id == "docling-1-1"
        assert tables[0].header == ["Date", "Description", "Amount"]
        assert len(tables[0].rows) == 2
        assert tables[0].rows[0][2] == "123.45"

    def test_handles_no_tables(self) -> None:
        text = "Just plain text without any tables."
        tables = _extract_markdown_tables(text, page_num=1)
        assert len(tables) == 0

    def test_extracts_multiple_tables(self) -> None:
        text = """| A | B |
| --- | --- |
| 1 | 2 |

Some text

| C | D |
| --- | --- |
| 3 | 4 |"""

        tables = _extract_markdown_tables(text, page_num=2)
        assert len(tables) == 2
        assert tables[0].header == ["A", "B"]
        assert tables[1].header == ["C", "D"]

    def test_table_at_end_of_text(self) -> None:
        text = """| X | Y |
| --- | --- |
| a | b |"""

        tables = _extract_markdown_tables(text, page_num=1)
        assert len(tables) == 1


class TestConvertDocumentRequest:
    def test_valid_request(self) -> None:
        req = ConvertDocumentRequest(
            document_id="doc-1",
            filename="test.pdf",
            content_base64=base64.b64encode(b"fake-pdf-content").decode("utf-8"),
        )
        assert req.output_format == "markdown"
        assert req.document_id == "doc-1"

    def test_custom_format(self) -> None:
        req = ConvertDocumentRequest(
            document_id="doc-2",
            filename="test.pdf",
            content_base64="dGVzdA==",
            output_format="json",
        )
        assert req.output_format == "json"


class TestConvertDocumentEndpoint:
    def test_invalid_base64_returns_error(self) -> None:
        req = ConvertDocumentRequest(
            document_id="doc-err",
            filename="bad.pdf",
            content_base64="not-valid-base64!!!",
        )
        response = convert_document_endpoint(req)
        assert response.backend == "error"
        assert len(response.warnings) > 0

    def test_text_content_with_pdfplumber_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Cuando Docling no está disponible, debe usar pdfplumber como fallback."""
        # Deshabilitar Docling para forzar fallback
        monkeypatch.setattr("app.docling_converter.USE_DOCLING", False)

        # Crear un contenido base64 simple (no es un PDF real, pdfplumber también fallará)
        content = base64.b64encode(b"Hello World").decode("utf-8")
        req = ConvertDocumentRequest(
            document_id="doc-fallback",
            filename="test.txt",
            content_base64=content,
        )
        response = convert_document_endpoint(req)
        assert response.document_id == "doc-fallback"
        # El backend será pdfplumber (aunque falle, el fallback captura el error)
        assert "pdfplumber" in response.backend
