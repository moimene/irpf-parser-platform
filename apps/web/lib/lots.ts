import type { SupabaseClient } from "@supabase/supabase-js";
import { toDeterministicCanonicalAssetId, toDeterministicCanonicalFiscalEventId } from "@/lib/canonical-id";
import { isMissingCanonicalRuntimeRelation } from "@/lib/canonical-store";
import type { TradeEvent } from "@/lib/rules-core";
import { dbTables } from "@/lib/db-tables";
import { deriveCanonicalAssetViews } from "@/lib/fiscal-canonical";

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
  retention?: number | string | null;
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

export type PersistedSaleAllocation = {
  id: string;
  expediente_id: string;
  sale_operation_id: string;
  lot_id: string;
  acquisition_operation_id: string;
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

export type DerivedFiscalRuntime = {
  lots: PersistedLot[];
  allocations: PersistedSaleAllocation[];
  saleSummaries: FiscalSaleSummary[];
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

export function deriveFiscalRuntimeFromOperations(input: {
  expedienteId: string;
  operations: RuntimeOperationRow[];
}): DerivedFiscalRuntime {
  const sortedOperations = [...input.operations].sort(sortOperations);
  const lotsByIsin = new Map<string, MutableLot[]>();
  const allocations: PersistedSaleAllocation[] = [];
  const issues: FiscalRuntimeIssue[] = [];

  for (const operation of sortedOperations) {
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

  return {
    lots,
    allocations,
    saleSummaries,
    issues
  };
}

export function deriveLotsFromOperations(input: {
  expedienteId: string;
  operations: RuntimeOperationRow[];
}): { lots: PersistedLot[]; issues: FiscalRuntimeIssue[] } {
  const runtime = deriveFiscalRuntimeFromOperations(input);
  return {
    lots: runtime.lots,
    issues: runtime.issues
  };
}

type ExpedienteCanonicalMetaRow = {
  id: string;
  client_id: string | null;
  reference: string;
  fiscal_year: number;
  model_type: string;
};

async function syncCanonicalRuntimeCompat(
  supabase: SupabaseClient,
  input: {
    expediente: ExpedienteCanonicalMetaRow;
    operations: RuntimeOperationRow[];
    runtime: DerivedFiscalRuntime;
  }
): Promise<void> {
  const existingEventsResult = await supabase
    .from(dbTables.fiscalEvents)
    .select("id, source_event_id, metadata")
    .eq("expediente_id", input.expediente.id);

  if (isMissingCanonicalRuntimeRelation(existingEventsResult.error)) {
    return;
  }

  if (existingEventsResult.error) {
    throw new Error(`No se pudieron cargar eventos fiscales canónicos previos: ${existingEventsResult.error.message}`);
  }

  const existingEventMetadataBySourceEventId = new Map(
    ((existingEventsResult.data ?? []) as Array<{
      id: string;
      source_event_id: string;
      metadata: JsonObject | null;
    }>).map((row) => [row.source_event_id, row.metadata ?? {}])
  );

  if (!input.expediente.client_id) {
    for (const eventRow of existingEventsResult.data ?? []) {
      const { error: deleteEventError } = await supabase
        .from(dbTables.fiscalEvents)
        .delete()
        .eq("id", String(eventRow.id));

      if (deleteEventError) {
        throw new Error(`No se pudieron limpiar eventos canónicos sin cliente: ${deleteEventError.message}`);
      }
    }

    return;
  }

  const expedienteMetaById = new Map([
    [
      input.expediente.id,
      {
        reference: input.expediente.reference,
        fiscal_year: input.expediente.fiscal_year,
        model_type: input.expediente.model_type
      }
    ]
  ]);

  const canonicalExpedienteView = deriveCanonicalAssetViews({
    operations: input.operations.map((operation) => ({
      id: operation.id,
      expediente_id: operation.expediente_id,
      operation_type: operation.operation_type,
      operation_date: operation.operation_date,
      isin: operation.isin,
      description: operation.description ?? operation.manual_notes ?? null,
      amount: toPositiveAmount(operation.amount),
      currency: normalizeCurrency(operation.currency),
      quantity: toNumber(operation.quantity),
      retention: toPositiveAmount(operation.retention),
      realized_gain: toNumber(operation.realized_gain),
      source: operation.source
    })),
    lots: input.runtime.lots.map((lot) => ({
      id: lot.id,
      expediente_id: lot.expediente_id,
      isin: lot.isin,
      description: lot.description,
      quantity_open: lot.quantity_open,
      total_cost: lot.total_cost,
      currency: lot.currency,
      status: lot.status
    })),
    saleSummaries: input.runtime.saleSummaries,
    expedienteMetaById
  });

  const eventRows = canonicalExpedienteView.fiscalEvents.map((event) => ({
    id: toDeterministicCanonicalFiscalEventId(input.expediente.id, event.event_id),
    client_id: input.expediente.client_id as string,
    expediente_id: input.expediente.id,
    asset_id: toDeterministicCanonicalAssetId(input.expediente.client_id as string, event.asset_key),
    asset_key: event.asset_key,
    source_event_id: event.event_id,
    asset_label: event.asset_label,
    isin: event.isin,
    event_kind: event.event_kind,
    operation_type: event.operation_type,
    operation_date: event.operation_date,
    description: event.description,
    amount: event.amount,
    currency: event.currency,
    quantity: event.quantity,
    retention: event.retention,
    realized_gain: event.realized_gain,
    source: event.source,
    status: event.status,
    metadata: {
      ...(existingEventMetadataBySourceEventId.get(event.event_id) ?? {}),
      expediente_reference: input.expediente.reference,
      fiscal_year: input.expediente.fiscal_year,
      model_type: input.expediente.model_type
    }
  }));

  if (eventRows.length > 0) {
    const { error: upsertEventsError } = await supabase
      .from(dbTables.fiscalEvents)
      .upsert(eventRows, { onConflict: "expediente_id,source_event_id" });

    if (upsertEventsError) {
      throw new Error(`No se pudieron persistir eventos fiscales canónicos: ${upsertEventsError.message}`);
    }
  }

  const nextEventIds = new Set(eventRows.map((row) => row.id));
  for (const existingEvent of existingEventsResult.data ?? []) {
    const currentId = String(existingEvent.id);
    if (nextEventIds.has(currentId)) {
      continue;
    }

    const { error: deleteEventError } = await supabase
      .from(dbTables.fiscalEvents)
      .delete()
      .eq("id", currentId);

    if (deleteEventError) {
      throw new Error(`No se pudieron limpiar eventos fiscales canónicos obsoletos: ${deleteEventError.message}`);
    }
  }

  const { data: clientExpedientes, error: clientExpedientesError } = await supabase
    .from(dbTables.expedientes)
    .select("id, reference, fiscal_year, model_type")
    .eq("client_id", input.expediente.client_id);

  if (clientExpedientesError) {
    throw new Error(`No se pudieron cargar expedientes del cliente para activos canónicos: ${clientExpedientesError.message}`);
  }

  const clientExpedienteIds = (clientExpedientes ?? []).map((expediente) => String(expediente.id));
  const clientExpedienteMetaById = new Map(
    (clientExpedientes ?? []).map((expediente) => [
      String(expediente.id),
      {
        reference: String(expediente.reference),
        fiscal_year: Number(expediente.fiscal_year),
        model_type: String(expediente.model_type)
      }
    ])
  );

  const [clientOperationsResult, clientLotsResult, clientAllocationsResult, existingAssetsResult] = await Promise.all([
    clientExpedienteIds.length === 0
      ? Promise.resolve({ data: [] as RuntimeOperationRow[], error: null })
      : supabase
          .from(dbTables.operations)
          .select(
            "id, expediente_id, operation_type, operation_date, isin, description, quantity, amount, currency, retention, realized_gain, source, manual_notes, created_at"
          )
          .in("expediente_id", clientExpedienteIds)
          .order("operation_date", { ascending: true })
          .order("created_at", { ascending: true }),
    clientExpedienteIds.length === 0
      ? Promise.resolve({ data: [] as PersistedLot[], error: null })
      : supabase
          .from(dbTables.lots)
          .select("id, expediente_id, isin, description, quantity_open, total_cost, currency, status")
          .in("expediente_id", clientExpedienteIds),
    clientExpedienteIds.length === 0
      ? Promise.resolve({ data: [] as PersistedSaleAllocationRow[], error: null })
      : supabase
          .from(dbTables.saleAllocations)
          .select("sale_operation_id, quantity, sale_amount_allocated, total_cost, realized_gain, acquisition_date, acquisition_operation_id, currency")
          .in("expediente_id", clientExpedienteIds),
    supabase.from(dbTables.assets).select("id, asset_key, metadata").eq("client_id", input.expediente.client_id)
  ]);

  if (clientOperationsResult.error || clientLotsResult.error || clientAllocationsResult.error) {
    throw new Error(
      `No se pudo recalcular la base canónica de activos: ${
        clientOperationsResult.error?.message ??
        clientLotsResult.error?.message ??
        clientAllocationsResult.error?.message ??
        "error desconocido"
      }`
    );
  }

  if (existingAssetsResult.error) {
    if (isMissingCanonicalRuntimeRelation(existingAssetsResult.error)) {
      return;
    }

    throw new Error(`No se pudieron cargar activos canónicos previos: ${existingAssetsResult.error.message}`);
  }

  const existingAssetMetadataByAssetKey = new Map(
    ((existingAssetsResult.data ?? []) as Array<{
      id: string;
      asset_key: string;
      metadata: JsonObject | null;
    }>).map((row) => [row.asset_key, row.metadata ?? {}])
  );

  const clientRuntimeSaleSummaries = summarizeSalesFromOperations({
    operations: (clientOperationsResult.data ?? []) as RuntimeOperationRow[],
    allocations: (clientAllocationsResult.data ?? []) as PersistedSaleAllocationRow[]
  });

  const clientCanonicalView = deriveCanonicalAssetViews({
    operations: ((clientOperationsResult.data ?? []) as RuntimeOperationRow[]).map((operation) => ({
      id: operation.id,
      expediente_id: operation.expediente_id,
      operation_type: operation.operation_type,
      operation_date: operation.operation_date,
      isin: operation.isin,
      description: operation.description ?? operation.manual_notes ?? null,
      amount: toPositiveAmount(operation.amount),
      currency: normalizeCurrency(operation.currency),
      quantity: toNumber(operation.quantity),
      retention: toPositiveAmount(operation.retention),
      realized_gain: toNumber(operation.realized_gain),
      source: operation.source
    })),
    lots: ((clientLotsResult.data ?? []) as Array<{
      id: string;
      expediente_id: string;
      isin: string;
      description: string | null;
      quantity_open: number | string;
      total_cost: number | string | null;
      currency: string | null;
      status: "OPEN" | "CLOSED";
    }>).map((lot) => ({
      id: lot.id,
      expediente_id: lot.expediente_id,
      isin: lot.isin,
      description: lot.description,
      quantity_open: toNumber(lot.quantity_open) ?? 0,
      total_cost: toNumber(lot.total_cost),
      currency: lot.currency,
      status: lot.status
    })),
    saleSummaries: clientRuntimeSaleSummaries,
    expedienteMetaById: clientExpedienteMetaById
  });

  const assetRows = clientCanonicalView.assets.map((asset) => ({
    id: toDeterministicCanonicalAssetId(input.expediente.client_id as string, asset.asset_key),
    client_id: input.expediente.client_id as string,
    asset_key: asset.asset_key,
    isin: asset.isin,
    label: asset.label,
    currencies: asset.currencies,
    expedientes: asset.expedientes,
    fiscal_years: asset.fiscal_years,
    events_total: asset.events_total,
    dividends: asset.dividends,
    interests: asset.interests,
    acquisitions: asset.acquisitions,
    transmissions: asset.transmissions,
    retentions: asset.retentions,
    gains_losses: asset.gains_losses,
    open_lots: asset.open_lots,
    closed_lots: asset.closed_lots,
    quantity_open: asset.quantity_open,
    open_cost_basis: asset.open_cost_basis,
    gross_amount_total: asset.gross_amount_total,
    realized_gain_total: asset.realized_gain_total,
    pending_transmissions: asset.pending_transmissions,
    latest_event_date: asset.latest_event_date,
    last_source: asset.last_source,
    metadata: existingAssetMetadataByAssetKey.get(asset.asset_key) ?? {}
  }));

  if (assetRows.length > 0) {
    const { error: upsertAssetsError } = await supabase
      .from(dbTables.assets)
      .upsert(assetRows, { onConflict: "client_id,asset_key" });

    if (upsertAssetsError) {
      throw new Error(`No se pudieron persistir activos canónicos: ${upsertAssetsError.message}`);
    }
  }

  const nextAssetIds = new Set(assetRows.map((row) => row.id));
  for (const existingAsset of existingAssetsResult.data ?? []) {
    const currentId = String(existingAsset.id);
    if (nextAssetIds.has(currentId)) {
      continue;
    }

    const { error: deleteAssetError } = await supabase.from(dbTables.assets).delete().eq("id", currentId);
    if (deleteAssetError) {
      throw new Error(`No se pudieron limpiar activos canónicos obsoletos: ${deleteAssetError.message}`);
    }
  }
}

export async function rebuildExpedienteFiscalRuntime(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<void> {
  const [operationsResult, expedienteResult] = await Promise.all([
    supabase
      .from(dbTables.operations)
      .select(
        "id, expediente_id, operation_type, operation_date, isin, description, quantity, amount, currency, retention, realized_gain, source, manual_notes, created_at"
      )
      .eq("expediente_id", expedienteId)
      .order("operation_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from(dbTables.expedientes)
      .select("id, client_id, reference, fiscal_year, model_type")
      .eq("id", expedienteId)
      .maybeSingle()
  ]);

  if (operationsResult.error) {
    throw new Error(`No se pudieron cargar operaciones para recalcular el runtime fiscal: ${operationsResult.error.message}`);
  }

  if (expedienteResult.error) {
    throw new Error(`No se pudo cargar el expediente para recalcular el runtime fiscal: ${expedienteResult.error.message}`);
  }

  const operations = (operationsResult.data ?? []) as RuntimeOperationRow[];
  const runtime = deriveFiscalRuntimeFromOperations({
    expedienteId,
    operations
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

  if (expedienteResult.data) {
    await syncCanonicalRuntimeCompat(supabase, {
      expediente: expedienteResult.data as ExpedienteCanonicalMetaRow,
      operations,
      runtime
    });
  }
}
