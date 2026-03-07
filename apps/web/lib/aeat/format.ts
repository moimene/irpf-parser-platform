/**
 * Generador de ficheros AEAT en formato de longitud fija.
 * Implementa los formatos de presentación telemática para:
 *   - Modelo 100 (IRPF) — Ganancias y pérdidas patrimoniales
 *   - Modelo 714 (IP) — Impuesto sobre el Patrimonio
 *   - Modelo 720 — Declaración de bienes en el extranjero
 *
 * Referencias:
 *   - Orden HAP/2215/2013 (Modelo 720)
 *   - Orden HAP/2194/2013 (Modelo 100)
 *   - Orden HAP/2055/2012 (Modelo 714)
 */

import {
  getAssetDisplayName,
  isForeignAssetRecord,
  supportsModel720,
  type CanonicalAssetRecord
} from "@/lib/asset-registry";

export interface AeatRecord {
  isin?: string | null;
  description?: string | null;
  operation_date?: string | null;
  amount?: number | null;
  currency?: string;
  quantity?: number | null;
  retention?: number | null;
  realized_gain?: number | null;
  operation_type?: string;
}

export type AeatAssetRecord = CanonicalAssetRecord;

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

function padLeft(value: string | number, length: number, char = " "): string {
  return String(value).padStart(length, char);
}

function padRight(value: string | number, length: number, char = " "): string {
  return String(value).padEnd(length, char);
}

function formatAmount(value: number | null | undefined, length = 13): string {
  if (value == null) return padLeft("0", length, "0");
  // Formato AEAT: sin punto decimal, últimos 2 dígitos son centavos
  const cents = Math.round(Math.abs(value) * 100);
  const sign = value < 0 ? "N" : " ";
  return sign + padLeft(cents.toString(), length - 1, "0");
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "00000000";
  // Convertir YYYY-MM-DD → DDMMYYYY
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2].padStart(2, "0")}${parts[1].padStart(2, "0")}${parts[0]}`;
  }
  return "00000000";
}

function formatNif(nif: string): string {
  return padRight(nif.toUpperCase().replace(/[^A-Z0-9]/g, ""), 9);
}

function currentYear(): string {
  return new Date().getFullYear().toString();
}

function formatPercentage(value: number | null | undefined): string {
  if (value == null) {
    return "00000";
  }

  const normalized = Math.max(0, Math.min(100, value));
  return padLeft(Math.round(normalized * 100), 5, "0");
}

function truncate(value: string | null | undefined, length: number): string {
  return padRight((value ?? "").slice(0, length), length);
}

function deriveAssetIdentifier(asset: AeatAssetRecord): string {
  return (
    asset.security?.security_identifier ??
    asset.collective_investment?.security_identifier ??
    asset.account?.account_code ??
    asset.real_estate?.cadastral_reference ??
    asset.movable?.registry_reference ??
    ""
  );
}

function deriveAssetQuantity(asset: AeatAssetRecord): number | null {
  return asset.security?.units ?? asset.collective_investment?.units ?? null;
}

// ---------------------------------------------------------------------------
// Modelo 100 — IRPF (Ganancias y pérdidas patrimoniales)
// Registro tipo 2 — Transmisiones de valores
// Longitud fija: 500 caracteres por registro
// ---------------------------------------------------------------------------

export function generateModel100(
  records: AeatRecord[],
  nif: string,
  ejercicio: string = currentYear()
): string {
  const lines: string[] = [];

  // Registro de cabecera (tipo 1)
  const header = [
    "1",                           // Tipo registro
    "100",                         // Modelo
    ejercicio,                     // Ejercicio
    formatNif(nif),                // NIF declarante
    padRight("IRPF PARSER AUTO", 40), // Nombre
    padLeft("", 446),              // Relleno
  ].join("");
  lines.push(header.slice(0, 500));

  // Registros de operaciones (tipo 2)
  const ventas = records.filter((r) => r.operation_type === "VENTA");

  ventas.forEach((rec, idx) => {
    const line = [
      "2",                                              // Tipo registro
      "100",                                            // Modelo
      ejercicio,                                        // Ejercicio
      formatNif(nif),                                   // NIF
      padLeft(idx + 1, 6, "0"),                        // Nº orden
      padRight(rec.isin ?? "", 12),                    // ISIN
      padRight(rec.description?.slice(0, 40) ?? "", 40), // Descripción
      formatDate(rec.operation_date),                   // Fecha operación
      formatAmount(rec.quantity),                       // Cantidad
      formatAmount(rec.amount),                         // Importe
      formatAmount(rec.realized_gain),                  // Ganancia/pérdida
      padRight(rec.currency ?? "EUR", 3),              // Divisa
      padLeft("", 400),                                 // Relleno
    ].join("");
    lines.push(line.slice(0, 500));
  });

  // Registro de totales (tipo 9)
  const totalGain = ventas.reduce((sum, r) => sum + (r.realized_gain ?? 0), 0);
  const footer = [
    "9",                           // Tipo registro
    "100",                         // Modelo
    ejercicio,                     // Ejercicio
    formatNif(nif),                // NIF
    padLeft(ventas.length, 9, "0"), // Total registros
    formatAmount(totalGain, 15),   // Total ganancia/pérdida
    padLeft("", 462),              // Relleno
  ].join("");
  lines.push(footer.slice(0, 500));

  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Modelo 714 — Impuesto sobre el Patrimonio
// Registro tipo 2 — Valores mobiliarios
// Longitud fija: 500 caracteres por registro
// ---------------------------------------------------------------------------

export function generateModel714(
  records: AeatRecord[],
  nif: string,
  ejercicio: string = currentYear()
): string {
  const lines: string[] = [];

  // Cabecera
  const header = [
    "1",
    "714",
    ejercicio,
    formatNif(nif),
    padRight("IP PARSER AUTO", 40),
    padLeft("", 443),
  ].join("");
  lines.push(header.slice(0, 500));

  // Posiciones (tipo 2)
  const posiciones = records.filter(
    (r) => r.operation_type === "POSICION" || r.operation_type === "COMPRA"
  );

  posiciones.forEach((rec, idx) => {
    const valorMercado = rec.amount ?? 0;
    const line = [
      "2",
      "714",
      ejercicio,
      formatNif(nif),
      padLeft(idx + 1, 6, "0"),
      padRight(rec.isin ?? "", 12),
      padRight(rec.description?.slice(0, 40) ?? "", 40),
      formatAmount(rec.quantity),
      formatAmount(valorMercado),
      padRight(rec.currency ?? "EUR", 3),
      padLeft("", 382),
    ].join("");
    lines.push(line.slice(0, 500));
  });

  // Total patrimonio
  const totalPatrimonio = posiciones.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const footer = [
    "9",
    "714",
    ejercicio,
    formatNif(nif),
    padLeft(posiciones.length, 9, "0"),
    formatAmount(totalPatrimonio, 15),
    padLeft("", 462),
  ].join("");
  lines.push(footer.slice(0, 500));

  return lines.join("\r\n") + "\r\n";
}

export function generateModel714FromAssets(
  assets: AeatAssetRecord[],
  nif: string,
  ejercicio: string = currentYear()
): string {
  const lines: string[] = [];

  const header = [
    "1",
    "714",
    ejercicio,
    formatNif(nif),
    padRight("IP ASSET REGISTRY", 40),
    padLeft("", 443)
  ].join("");
  lines.push(header.slice(0, 500));

  const positions = assets.filter((asset) => asset.location_key === "ES" || isForeignAssetRecord(asset));

  positions.forEach((asset, idx) => {
    const line = [
      "2",
      "714",
      ejercicio,
      formatNif(nif),
      padLeft(idx + 1, 6, "0"),
      truncate(deriveAssetIdentifier(asset), 12),
      truncate(getAssetDisplayName(asset), 40),
      formatAmount(deriveAssetQuantity(asset)),
      formatAmount(asset.valuation_1_eur),
      padRight(asset.currency ?? "EUR", 3),
      padLeft("", 382)
    ].join("");
    lines.push(line.slice(0, 500));
  });

  const totalPatrimonio = positions.reduce((sum, asset) => sum + asset.valuation_1_eur, 0);
  const footer = [
    "9",
    "714",
    ejercicio,
    formatNif(nif),
    padLeft(positions.length, 9, "0"),
    formatAmount(totalPatrimonio, 15),
    padLeft("", 462)
  ].join("");
  lines.push(footer.slice(0, 500));

  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Modelo 720 — Bienes en el extranjero
// Registro tipo 2 — Cuentas y valores en entidades financieras extranjeras
// Longitud fija: 500 caracteres por registro
// ---------------------------------------------------------------------------

export function generateModel720(
  records: AeatRecord[],
  nif: string,
  ejercicio: string = currentYear()
): string {
  const lines: string[] = [];

  // Cabecera
  const header = [
    "1",
    "720",
    ejercicio,
    formatNif(nif),
    padRight("720 PARSER AUTO", 40),
    padLeft("", 443),
  ].join("");
  lines.push(header.slice(0, 500));

  // Todos los registros con ISIN (valores extranjeros)
  const extranjeros = records.filter(
    (r) => r.isin && !r.isin.startsWith("ES")
  );

  extranjeros.forEach((rec, idx) => {
    const valorSaldo = rec.amount ?? 0;
    // Clave de tipo de bien: V = valores, C = cuentas
    const claveBien = "V";
    const line = [
      "2",
      "720",
      ejercicio,
      formatNif(nif),
      padLeft(idx + 1, 6, "0"),
      claveBien,                                        // Clave tipo bien
      padRight(rec.isin ?? "", 12),                    // ISIN / identificador
      padRight(rec.description?.slice(0, 40) ?? "", 40), // Descripción
      formatAmount(rec.quantity),                       // Número de títulos
      formatAmount(valorSaldo),                         // Saldo/valor
      padRight(rec.currency ?? "USD", 3),              // Divisa
      formatDate(rec.operation_date),                   // Fecha adquisición
      padLeft("", 368),                                 // Relleno
    ].join("");
    lines.push(line.slice(0, 500));
  });

  // Totales
  const totalSaldo = extranjeros.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const footer = [
    "9",
    "720",
    ejercicio,
    formatNif(nif),
    padLeft(extranjeros.length, 9, "0"),
    formatAmount(totalSaldo, 15),
    padLeft("", 462),
  ].join("");
  lines.push(footer.slice(0, 500));

  return lines.join("\r\n") + "\r\n";
}

export function generateModel720FromAssets(
  assets: AeatAssetRecord[],
  nif: string,
  ejercicio: string = currentYear()
): string {
  const lines: string[] = [];

  const header = [
    "1",
    "720",
    ejercicio,
    formatNif(nif),
    padRight("720 ASSET REGISTRY", 40),
    padLeft("", 443)
  ].join("");
  lines.push(header.slice(0, 500));

  const foreignAssets = assets.filter((asset) => supportsModel720(asset) && isForeignAssetRecord(asset));

  foreignAssets.forEach((asset, idx) => {
    const line = [
      "2",
      "720",
      ejercicio,
      formatNif(nif),
      padLeft(idx + 1, 6, "0"),
      asset.asset_key,
      asset.asset_subkey,
      padRight(asset.country_code, 2),
      truncate(deriveAssetIdentifier(asset), 34),
      truncate(getAssetDisplayName(asset), 60),
      formatDate(asset.incorporation_date),
      formatAmount(asset.valuation_1_eur, 15),
      formatAmount(asset.valuation_2_eur, 15),
      formatPercentage(asset.ownership_percentage),
      padLeft("", 345)
    ].join("");
    lines.push(line.slice(0, 500));
  });

  const totalSaldo = foreignAssets.reduce((sum, asset) => sum + asset.valuation_1_eur, 0);
  const footer = [
    "9",
    "720",
    ejercicio,
    formatNif(nif),
    padLeft(foreignAssets.length, 9, "0"),
    formatAmount(totalSaldo, 15),
    padLeft("", 462)
  ].join("");
  lines.push(footer.slice(0, 500));

  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function generateAeatFile(
  model: "100" | "714" | "720",
  records: AeatRecord[],
  nif: string,
  ejercicio?: string
): string {
  switch (model) {
    case "100":
      return generateModel100(records, nif, ejercicio);
    case "714":
      return generateModel714(records, nif, ejercicio);
    case "720":
      return generateModel720(records, nif, ejercicio);
  }
}

export function generateAeatAssetFile(
  model: "714" | "720",
  assets: AeatAssetRecord[],
  nif: string,
  ejercicio?: string
): string {
  switch (model) {
    case "714":
      return generateModel714FromAssets(assets, nif, ejercicio);
    case "720":
      return generateModel720FromAssets(assets, nif, ejercicio);
  }
}
