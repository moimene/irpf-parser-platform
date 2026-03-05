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
    httpx>=0.27.0

# Copiar código fuente
COPY app/ ./app/

# Puerto expuesto
EXPOSE 8000

# Comando de inicio
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
