import type { SupabaseClient } from "@supabase/supabase-js";
import type { AeatRecord } from "@/lib/aeat/format";
import type { ParsedRecord } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
import { rebuildExpedienteFiscalRuntime } from "@/lib/lots";

type JsonObject = Record<string, unknown>;
export type OperationSource = "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";

export type PersistedOperation = {
  id: string;
  expediente_id: string;
  document_id: string;
  operation_type: "DIVIDENDO" | "INTERES" | "COMPRA" | "VENTA" | "POSICION";
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  retention: number | null;
  realized_gain: number | null;
  source: OperationSource;
  confidence: number | null;
  origin_trace: JsonObject;
  manual_notes: string | null;
};

type PersistedOperationRow = {
  operation_type: string;
  operation_date: string;
  isin: string | null;
  quantity: number | string | null;
  realized_gain: number | string | null;
  description?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  retention?: number | string | null;
  origin_trace?: unknown;
  manual_notes?: string | null;
};

const PERSISTABLE_OPERATION_TYPES = new Set([
  "DIVIDENDO",
  "INTERES",
  "COMPRA",
  "VENTA",
  "POSICION"
]);

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = (payload as JsonObject)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = (payload as JsonObject)[key];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function coerceNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toOperationDate(candidate: string | null): string {
  const trimmed = candidate?.trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return new Date().toISOString().slice(0, 10);
}

function normalizeCurrency(candidate: string | null): string | null {
  return candidate?.trim().toUpperCase() || null;
}

function getFields(record: ParsedRecord | Record<string, unknown>): JsonObject {
  const candidate = (record as Record<string, unknown>).fields;
  return candidate && typeof candidate === "object" ? (candidate as JsonObject) : {};
}

function getConfidence(record: ParsedRecord | Record<string, unknown>): number | null {
  const candidate = (record as Record<string, unknown>).confidence;
  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? candidate : null;
  }
  return null;
}

function getSourceSpans(record: ParsedRecord | Record<string, unknown>): unknown[] {
  const candidate = (record as Record<string, unknown>).source_spans;
  return Array.isArray(candidate) ? candidate : [];
}

export function buildOperationsFromRecords(input: {
  records: Array<ParsedRecord | Record<string, unknown>>;
  expedienteId: string;
  documentId: string;
  source: OperationSource;
  manualNotes?: string | null;
  reviewedBy?: string | null;
}): PersistedOperation[] {
  return input.records
    .filter((record) => {
      const operationType = String((record as Record<string, unknown>).record_type ?? "");
      return PERSISTABLE_OPERATION_TYPES.has(operationType);
    })
    .map((record) => {
      const operationType = String(
        (record as Record<string, unknown>).record_type
      ) as PersistedOperation["operation_type"];
      const fields = getFields(record);
      const operationDate = toOperationDate(readString(fields, "operation_date"));
      const description = readString(fields, "description");
      const amount = readNumber(fields, "amount");
      const currency = normalizeCurrency(readString(fields, "currency"));
      const quantity = readNumber(fields, "quantity");
      const retention = readNumber(fields, "retention");
      const realizedGain = readNumber(fields, "realized_gain");

      return {
        id: crypto.randomUUID(),
        expediente_id: input.expedienteId,
        document_id: input.documentId,
        operation_type: operationType,
        operation_date: operationDate,
        isin: readString(fields, "isin"),
        description,
        amount,
        currency,
        quantity,
        retention,
        realized_gain: realizedGain,
        source: input.source,
        confidence: getConfidence(record),
        origin_trace: {
          fields,
          source_spans: getSourceSpans(record),
          reviewed_by: input.reviewedBy ?? null,
          manual_notes: input.manualNotes ?? null
        },
        manual_notes: input.manualNotes ?? null
      };
    });
}

export async function replaceDocumentOperations(
  supabase: SupabaseClient,
  documentId: string,
  expedienteId: string,
  operations: PersistedOperation[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from(dbTables.operations)
    .delete()
    .eq("document_id", documentId);

  if (deleteError) {
    throw new Error(`No se pudieron limpiar operaciones previas: ${deleteError.message}`);
  }

  if (operations.length === 0) {
    await rebuildExpedienteFiscalRuntime(supabase, expedienteId);
    await syncExpedienteWorkflowById(supabase, { expedienteId }).catch((error) => {
      console.error("No se pudo sincronizar workflow tras limpiar operaciones", error);
    });
    return;
  }

  const { error: insertError } = await supabase.from(dbTables.operations).insert(operations);
  if (insertError) {
    throw new Error(`No se pudieron persistir operaciones: ${insertError.message}`);
  }

  await rebuildExpedienteFiscalRuntime(supabase, expedienteId);
  await syncExpedienteWorkflowById(supabase, { expedienteId }).catch((error) => {
    console.error("No se pudo sincronizar workflow tras reemplazar operaciones", error);
  });
}

export function toAeatRecord(row: PersistedOperationRow): AeatRecord {
  const trace = row.origin_trace && typeof row.origin_trace === "object"
    ? (row.origin_trace as JsonObject)
    : {};
  const fields = trace.fields && typeof trace.fields === "object"
    ? (trace.fields as JsonObject)
    : {};

  const description = row.description ?? readString(fields, "description") ?? row.manual_notes ?? row.operation_type;
  const amount = coerceNumber(row.amount) ?? readNumber(fields, "amount");
  const currency = row.currency ?? readString(fields, "currency") ?? "EUR";
  const quantity = coerceNumber(row.quantity) ?? readNumber(fields, "quantity");
  const retention = coerceNumber(row.retention) ?? readNumber(fields, "retention");
  const realizedGain =
    coerceNumber(row.realized_gain) ??
    readNumber(fields, "realized_gain");

  return {
    isin: row.isin ?? readString(fields, "isin"),
    description,
    operation_date: row.operation_date,
    operation_type: row.operation_type,
    amount,
    currency,
    quantity,
    retention,
    realized_gain: realizedGain
  };
}
