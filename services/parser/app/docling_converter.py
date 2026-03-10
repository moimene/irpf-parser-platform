"""
Módulo de conversión de documentos con Docling (IBM).

Proporciona conversión de PDF, DOCX, XLSX e imágenes a Markdown estructurado
con detección avanzada de tablas (TableFormer) y OCR multilingüe.

Fallback automático a pdfplumber cuando Docling no está disponible.
"""
import base64
import logging
import os
from io import BytesIO
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field

from app.schemas import StructuredDocument, StructuredPage, StructuredTable

logger = logging.getLogger(__name__)

# Controlar activación de Docling vía env var (opt-in para no romper flujos existentes)
USE_DOCLING = os.environ.get("USE_DOCLING", "true").lower() in ("1", "true", "yes")

# ── Schemas para el endpoint /convert-document ──

class ConvertDocumentRequest(BaseModel):
    document_id: str
    filename: str
    content_base64: str
    output_format: Literal["markdown", "json", "structured"] = "markdown"


class ConvertDocumentResponse(BaseModel):
    document_id: str
    markdown: str
    tables_count: int = 0
    pages_count: int = 0
    backend: str = "docling"
    entity_hint: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


# ── Detección de entidad rápida ──

def _quick_detect_entity(text: str) -> Optional[str]:
    """Detección rápida de entidad bancaria desde las primeras líneas."""
    sample = text[:2000].lower()
    if "pictet" in sample:
        return "PICTET"
    if any(k in sample for k in ["goldman", "gs ", "gs-", "gsam"]):
        return "GOLDMAN_SACHS"
    if "citi" in sample:
        return "CITI"
    if any(k in sample for k in ["j.p. morgan", "jpmorgan", "jp morgan"]):
        return "JP_MORGAN"
    return None


# ── Conversión con Docling ──

def _infer_format(filename: str) -> str:
    """Infiere el formato de entrada por extensión."""
    lower = filename.lower()
    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        return "xlsx"
    if lower.endswith(".docx"):
        return "docx"
    if lower.endswith(".csv"):
        return "csv"
    if lower.endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp")):
        return "image"
    return "pdf"


def _convert_with_docling(content_bytes: bytes, filename: str) -> Tuple[str, int, int, List[str]]:
    """
    Convierte un documento a Markdown usando Docling.

    Returns:
        (markdown, tables_count, pages_count, warnings)
    """
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption

    warnings: List[str] = []

    # Configurar pipeline con tabla-aware + OCR
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_table_structure = True
    pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE
    pipeline_options.do_ocr = True

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )

    # Preparar fuente como stream con nombre
    source = DocumentStream(name=filename, stream=BytesIO(content_bytes))

    result = converter.convert(source)

    from docling.datamodel.base_models import ConversionStatus

    if result.status == ConversionStatus.FAILURE:
        error_msgs = [e.error_message for e in (result.errors or [])]
        raise RuntimeError(f"Docling conversion failed: {'; '.join(error_msgs)}")

    if result.status == ConversionStatus.PARTIAL_SUCCESS:
        for error in (result.errors or []):
            warnings.append(f"Docling partial: {error.error_message}")

    # Exportar a Markdown
    markdown = result.document.export_to_markdown()

    # Contar tablas y páginas
    tables_count = len(result.document.tables) if hasattr(result.document, "tables") else 0
    pages_count = 0
    if hasattr(result.document, "pages") and result.document.pages:
        pages_count = len(result.document.pages)
    elif markdown:
        # Estimación por saltos de página en Markdown
        pages_count = max(1, markdown.count("\n---\n") + 1)

    return markdown, tables_count, pages_count, warnings


def _convert_with_pdfplumber_fallback(content_bytes: bytes) -> Tuple[str, int, int, List[str]]:
    """Fallback a pdfplumber cuando Docling no está disponible o falla."""
    warnings = ["Usando pdfplumber como fallback (Docling no disponible o falló)."]

    try:
        import pdfplumber

        pages_text: List[str] = []
        tables_count = 0

        with pdfplumber.open(BytesIO(content_bytes)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                pages_text.append(text)

                # Extraer tablas como Markdown
                raw_tables = page.extract_tables() or []
                for table in raw_tables:
                    tables_count += 1
                    if table and len(table) > 0:
                        # Convertir tabla a formato Markdown
                        header = table[0]
                        md_header = "| " + " | ".join(str(c or "") for c in header) + " |"
                        md_sep = "| " + " | ".join("---" for _ in header) + " |"
                        md_rows = [
                            "| " + " | ".join(str(c or "") for c in row) + " |"
                            for row in table[1:]
                        ]
                        md_table = "\n".join([md_header, md_sep, *md_rows])
                        pages_text.append(f"\n{md_table}\n")

        markdown = "\n\n".join(pages_text)
        return markdown, tables_count, len(pages_text), warnings

    except Exception as exc:
        warnings.append(f"pdfplumber fallback también falló: {exc}")
        return "", 0, 0, warnings


def convert_document(content_bytes: bytes, filename: str) -> Tuple[str, int, int, str, List[str]]:
    """
    Convierte un documento a Markdown.

    Intenta Docling primero, con fallback a pdfplumber.

    Returns:
        (markdown, tables_count, pages_count, backend, warnings)
    """
    if USE_DOCLING:
        try:
            markdown, tables_count, pages_count, warnings = _convert_with_docling(
                content_bytes, filename
            )
            return markdown, tables_count, pages_count, "docling", warnings
        except Exception as exc:
            logger.warning("Docling conversion failed, falling back to pdfplumber: %s", exc)
            markdown, tables_count, pages_count, warnings = _convert_with_pdfplumber_fallback(
                content_bytes
            )
            warnings.insert(0, f"Docling falló ({exc}), usando pdfplumber como fallback.")
            return markdown, tables_count, pages_count, "pdfplumber_fallback", warnings

    # Docling deshabilitado, usar pdfplumber directamente
    markdown, tables_count, pages_count, warnings = _convert_with_pdfplumber_fallback(content_bytes)
    return markdown, tables_count, pages_count, "pdfplumber", warnings


def convert_document_endpoint(request: ConvertDocumentRequest) -> ConvertDocumentResponse:
    """
    Punto de entrada para el endpoint /convert-document.
    """
    try:
        content_bytes = base64.b64decode(request.content_base64)
    except Exception:
        return ConvertDocumentResponse(
            document_id=request.document_id,
            markdown="",
            backend="error",
            warnings=["Error decodificando content_base64."],
        )

    markdown, tables_count, pages_count, backend, warnings = convert_document(
        content_bytes, request.filename
    )

    entity_hint = _quick_detect_entity(markdown)

    return ConvertDocumentResponse(
        document_id=request.document_id,
        markdown=markdown,
        tables_count=tables_count,
        pages_count=pages_count,
        backend=backend,
        entity_hint=entity_hint,
        warnings=warnings,
    )


def build_docling_structured_document(
    content_bytes: bytes, filename: str
) -> Tuple[StructuredDocument, List[str]]:
    """
    Construye un StructuredDocument usando Docling como backend.

    Convierte a Markdown y luego parsea las tablas detectadas
    para poblar la estructura compatible con el parser existente.
    """
    markdown, tables_count, pages_count, backend, warnings = convert_document(
        content_bytes, filename
    )

    if not markdown:
        return (
            StructuredDocument(
                source_type="PDF",
                backend="docling" if backend == "docling" else "pdfplumber",
                pages=[],
                metadata={"page_count": 0},
            ),
            warnings,
        )

    # Dividir por páginas (Docling separa con ---)
    page_texts = markdown.split("\n---\n") if "\n---\n" in markdown else [markdown]

    pages: List[StructuredPage] = []
    for idx, page_text in enumerate(page_texts, start=1):
        # Extraer tablas en formato Markdown del texto
        structured_tables = _extract_markdown_tables(page_text, idx)

        pages.append(
            StructuredPage(
                page=idx,
                text=page_text,
                tables=structured_tables,
            )
        )

    return (
        StructuredDocument(
            source_type="PDF",
            backend="docling" if backend == "docling" else "pdfplumber",
            pages=pages,
            metadata={
                "page_count": len(pages),
                "tables_count": tables_count,
                "docling_backend": backend,
            },
        ),
        warnings,
    )


def _extract_markdown_tables(text: str, page_num: int) -> List[StructuredTable]:
    """Extrae tablas en formato Markdown del texto de una página."""
    tables: List[StructuredTable] = []
    lines = text.split("\n")
    table_lines: List[str] = []
    in_table = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            in_table = True
            table_lines.append(stripped)
        elif in_table:
            # Fin de tabla
            if len(table_lines) >= 2:
                table = _parse_markdown_table(table_lines, page_num, len(tables) + 1)
                if table:
                    tables.append(table)
            table_lines = []
            in_table = False

    # Capturar tabla al final del texto
    if in_table and len(table_lines) >= 2:
        table = _parse_markdown_table(table_lines, page_num, len(tables) + 1)
        if table:
            tables.append(table)

    return tables


def _parse_markdown_table(
    lines: List[str], page_num: int, table_idx: int
) -> Optional[StructuredTable]:
    """Parsea líneas de una tabla Markdown a StructuredTable."""
    # Filtrar líneas separadoras (| --- | --- |)
    content_lines = [
        line for line in lines
        if not all(c in "-| " for c in line)
    ]

    if not content_lines:
        return None

    rows: List[List[Optional[str]]] = []
    for line in content_lines:
        cells = [cell.strip() or None for cell in line.strip("|").split("|")]
        rows.append(cells)

    if not rows:
        return None

    header = rows[0]
    body = rows[1:] if len(rows) > 1 else []

    return StructuredTable(
        table_id=f"docling-{page_num}-{table_idx}",
        page=page_num,
        source=f"docling:page-{page_num}",
        header=header,
        rows=body,
    )
