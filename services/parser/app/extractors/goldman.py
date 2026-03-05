"""
Extractor para extractos bancarios de Goldman Sachs (GS).
Formato: extractos en inglés con secciones separadas por tipo:
- "Dividends" / "Dividend Income"
- "Interest Earned on Credit Balances" / "Interest Income"
- "Realized Gains and Losses" / "Realized Gain/Loss"
- "Portfolio Summary" / "Positions"
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

# Cabeceras de sección GS que indican el tipo de operación
GS_SECTION_HEADERS = {
    "DIVIDENDO": [
        "dividend", "dividends", "dividend income", "div income",
    ],
    "INTERES": [
        "interest earned", "interest income", "credit interest",
        "interest on", "money market",
    ],
    "VENTA": [
        "realized gain", "realized loss", "realized gains and losses",
        "gain/loss", "proceeds from sale", "sold securities",
    ],
    "COMPRA": [
        "purchased securities", "securities purchased", "bought",
    ],
    "POSICION": [
        "portfolio summary", "account summary", "positions", "holdings",
        "market value", "portfolio value",
    ],
}

# Regex para detectar retención en GS (Tax Withheld, Federal Tax)
RETENTION_PATTERN = re.compile(
    r"(tax\s+withheld|federal\s+tax|withholding|nra\s+withholding|retention)[:\s]+([0-9.,\-]+)",
    re.IGNORECASE,
)


def _detect_section_type(text: str) -> Optional[str]:
    """Detecta el tipo de sección por su cabecera."""
    lower = text.lower()
    for op_type, headers in GS_SECTION_HEADERS.items():
        for header in headers:
            if header in lower:
                return op_type
    return None


def extract(pdf_bytes: bytes) -> List[ExtractedRecord]:
    """
    Extrae registros de un extracto Goldman Sachs.
    Estrategia: detección de secciones por cabecera + extracción tabular.
    """
    records: List[ExtractedRecord] = []
    current_section: Optional[str] = None

    # Estrategia 1: extracción tabular con contexto de sección
    tables = extract_tables_from_pdf(pdf_bytes)
    for table in tables:
        for row in table:
            if not row:
                continue
            row_str = row_to_str(row)
            if not row_str.strip():
                continue

            # Detectar si esta fila es una cabecera de sección
            section = _detect_section_type(row_str)
            if section:
                current_section = section
                continue

            # Si no tenemos sección activa, intentar detectar por la fila misma
            op_type = current_section
            if not op_type:
                op_type, _ = detect_operation_type(row_str)
                if op_type == "DESCONOCIDO":
                    continue

            # Extraer campos
            date_val: Optional[str] = None
            amount_val: Optional[float] = None
            isin_val: Optional[str] = None
            currency_val = "USD"  # GS usa USD por defecto
            retention_val: Optional[float] = None
            description = row_str[:120]

            for cell in row:
                cell_str = str(cell or "").strip()
                if not date_val:
                    date_val = parse_date(cell_str)
                if not isin_val:
                    isin_val = extract_isin(cell_str)
                currency_candidate = extract_currency(cell_str)
                if currency_candidate != "EUR":
                    currency_val = currency_candidate

            # Buscar retención en la fila completa
            ret_match = RETENTION_PATTERN.search(row_str)
            if ret_match:
                retention_val = parse_amount(ret_match.group(2))

            # El importe suele estar en las últimas celdas de la fila
            for cell in reversed(row):
                cell_str = str(cell or "").strip()
                if cell_str and not date_val == cell_str:
                    candidate = parse_amount(cell_str)
                    if candidate is not None and candidate != 0:
                        amount_val = candidate
                        break

            conf = confidence_from_fields(
                has_date=date_val is not None,
                has_amount=amount_val is not None,
                has_isin=isin_val is not None,
                base=0.90 if current_section else 0.82,
            )

            records.append(ExtractedRecord(
                record_type=op_type,
                operation_date=date_val,
                isin=isin_val,
                description=description,
                amount=amount_val,
                currency=currency_val,
                retention=retention_val,
                quantity=None,
                page=1,
                row_text=row_str,
                confidence=conf,
                extra={"template": "goldman.table.v1", "section": current_section},
            ))

    # Estrategia 2: texto línea a línea con detección de secciones
    if len(records) < 2:
        pages_text, _ = extract_text_from_pdf(pdf_bytes)
        current_section = None
        for page_num, page_text in enumerate(pages_text, start=1):
            for line in page_text.splitlines():
                line = line.strip()
                if len(line) < 10:
                    continue

                # Detectar cabecera de sección
                section = _detect_section_type(line)
                if section:
                    current_section = section
                    continue

                op_type = current_section
                if not op_type:
                    op_type, _ = detect_operation_type(line)
                    if op_type == "DESCONOCIDO":
                        continue

                date_val = parse_date(line)
                amount_val = parse_amount(line)
                isin_val = extract_isin(line)
                currency_val = extract_currency(line) or "USD"

                # Retención en la línea
                ret_match = RETENTION_PATTERN.search(line)
                retention_val = parse_amount(ret_match.group(2)) if ret_match else None

                conf = confidence_from_fields(
                    has_date=date_val is not None,
                    has_amount=amount_val is not None,
                    has_isin=isin_val is not None,
                    base=0.85 if current_section else 0.78,
                )

                records.append(ExtractedRecord(
                    record_type=op_type,
                    operation_date=date_val,
                    isin=isin_val,
                    description=line[:120],
                    amount=amount_val,
                    currency=currency_val,
                    retention=retention_val,
                    quantity=None,
                    page=page_num,
                    row_text=line,
                    confidence=conf,
                    extra={"template": "goldman.text.v1", "section": current_section},
                ))

    return records
