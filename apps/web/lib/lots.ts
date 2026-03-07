import type { SupabaseClient } from "@supabase/supabase-js";
import { detectBlockedLosses, type TradeEvent } from "@/lib/rules-core";
import { dbTables } from "@/lib/db-tables";
import {
  normalizeUppercase,
  readTargetSnapshot,
  toNullableNumber,
  type FiscalAdjustmentRow
} from "@/lib/fiscal-adjustments";

type JsonObject = Record<string, unknown>;

export type OperationSource = "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";

export type RuntimeOperationRow = {
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
  acquisition_operation_id: string | null;
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

export type PersistedSaleAllocation = {
  id: string;
  expediente_id: string;
  sale_operation_id: string;
  lot_id: string;
  acquisition_operation_id: string | null;
  isin: string;
  sale_date: string;
  acquisition_date: string;
  quantity: number;
  sale_unit_price: number | null;
  sale_amount_allocated: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  realized_gain: number | null;
  currency: string | null;
  source: OperationSource;
  metadata: JsonObject;
};

export type PersistedSaleAllocationRow = {
  sale_operation_id: string;
  quantity: number | string;
  sale_amount_allocated: number | string | null;
  total_cost: number | string | null;
  realized_gain: number | string | null;
  acquisition_date: string;
  acquisition_operation_id?: string | null;
  currency?: string | null;
};

export type FiscalSaleStatus =
  | "MATCHED"
  | "UNRESOLVED"
  | "PENDING_COST_BASIS"
  | "INVALID_DATA";

export type FiscalSaleSummary = {
  sale_operation_id: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  sale_amount: number | null;
  sale_amount_allocated: number | null;
  quantity_allocated: number;
  missing_quantity: number;
  cost_basis: number | null;
  realized_gain: number | null;
  reported_realized_gain: number | null;
  currency: string | null;
  allocations_count: number;
  status: FiscalSaleStatus;
  source: OperationSource;
};

export type FiscalRuntimeIssue = {
  code: string;
  operation_id: string;
  message: string;
  isin?: string | null;
  quantity?: number | null;
};

export type FiscalBlockedLoss = {
  sale_operation_id: string;
  blocked_by_buy_operation_id: string;
  isin: string;
  sale_date: string;
  blocked_by_buy_date: string;
  window_months: number;
  sale_quantity: number;
  blocked_by_buy_quantity: number;
  realized_loss: number | null;
  currency: string | null;
  reason: string;
  sale_description: string | null;
  blocked_by_buy_description: string | null;
  sale_source: OperationSource;
  blocked_by_buy_source: OperationSource;
};

export type DerivedFiscalRuntime = {
  lots: PersistedLot[];
  allocations: PersistedSaleAllocation[];
  saleSummaries: FiscalSaleSummary[];
  blockedLosses: FiscalBlockedLoss[];
  issues: FiscalRuntimeIssue[];
};

type MutableLot = PersistedLot & {
  metadata: {
    sales: Array<{
      allocation_id: string;
      sale_operation_id: string;
      operation_date: string;
      quantity: number;
      sale_amount_allocated: number | null;
      total_cost: number | null;
      realized_gain: number | null;
    }>;
    transfers_out?: Array<{
      adjustment_id: string;
      operation_date: string;
      quantity: number;
      description: string | null;
    }>;
    acquisition_origin?: string;
    adjustment_id?: string;
    target_operation_id?: string | null;
  };
};

type RuntimeEvent =
  | {
      kind: "operation";
      operation: RuntimeOperationRow;
    }
  | {
      kind: "transfer_out";
      adjustment: FiscalAdjustmentRow;
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

function toPositiveAmount(value: number | string | null | undefined): number | null {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.abs(parsed);
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

function sortOperations(left: RuntimeOperationRow, right: RuntimeOperationRow): number {
  const byDate = new Date(left.operation_date).getTime() - new Date(right.operation_date).getTime();
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
}

function sumNumbers(values: Array<number | null>): number | null {
  if (values.length === 0) {
    return null;
  }

  if (values.some((value) => value === null)) {
    return null;
  }

  const numericValues = values.filter((value): value is number => value !== null);
  return roundValue(
    numericValues.reduce((sum, value) => sum + value, 0),
    4
  );
}

function sortAdjustments(left: FiscalAdjustmentRow, right: FiscalAdjustmentRow): number {
  const byDate = new Date(left.operation_date).getTime() - new Date(right.operation_date).getTime();
  if (byDate !== 0) {
    return byDate;
  }

  const leftCreated = left.created_at ? new Date(left.created_at).getTime() : 0;
  const rightCreated = right.created_at ? new Date(right.created_at).getTime() : 0;
  if (leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }

  return left.id.localeCompare(right.id);
}

function runtimeEventPriority(event: RuntimeEvent): number {
  if (event.kind === "transfer_out") {
    return 1;
  }

  return operationPriority(event.operation.operation_type) === 1 ? 2 : operationPriority(event.operation.operation_type);
}

function sortRuntimeEvents(left: RuntimeEvent, right: RuntimeEvent): number {
  const leftDate =
    left.kind === "transfer_out" ? left.adjustment.operation_date : left.operation.operation_date;
  const rightDate =
    right.kind === "transfer_out" ? right.adjustment.operation_date : right.operation.operation_date;
  const byDate = new Date(leftDate).getTime() - new Date(rightDate).getTime();
  if (byDate !== 0) {
    return byDate;
  }

  const byPriority = runtimeEventPriority(left) - runtimeEventPriority(right);
  if (byPriority !== 0) {
    return byPriority;
  }

  const leftCreated =
    left.kind === "transfer_out"
      ? (left.adjustment.created_at ? new Date(left.adjustment.created_at).getTime() : 0)
      : (left.operation.created_at ? new Date(left.operation.created_at).getTime() : 0);
  const rightCreated =
    right.kind === "transfer_out"
      ? (right.adjustment.created_at ? new Date(right.adjustment.created_at).getTime() : 0)
      : (right.operation.created_at ? new Date(right.operation.created_at).getTime() : 0);
  if (leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }

  const leftId = left.kind === "transfer_out" ? left.adjustment.id : left.operation.id;
  const rightId = right.kind === "transfer_out" ? right.adjustment.id : right.operation.id;
  return leftId.localeCompare(rightId);
}

function buildAdjustmentIssue(
  adjustment: FiscalAdjustmentRow,
  code: string,
  message: string,
  quantity?: number | null
): FiscalRuntimeIssue {
  return {
    code,
    operation_id: adjustment.id,
    isin: normalizeUppercase(adjustment.isin),
    quantity,
    message
  };
}

function sameNullableNumber(left: number | null, right: number | null, tolerance = 0.000001): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return Math.abs(left - right) <= tolerance;
}

function resolveCostBasisTargetOperation(
  operations: RuntimeOperationRow[],
  adjustment: FiscalAdjustmentRow
): RuntimeOperationRow | null {
  const directTarget = operations.find(
    (operation) => operation.id === adjustment.target_operation_id && operation.operation_type === "COMPRA"
  );

  if (directTarget) {
    return directTarget;
  }

  const snapshot = readTargetSnapshot(adjustment.metadata);
  if (!snapshot) {
    return null;
  }

  return (
    operations.find((operation) => {
      if (operation.operation_type !== "COMPRA") {
        return false;
      }

      if (normalizeUppercase(operation.isin) !== normalizeUppercase(snapshot.isin)) {
        return false;
      }

      if (operation.operation_date !== snapshot.operation_date) {
        return false;
      }

      if (!sameNullableNumber(toNumber(operation.quantity), snapshot.quantity)) {
        return false;
      }

      return true;
    }) ?? null
  );
}

function applyFiscalAdjustmentsToOperations(input: {
  expedienteId: string;
  operations: RuntimeOperationRow[];
  adjustments: FiscalAdjustmentRow[];
}): { operations: RuntimeOperationRow[]; transferOutAdjustments: FiscalAdjustmentRow[]; issues: FiscalRuntimeIssue[] } {
  const activeAdjustments = [...input.adjustments]
    .filter((adjustment) => adjustment.status === "ACTIVE")
    .sort(sortAdjustments);
  const issues: FiscalRuntimeIssue[] = [];
  const operations = input.operations.map((operation) => ({ ...operation }));
  const syntheticOperations: RuntimeOperationRow[] = [];
  const transferOutAdjustments: FiscalAdjustmentRow[] = [];

  for (const adjustment of activeAdjustments) {
    if (adjustment.adjustment_type === "COST_BASIS") {
      const target = resolveCostBasisTargetOperation(operations, adjustment);
      if (!target) {
        issues.push(
          buildAdjustmentIssue(
            adjustment,
            "adjustment_target_not_found",
            "El ajuste manual de coste no encontró una compra origen sobre la que aplicarse."
          )
        );
        continue;
      }

      const resolvedQuantity = toNumber(adjustment.quantity) ?? toNumber(target.quantity);
      if (resolvedQuantity === null || Math.abs(resolvedQuantity) <= 0) {
        issues.push(
          buildAdjustmentIssue(
            adjustment,
            "adjustment_invalid_quantity",
            "El ajuste manual de coste requiere una cantidad válida mayor que cero."
          )
        );
        continue;
      }

      target.operation_date = adjustment.operation_date;
      target.isin = normalizeUppercase(adjustment.isin) ?? target.isin;
      target.description = adjustment.description ?? target.description;
      target.quantity = roundValue(Math.abs(resolvedQuantity), 6);
      target.amount = toNullableNumber(adjustment.total_amount) ?? target.amount;
      target.currency = normalizeCurrency(adjustment.currency ?? target.currency);
      target.source = "MANUAL";
      target.manual_notes = adjustment.notes ?? target.manual_notes;
      continue;
    }

    if (adjustment.adjustment_type === "TRANSFER_OUT") {
      transferOutAdjustments.push(adjustment);
      continue;
    }

    const quantity = toNumber(adjustment.quantity);
    if (quantity === null || Math.abs(quantity) <= 0) {
      issues.push(
        buildAdjustmentIssue(
          adjustment,
          "adjustment_invalid_quantity",
          "El ajuste manual requiere una cantidad válida mayor que cero."
        )
      );
      continue;
    }

    const isin = normalizeUppercase(adjustment.isin);
    if (!isin) {
      issues.push(
        buildAdjustmentIssue(
          adjustment,
          "adjustment_missing_isin",
          "El ajuste manual requiere ISIN para incorporarse al runtime fiscal."
        )
      );
      continue;
    }

    syntheticOperations.push({
      id: adjustment.id,
      expediente_id: input.expedienteId,
      operation_type: "COMPRA",
      operation_date: adjustment.operation_date,
      isin,
      description: adjustment.description ?? adjustment.adjustment_type,
      quantity: roundValue(Math.abs(quantity), 6),
      amount: toNullableNumber(adjustment.total_amount),
      currency: normalizeCurrency(adjustment.currency),
      realized_gain: null,
      source: "MANUAL",
      manual_notes: adjustment.notes,
      created_at: adjustment.created_at
    });
  }

  return {
    operations: [...operations, ...syntheticOperations].sort(sortOperations),
    transferOutAdjustments: transferOutAdjustments.sort(sortAdjustments),
    issues
  };
}

export function summarizeSalesFromOperations(input: {
  operations: RuntimeOperationRow[];
  allocations: PersistedSaleAllocationRow[];
}): FiscalSaleSummary[] {
  const allocationsBySale = new Map<string, PersistedSaleAllocationRow[]>();

  for (const allocation of input.allocations) {
    const current = allocationsBySale.get(allocation.sale_operation_id) ?? [];
    current.push(allocation);
    allocationsBySale.set(allocation.sale_operation_id, current);
  }

  return [...input.operations]
    .filter((operation) => operation.operation_type === "VENTA")
    .sort(sortOperations)
    .map((operation) => {
      const saleQuantity = toNumber(operation.quantity);
      const normalizedQuantity = saleQuantity === null ? null : roundValue(Math.abs(saleQuantity), 6);
      const saleAmount = toPositiveAmount(operation.amount);
      const allocations = allocationsBySale.get(operation.id) ?? [];
      const quantityAllocated = roundValue(
        allocations.reduce((sum, allocation) => sum + Math.abs(toNumber(allocation.quantity) ?? 0), 0),
        6
      );
      const missingQuantity =
        normalizedQuantity === null ? 0 : roundValue(Math.max(normalizedQuantity - quantityAllocated, 0), 6);

      const saleAmountAllocated = sumNumbers(
        allocations.map((allocation) => {
          const value = toNumber(allocation.sale_amount_allocated);
          return value === null ? null : roundValue(Math.abs(value), 4);
        })
      );
      const costBasis = sumNumbers(
        allocations.map((allocation) => {
          const value = toNumber(allocation.total_cost);
          return value === null ? null : roundValue(Math.abs(value), 4);
        })
      );
      const realizedGain = sumNumbers(
        allocations.map((allocation) => {
          const value = toNumber(allocation.realized_gain);
          return value === null ? null : roundValue(value, 4);
        })
      );

      let status: FiscalSaleStatus = "MATCHED";
      if (!operation.isin?.trim() || normalizedQuantity === null || normalizedQuantity <= 0) {
        status = "INVALID_DATA";
      } else if (missingQuantity > 0) {
        status = "UNRESOLVED";
      } else if (saleAmount === null || costBasis === null || realizedGain === null || saleAmountAllocated === null) {
        status = "PENDING_COST_BASIS";
      }

      return {
        sale_operation_id: operation.id,
        operation_date: operation.operation_date,
        isin: operation.isin?.trim().toUpperCase() ?? null,
        description: operation.description ?? operation.manual_notes ?? null,
        quantity: normalizedQuantity,
        sale_amount: saleAmount,
        sale_amount_allocated: saleAmountAllocated,
        quantity_allocated: quantityAllocated,
        missing_quantity: missingQuantity,
        cost_basis: costBasis,
        realized_gain: status === "MATCHED" ? realizedGain : null,
        reported_realized_gain: toNumber(operation.realized_gain),
        currency: normalizeCurrency(operation.currency),
        allocations_count: allocations.length,
        status,
        source: operation.source
      };
    });
}

export function buildTradeEventsFromFiscalRuntime(input: {
  operations: RuntimeOperationRow[];
  saleSummaries: FiscalSaleSummary[];
}): TradeEvent[] {
  const summaryBySaleId = new Map(
    input.saleSummaries.map((summary) => [summary.sale_operation_id, summary])
  );

  return [...input.operations]
    .filter(
      (operation) => operation.operation_type === "COMPRA" || operation.operation_type === "VENTA"
    )
    .sort(sortOperations)
    .flatMap<TradeEvent>((operation) => {
      const isin = operation.isin?.trim().toUpperCase();
      const quantity = toNumber(operation.quantity);
      if (!isin || quantity === null || Math.abs(quantity) <= 0) {
        return [];
      }

      if (operation.operation_type === "COMPRA") {
        return [
          {
            id: operation.id,
            isin,
            type: "BUY" as const,
            tradeDate: operation.operation_date,
            quantity: roundValue(Math.abs(quantity), 6),
            assetKind: "LISTED" as const
          }
        ];
      }

      const summary = summaryBySaleId.get(operation.id);
      return [
        {
          id: operation.id,
          isin,
          type: "SELL" as const,
          tradeDate: operation.operation_date,
          quantity: roundValue(Math.abs(quantity), 6),
          gainLossEur: summary?.realized_gain ?? undefined,
          assetKind: "LISTED" as const
        }
      ];
    });
}

export function detectBlockedLossesFromFiscalRuntime(input: {
  operations: RuntimeOperationRow[];
  saleSummaries: FiscalSaleSummary[];
}): FiscalBlockedLoss[] {
  const operationById = new Map(input.operations.map((operation) => [operation.id, operation]));
  const saleSummaryById = new Map(
    input.saleSummaries.map((summary) => [summary.sale_operation_id, summary])
  );

  return detectBlockedLosses(
    buildTradeEventsFromFiscalRuntime({
      operations: input.operations,
      saleSummaries: input.saleSummaries
    })
  )
    .flatMap<FiscalBlockedLoss>((blockedLoss) => {
      const saleOperation = operationById.get(blockedLoss.sellEventId);
      const buyOperation = operationById.get(blockedLoss.blockedByBuyEventId);

      if (!saleOperation || !buyOperation || !saleOperation.isin?.trim()) {
        return [];
      }

      const saleSummary = saleSummaryById.get(blockedLoss.sellEventId);
      const realizedGain = saleSummary?.realized_gain ?? toNumber(saleOperation.realized_gain);
      const realizedLoss =
        realizedGain !== null && realizedGain < 0 ? roundValue(Math.abs(realizedGain), 4) : null;

      return [
        {
          sale_operation_id: saleOperation.id,
          blocked_by_buy_operation_id: buyOperation.id,
          isin: saleOperation.isin.trim().toUpperCase(),
          sale_date: saleOperation.operation_date,
          blocked_by_buy_date: buyOperation.operation_date,
          window_months: blockedLoss.windowMonths,
          sale_quantity: roundValue(Math.abs(toNumber(saleOperation.quantity) ?? 0), 6),
          blocked_by_buy_quantity: roundValue(Math.abs(toNumber(buyOperation.quantity) ?? 0), 6),
          realized_loss: realizedLoss,
          currency: normalizeCurrency(saleSummary?.currency ?? saleOperation.currency ?? buyOperation.currency),
          reason: blockedLoss.reason,
          sale_description: saleSummary?.description ?? saleOperation.description ?? saleOperation.manual_notes ?? null,
          blocked_by_buy_description:
            buyOperation.description ?? buyOperation.manual_notes ?? null,
          sale_source: saleOperation.source,
          blocked_by_buy_source: buyOperation.source
        }
      ];
    })
    .sort((left, right) => {
      const bySaleDate = new Date(left.sale_date).getTime() - new Date(right.sale_date).getTime();
      if (bySaleDate !== 0) {
        return bySaleDate;
      }

      const byBuyDate =
        new Date(left.blocked_by_buy_date).getTime() - new Date(right.blocked_by_buy_date).getTime();
      if (byBuyDate !== 0) {
        return byBuyDate;
      }

      return left.sale_operation_id.localeCompare(right.sale_operation_id);
    });
}

export function deriveFiscalRuntimeFromOperations(input: {
  expedienteId: string;
  operations: RuntimeOperationRow[];
  adjustments?: FiscalAdjustmentRow[];
}): DerivedFiscalRuntime {
  const adjustedRuntime = applyFiscalAdjustmentsToOperations({
    expedienteId: input.expedienteId,
    operations: input.operations,
    adjustments: input.adjustments ?? []
  });
  const sortedOperations = adjustedRuntime.operations;
  const lotsByIsin = new Map<string, MutableLot[]>();
  const allocations: PersistedSaleAllocation[] = [];
  const issues: FiscalRuntimeIssue[] = [...adjustedRuntime.issues];
  const runtimeEvents: RuntimeEvent[] = [
    ...sortedOperations.map((operation) => ({ kind: "operation" as const, operation })),
    ...adjustedRuntime.transferOutAdjustments.map((adjustment) => ({
      kind: "transfer_out" as const,
      adjustment
    }))
  ].sort(sortRuntimeEvents);

  for (const runtimeEvent of runtimeEvents) {
    if (runtimeEvent.kind === "transfer_out") {
      const adjustment = runtimeEvent.adjustment;
      const isin = normalizeUppercase(adjustment.isin);
      const quantity = Math.abs(toNumber(adjustment.quantity) ?? 0);

      if (!isin) {
        issues.push(
          buildAdjustmentIssue(
            adjustment,
            "transfer_out_missing_isin",
            "La transferencia de salida requiere ISIN para aplicarse al runtime fiscal."
          )
        );
        continue;
      }

      if (quantity <= 0) {
        issues.push(
          buildAdjustmentIssue(
            adjustment,
            "transfer_out_invalid_quantity",
            "La transferencia de salida requiere una cantidad válida mayor que cero."
          )
        );
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

        const transferredQuantity = roundValue(Math.min(remaining, lot.quantity_open), 6);
        lot.quantity_open = roundValue(lot.quantity_open - transferredQuantity, 6);
        lot.quantity_sold = roundValue(lot.quantity_sold + transferredQuantity, 6);
        lot.metadata.transfers_out = lot.metadata.transfers_out ?? [];
        lot.metadata.transfers_out.push({
          adjustment_id: adjustment.id,
          operation_date: adjustment.operation_date,
          quantity: transferredQuantity,
          description: adjustment.description ?? adjustment.notes ?? null
        });
        remaining = roundValue(remaining - transferredQuantity, 6);
      }

      if (remaining > 0) {
        issues.push(
          buildAdjustmentIssue(
            adjustment,
            "transfer_out_without_available_lots",
            `La transferencia de salida de ${isin} no tiene lotes suficientes para cubrir ${remaining} títulos.`,
            remaining
          )
        );
      }

      continue;
    }

    const operation = runtimeEvent.operation;
    if (!operation.isin?.trim()) {
      if (operation.operation_type === "COMPRA" || operation.operation_type === "VENTA") {
        issues.push({
          code: "missing_isin",
          operation_id: operation.id,
          message: `Operación ${operation.operation_type} sin ISIN; se excluye del runtime fiscal.`,
          quantity: toNumber(operation.quantity)
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
          message: `Operación ${operation.operation_type} de ${isin} sin cantidad válida; se excluye del runtime fiscal.`
        });
      }
      continue;
    }

    if (operation.operation_type === "COMPRA") {
      const totalCost = toPositiveAmount(operation.amount);
      const normalizedTotalCost = totalCost === null ? null : roundValue(totalCost, 4);
      const unitCost =
        normalizedTotalCost === null ? null : roundValue(normalizedTotalCost / quantity, 8);
      const sourceAdjustment =
        input.adjustments?.find((adjustment) => adjustment.id === operation.id) ?? null;
      const acquisitionOperationId =
        sourceAdjustment && sourceAdjustment.adjustment_type !== "COST_BASIS" ? null : operation.id;

      const lot: MutableLot = {
        id: crypto.randomUUID(),
        expediente_id: input.expedienteId,
        acquisition_operation_id: acquisitionOperationId,
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
          sales: [],
          acquisition_origin: sourceAdjustment?.adjustment_type,
          adjustment_id: sourceAdjustment?.id,
          target_operation_id: sourceAdjustment?.target_operation_id ?? null
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

    const saleTotalAmount = toPositiveAmount(operation.amount);
    if (saleTotalAmount === null) {
      issues.push({
        code: "missing_sale_amount",
        operation_id: operation.id,
        isin,
        quantity,
        message: `Venta de ${isin} sin importe total; no se puede cerrar la ganancia/pérdida fiscal.`
      });
    }

    const saleUnitPrice = saleTotalAmount === null ? null : roundValue(saleTotalAmount / quantity, 8);
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
      const normalizedAllocatedQuantity = roundValue(allocatedQuantity, 6);
      const totalCost =
        lot.unit_cost === null ? null : roundValue(lot.unit_cost * normalizedAllocatedQuantity, 4);
      const saleAmountAllocated =
        saleUnitPrice === null ? null : roundValue(saleUnitPrice * normalizedAllocatedQuantity, 4);
      const realizedGain =
        saleAmountAllocated === null || totalCost === null
          ? null
          : roundValue(saleAmountAllocated - totalCost, 4);
      const allocationId = crypto.randomUUID();

      allocations.push({
        id: allocationId,
        expediente_id: input.expedienteId,
        sale_operation_id: operation.id,
        lot_id: lot.id,
        acquisition_operation_id: lot.acquisition_operation_id,
        isin,
        sale_date: operation.operation_date,
        acquisition_date: lot.acquisition_date,
        quantity: normalizedAllocatedQuantity,
        sale_unit_price: saleUnitPrice,
        sale_amount_allocated: saleAmountAllocated,
        unit_cost: lot.unit_cost,
        total_cost: totalCost,
        realized_gain: realizedGain,
        currency: normalizeCurrency(operation.currency ?? lot.currency),
        source: operation.source,
        metadata: {
          sale_description: operation.description ?? operation.manual_notes ?? null,
          lot_description: lot.description
        }
      });

      lot.quantity_open = roundValue(lot.quantity_open - normalizedAllocatedQuantity, 6);
      lot.quantity_sold = roundValue(lot.quantity_sold + normalizedAllocatedQuantity, 6);
      lot.metadata.sales.push({
        allocation_id: allocationId,
        sale_operation_id: operation.id,
        operation_date: operation.operation_date,
        quantity: normalizedAllocatedQuantity,
        sale_amount_allocated: saleAmountAllocated,
        total_cost: totalCost,
        realized_gain: realizedGain
      });
      remaining = roundValue(remaining - normalizedAllocatedQuantity, 6);

      if (lot.unit_cost === null) {
        issues.push({
          code: "missing_cost_basis",
          operation_id: operation.id,
          isin,
          quantity: normalizedAllocatedQuantity,
          message: `Venta de ${isin} consumiendo un lote sin coste fiscal calculable.`
        });
      }
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
      const byDate = new Date(left.acquisition_date).getTime() - new Date(right.acquisition_date).getTime();
      if (byDate !== 0) {
        return byDate;
      }

      return left.id.localeCompare(right.id);
    });

  const saleSummaries = summarizeSalesFromOperations({
    operations: sortedOperations,
    allocations
  });
  const blockedLosses = detectBlockedLossesFromFiscalRuntime({
    operations: sortedOperations,
    saleSummaries
  });

  return {
    lots,
    allocations,
    saleSummaries,
    blockedLosses,
    issues
  };
}

export function deriveLotsFromOperations(input: {
  expedienteId: string;
  operations: RuntimeOperationRow[];
  adjustments?: FiscalAdjustmentRow[];
}): { lots: PersistedLot[]; issues: FiscalRuntimeIssue[] } {
  const runtime = deriveFiscalRuntimeFromOperations(input);
  return {
    lots: runtime.lots,
    issues: runtime.issues
  };
}

export async function rebuildExpedienteFiscalRuntime(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<void> {
  const [operationsResult, adjustmentsResult] = await Promise.all([
    supabase
      .from(dbTables.operations)
      .select(
        "id, expediente_id, operation_type, operation_date, isin, description, quantity, amount, currency, realized_gain, source, manual_notes, created_at"
      )
      .eq("expediente_id", expedienteId)
      .order("operation_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from(dbTables.fiscalAdjustments)
      .select(
        "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
      )
      .eq("expediente_id", expedienteId)
      .order("operation_date", { ascending: true })
      .order("created_at", { ascending: true })
  ]);

  if (operationsResult.error || adjustmentsResult.error) {
    throw new Error(
      `No se pudieron cargar datos para recalcular el runtime fiscal: ${
        operationsResult.error?.message ?? adjustmentsResult.error?.message ?? "error desconocido"
      }`
    );
  }

  const runtime = deriveFiscalRuntimeFromOperations({
    expedienteId,
    operations: (operationsResult.data ?? []) as RuntimeOperationRow[],
    adjustments: (adjustmentsResult.data ?? []) as FiscalAdjustmentRow[]
  });

  const { error: deleteAllocationsError } = await supabase
    .from(dbTables.saleAllocations)
    .delete()
    .eq("expediente_id", expedienteId);

  if (deleteAllocationsError) {
    throw new Error(`No se pudieron limpiar asignaciones FIFO previas: ${deleteAllocationsError.message}`);
  }

  const { error: deleteLotsError } = await supabase
    .from(dbTables.lots)
    .delete()
    .eq("expediente_id", expedienteId);

  if (deleteLotsError) {
    throw new Error(`No se pudieron limpiar lotes previos: ${deleteLotsError.message}`);
  }

  if (runtime.lots.length > 0) {
    const { error: insertLotsError } = await supabase.from(dbTables.lots).insert(runtime.lots);
    if (insertLotsError) {
      throw new Error(`No se pudieron persistir lotes derivados: ${insertLotsError.message}`);
    }
  }

  if (runtime.allocations.length > 0) {
    const { error: insertAllocationsError } = await supabase
      .from(dbTables.saleAllocations)
      .insert(runtime.allocations);

    if (insertAllocationsError) {
      throw new Error(`No se pudieron persistir asignaciones FIFO: ${insertAllocationsError.message}`);
    }
  }

  const { error: deleteBlockedLossAlertsError } = await supabase
    .from(dbTables.alerts)
    .delete()
    .eq("expediente_id", expedienteId)
    .in("category", ["fiscal.blocked_loss", "fiscal.adjustment"])
    .eq("status", "open");

  if (deleteBlockedLossAlertsError) {
    throw new Error(
      `No se pudieron limpiar alertas de pérdidas bloqueadas: ${deleteBlockedLossAlertsError.message}`
    );
  }

  if (runtime.blockedLosses.length > 0) {
    const { error: insertBlockedLossAlertsError } = await supabase.from(dbTables.alerts).insert(
      runtime.blockedLosses.map((blockedLoss) => ({
        id: crypto.randomUUID(),
        expediente_id: expedienteId,
        severity: "warning" as const,
        category: "fiscal.blocked_loss",
        message: `Venta con pérdida de ${blockedLoss.isin} el ${blockedLoss.sale_date} bloqueada por recompra el ${blockedLoss.blocked_by_buy_date}.`,
        status: "open" as const,
        entity_type: "operation",
        entity_id: blockedLoss.sale_operation_id,
        metadata: blockedLoss
      }))
    );

    if (insertBlockedLossAlertsError) {
      throw new Error(
        `No se pudieron persistir alertas de pérdidas bloqueadas: ${insertBlockedLossAlertsError.message}`
      );
    }
  }

  const adjustmentIssues = runtime.issues.filter(
    (issue) => issue.code.startsWith("adjustment_") || issue.code.startsWith("transfer_out_")
  );

  if (adjustmentIssues.length > 0) {
    const { error: insertAdjustmentAlertsError } = await supabase.from(dbTables.alerts).insert(
      adjustmentIssues.map((issue) => ({
        id: crypto.randomUUID(),
        expediente_id: expedienteId,
        severity: "warning" as const,
        category: "fiscal.adjustment",
        message: issue.message,
        status: "open" as const,
        entity_type: "adjustment",
        entity_id: issue.operation_id,
        metadata: issue
      }))
    );

    if (insertAdjustmentAlertsError) {
      throw new Error(
        `No se pudieron persistir alertas de ajustes fiscales: ${insertAdjustmentAlertsError.message}`
      );
    }
  }
}
