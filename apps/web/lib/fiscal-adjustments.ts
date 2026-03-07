export type FiscalAdjustmentType =
  | "COST_BASIS"
  | "INHERITANCE"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

export type FiscalAdjustmentStatus = "ACTIVE" | "ARCHIVED";

export type JsonObject = Record<string, unknown>;

export type FiscalAdjustmentRow = {
  id: string;
  expediente_id: string;
  adjustment_type: FiscalAdjustmentType;
  status: FiscalAdjustmentStatus;
  target_operation_id: string | null;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | string | null;
  total_amount: number | string | null;
  currency: string | null;
  notes: string | null;
  metadata: JsonObject | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type FiscalAdjustmentTargetSnapshot = {
  operation_id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  amount: number | null;
  currency: string | null;
};

export type FiscalAdjustmentResponse = {
  id: string;
  adjustment_type: FiscalAdjustmentType;
  status: FiscalAdjustmentStatus;
  target_operation_id: string | null;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  total_amount: number | null;
  currency: string | null;
  notes: string | null;
  metadata: JsonObject | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export function toNullableNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeUppercase(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

export function readTargetSnapshot(metadata: JsonObject | null | undefined): FiscalAdjustmentTargetSnapshot | null {
  const candidate = metadata?.target_snapshot;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const row = candidate as Record<string, unknown>;
  const operationId = typeof row.operation_id === "string" ? row.operation_id : null;
  const operationType = typeof row.operation_type === "string" ? row.operation_type : null;
  const operationDate = typeof row.operation_date === "string" ? row.operation_date : null;

  if (!operationId || !operationType || !operationDate) {
    return null;
  }

  return {
    operation_id: operationId,
    operation_type: operationType,
    operation_date: operationDate,
    isin: typeof row.isin === "string" ? row.isin : null,
    description: typeof row.description === "string" ? row.description : null,
    quantity: toNullableNumber(row.quantity as number | string | null | undefined),
    amount: toNullableNumber(row.amount as number | string | null | undefined),
    currency: typeof row.currency === "string" ? row.currency : null
  };
}

export function buildTargetSnapshot(operation: {
  id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | string | null;
  amount: number | string | null;
  currency: string | null;
}): FiscalAdjustmentTargetSnapshot {
  return {
    operation_id: operation.id,
    operation_type: operation.operation_type,
    operation_date: operation.operation_date,
    isin: operation.isin,
    description: operation.description,
    quantity: toNullableNumber(operation.quantity),
    amount: toNullableNumber(operation.amount),
    currency: operation.currency
  };
}

export function serializeFiscalAdjustment(adjustment: FiscalAdjustmentRow): FiscalAdjustmentResponse {
  return {
    id: adjustment.id,
    adjustment_type: adjustment.adjustment_type,
    status: adjustment.status,
    target_operation_id: adjustment.target_operation_id,
    operation_date: adjustment.operation_date,
    isin: normalizeUppercase(adjustment.isin),
    description: adjustment.description,
    quantity: toNullableNumber(adjustment.quantity),
    total_amount: toNullableNumber(adjustment.total_amount),
    currency: normalizeUppercase(adjustment.currency),
    notes: adjustment.notes,
    metadata: adjustment.metadata,
    created_by: adjustment.created_by,
    updated_by: adjustment.updated_by,
    created_at: adjustment.created_at,
    updated_at: adjustment.updated_at ?? null
  };
}
