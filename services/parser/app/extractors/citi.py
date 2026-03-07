"""
Extractor para extractos bancarios de Citi (Citigroup / Citibank).
Formato: mixto — texto narrativo + tablas. Secciones en inglés:
- "Realized Gain/Loss" con columnas Date Sold, Proceeds, Cost Basis, Gain/Loss
- "Dividend Income" / "Interest Income"
- "Portfolio Holdings" / "Account Summary"
"""
import re
from typing import List, Optional

from app.extractors.base import (
    ExtractedRecord,
    confidence_from_fields,
    detect_operation_type,
    extract_currency,
    extract_isin,
    extract_tables_from_pdf,
    extract_text_from_pdf,
    parse_amount,
    parse_date,
    row_to_str,
)

# Cabeceras de sección Citi
CITI_SECTION_HEADERS = {
    "VENTA": [
        "realized gain/loss", "realized gains", "gain/loss",
        "date sold", "proceeds", "sold",
    ],
    "DIVIDENDO": [
        "dividend income", "dividends received", "dividend",
    ],
    "INTERES": [
        "interest income", "interest earned", "interest received",
        "money market interest",
    ],
    "POSICION": [
        "portfolio holdings", "account summary", "holdings",
        "market value", "portfolio value", "positions",
    ],
}

# Regex para "Date Sold" que aparece en tablas de Citi
DATE_SOLD_PATTERN = re.compile(r"date\s+sold[:\s]+(\d{2}/\d{2}/\d{4})", re.IGNORECASE)
PROCEEDS_PATTERN = re.compile(r"proceeds[:\s]+([0-9.,]+)", re.IGNORECASE)
COST_BASIS_PATTERN = re.compile(r"cost\s+basis[:\s]+([0-9.,]+)", re.IGNORECASE)


def _detect_citi_section(text: str) -> Optional[str]:
    """Detecta el tipo de sección por su cabecera."""
    lower = " ".join(text.lower().split())
    if parse_date(text) or extract_isin(text) or parse_amount(text) is not None:
        return None

    for op_type, headers in CITI_SECTION_HEADERS.items():
        for header in headers:
            is_prefixed = lower.startswith(f"{header}:") or lower.startswith(f"{header} -")
            is_short_variant = lower.startswith(f"{header} ") and len(lower.split()) <= len(header.split()) + 2
            if lower == header or is_prefixed or is_short_variant:
                return op_type
    return None


def _parse_citi_realized_row(row_str: str) -> Optional[ExtractedRecord]:
    """
    Parsea una fila de la sección 'Realized Gain/Loss' de Citi.
    Formato típico: ISIN | Descripción | Date Sold | Proceeds | Cost Basis | Gain/Loss
    """
    date_val = parse_date(row_str)
    isin_val = extract_isin(row_str)
    currency_val = extract_currency(row_str) or "USD"

    # Buscar "Proceeds" explícito
    proceeds_match = PROCEEDS_PATTERN.search(row_str)
    amount_val = parse_amount(proceeds_match.group(1)) if proceeds_match else parse_amount(row_str)

    # Buscar ganancia/pérdida neta (último importe en la fila)
    amounts = re.findall(r"-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}", row_str)
    gain_loss = None
    if len(amounts) >= 2:
        try:
            gain_loss = float(amounts[-1].replace(".", "").replace(",", "."))
        except ValueError:
            pass

    conf = confidence_from_fields(
        has_date=date_val is not None,
        has_amount=amount_val is not None,
        has_isin=isin_val is not None,
        base=0.88,
    )

    return ExtractedRecord(
        record_type="VENTA",
        operation_date=date_val,
        isin=isin_val,
        description=row_str[:120],
        amount=amount_val,
        currency=currency_val,
        retention=None,
        quantity=None,
        page=1,
        row_text=row_str,
        confidence=conf,
        extra={"template": "citi.realized.v1", "gain_loss": gain_loss},
    )


def extract(pdf_bytes: bytes) -> List[ExtractedRecord]:
    """
    Extrae registros de un extracto Citi.
    Estrategia: detección de secciones + tablas + texto narrativo.
    """
    records: List[ExtractedRecord] = []
    current_section: Optional[str] = None

    # Estrategia 1: extracción tabular
    tables = extract_tables_from_pdf(pdf_bytes)
    for table in tables:
        for row in table:
            if not row:
                continue
            row_str = row_to_str(row)
            if not row_str.strip():
                continue

            section = _detect_citi_section(row_str)
            if section:
                current_section = section
                continue

            op_type = current_section
            if not op_type:
                op_type, _ = detect_operation_type(row_str)
                if op_type == "DESCONOCIDO":
                    continue

            if op_type == "VENTA":
                rec = _parse_citi_realized_row(row_str)
                if rec:
                    records.append(rec)
                continue

            date_val: Optional[str] = None
            amount_val: Optional[float] = None
            isin_val: Optional[str] = None
            currency_val = "USD"

            for cell in row:
                cell_str = str(cell or "").strip()
                if not date_val:
                    date_val = parse_date(cell_str)
                if not isin_val:
                    isin_val = extract_isin(cell_str)
                currency_candidate = extract_currency(cell_str)
                if currency_candidate != "EUR":
                    currency_val = currency_candidate

            for cell in reversed(row):
                cell_str = str(cell or "").strip()
                candidate = parse_amount(cell_str)
                if candidate is not None and candidate != 0:
                    amount_val = candidate
                    break

            conf = confidence_from_fields(
                has_date=date_val is not None,
                has_amount=amount_val is not None,
                has_isin=isin_val is not None,
                base=0.88 if current_section else 0.80,
            )

            records.append(ExtractedRecord(
                record_type=op_type,
                operation_date=date_val,
                isin=isin_val,
                description=row_str[:120],
                amount=amount_val,
                currency=currency_val,
                retention=None,
                quantity=None,
                page=1,
                row_text=row_str,
                confidence=conf,
                extra={"template": "citi.table.v1", "section": current_section},
            ))

    # Estrategia 2: texto línea a línea
    if len(records) < 2:
        pages_text, _ = extract_text_from_pdf(pdf_bytes)
        current_section = None
        for page_num, page_text in enumerate(pages_text, start=1):
            for line in page_text.splitlines():
                line = line.strip()
                if len(line) < 10:
                    continue

                section = _detect_citi_section(line)
                if section:
                    current_section = section
                    continue

                op_type = current_section
                if not op_type:
                    op_type, _ = detect_operation_type(line)
                    if op_type == "DESCONOCIDO":
                        continue

                if op_type == "VENTA":
                    rec = _parse_citi_realized_row(line)
                    if rec:
                        rec.page = page_num
                        rec.extra["template"] = "citi.text.v1"
                        records.append(rec)
                    continue

                date_val = parse_date(line)
                amount_val = parse_amount(line)
                isin_val = extract_isin(line)
                currency_val = extract_currency(line) or "USD"

                conf = confidence_from_fields(
                    has_date=date_val is not None,
                    has_amount=amount_val is not None,
                    has_isin=isin_val is not None,
                    base=0.83 if current_section else 0.75,
                )

                records.append(ExtractedRecord(
                    record_type=op_type,
                    operation_date=date_val,
                    isin=isin_val,
                    description=line[:120],
                    amount=amount_val,
                    currency=currency_val,
                    retention=None,
                    quantity=None,
                    page=page_num,
                    row_text=line,
                    confidence=conf,
                    extra={"template": "citi.text.v1", "section": current_section},
                ))

    return records
