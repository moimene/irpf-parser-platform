FROM python:3.11-slim

# Dependencias del sistema para pdfplumber + Docling (visión/OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpoppler-cpp-dev \
    poppler-utils \
    libffi-dev \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar PyTorch CPU-only PRIMERO (evita descargar CUDA ~2GB)
RUN pip install --no-cache-dir \
    torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Instalar dependencias Python (Docling usará el torch CPU ya instalado)
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    "fastapi>=0.115.0" \
    "uvicorn[standard]>=0.32.0" \
    "pydantic>=2.10.0" \
    "pypdf>=5.0.0" \
    "pdfplumber>=0.11.0" \
    "openpyxl>=3.1.5" \
    "xlrd>=2.0.1" \
    "httpx>=0.27.0" \
    "openai>=1.51.0" \
    "supabase>=2.7.4" \
    "python-multipart>=0.0.9" \
    "docling>=2.0.0"

# Pre-descargar modelos Docling al build: Layout Heron + TableFormer ACCURATE + OCR
# Esto evita descargas en runtime (~500MB de modelos)
RUN python -c "\
from docling.datamodel.base_models import InputFormat; \
from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode; \
from docling.document_converter import DocumentConverter, PdfFormatOption; \
opts = PdfPipelineOptions(); \
opts.do_table_structure = True; \
opts.table_structure_options.mode = TableFormerMode.ACCURATE; \
opts.table_structure_options.do_cell_matching = True; \
opts.do_ocr = True; \
DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}); \
print('Docling models pre-downloaded: Layout Heron + TableFormer ACCURATE + EasyOCR')" || true

# Copiar código fuente
COPY app/ ./app/

# Puerto expuesto
EXPOSE 8000

# Health check para Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 -c "import os, urllib.request; urllib.request.urlopen(f\"http://localhost:{os.environ.get('PORT', '8000')}/health\")" || exit 1

# Comando de inicio con 2 workers para producción
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 2"]
