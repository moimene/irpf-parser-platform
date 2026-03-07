from app.extractors.base import parse_amount
from app.extractors.citi import _detect_citi_section
from app.extractors.goldman import _detect_section_type


def test_parse_amount_handles_us_and_eu_formats():
    assert parse_amount("123.45 USD") == 123.45
    assert parse_amount("1,234.56 USD") == 1234.56
    assert parse_amount("1.234,56 EUR") == 1234.56


def test_goldman_data_row_is_not_mistaken_for_section_header():
    line = "Goldman Sachs Dividend payment 2025-01-15 US0378331005 Apple Inc 123.45 USD"
    assert _detect_section_type(line) is None


def test_citi_data_row_is_not_mistaken_for_section_header():
    line = "Dividend income 2025-01-15 US0378331005 Apple Inc 123.45 USD"
    assert _detect_citi_section(line) is None
