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
