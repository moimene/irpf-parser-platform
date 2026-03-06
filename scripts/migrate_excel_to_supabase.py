#!/usr/bin/env python3
"""
migrate_excel_to_supabase.py
============================
Migra los datos del Excel patrimonial (datosRPFFAGU2025.xlsx) a la tabla
irpf_patrimonio de Supabase.

Uso:
  SUPABASE_URL=https://xxx.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  CLIENT_ID=<uuid-del-cliente-en-irpf_clients> \
  python3 migrate_excel_to_supabase.py /ruta/al/datosRPFFAGU2025.xlsx

Requisitos:
  pip install openpyxl requests
"""

import os
import sys
import json
import re
import requests
import openpyxl
from datetime import datetime, date

# ─── Configuración ────────────────────────────────────────────────────────────

SUPABASE_URL          = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY  = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
CLIENT_ID             = os.environ.get("CLIENT_ID", "")
BATCH_SIZE            = 200   # Registros por batch de inserción

if not all([SUPABASE_URL, SUPABASE_SERVICE_KEY, CLIENT_ID]):
    print("ERROR: Faltan variables de entorno SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o CLIENT_ID")
    sys.exit(1)

EXCEL_PATH = sys.argv[1] if len(sys.argv) > 1 else "datosRPFFAGU2025.xlsx"

# ─── Mapeo de hojas a categorías ──────────────────────────────────────────────

SHEET_CATEGORY_MAP = {
    # Inventario / Posiciones
    "INVENTARIO": "inventario",
    "ACCIONES": "inventario",
    "CARTERA": "inventario",
    # Goldman Sachs
    "GS": "goldman",
    "GOLDMAN": "goldman",
    "GOLDMAN SACHS": "goldman",
    # Citi
    "CITI": "citi",
    "CITIBANK": "citi",
    "CITIGROUP": "citi",
    # J.P. Morgan
    "JPM": "jpmorgan",
    "JPMORGAN": "jpmorgan",
    "JP MORGAN": "jpmorgan",
    # Pictet
    "PICTET": "pictet",
    # Derivados
    "FORWARDS": "derivados",
    "DERIVADOS": "derivados",
    "OPCIONES": "derivados",
    # Inmuebles
    "INMUEBLES": "inmuebles",
    "ESPALTER": "inmuebles",
    "JOSELITO": "inmuebles",
    "TATO": "inmuebles",
    # Obras de Arte
    "ARTE": "obras_arte",
    "OBRAS": "obras_arte",
    "COLECCION": "obras_arte",
    # Private Equity
    "PE": "private_equity",
    "PRIVATE EQUITY": "private_equity",
    "FONDOS": "private_equity",
    # Tipos de cambio
    "TC": "tipos_cambio",
    "TIPOS": "tipos_cambio",
    "CAMBIO": "tipos_cambio",
    "FX": "tipos_cambio",
}

def detect_category(sheet_name: str) -> str:
    """Detecta la categoría patrimonial a partir del nombre de la hoja."""
    upper = sheet_name.upper()
    for key, cat in SHEET_CATEGORY_MAP.items():
        if key in upper:
            return cat
    return "inventario"  # fallback

def detect_ejercicio(sheet_name: str) -> int | None:
    """Extrae el año fiscal del nombre de la hoja si está presente."""
    match = re.search(r"(20\d{2})", sheet_name)
    return int(match.group(1)) if match else None

def serialize_value(v):
    """Convierte valores de celda a tipos JSON serializables."""
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, float):
        if v != v:  # NaN
            return None
        return v
    return v

def read_sheet(ws) -> tuple[list[str], list[dict]]:
    """Lee una hoja y devuelve (columnas, filas_como_dict)."""
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], []

    # Primera fila no vacía como cabecera
    header_idx = 0
    for i, row in enumerate(rows):
        if any(c is not None for c in row):
            header_idx = i
            break

    raw_headers = rows[header_idx]
    headers = []
    for i, h in enumerate(raw_headers):
        if h is None or str(h).strip() == "":
            headers.append(f"col_{i}")
        else:
            headers.append(str(h).strip())

    records = []
    for row in rows[header_idx + 1:]:
        if not any(c is not None for c in row):
            continue  # Saltar filas completamente vacías
        record = {}
        for col, val in zip(headers, row):
            record[col] = serialize_value(val)
        records.append(record)

    return headers, records

def supabase_upsert(table: str, rows: list[dict]) -> dict:
    """Inserta filas en Supabase vía REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    resp = requests.post(url, headers=headers, json=rows, timeout=30)
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Supabase error {resp.status_code}: {resp.text[:300]}")
    return {"inserted": len(rows)}

def upsert_hoja(client_id: str, categoria_id: str, nombre: str,
                ejercicio: int | None, columnas: list[str],
                num_filas: int, kpis: dict) -> None:
    """Registra los metadatos de la hoja en irpf_hojas."""
    url = f"{SUPABASE_URL}/rest/v1/irpf_hojas"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    payload = {
        "client_id":    client_id,
        "categoria_id": categoria_id,
        "nombre":       nombre,
        "ejercicio":    ejercicio,
        "num_filas":    num_filas,
        "columnas":     columnas,
        "kpis":         kpis,
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=15)
    if resp.status_code not in (200, 201):
        print(f"  WARN hoja upsert: {resp.status_code} {resp.text[:100]}")

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"Abriendo {EXCEL_PATH} ...")
    wb = openpyxl.load_workbook(EXCEL_PATH, read_only=True, data_only=True)
    sheets = wb.sheetnames
    print(f"  {len(sheets)} hojas encontradas")

    total_inserted = 0
    total_sheets   = 0

    for sheet_name in sheets:
        ws = wb[sheet_name]
        categoria_id = detect_category(sheet_name)
        ejercicio    = detect_ejercicio(sheet_name)

        print(f"\n[{sheet_name}] → {categoria_id} (ejercicio: {ejercicio})")

        try:
            columnas, records = read_sheet(ws)
        except Exception as e:
            print(f"  ERROR leyendo hoja: {e}")
            continue

        if not records:
            print(f"  Sin datos — omitida")
            continue

        print(f"  {len(records)} filas, {len(columnas)} columnas")

        # Preparar rows para irpf_patrimonio
        rows_to_insert = []
        for i, rec in enumerate(records):
            rows_to_insert.append({
                "client_id":    CLIENT_ID,
                "categoria_id": categoria_id,
                "hoja":         sheet_name,
                "ejercicio":    ejercicio,
                "fila":         i + 2,  # +2 por la cabecera y base 1
                "datos":        rec,
                "fuente":       "excel_manual",
            })

        # Insertar en batches
        inserted = 0
        for i in range(0, len(rows_to_insert), BATCH_SIZE):
            batch = rows_to_insert[i:i + BATCH_SIZE]
            try:
                result = supabase_upsert("irpf_patrimonio", batch)
                inserted += result["inserted"]
            except Exception as e:
                print(f"  ERROR batch {i//BATCH_SIZE + 1}: {e}")

        # Calcular KPIs básicos (sumas de columnas numéricas)
        kpis = {}
        for col in columnas[:10]:  # Solo primeras 10 columnas para KPIs
            vals = [r.get(col) for r in records if isinstance(r.get(col), (int, float))]
            if vals:
                kpis[col] = {"sum": sum(vals), "count": len(vals)}

        # Registrar metadatos de la hoja
        upsert_hoja(CLIENT_ID, categoria_id, sheet_name, ejercicio,
                    columnas, len(records), kpis)

        print(f"  Insertadas {inserted} filas")
        total_inserted += inserted
        total_sheets   += 1

    wb.close()
    print(f"\n{'='*50}")
    print(f"Migración completada: {total_sheets} hojas, {total_inserted} registros")
    print(f"Cliente ID: {CLIENT_ID}")

if __name__ == "__main__":
    main()
