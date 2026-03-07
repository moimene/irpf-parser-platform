import type { SupabaseClient } from "@supabase/supabase-js";
import { dbTables } from "@/lib/db-tables";

type JsonObject = Record<string, unknown>;

type OperationSource = "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";

type OperationRow = {
  id: string;
  expediente_id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | string | null;
  amount: number | string | null;
  currency: string | null;
  realized_gain: number | string | null;
  source: OperationSource;
  manual_notes: string | null;
  created_at?: string;
};

export type PersistedLot = {
  id: string;
  expediente_id: string;
  acquisition_operation_id: string;
  isin: string;
  description: string | null;
  acquisition_date: string;
  quantity_original: number;
  quantity_open: number;
  quantity_sold: number;
  unit_cost: number | null;
  total_cost: number | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
  source: OperationSource;
  metadata: JsonObject;
};

export type LotDerivationIssue = {
  code: string;
  operation_id: string;
  message: string;
  isin?: string | null;
  quantity?: number | null;
};

type MutableLot = PersistedLot & {
  metadata: {
    sales: Array<{
      operation_id: string;
      operation_date: string;
      quantity: number;
      proceeds: number | null;
      realized_gain: number | null;
    }>;
  };
};

function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeCurrency(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function roundValue(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function operationPriority(operationType: string): number {
  if (operationType === "COMPRA") {
    return 0;
  }

  if (operationType === "VENTA") {
    return 1;
  }

  return 2;
}

export function deriveLotsFromOperations(input: {
  expedienteId: string;
  operations: OperationRow[];
}): { lots: PersistedLot[]; issues: LotDerivationIssue[] } {
  const sortedOperations = [...input.operations].sort((left, right) => {
    const byDate =
      new Date(left.operation_date).getTime() - new Date(right.operation_date).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    const byPriority = operationPriority(left.operation_type) - operationPriority(right.operation_type);
    if (byPriority !== 0) {
      return byPriority;
    }

    const leftCreated = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightCreated = right.created_at ? new Date(right.created_at).getTime() : 0;
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    return left.id.localeCompare(right.id);
  });

  const lotsByIsin = new Map<string, MutableLot[]>();
  const issues: LotDerivationIssue[] = [];

  for (const operation of sortedOperations) {
    if (!operation.isin?.trim()) {
      if (operation.operation_type === "COMPRA" || operation.operation_type === "VENTA") {
        issues.push({
          code: "missing_isin",
          operation_id: operation.id,
          message: `Operación ${operation.operation_type} sin ISIN; se excluye del runtime de lotes.`
        });
      }
      continue;
    }

    const isin = operation.isin.trim().toUpperCase();
    const quantity = Math.abs(toNumber(operation.quantity) ?? 0);
    if (quantity <= 0) {
      if (operation.operation_type === "COMPRA" || operation.operation_type === "VENTA") {
        issues.push({
          code: "missing_quantity",
          operation_id: operation.id,
          isin,
          message: `Operación ${operation.operation_type} de ${isin} sin cantidad válida; se excluye del runtime de lotes.`
        });
      }
      continue;
    }

    if (operation.operation_type === "COMPRA") {
      const totalCost = toNumber(operation.amount);
      const normalizedTotalCost =
        totalCost === null ? null : roundValue(Math.abs(totalCost), 4);
      const unitCost =
        normalizedTotalCost === null ? null : roundValue(normalizedTotalCost / quantity, 8);
      const lot: MutableLot = {
        id: crypto.randomUUID(),
        expediente_id: input.expedienteId,
        acquisition_operation_id: operation.id,
        isin,
        description: operation.description ?? operation.manual_notes ?? null,
        acquisition_date: operation.operation_date,
        quantity_original: roundValue(quantity, 6),
        quantity_open: roundValue(quantity, 6),
        quantity_sold: 0,
        unit_cost: unitCost,
        total_cost: normalizedTotalCost,
        currency: normalizeCurrency(operation.currency),
        status: "OPEN",
        source: operation.source,
        metadata: {
          sales: []
        }
      };

      const existingLots = lotsByIsin.get(isin) ?? [];
      existingLots.push(lot);
      lotsByIsin.set(isin, existingLots);
      continue;
    }

    if (operation.operation_type !== "VENTA") {
      continue;
    }

    const existingLots = lotsByIsin.get(isin) ?? [];
    let remaining = quantity;

    for (const lot of existingLots) {
      if (remaining <= 0) {
        break;
      }

      if (lot.quantity_open <= 0) {
        continue;
      }

      const allocatedQuantity = Math.min(remaining, lot.quantity_open);
      lot.quantity_open = roundValue(lot.quantity_open - allocatedQuantity, 6);
      lot.quantity_sold = roundValue(lot.quantity_sold + allocatedQuantity, 6);
      lot.metadata.sales.push({
        operation_id: operation.id,
        operation_date: operation.operation_date,
        quantity: roundValue(allocatedQuantity, 6),
        proceeds: toNumber(operation.amount),
        realized_gain: toNumber(operation.realized_gain)
      });
      remaining = roundValue(remaining - allocatedQuantity, 6);
    }

    if (remaining > 0) {
      issues.push({
        code: "sell_without_available_lots",
        operation_id: operation.id,
        isin,
        quantity: remaining,
        message: `Venta de ${isin} sin lotes suficientes para cubrir ${remaining} títulos.`
      });
    }
  }

  const lots = [...lotsByIsin.values()]
    .flat()
    .map(
      (lot): PersistedLot => ({
        ...lot,
        quantity_open: roundValue(lot.quantity_open, 6),
        quantity_sold: roundValue(lot.quantity_sold, 6),
        status: lot.quantity_open > 0 ? "OPEN" : "CLOSED"
      })
    )
    .sort((left, right) => {
      const byDate =
        new Date(left.acquisition_date).getTime() - new Date(right.acquisition_date).getTime();
      if (byDate !== 0) {
        return byDate;
      }

      return left.id.localeCompare(right.id);
    });

  return { lots, issues };
}

export async function rebuildExpedienteLots(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<void> {
  const { data: operations, error: operationsError } = await supabase
    .from(dbTables.operations)
    .select(
      "id, expediente_id, operation_type, operation_date, isin, description, quantity, amount, currency, realized_gain, source, manual_notes, created_at"
    )
    .eq("expediente_id", expedienteId)
    .order("operation_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (operationsError) {
    throw new Error(`No se pudieron cargar operaciones para recalcular lotes: ${operationsError.message}`);
  }

  const { lots } = deriveLotsFromOperations({
    expedienteId,
    operations: (operations ?? []) as OperationRow[]
  });

  const { error: deleteError } = await supabase
    .from(dbTables.lots)
    .delete()
    .eq("expediente_id", expedienteId);

  if (deleteError) {
    throw new Error(`No se pudieron limpiar lotes previos: ${deleteError.message}`);
  }

  if (lots.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from(dbTables.lots).insert(lots);
  if (insertError) {
    throw new Error(`No se pudieron persistir lotes derivados: ${insertError.message}`);
  }
}
