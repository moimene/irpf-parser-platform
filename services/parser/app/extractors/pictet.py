"""
Extractor para extractos bancarios de Pictet.
Formato: tablas con columnas Fecha | Descripción | ISIN | Cantidad | Precio | Importe | Divisa
También maneja el formato de texto narrativo de algunos extractos Pictet.
"""
from io import BytesIO
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


def extract(pdf_bytes: bytes) -> List[ExtractedRecord]:
    """
    Extrae registros de un extracto Pictet.
    Estrategia: tablas primero, luego texto línea a línea.
    """
    records: List[ExtractedRecord] = []

    # Estrategia 1: extracción tabular
    tables = extract_tables_from_pdf(pdf_bytes)
    for table in tables:
        for i, row in enumerate(table):
            if not row or len(row) < 3:
                continue
            row_str = row_to_str(row)
            op_type, base_conf = detect_operation_type(row_str)
            if op_type == "DESCONOCIDO":
                continue

            # Buscar campos en las celdas de la fila
            date_val: Optional[str] = None
            amount_val: Optional[float] = None
            isin_val: Optional[str] = None
            currency_val = "EUR"
            retention_val: Optional[float] = None
            quantity_val: Optional[float] = None
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
                # Detectar retención (celda que contiene "retenc" o "withhold")
                if any(k in cell_str.lower() for k in ["retenc", "withhold", "ret."]):
                    retention_val = parse_amount(cell_str)
                elif not amount_val:
                    amount_val = parse_amount(cell_str)

            conf = confidence_from_fields(
                has_date=date_val is not None,
                has_amount=amount_val is not None,
                has_isin=isin_val is not None,
                base=base_conf,
            )

            records.append(ExtractedRecord(
                record_type=op_type,
                operation_date=date_val,
                isin=isin_val,
                description=description,
                amount=amount_val,
                currency=currency_val,
                retention=retention_val,
                quantity=quantity_val,
                page=1,
                row_text=row_str,
                confidence=conf,
                extra={"template": "pictet.table.v1"},
            ))

    # Estrategia 2: texto línea a línea (si tablas no dieron resultados suficientes)
    if len(records) < 2:
        pages_text, _ = extract_text_from_pdf(pdf_bytes)
        for page_num, page_text in enumerate(pages_text, start=1):
            for line in page_text.splitlines():
                line = line.strip()
                if len(line) < 15:
                    continue
                op_type, base_conf = detect_operation_type(line)
                if op_type == "DESCONOCIDO":
                    continue

                date_val = parse_date(line)
                amount_val = parse_amount(line)
                isin_val = extract_isin(line)
                currency_val = extract_currency(line)

                conf = confidence_from_fields(
                    has_date=date_val is not None,
                    has_amount=amount_val is not None,
                    has_isin=isin_val is not None,
                    base=base_conf - 0.05,  # texto es menos preciso que tabla
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
                    extra={"template": "pictet.text.v1"},
                ))

    return records
