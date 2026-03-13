# IRPF Parser Service — Architecture Reference

**Version**: 0.8.6
**Status**: Production (Railway)
**Last Updated**: 2026-03-13

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Dual Engine Design](#3-dual-engine-design)
4. [OCR & Document Conversion](#4-ocr--document-conversion-docling)
5. [V1 Engine — Harvey AI Cognitive Engine](#5-v1-engine--harvey-ai-cognitive-engine)
6. [V2 Engine — OpenAI Structured Outputs](#6-v2-engine--openai-structured-outputs)
7. [Aduana Matemática — Deduplication Pipeline](#7-aduana-matemática--deduplication-pipeline)
8. [ISIN Luhn Validation (ISO 6166)](#8-isin-luhn-validation-iso-6166)
9. [Coverage Warnings System](#9-coverage-warnings-system)
10. [Pydantic Schemas — BOE en Código](#10-pydantic-schemas--boe-en-código)
11. [Fallback Pipeline (V1)](#11-fallback-pipeline-v1)
12. [Excel Exporter](#12-excel-exporter)
13. [API Endpoints](#13-api-endpoints)
14. [Deployment & Infrastructure](#14-deployment--infrastructure)
15. [Environment Variables](#15-environment-variables)
16. [Directory Structure](#16-directory-structure)
17. [Dependencies](#17-dependencies)
18. [Benchmark Results](#18-benchmark-results)
19. [Known Limitations](#19-known-limitations)
20. [Version History](#20-version-history)

---

## 1. Overview

The IRPF Parser Service is a **FastAPI microservice** that extracts structured financial asset data from bank portfolio PDFs for the Spanish Modelo 720 foreign asset declaration (AEAT). It converts unstructured PDF documents into typed, BOE-compliant data structures ready for regulatory filing.

**Core capability**: Take any bank portfolio PDF (EFG, Pictet, Goldman Sachs, JP Morgan, Citi, or unknown) and extract every declarable asset with its ISIN, valuation, currency, country, and M720 classification — with 98%+ confidence and 100% ISIN coverage.

**Regulatory context**: The Modelo 720 requires Spanish tax residents to declare foreign assets exceeding €50,000 in three categories: bank accounts (C), securities/funds (V/I), and insurance policies (S). Each asset must be reported with specific fields defined by Orden HAP/72/2013.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    IRPF Parser Service (Railway)                  │
│                      FastAPI + Uvicorn (1 worker)                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐    ┌───────────────────────────────────┐   │
│  │  /parse-document │    │  /api/v2/parse-universal           │   │
│  │  (V1 — Harvey)   │    │  (V2 — OpenAI Structured Outputs)  │   │
│  └────────┬────────┘    └────────────┬──────────────────────┘   │
│           │                          │                           │
│  ┌────────▼────────┐    ┌────────────▼──────────────────────┐   │
│  │ parser_engine.py │    │ engines/openai_universal.py        │   │
│  │ 4-level fallback │    │ Map-Reduce + Structured Outputs    │   │
│  │ Harvey → Template │    │ + ISIN Verification Pass           │   │
│  │ → Deterministic   │    │ + Coverage Warnings                │   │
│  │ → LLM fallback    │    │                                    │   │
│  └────────┬────────┘    └────────────┬──────────────────────┘   │
│           │                          │                           │
│  ┌────────▼────────┐                 │                           │
│  │ harvey_engine.py │                 │                           │
│  │ API v2 + Aduana  │                 │                           │
│  │ Matemática (7    │                 │                           │
│  │ layer dedup)     │                 │                           │
│  └────────┬────────┘                 │                           │
│           │                          │                           │
│  ┌────────▼──────────────────────────▼──────────────────────┐   │
│  │              docling_converter.py                          │   │
│  │     PDF → Markdown (Docling / pdfplumber fallback)         │   │
│  │  Layout Heron (RT-DETR) + TableFormer ACCURATE + EasyOCR   │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Shared Utilities                                             │ │
│  │  extractors/base.py — ISIN Luhn, date/amount parsing         │ │
│  │  schemas/m720_boe_v2.py — Pydantic V2 models (BOE fields)    │ │
│  │  exporters/excel_m720_v2.py — 5-sheet XLSX generation        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**Key design principle**: V1 and V2 are completely independent **fork logic**. They share no execution flow — only common utilities (Docling converter, ISIN Luhn validation, text splitter). This allows independent evolution and A/B testing.

---

## 3. Dual Engine Design

### V1 — Harvey AI (`/parse-document`)

- **Primary use**: Production document pipeline (Supabase edge function → parser → DB)
- **Engine**: Harvey AI API v2 (EU endpoint)
- **Output format**: `ParsedRecord[]` + `CanonicalAssetRecord[]` (V1 schemas)
- **Dedup**: 7-layer Aduana Matemática in `harvey_engine.py`
- **Fallback chain**: Harvey → entity templates → deterministic → LLM → manual

### V2 — OpenAI Structured Outputs (`/api/v2/parse-universal`)

- **Primary use**: High-quality extraction with typed schemas (BOE-compliant)
- **Engine**: OpenAI gpt-4o with `response_format=M720DocumentExtraction`
- **Output format**: `M720DocumentExtraction` (Pydantic V2 model with 5 asset lists)
- **Post-processing**: ISIN Verification Pass + Aduana V2 dedup + Coverage Warnings
- **Advantage**: Structured Outputs guarantee valid JSON matching the exact Pydantic schema

### Why two engines?

| Aspect | V1 (Harvey) | V2 (OpenAI) |
|--------|-------------|-------------|
| Schema enforcement | JSON parsing from text | Structured Outputs (guaranteed) |
| Classification | Post-hoc by client | LLM classifies directly into 5 BOE keys |
| Dedup | 7-layer Aduana in Python | Simpler dedup + ISIN smart merge |
| Coverage tracking | No | Yes (CoverageWarning system) |
| ISIN rescue | No | Yes (Verification Pass) |
| Cost | Harvey API (enterprise) | OpenAI API (pay-per-token) |

---

## 4. OCR & Document Conversion (Docling)

**File**: `app/docling_converter.py` (490 lines)

The Docling converter transforms PDF documents into structured Markdown, preserving table layouts and financial data with high fidelity.

### Pipeline

```
PDF bytes
  │
  ▼
Layout Heron (RT-DETR)     ← Page layout analysis (headers, tables, paragraphs)
  │
  ▼
TableFormer ACCURATE        ← Table structure recognition + cell matching
  │
  ▼
EasyOCR (es, en, fr, de, it)  ← Multilingual OCR for scanned pages
  │
  ▼
Markdown export             ← Structured Markdown with table grids
  │
  ▼
Page separator: \n---\n     ← Docling inserts between detected pages
```

### Configuration

```python
pipeline_options = PdfPipelineOptions()
pipeline_options.do_table_structure = True
pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE
pipeline_options.table_structure_options.do_cell_matching = True
pipeline_options.do_ocr = True
pipeline_options.ocr_options.lang = ["es", "en", "fr", "de", "it"]
```

### Fallback Chain

1. **Docling** (primary): Full pipeline with Layout Heron + TableFormer
2. **pdfplumber** (fallback): Simpler text + table extraction when Docling fails
3. **pypdf** (last resort): Raw text extraction only

### Key Functions

| Function | Purpose |
|----------|---------|
| `convert_document(bytes, filename)` | Main entry: returns `(markdown, tables_count, pages_count, backend, warnings)` |
| `build_docling_structured_document(bytes, filename)` | Native Docling → `StructuredDocument` with proper table headers/rows |
| `_convert_with_docling(bytes, filename)` | Direct Docling conversion to Markdown |
| `_convert_with_pdfplumber_fallback(bytes)` | Fallback using pdfplumber |
| `_quick_detect_entity(text)` | Fast bank entity detection from first 2000 chars |

### Model Pre-download

Docling models (~500MB) are pre-downloaded during Docker build to avoid cold start delays:

```dockerfile
RUN python -c "from docling.document_converter import DocumentConverter; ..."
```

---

## 5. V1 Engine — Harvey AI Cognitive Engine

**File**: `app/harvey_engine.py` (949 lines)

Harvey AI is the primary cognitive engine for V1 extraction. It uses the Harvey API v2 Completion endpoint with a Map-Reduce pattern.

### Harvey API Integration

```
Endpoint:    POST /api/v2/completion
Auth:        Bearer token (HARVEY_TOKEN)
Content:     multipart/form-data
Mode:        "assist" (analysis, not prose)
Stream:      "false" (batch pipeline)
Base URL:    https://eu.api.harvey.ai (EU endpoint)
```

### Map-Reduce Pattern

```
Full Markdown (e.g., 80K chars for 16-page portfolio)
  │
  ▼ SPLIT by \n---\n (Docling page separators)
[Page 1] [Page 2] ... [Page 16]
  │
  ▼ SUB-SPLIT pages > 15K chars
[SubChunk 1a] [SubChunk 1b] [Page 2] ...
  │
  ▼ GROUP into blocks ≤ 15K chars
[Block 1: pages 1-3] [Block 2: pages 4-6] ...
  │
  ▼ MAP (parallel with semaphore=3)
Harvey API v2 ──┬── Block 1 → M720ExtractionChunk
                ├── Block 2 → M720ExtractionChunk
                └── Block N → M720ExtractionChunk
  │
  ▼ REDUCE (filter errors + Aduana Matemática)
Final validated asset list
```

**Chunk limit**: 15,000 chars per block (Harvey API limit is 20K, system prompt takes ~1,500).

**Retry logic**: Exponential backoff (2s, 4s) for empty responses or HTTP errors.

### Harvey Response Parsing

Harvey returns text (not guaranteed JSON), so `_extract_json_from_text()` uses 3 strategies:
1. Direct JSON parse of full response
2. Extract from ` ```json ... ``` ` markdown blocks
3. Find outermost `{ ... }` brace pair

Results are validated against `M720ExtractionChunk` Pydantic model.

### System Prompt

The Harvey system prompt (~1,200 chars) instructs the model to:
- Extract ONLY year-end positions (31 December balances)
- Classify into CUENTA/VALOR/FONDO/SEGURO/DESCONOCIDO
- Convert European number formats (1.234,56 → 1234.56)
- Include ISIN codes exactly as they appear
- Ignore portfolio subtotals and aggregation lines
- Return pure JSON without markdown or explanatory text

---

## 6. V2 Engine — OpenAI Structured Outputs

**File**: `app/engines/openai_universal.py` (1,052 lines)

The V2 engine uses OpenAI's Structured Outputs feature to guarantee typed JSON responses matching the `M720DocumentExtraction` Pydantic model.

### Key Advantage: Structured Outputs

```python
response = await client.beta.chat.completions.parse(
    model=self.model,          # gpt-4o
    messages=[system_msg, user_msg],
    response_format=M720DocumentExtraction,  # Pydantic model as schema
    temperature=0,
)
extraction = response.choices[0].message.parsed
```

Unlike Harvey (text → manual JSON parsing), OpenAI Structured Outputs **guarantee** the response matches the exact Pydantic schema. No JSON parsing errors, no schema validation failures.

### Map-Reduce (same pattern, different engine)

```
Markdown → SPLIT → SUB-SPLIT → GROUP (≤20K chars) → MAP (semaphore=3) → MERGE
```

**Chunk limit**: 20,000 chars per block (OpenAI handles larger contexts).

Each block produces a `M720DocumentExtraction` with partial results. The MERGE phase combines all partial extractions into one.

### ISIN Verification Pass (v0.8.5)

After the first Map-Reduce extraction, the system performs a second pass to rescue missing ISINs:

```
1. Regex-find ALL ISINs in each block's text
2. Compare against ISINs already extracted from that block
3. For each missing ISIN:
   a. Extract ±1500 chars of OCR context around the ISIN
   b. Send focused re-extraction query to GPT-4o
   c. Merge rescued assets into results
```

This mitigates GPT-4o's non-determinism — even with `temperature=0`, the model occasionally skips valid ISINs in dense tables.

### Merge Logic

```python
def merge_extractions(extractions: List[M720DocumentExtraction]) -> M720DocumentExtraction:
    """Merge multiple partial extractions into one."""
    # Concatenate all 5 asset lists
    # Then apply dedup: ISIN smart dedup (same ISIN + same amount → discard)
```

Dedup rules in merge:
- **Same ISIN + same amount (±1%)** → duplicate (summary vs detail) → discard
- **Same ISIN + different amount** → multi-lot position → SUM amounts and quantities
- **Same account number + currency** → keep higher balance

---

## 7. Aduana Matemática — Deduplication Pipeline

The "Aduana Matemática" (Mathematical Customs) is a 7-layer deduplication pipeline that removes false positives from AI extraction.

### Why It Exists

Bank portfolio PDFs typically show the same asset multiple times:
- **Summary page** lists portfolio total by asset class
- **Detail pages** list each individual position
- **Multiple lots** of the same ISIN appear in separate rows
- **Category subtotals** appear as line items (e.g., "Bonos: 500,000 USD")

Without dedup, a 16-page EFG portfolio would produce 60+ raw records instead of the correct ~42.

### The 7 Layers (V1 — Harvey Engine)

```
RAW ASSETS FROM AI (e.g., 60 records)
  │
  ▼ Layer 1: Aggregation Filter
  │  Discard: "Bonos", "Renta variable", "Total cartera", etc.
  │  Regex-based detection of portfolio subtotals and category names
  │
  ▼ Layer 2: Garbage Name Filter
  │  Discard: truncated/generic names without ISIN (e.g., "Fund", "PLC")
  │  Criterion: normalized name < 5 chars after removing noise words
  │
  ▼ Layer 3: ISIN Smart Dedup
  │  Same ISIN + same amount (±1%) → DISCARD (summary/detail duplicate)
  │  Same ISIN + different amount → SUM (multi-lot position)
  │  Tracks all known lot amounts per ISIN to distinguish duplicates from new lots
  │
  ▼ Layer 4: Account Dedup
  │  Same account number + currency → KEEP higher absolute balance
  │  Account number extracted via regex from description (longest alphanumeric ≥6 chars)
  │
  ▼ Layer 5: Cross-ISIN Name Dedup
  │  Non-ISIN asset with same normalized name as an ISIN asset → MERGE
  │  Example: "BlackRock Global Funds" (no ISIN) matches "BlackRock Global Funds SICAV" (with ISIN)
  │  Same amount → discard; Different amount → SUM as new lot
  │
  ▼ Layer 6: Name Dedup
  │  Normalized name + currency + amount for non-ISIN assets → DISCARD duplicate
  │  Name normalization: lowercase, strip punctuation, remove noise words
  │  (fund, class, acc, plc, sicav, ucits, sub, the, de, del, la, el)
  │
  ▼ Layer 7: Amount-Based Secondary Dedup
  │  Same currency + same amount + same country → DISCARD
  │  Catches remaining duplicates with completely different names
  │  (e.g., "Fund" vs full name in different chunks)
  │
  ▼
FINAL VALIDATED ASSETS (e.g., 42 records)
```

### Name Normalization

```python
def _normalize_name_for_dedup(name: str) -> str:
    # Lowercase, remove punctuation, compress spaces
    # Remove noise words: fund, class, acc, plc, sicav, ucits, sub, the, de, del, la, el
    # Return cleaned core words
```

### Aggregation Patterns (22 regex patterns)

```python
_AGGREGATION_PATTERNS = [
    r"^bonos?\s*$",
    r"^renta\s+(fija|variable)\s*$",
    r"^(total|subtotal|suma|resumen)\b",
    r"^patrimonio\s+(total|neto)\s*$",
    r"^(cartera|portfolio|portafolio)\s*(total)?\s*$",
    r"^(fixed\s+income|equity|real\s+estate)\s*$",
    # ... 16 more patterns
]
```

---

## 8. ISIN Luhn Validation (ISO 6166)

**File**: `app/extractors/base.py`, function `validate_isin_luhn()`

Every ISIN extracted by the AI engines is validated using the Luhn check digit algorithm per ISO 6166.

### Algorithm

```
Input: "CH0491148604"

Step 1: Convert chars to digits
  C=12, H=17, 0=0, 4=4, 9=9, 1=1, 1=1, 4=4, 8=8, 6=6, 0=0, 4=4
  → "121704911486044"

Step 2: Luhn mod-10 check
  Double alternate digits from right, sum all digits
  Total mod 10 == 0 → VALID
```

### Confidence Impact

| ISIN Status | Confidence | Action |
|-------------|-----------|--------|
| Valid Luhn | 0.99 | Keep as-is |
| Invalid Luhn | 0.60 | Nullify ISIN, flag for manual review |
| No ISIN | 0.95 | Base Harvey/OpenAI confidence |

### Regex Pattern

```python
ISIN_PATTERN = re.compile(r"\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b")
```

Matches: 2 uppercase letters (country) + 9 alphanumeric + 1 check digit.

---

## 9. Coverage Warnings System

**Version**: v0.8.6
**Files**: `app/schemas/m720_boe_v2.py` (CoverageWarning, ExtractionCoverage), `app/engines/openai_universal.py`

The Coverage Warnings system provides structured reporting of extraction quality for human review.

### CoverageWarning Types

| Type | Severity | Description |
|------|----------|-------------|
| `isin_no_extraido` | alta | ISIN visible in OCR but not extracted by AI |
| `isin_no_rescatado` | alta | ISIN that the rescue pass also couldn't extract |
| `isin_no_en_ocr` | media | Expected ISIN not present in markdown (OCR failure) |
| `bloque_fallido` | alta | Entire block failed (API error/timeout) |
| `rescue_fallido` | media | Rescue pass itself failed (API error) |

### ExtractionCoverage Metrics

```python
class ExtractionCoverage(BaseModel):
    isins_en_ocr: int          # ISINs found by regex in OCR text
    isins_extraidos: int       # ISINs present in final extraction
    isins_rescatados: int      # ISINs recovered by verification pass
    isins_no_recuperados: List[str]  # ISINs still missing (need manual review)
    bloques_total: int         # Total blocks processed
    bloques_exitosos: int      # Blocks that returned results
    bloques_fallidos: int      # Blocks that failed
    rescue_passes: int         # Number of rescue passes launched
    cobertura_isin_pct: float  # (extraidos / en_ocr) × 100
    warnings: List[CoverageWarning]
```

### Coverage Calculation

```
Coverage % = (ISINs extracted / ISINs in OCR) × 100

100% = All ISINs in the document were extracted
<100% = Some ISINs visible in the PDF were not extracted (need human review)
```

For each unextracted ISIN, the system includes ±200 characters of OCR context so the reviewer can quickly locate it in the original document.

---

## 10. Pydantic Schemas — BOE en Código

**File**: `app/schemas/m720_boe_v2.py` (845 lines)

The V2 schemas encode the Modelo 720 BOE specification directly in Pydantic models. Each `Field(description=...)` serves double duty: it documents the field AND instructs OpenAI's Structured Outputs what to extract.

### Schema Hierarchy

```
BaseM720Asset (common fields)
├── M720Cuenta      (Clave C — bank accounts, subclaves A-E)
├── M720Valor       (Clave V — securities, subclaves A-C)
├── M720IIC         (Clave I — investment funds/IICs)
├── M720Seguro      (Clave S — insurance, subclaves 1-2)
└── M720Inmueble    (Clave B — real estate, subclaves 1-5)

M720DocumentExtraction (root container)
├── cuentas: List[M720Cuenta]
├── valores: List[M720Valor]
├── iics: List[M720IIC]
├── seguros: List[M720Seguro]
└── inmuebles: List[M720Inmueble]
```

### Common Fields (BaseM720Asset)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pais_entidad_o_inmueble` | str | required | ISO 3166-1 alpha-2 country code |
| `moneda_original` | str | required | ISO 4217 currency code |
| `condicion_declarante` | Literal | "Titular" | Relationship to asset |
| `origen_bien_derecho` | Literal["A","M","C"] | "A" | A=new, M=modified, C=cancelled |
| `porcentaje_participacion` | float | 100.0 | Ownership percentage |

### Classification Rules (V vs I)

The system prompt encodes the critical V vs I classification rule:

```
PRIORITY: ETF check FIRST
  - Name contains "ETF" → ALWAYS V (even if ISIN is IE/LU and name has "PLC"/"SICAV"/"UCITS")
    - Equity ETF → V(A)
    - Bond ETF → V(B)

THEN: Fund check
  - ISIN starts with IE/LU + name contains "Fund"/"SICAV"/"UCITS"/"ICAV"/"PLC" → I

OTHERWISE:
  - Individual stock/ADR → V(A)
  - Corporate/government bond → V(B)
  - Warrant/structured note/derivative → V(C)
```

### Auxiliary Types

```python
CondicionDeclarante = Literal[
    "Titular", "Representante", "Autorizado", "Beneficiario",
    "Usufructuario", "Tomador", "Con poder de disposición",
    "Otras formas de titularidad real"
]

OrigenBienDerecho = Literal["A", "M", "C"]

class DireccionEntidad(BaseModel):
    calle, poblacion, provincia, codigo_postal, pais
```

---

## 11. Fallback Pipeline (V1)

**File**: `app/parser_engine.py` (510 lines)

When Harvey AI is unavailable or fails, the V1 pipeline falls through 4 levels:

### Level 0 — Harvey AI (Primary)

- Called for ALL documents regardless of entity
- Map-Reduce + Aduana Matemática
- Returns immediately on success

### Level 1 — Entity Templates

Template-based extraction for known banks:

| Entity | Extractor | Template | Default Currency |
|--------|-----------|----------|-----------------|
| PICTET | `extractors/pictet.py` | pictet.v2 | EUR |
| GOLDMAN_SACHS | `extractors/goldman.py` | goldman.v2 | USD |
| CITI | `extractors/citi.py` | citi.v2 | USD |
| JP_MORGAN | `extractors/jpmorgan.py` | jpmorgan.v1 | USD |

Entity detection uses keyword matching in filename + entity_hint + first 800 chars of text.

### Level 1.5 — Deterministic Extraction

Line-by-line extraction from `StructuredDocument` using keyword-based operation type detection:

```python
OPERATION_TYPES = {
    "DIVIDENDO": ["dividend", "dividendo", "gross dividend", ...],
    "INTERES": ["interest", "coupon", "cupón", ...],
    "VENTA": ["realized", "sell", "venta", ...],
    "COMPRA": ["purchase", "buy", "compra", ...],
    "POSICION": ["position", "balance", "holding", "market value", ...],
}
```

### Level 2 — LLM Fallback

Uses GPT-4o-mini (`extractors/llm_fallback.py`) for semantic extraction when deterministic methods fail.

### Level 3 — Manual Review

If no records extracted: confidence=0.40, strategy="manual", document flagged for human review.

---

## 12. Excel Exporter

**File**: `app/exporters/excel_m720_v2.py` (273 lines)

Generates a 5-sheet XLSX file from `M720DocumentExtraction`:

| Sheet | BOE Key | Columns |
|-------|---------|---------|
| Cuentas (C) | C | Subclave, IBAN, BIC, Entidad, Saldo 31/12, Saldo Medio 4T, ... |
| Valores (V) | V | Subclave, ISIN, Emisor, Valor 31/12, Nº Valores, Representación, ... |
| IICs (I) | I | ISIN, Gestora, Valor Liquidativo 31/12, Nº Participaciones, ... |
| Seguros (S) | S | Subclave, Aseguradora, Valor Rescate 31/12, ... |
| Inmuebles (B) | B | Clave Bien, Subclave, Tipo, Registro, Valor Adquisición, ... |

Features:
- Professional styling with Calibri font, dark blue headers (#2C3E50)
- Auto-column width adjustment
- Number formatting (#,##0.00 for financial values)
- Auto-filter on all data ranges
- Thin borders on all cells

---

## 13. API Endpoints

### `GET /health`

Health check with version, capabilities, and engine status.

**Response includes**: available engines, Docling pipeline details, supported entities, OpenAI V2 features.

### `POST /parse-document` (V1)

**Request**: `ParseDocumentRequest`
```json
{
  "document_id": "uuid",
  "expediente_id": "uuid",
  "filename": "portfolio.pdf",
  "content_base64": "base64-encoded-pdf",
  "entity_hint": "PICTET"  // optional
}
```

**Response**: `ParseDocumentResponse` with `records[]`, `asset_records[]`, `fiscal_events[]`, `structured_document`, `confidence`, `strategy`.

### `POST /api/v2/parse-universal` (V2)

**Request**: `ParseUniversalV2Request`
```json
{
  "filename": "portfolio.pdf",
  "content_base64": "base64-encoded-pdf",
  "ejercicio": 2025
}
```

**Response**: `ParseUniversalV2Response` with `extraction` (M720DocumentExtraction), `coverage` (ExtractionCoverage), `model`, `processing_time_seconds`, `warnings`.

### `POST /api/v2/export-excel`

**Request**: `M720DocumentExtraction` (JSON body)

**Response**: XLSX file download (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)

### `POST /convert-document`

**Request**: `ConvertDocumentRequest` with `document_id`, `filename`, `content_base64`

**Response**: `ConvertDocumentResponse` with `markdown`, `tables_count`, `pages_count`, `backend`, `entity_hint`

---

## 14. Deployment & Infrastructure

### Railway Configuration

```
Platform:      Railway (railway.app)
URL:           https://parser-production-0827.up.railway.app
Image:         Docker (python:3.11-slim)
Workers:       1 (Docling consumes significant RAM)
Health check:  GET /health (30s interval, 10s timeout, 30s start period)
```

### Docker Build Strategy

```dockerfile
FROM python:3.11-slim

# 1. System dependencies for PDF processing and OCR
RUN apt-get install libpoppler-cpp-dev libgl1 libglib2.0-0

# 2. PyTorch CPU-only FIRST (avoids 2GB CUDA download)
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 3. Python dependencies (Docling uses pre-installed torch)
RUN pip install fastapi uvicorn pydantic pdfplumber docling openai httpx openpyxl

# 4. Pre-download Docling models (~500MB, eliminates cold start)
RUN python -c "from docling.document_converter import DocumentConverter; ..."

# 5. Copy application code
COPY app/ ./app/

# 6. Single worker (RAM constraint)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "${PORT}", "--workers", "1"]
```

### Deploy Command

```bash
cd /path/to/IRPF_PARSER/services/parser
~/bin/railway up --ci
```

### Version String Locations

**CRITICAL**: Version appears in 3 places in `main.py` — ALL THREE must be updated:

1. **Line 2**: Module docstring (`IRPF Parser Service — FastAPI v0.8.6`)
2. **Line 48**: `FastAPI(version="0.8.6")`
3. **Line 99**: Health endpoint return (`"version": "0.8.6"`)

---

## 15. Environment Variables

### Required for V1 (Harvey AI)

| Variable | Description | Example |
|----------|-------------|---------|
| `HARVEY_TOKEN` | Bearer token for Harvey AI API | `hvt_...` |
| `HARVEY_BASE_URL` | Harvey API base URL | `https://eu.api.harvey.ai` (default) |

### Required for V2 (OpenAI)

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |
| `OPENAI_MODEL` | Model to use | `gpt-4o` (default) |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `USE_DOCLING` | Enable Docling pipeline | `true` |
| `PORT` | Server port | `8000` |

---

## 16. Directory Structure

```
services/parser/
├── Dockerfile              # Docker image with PyTorch CPU + Docling models
├── pyproject.toml          # Dependencies: fastapi, docling, openai, httpx, etc.
├── railway.json            # Railway deployment config
├── railway.toml            # Railway build settings
├── ARCHITECTURE.md         # This file
│
└── app/
    ├── __init__.py
    ├── main.py              # FastAPI app, 5 endpoints, version management
    ├── parser_engine.py     # V1 orchestrator: Harvey → template → deterministic → LLM
    ├── harvey_engine.py     # Harvey AI engine: API v2, Map-Reduce, Aduana Matemática
    ├── docling_converter.py # PDF → Markdown: Docling + pdfplumber fallback
    ├── structured_document.py # StructuredDocument, StructuredPage, StructuredTable models
    ├── canonical_registry.py  # ParsedRecord → CanonicalAssetRecord/FiscalEvent mapping
    │
    ├── engines/
    │   └── openai_universal.py  # V2 OpenAI engine: Structured Outputs, Map-Reduce,
    │                            # ISIN Verification Pass, Coverage Warnings
    │
    ├── extractors/
    │   ├── base.py          # ISIN Luhn validation, date/amount parsing, currency detection
    │   ├── pictet.py        # Pictet bank template extractor
    │   ├── goldman.py       # Goldman Sachs template extractor
    │   ├── citi.py          # Citi bank template extractor
    │   ├── jpmorgan.py      # JP Morgan template extractor
    │   └── llm_fallback.py  # GPT-4o-mini fallback extractor
    │
    ├── schemas/
    │   ├── __init__.py      # V1 schemas: ParseDocumentRequest/Response, ParsedRecord,
    │   │                    # StructuredDocument, SourceSpan
    │   └── m720_boe_v2.py   # V2 BOE schemas: M720DocumentExtraction (5 asset types),
    │                        # CoverageWarning, ExtractionCoverage
    │
    └── exporters/
        └── excel_m720_v2.py # V2 XLSX generator: 5 sheets, one per BOE key
```

---

## 17. Dependencies

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| fastapi | ≥0.115.0 | Web framework |
| uvicorn | ≥0.32.0 | ASGI server |
| pydantic | ≥2.10.0 | Data validation and schemas |
| docling | ≥2.0.0 | PDF→Markdown with Layout+OCR |
| openai | ≥1.40.0 | OpenAI API (V2 engine) |
| httpx | ≥0.27.0 | Async HTTP client (Harvey API) |
| pdfplumber | ≥0.11.0 | PDF text/table extraction (fallback) |
| pypdf | ≥5.0.0 | PDF reading (last-resort fallback) |
| openpyxl | ≥3.1.5 | XLSX generation |
| xlrd | ≥2.0.1 | XLS reading |
| torch | CPU-only | PyTorch for Docling ML models |
| torchvision | CPU-only | Vision models for Layout Heron |

### Dev

| Package | Purpose |
|---------|---------|
| pytest | Unit tests |

---

## 18. Benchmark Results

### EFG Bank Portfolio (16-page, SORIA MUNOZ PEDRO EUGENIO)

**Document**: Cartera 560484-2, 31 December 2019

| Metric | V1 (Harvey) | V2 (OpenAI v0.8.6) |
|--------|-------------|---------------------|
| Total assets | 42 | 39 |
| Accounts (C) | 5 | 5 |
| Securities (V) | 11 | 11 |
| IICs (I) | 26 | 23 |
| Insurance (S) | 0 | 0 |
| Real estate (B) | 0 | 0 |
| OCR confidence | 98% | N/A |
| ISIN coverage | N/A | 100% (34/34) |
| ISINs rescued | N/A | 1 (LU0462954479) |
| Processing time | ~60s | ~105s |
| Total valuation | ~3,676,737 USD | ~3,675,495 USD |
| Error vs ground truth | 0.03% | 0.03% |

### Notable Extraction Examples

- **FORT Global Multi-lot SUM**: 35,686 + 66,810 = 102,497 USD (exact match)
- **DB Platinum IV Platow (LU0462954479)**: Rescued by ISIN Verification Pass
- **Known limitation**: Marshall Wace cross-ISIN name mismatch (abbreviated vs full name requires manual review)

---

## 19. Known Limitations

1. **GPT-4o Non-determinism**: Even with `temperature=0`, results vary between runs. The ISIN Verification Pass mitigates this but cannot guarantee 100% recall on every run.

2. **Cross-ISIN Name Matching**: When the same fund appears with abbreviated name (no ISIN) in one section and full name (with ISIN) in another, the name dedup may fail if the abbreviation is too different.

3. **Scanned PDFs**: OCR quality depends on scan resolution. Low-resolution scans may produce garbled ISIN codes that fail Luhn validation.

4. **Single Worker**: Docling + PyTorch consume significant RAM. Railway deployment runs with 1 Uvicorn worker, limiting concurrent requests.

5. **V1/V2 Asset Count Discrepancy**: V2 may classify some assets differently than V1 (e.g., distinguishing IIC from V differently), leading to minor count differences.

6. **No Persistent State**: The parser is stateless. Each request is independent. There is no caching of Docling conversions between V1 and V2 calls on the same document.

---

## 20. Version History

| Version | Date | Changes |
|---------|------|---------|
| v0.3.0 | 2026-03 | Initial release with pdfplumber |
| v0.5.0 | 2026-03 | Docling integration (Layout Heron + TableFormer + EasyOCR) |
| v0.7.0 | 2026-03 | Harvey AI cognitive engine (primary motor) |
| v0.7.4 | 2026-03 | Aduana Matemática: 5-layer dedup pipeline |
| v0.7.5 | 2026-03 | Account dedup (layer 6), cross-ISIN name dedup |
| v0.7.7 | 2026-03 | Smart ISIN SUM (multi-lot), amount-based secondary dedup (layer 7). **STABLE** |
| v0.8.0 | 2026-03 | V2 OpenAI engine: Structured Outputs, Map-Reduce, BOE schemas |
| v0.8.5 | 2026-03 | ISIN Verification Pass (rescue missing ISINs) |
| v0.8.6 | 2026-03 | Coverage Warnings: structured reporting for human review |

---

## Appendix A: System Prompt Engineering

Both engines use carefully crafted system prompts that encode domain knowledge:

### Key Prompt Rules (shared concept, different implementations)

1. **Only year-end positions** — ignore all intermediate transactions
2. **European number format** — 1.234.567,89 → 1234567.89
3. **ISIN exactness** — extract 12-char codes verbatim
4. **V vs I classification** — ETF priority rule (see Section 10)
5. **No aggregation lines** — filter portfolio subtotals
6. **Moneda original** — keep original currency, don't convert to EUR
7. **Country inference** — from ISIN prefix, address, or BIC/SWIFT
8. **Multi-lot extraction** — each lot as separate entry (dedup in post-processing)
9. **Completeness priority** — prefer over-extraction to missing assets
10. **FX exclusion** — exclude forex forwards/swaps/spots

### V2 Additional Rules

11. **Include zero-balance accounts** — AEAT requires all open accounts
12. **Include residual-value positions** — expired warrants, minimal NAV funds
13. **Multi-currency sections** — inherit currency from table/section context, not reporting currency

---

## Appendix B: Data Flow — Complete Pipeline

```
Frontend (720App)
  │
  ▼ Upload PDF to Supabase Storage
Supabase Edge Function (on-document-upload)
  │
  ▼ Download file, base64 encode
POST /parse-document (V1 — production pipeline)
  │
  ├─▶ Docling: PDF → Markdown
  │
  ├─▶ Harvey AI: Map-Reduce extraction
  │     ├─ Chunk 1 → Harvey API → M720ExtractionChunk
  │     ├─ Chunk 2 → Harvey API → M720ExtractionChunk
  │     └─ Chunk N → Harvey API → M720ExtractionChunk
  │
  ├─▶ Aduana Matemática: 7-layer dedup
  │
  ├─▶ Canonical Registry: ParsedRecord → CanonicalAssetRecord
  │
  ▼ Response: records[], asset_records[], structured_document
Frontend: extractAndClassify() → m720-classifier → m720_assets table
  │
  ▼ User reviews in Excel-like TanStack Table
  │
  ▼ Validation engine → issues table
  │
  ▼ TXT generator → AEAT-compliant file (ISO-8859-1, 500 chars/line, CR+LF)
```

---

*This document is the authoritative reference for the IRPF Parser Service architecture. Keep it updated with every version change.*
