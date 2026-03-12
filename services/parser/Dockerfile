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
# Railway no tiene GPU, CPU-only reduce de ~2GB a ~200MB
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

# NO pre-descargamos modelos Docling en el build para aligerar la imagen.
# Los modelos (~500MB) se descargan automáticamente en el primer request.
# Railway mantiene el container vivo, así que solo se descargan una vez.

# Copiar código fuente
COPY app/ ./app/

# Puerto expuesto
EXPOSE 8000

# Health check para Railway (start period alto para descarga de modelos)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD python3 -c "import os, urllib.request; urllib.request.urlopen(f\"http://localhost:{os.environ.get('PORT', '8000')}/health\")" || exit 1

# Comando de inicio con 1 worker (Docling consume mucha RAM)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
