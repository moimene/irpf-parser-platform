import base64
from io import BytesIO

import pytest

from app.parser_engine import parse_document
from app.schemas import ParseDocumentRequest


def test_template_detects_pictet_dividend() -> None:
    response = parse_document(
        ParseDocumentRequest(
            document_id="doc-1",
            expediente_id="exp-1",
            filename="PICTET_2025_Q4.pdf",
            text="Dividendo ordinario 26/12/2025 393,06 USD"
        )
    )

    assert response.parser_strategy == "template"
    assert response.records
    assert response.confidence >= 0.85
    assert response.structured_document is not None
    assert response.structured_document.backend == "text"
    assert response.structured_document.pages
    assert response.fiscal_events
    assert response.fiscal_events[0]["event_type"] == "DIVIDEND"
    assert response.fiscal_events[0]["capital_operation_key"] == "DIVIDENDO_ACCION"
    assert response.fiscal_events[0]["irpf_group"] == "RCM"


def test_semantic_fallback_requires_manual_when_low_signal() -> None:
    response = parse_document(
        ParseDocumentRequest(
            document_id="doc-2",
            expediente_id="exp-1",
            filename="unknown.pdf",
            text="abc"
        )
    )

    assert response.requires_manual_review is True
    assert response.parser_strategy in {"semantic", "manual"}


def test_csv_builds_structured_document_and_records() -> None:
    csv_payload = "\n".join(
        [
            "Date,Description,ISIN,Amount,Currency",
            "2025-01-15,Dividend payment,US0378331005,123.45,USD",
        ]
    )
    response = parse_document(
        ParseDocumentRequest(
            document_id="doc-csv",
            expediente_id="exp-1",
            filename="PICTET_statement.csv",
            source_type="CSV",
            content_base64=base64.b64encode(csv_payload.encode("utf-8")).decode("utf-8"),
        )
    )

    assert response.parser_strategy == "template"
    assert response.records
    assert response.structured_document is not None
    assert response.structured_document.source_type == "CSV"
    assert response.structured_document.backend == "csv"
    assert response.structured_document.pages[0].tables
    assert response.asset_records
    assert response.fiscal_events
    assert response.fiscal_events[0]["capital_operation_key"] == "DIVIDENDO_ACCION"


def test_xlsx_builds_structured_document_and_records() -> None:
    openpyxl = pytest.importorskip("openpyxl")

    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Dividendos"
    worksheet.append(["Date", "Description", "ISIN", "Amount", "Currency"])
    worksheet.append(["2025-01-15", "Dividend payment", "US0378331005", 123.45, "USD"])

    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()

    response = parse_document(
        ParseDocumentRequest(
            document_id="doc-xlsx",
            expediente_id="exp-1",
            filename="PICTET_positions.xlsx",
            source_type="XLSX",
            content_base64=base64.b64encode(buffer.getvalue()).decode("utf-8"),
        )
    )

    assert response.parser_strategy == "template"
    assert response.records
    assert response.structured_document is not None
    assert response.structured_document.source_type == "XLSX"
    assert response.structured_document.backend == "xlsx"
    assert response.structured_document.pages[0].tables
    assert response.asset_records
    assert response.fiscal_events
    assert response.fiscal_events[0]["capital_operation_key"] == "DIVIDENDO_ACCION"
