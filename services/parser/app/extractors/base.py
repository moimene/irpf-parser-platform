"""
Utilidades compartidas para todos los extractores de entidades bancarias.
Proporciona parseo robusto de fechas, importes, ISINs y divisas.
"""
import re
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Tipos de operación reconocidos
# ---------------------------------------------------------------------------
OPERATION_TYPES = {
    "DIVIDENDO": [
        "dividend", "dividendo", "gross dividend", "div recv", "bruttodividende",
        "dividende", "distribución", "distribucion",
    ],
    "INTERES": [
        "interest", "interes", "interés", "credit interest", "interest earned",
        "interest on", "coupon", "cupón", "cupon", "rendimiento",
    ],
    "VENTA": [
        "realized", "gain/loss", "proceeds", "sell", "sold", "disposed",
        "venta", "venta de", "sale", "liquidación", "liquidacion",
    ],
    "COMPRA": [
        "purchase", "buy", "bought", "compra", "adquisición", "adquisicion",
        "subscription", "suscripción",
    ],
    "POSICION": [
        "position", "posición", "posicion", "balance", "holding",
        "market value", "valor mercado",
    ],
}

# Regex para ISIN (ISO 6166)
ISIN_PATTERN = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")

# Regex para divisas
CURRENCY_PATTERN = re.compile(
    r"\b(EUR|USD|GBP|CHF|JPY|SEK|NOK|DKK|CAD|AUD|HKD|SGD)\b", re.IGNORECASE
)

# Regex para importes (formatos europeo y anglosajón)
AMOUNT_PATTERNS = [
    re.compile(r"(-?\d{1,3}(?:\.\d{3})+,\d{2})"),   # 1.234.567,89 (europeo)
    re.compile(r"(-?\d{1,3}(?:,\d{3})+\.\d{2})"),   # 1,234,567.89 (anglosajón)
    re.compile(r"(-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2})"),  # mixto
    re.compile(r"(-?\d+[.,]\d{2})\b"),               # simple: 123,45 o 123.45
    re.compile(r"(-?\d{4,})"),                        # entero grande sin decimales
]

# Regex para fechas
DATE_PATTERNS = [
    re.compile(r"(\d{2})[/\-\.](\d{2})[/\-\.](\d{4})"),  # DD/MM/YYYY o DD-MM-YYYY
    re.compile(r"(\d{4})[/\-\.](\d{2})[/\-\.](\d{2})"),  # YYYY-MM-DD
    re.compile(r"(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})", re.IGNORECASE),
    re.compile(r"(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)[a-z]*\s+(\d{4})", re.IGNORECASE),
]

MONTH_MAP = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    "ene": "01", "abr": "04", "ago": "08",
}


@dataclass
class ExtractedRecord:
    """Registro extraído de un documento financiero."""
    record_type: str
    operation_date: Optional[str]
    isin: Optional[str]
    description: str
    amount: Optional[float]
    currency: str
    retention: Optional[float]
    quantity: Optional[float]
    page: int
    row_text: str
    confidence: float
    extra: Dict[str, Any] = field(default_factory=dict)


def parse_date(text: str) -> Optional[str]:
    """Extrae y normaliza una fecha a formato YYYY-MM-DD."""
    for pattern in DATE_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        groups = m.groups()
        # YYYY-MM-DD
        if len(groups[0]) == 4:
            return f"{groups[0]}-{groups[1].zfill(2)}-{groups[2].zfill(2)}"
        # DD/MM/YYYY
        if groups[0].isdigit() and groups[1].isdigit() and groups[2].isdigit():
            return f"{groups[2]}-{groups[1].zfill(2)}-{groups[0].zfill(2)}"
        # DD Mon YYYY
        if not groups[1].isdigit():
            month = MONTH_MAP.get(groups[1].lower()[:3], "01")
            return f"{groups[2]}-{month}-{groups[0].zfill(2)}"
    return None


def parse_amount(text: str) -> Optional[float]:
    """Extrae el primer importe numérico del texto."""
    for pattern in AMOUNT_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        raw = m.group(1)
        # Detectar formato europeo (punto como separador de miles, coma decimal)
        if re.search(r"\.\d{3},", raw) or (raw.count(".") > 1):
            cleaned = raw.replace(".", "").replace(",", ".")
        elif raw.count(",") > 1:
            cleaned = raw.replace(",", "")
        elif "," in raw and "." in raw:
            # Determinar cuál es el separador decimal por posición
            last_comma = raw.rfind(",")
            last_dot = raw.rfind(".")
            if last_comma > last_dot:
                cleaned = raw.replace(".", "").replace(",", ".")
            else:
                cleaned = raw.replace(",", "")
        elif "," in raw:
            # Solo coma: podría ser decimal europeo o separador de miles
            parts = raw.split(",")
            if len(parts[-1]) == 2:
                cleaned = raw.replace(",", ".")
            else:
                cleaned = raw.replace(",", "")
        else:
            cleaned = raw
        try:
            return float(cleaned)
        except ValueError:
            continue
    return None


def extract_isin(text: str) -> Optional[str]:
    """Extrae el primer ISIN válido del texto."""
    m = ISIN_PATTERN.search(text)
    return m.group(1) if m else None


def extract_currency(text: str) -> str:
    """Extrae la divisa del texto, por defecto EUR."""
    m = CURRENCY_PATTERN.search(text)
    return m.group(1).upper() if m else "EUR"


def detect_operation_type(text: str) -> Tuple[str, float]:
    """
    Detecta el tipo de operación por keywords.
    Devuelve (tipo, confianza_base).
    """
    lower = text.lower()
    for op_type, keywords in OPERATION_TYPES.items():
        for kw in keywords:
            if kw in lower:
                return op_type, 0.88
    return "DESCONOCIDO", 0.45


def extract_text_from_pdf(pdf_bytes: bytes) -> Tuple[List[str], bool]:
    """
    Extrae texto de un PDF usando pdfplumber (preferido) o pypdf (fallback).
    Devuelve (lista_de_textos_por_página, es_texto_nativo).
    """
    pages_text: List[str] = []
    has_text = False

    # Intento 1: pdfplumber (mejor para tablas y texto estructurado)
    try:
        import pdfplumber
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages_text.append(text)
                if len(text.strip()) > 50:
                    has_text = True
        if has_text:
            return pages_text, True
    except Exception:
        pass

    # Intento 2: pypdf (fallback)
    try:
        from pypdf import PdfReader
        reader = PdfReader(BytesIO(pdf_bytes))
        pages_text = []
        for page in reader.pages:
            text = page.extract_text() or ""
            pages_text.append(text)
            if len(text.strip()) > 50:
                has_text = True
        return pages_text, has_text
    except Exception:
        return [], False


def extract_tables_from_pdf(pdf_bytes: bytes) -> List[List[List[Optional[str]]]]:
    """
    Extrae tablas de un PDF usando pdfplumber.
    Devuelve lista de tablas, cada tabla es lista de filas, cada fila es lista de celdas.
    """
    all_tables: List[List[List[Optional[str]]]] = []
    try:
        import pdfplumber
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                if tables:
                    all_tables.extend(tables)
    except Exception:
        pass
    return all_tables


def row_to_str(row: List[Optional[str]]) -> str:
    """Convierte una fila de tabla a string para búsqueda de keywords."""
    return " ".join(str(cell or "").strip() for cell in row if cell)


def confidence_from_fields(
    has_date: bool,
    has_amount: bool,
    has_isin: bool,
    base: float = 0.88,
) -> float:
    """Calcula la confianza final según los campos extraídos."""
    score = base
    if not has_date:
        score -= 0.12
    if not has_amount:
        score -= 0.10
    if not has_isin:
        score -= 0.05
    return round(max(0.45, min(0.99, score)), 3)
