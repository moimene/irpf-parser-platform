"""
Extractor J.P. Morgan — dos sub-tipos de documento:

1. AccountOpeningLetter  → extrae datos de cuenta (IBAN, titular, divisa)
   Produce registros tipo CUENTA_BANCARIA para el Modelo 720.

2. Statement (extracto de operaciones)  → extrae COMPRA / VENTA / DIVIDENDO
   Produce registros tipo operación para irpf_operations.
   Patrones inferidos de los extractos GS/Citi del Excel; se refinará
   cuando se disponga de extractos reales de J.P. Morgan.
"""
import re
from typing import List, Optional

import pdfplumber

from .base import ExtractedRecord, extract_text_from_pdf

# ---------------------------------------------------------------------------
# Patrones de detección de sub-tipo
# ---------------------------------------------------------------------------
_OPENING_SIGNALS = [
    "account opening",
    "account number:",
    "iban:",
    "swift bic:",
    "dear valued client",
    "we have opened your account",
]

_STATEMENT_SIGNALS = [
    "statement of account",
    "transaction date",
    "value date",
    "debit",
    "credit",
    "balance",
    "trade confirmation",
]

# ---------------------------------------------------------------------------
# Patrones de extracción para carta de apertura
# ---------------------------------------------------------------------------
_RE_ACCOUNT_NUMBER = re.compile(
    r"account\s+number[:\s]+([A-Z0-9\-]{6,20})", re.IGNORECASE
)
_RE_IBAN = re.compile(r"IBAN[:\s]+([A-Z]{2}\d{2}[A-Z0-9]{4,30})", re.IGNORECASE)
_RE_CURRENCY = re.compile(r"currency[:\s]+([A-Z]{3})", re.IGNORECASE)
_RE_SWIFT = re.compile(r"swift\s+bic[:\s]+([A-Z0-9]{8,11})", re.IGNORECASE)
_RE_TITLED = re.compile(r"titled[:\s]+(.+)", re.IGNORECASE)
_RE_DATE = re.compile(
    r"(\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+\d{4})",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Patrones de extracción para extractos de operaciones (J.P. Morgan SE)
# ---------------------------------------------------------------------------
_RE_ISIN = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}\d)\b")
_RE_AMOUNT = re.compile(
    r"([\-\+]?\s*[\d,\.]+)\s*(EUR|USD|GBP|CHF|JPY)", re.IGNORECASE
)
_RE_OP_DATE = re.compile(r"(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4})")


def _detect_subtype(text: str) -> str:
    """Devuelve 'opening_letter' o 'statement' según el contenido del PDF."""
    lower = text.lower()
    opening_score = sum(1 for s in _OPENING_SIGNALS if s in lower)
    statement_score = sum(1 for s in _STATEMENT_SIGNALS if s in lower)
    if opening_score >= 2:
        return "opening_letter"
    if statement_score >= 2:
        return "statement"
    # Heurística de desempate: si hay IBAN sin tabla de transacciones
    if "iban" in lower and "transaction date" not in lower:
        return "opening_letter"
    return "statement"


def _extract_opening_letter(text: str, page: int = 1) -> List[ExtractedRecord]:
    """
    Extrae los datos de identificación de cuenta de una carta de apertura.
    Produce un único registro tipo CUENTA_BANCARIA.
    """
    records: List[ExtractedRecord] = []

    iban_m = _RE_IBAN.search(text)
    account_m = _RE_ACCOUNT_NUMBER.search(text)
    currency_m = _RE_CURRENCY.search(text)
    swift_m = _RE_SWIFT.search(text)
    titled_m = _RE_TITLED.search(text)
    date_m = _RE_DATE.search(text)

    iban = iban_m.group(1).strip() if iban_m else None
    account_number = account_m.group(1).strip() if account_m else None
    currency = currency_m.group(1).strip() if currency_m else "EUR"
    swift = swift_m.group(1).strip() if swift_m else None
    holder = titled_m.group(1).strip() if titled_m else None
    open_date = date_m.group(1).strip() if date_m else None

    # Necesitamos al menos IBAN o número de cuenta para crear el registro
    if not iban and not account_number:
        return records

    # Descripción estructurada para el Review Board
    description_parts = ["Apertura de cuenta J.P. Morgan SE"]
    if holder:
        description_parts.append(f"Titular: {holder}")
    if iban:
        description_parts.append(f"IBAN: {iban}")
    if account_number:
        description_parts.append(f"Cuenta: {account_number}")
    if swift:
        description_parts.append(f"SWIFT: {swift}")

    # Confianza alta si tenemos IBAN completo
    confidence = 0.95 if iban else 0.80

    records.append(
        ExtractedRecord(
            record_type="CUENTA_BANCARIA",
            description=" | ".join(description_parts),
            operation_date=open_date,
            isin=None,
            amount=None,
            currency=currency,
            retention=None,
            quantity=None,
            confidence=confidence,
            page=page,
            row_text=text[:200],
            extra={
                "iban": iban,
                "account_number": account_number,
                "currency": currency,
                "swift_bic": swift,
                "account_holder": holder,
                "open_date": open_date,
                "entity": "JP_MORGAN",
                "branch": "Luxembourg",
                "document_type": "account_opening_letter",
            },
        )
    )
    return records


def _extract_statement_rows(
    pdf_bytes: bytes,
) -> List[ExtractedRecord]:
    """
    Extrae operaciones de un extracto de cuenta J.P. Morgan SE.
    Patrones inferidos de los extractos GS/Citi del Excel;
    se refinará con extractos reales cuando estén disponibles.
    """
    records: List[ExtractedRecord] = []

    with pdfplumber.open(pdf_bytes) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            text = page.extract_text() or ""

            # Intentar extracción tabular primero
            for table in tables:
                for row in table:
                    if not row:
                        continue
                    row_text = " ".join(str(c) for c in row if c)
                    isin_m = _RE_ISIN.search(row_text)
                    amount_m = _RE_AMOUNT.search(row_text)
                    date_m = _RE_OP_DATE.search(row_text)

                    if not (isin_m or amount_m):
                        continue

                    # Determinar tipo de operación por palabras clave
                    lower_row = row_text.lower()
                    if any(k in lower_row for k in ["buy", "purchase", "compra"]):
                        op_type = "COMPRA"
                    elif any(k in lower_row for k in ["sell", "sale", "venta"]):
                        op_type = "VENTA"
                    elif any(k in lower_row for k in ["dividend", "dividendo"]):
                        op_type = "DIVIDENDO"
                    elif any(k in lower_row for k in ["interest", "interes", "coupon"]):
                        op_type = "INTERES"
                    else:
                        op_type = "MOVIMIENTO"

                    amount: Optional[float] = None
                    currency = "EUR"
                    if amount_m:
                        try:
                            amount = float(
                                amount_m.group(1).replace(",", "").replace(" ", "")
                            )
                            currency = amount_m.group(2).upper()
                        except ValueError:
                            pass

                    records.append(
                        ExtractedRecord(
                            record_type=op_type,
                            description=row_text[:200],
                            operation_date=date_m.group(1) if date_m else None,
                            isin=isin_m.group(1) if isin_m else None,
                            amount=amount,
                            currency=currency,
                            retention=None,
                            quantity=None,
                            confidence=0.72,  # Confianza moderada — sin extracto real calibrado
                            page=page_num,
                            row_text=row_text[:200],
                            extra={"raw_row": row_text, "entity": "JP_MORGAN"},
                        )
                    )

    return records


def extract(pdf_bytes: bytes) -> List[ExtractedRecord]:
    """
    Punto de entrada principal del extractor J.P. Morgan.
    Detecta automáticamente el sub-tipo y delega al extractor correcto.
    """
    pages_text, _ = extract_text_from_pdf(pdf_bytes)
    full_text = "\n".join(pages_text)

    subtype = _detect_subtype(full_text)

    if subtype == "opening_letter":
        return _extract_opening_letter(full_text, page=1)

    # Para extractos de operaciones
    return _extract_statement_rows(pdf_bytes)
