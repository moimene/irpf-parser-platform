FROM python:3.11-slim

# Dependencias del sistema para pdfplumber (pdfminer + Pillow)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpoppler-cpp-dev \
    poppler-utils \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias Python
COPY pyproject.toml .
RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    "uvicorn[standard]>=0.32.0" \
    pydantic>=2.10.0 \
    pypdf>=5.0.0 \
    pdfplumber>=0.11.0 \
    httpx>=0.27.0 \
    openai>=1.51.0 \
    supabase>=2.7.4 \
    python-multipart>=0.0.9

# Copiar código fuente
COPY app/ ./app/

# Puerto expuesto
EXPOSE 8000

# Health check para Railway
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Comando de inicio con 2 workers para producción
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
