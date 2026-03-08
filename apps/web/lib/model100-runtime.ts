import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalAssetResponse, CanonicalFiscalEventResponse } from "@/lib/asset-registry";
import { loadCanonicalRegistrySnapshot } from "@/lib/asset-registry-store";
import { dbTables } from "@/lib/db-tables";
import type { FiscalAdjustmentRow } from "@/lib/fiscal-adjustments";
import {
  detectBlockedLossesFromFiscalRuntime,
  deriveFiscalRuntimeFromOperations,
  type DerivedFiscalRuntime,
  type FiscalRuntimeIssue,
  type FiscalSaleSummary,
  type OperationSource,
  type RuntimeOperationRow
} from "@/lib/lots";

export type Model100RuntimeSource = "irpf_asset_fiscal_events" | "irpf_operations";

type CanonicalRegistryRuntimeSnapshot = {
  available: boolean;
  assets: CanonicalAssetResponse[];
  fiscalEvents: CanonicalFiscalEventResponse[];
};

type CanonicalSaleOverride = {
  quantity: number;
  saleAmount: number;
  costBasis: number;
  realizedGain: number;
  currency: string | null;
};

export type Model100RuntimeResult = DerivedFiscalRuntime & {
  source: Model100RuntimeSource;
  operations: RuntimeOperationRow[];
};

const CANONICAL_BUY_KEYS = new Set(["COMPRA_VALOR", "COMPRA_FONDO"]);
const CANONICAL_SELL_KEYS = new Set(["VENTA_VALOR", "VENTA_FONDO"]);

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeUppercase(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function roundValue(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function toOperationSource(source: CanonicalFiscalEventResponse["source"]): OperationSource {
  if (source === "MANUAL" || source === "IMPORTACION_EXCEL") {
    return source;
  }

  return "AUTO";
}

function resolveRuntimeOperationType(
  event: CanonicalFiscalEventResponse,
  asset: CanonicalAssetResponse | undefined
): "COMPRA" | "VENTA" | null {
  if (event.capital_operation_key && CANONICAL_BUY_KEYS.has(event.capital_operation_key)) {
    return "COMPRA";
  }

  if (event.capital_operation_key && CANONICAL_SELL_KEYS.has(event.capital_operation_key)) {
    return "VENTA";
  }

  if (asset?.asset_key && ["V", "I"].includes(asset.asset_key)) {
    if (event.event_type === "ACQUISITION") {
      return "COMPRA";
    }

    if (event.event_type === "DISPOSAL") {
      return "VENTA";
    }
  }

  return null;
}

function resolveRuntimeIdentifier(asset: CanonicalAssetResponse | undefined): string | null {
  return normalizeUppercase(
    asset?.security?.security_identifier ??
      asset?.collective_investment?.security_identifier ??
      null
  );
}

function resolveRuntimeDescription(
  event: CanonicalFiscalEventResponse,
  asset: CanonicalAssetResponse | undefined
): string | null {
  return (
    normalizeText(event.notes) ??
    normalizeText(asset?.asset_description) ??
    normalizeText(asset?.entity_name) ??
    normalizeText(asset?.display_name) ??
    normalizeText(event.capital_operation_key) ??
    normalizeText(event.event_type)
  );
}

function resolveRuntimeAmount(
  operationType: "COMPRA" | "VENTA",
  event: CanonicalFiscalEventResponse
): number | null {
  if (operationType === "COMPRA") {
    return (
      toNullableNumber(event.gross_amount_eur) ??
      toNullableNumber(event.cost_basis_amount_eur) ??
      null
    );
  }

  return (
    toNullableNumber(event.proceeds_amount_eur) ??
    toNullableNumber(event.gross_amount_eur) ??
    null
  );
}

function buildExplicitSaleOverride(event: CanonicalFiscalEventResponse): CanonicalSaleOverride | null {
  const quantity = toNullableNumber(event.quantity);
  const saleAmount =
    toNullableNumber(event.proceeds_amount_eur) ??
    toNullableNumber(event.gross_amount_eur);
  const realizedGain = toNullableNumber(event.realized_result_eur);
  const costBasis =
    toNullableNumber(event.cost_basis_amount_eur) ??
    (saleAmount !== null && realizedGain !== null ? roundValue(saleAmount - realizedGain, 4) : null);
  const resolvedRealizedGain =
    realizedGain ??
    (saleAmount !== null && costBasis !== null ? roundValue(saleAmount - costBasis, 4) : null);

  if (
    quantity === null ||
    quantity <= 0 ||
    saleAmount === null ||
    costBasis === null ||
    resolvedRealizedGain === null
  ) {
    return null;
  }

  return {
    quantity: roundValue(Math.abs(quantity), 6),
    saleAmount: roundValue(Math.abs(saleAmount), 4),
    costBasis: roundValue(Math.abs(costBasis), 4),
    realizedGain: roundValue(resolvedRealizedGain, 4),
    currency: normalizeUppercase(event.currency)
  };
}

export function projectRuntimeOperationsFromCanonicalFiscalEvents(input: {
  expedienteId: string;
  assets: CanonicalAssetResponse[];
  fiscalEvents: CanonicalFiscalEventResponse[];
}): {
  operations: RuntimeOperationRow[];
  explicitSaleOverrides: Map<string, CanonicalSaleOverride>;
} {
  const assetById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const operations: RuntimeOperationRow[] = [];
  const explicitSaleOverrides = new Map<string, CanonicalSaleOverride>();

  for (const event of input.fiscalEvents) {
    const asset = event.asset_id ? assetById.get(event.asset_id) : undefined;
    const operationType = resolveRuntimeOperationType(event, asset);
    if (!operationType) {
      continue;
    }

    operations.push({
      id: event.id,
      expediente_id: input.expedienteId,
      operation_type: operationType,
      operation_date: event.event_date,
      isin: resolveRuntimeIdentifier(asset),
      description: resolveRuntimeDescription(event, asset),
      quantity: toNullableNumber(event.quantity),
      amount: resolveRuntimeAmount(operationType, event),
      currency: normalizeUppercase(event.currency),
      realized_gain:
        operationType === "VENTA" ? toNullableNumber(event.realized_result_eur) : null,
      source: toOperationSource(event.source),
      manual_notes: normalizeText(event.notes),
      created_at: undefined
    });

    if (operationType === "VENTA") {
      const override = buildExplicitSaleOverride(event);
      if (override) {
        explicitSaleOverrides.set(event.id, override);
      }
    }
  }

  return {
    operations,
    explicitSaleOverrides
  };
}

function applyCanonicalSaleOverrides(input: {
  runtime: DerivedFiscalRuntime;
  operations: RuntimeOperationRow[];
  explicitSaleOverrides: Map<string, CanonicalSaleOverride>;
}): DerivedFiscalRuntime {
  const overriddenSaleIds = new Set<string>();

  const saleSummaries = input.runtime.saleSummaries.map((summary): FiscalSaleSummary => {
    const override = input.explicitSaleOverrides.get(summary.sale_operation_id);
    if (!override || summary.status === "MATCHED" || !summary.isin) {
      return summary;
    }

    overriddenSaleIds.add(summary.sale_operation_id);
    return {
      ...summary,
      quantity: override.quantity,
      sale_amount: override.saleAmount,
      sale_amount_allocated: override.saleAmount,
      quantity_allocated: override.quantity,
      missing_quantity: 0,
      cost_basis: override.costBasis,
      realized_gain: override.realizedGain,
      reported_realized_gain: summary.reported_realized_gain ?? override.realizedGain,
      currency: summary.currency ?? override.currency,
      status: "MATCHED"
    };
  });

  if (overriddenSaleIds.size === 0) {
    return input.runtime;
  }

  const issues = input.runtime.issues.filter((issue) => {
    if (!overriddenSaleIds.has(issue.operation_id)) {
      return true;
    }

    return !["sell_without_available_lots", "missing_cost_basis"].includes(issue.code);
  });

  return {
    ...input.runtime,
    blockedLosses: detectBlockedLossesFromFiscalRuntime({
      operations: input.operations,
      saleSummaries
    }),
    saleSummaries,
    issues
  };
}

export function buildModel100Runtime(input: {
  expedienteId: string;
  canonicalRegistry?: CanonicalRegistryRuntimeSnapshot | null;
  legacyOperations?: RuntimeOperationRow[];
  adjustments?: FiscalAdjustmentRow[];
}): Model100RuntimeResult {
  const projectedCanonical =
    input.canonicalRegistry?.available
      ? projectRuntimeOperationsFromCanonicalFiscalEvents({
          expedienteId: input.expedienteId,
          assets: input.canonicalRegistry.assets,
          fiscalEvents: input.canonicalRegistry.fiscalEvents
        })
      : { operations: [] as RuntimeOperationRow[], explicitSaleOverrides: new Map<string, CanonicalSaleOverride>() };

  if (projectedCanonical.operations.length > 0) {
    const runtime = deriveFiscalRuntimeFromOperations({
      expedienteId: input.expedienteId,
      operations: projectedCanonical.operations,
      adjustments: input.adjustments ?? []
    });

    return {
      ...applyCanonicalSaleOverrides({
        runtime,
        operations: projectedCanonical.operations,
        explicitSaleOverrides: projectedCanonical.explicitSaleOverrides
      }),
      source: "irpf_asset_fiscal_events",
      operations: projectedCanonical.operations
    };
  }

  const legacyOperations = input.legacyOperations ?? [];
  return {
    ...deriveFiscalRuntimeFromOperations({
      expedienteId: input.expedienteId,
      operations: legacyOperations,
      adjustments: input.adjustments ?? []
    }),
    source: "irpf_operations",
    operations: legacyOperations
  };
}

export async function loadModel100Runtime(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<Model100RuntimeResult> {
  const [canonicalRegistry, adjustmentsResult] = await Promise.all([
    loadCanonicalRegistrySnapshot(supabase, expedienteId),
    supabase
      .from(dbTables.fiscalAdjustments)
      .select(
        "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
      )
      .eq("expediente_id", expedienteId)
      .order("operation_date", { ascending: true })
      .order("created_at", { ascending: true })
  ]);

  if (adjustmentsResult.error) {
    throw new Error(
      `No se pudieron cargar ajustes fiscales del modelo 100: ${adjustmentsResult.error.message}`
    );
  }

  const projectedCanonical = buildModel100Runtime({
    expedienteId,
    canonicalRegistry,
    adjustments: (adjustmentsResult.data ?? []) as FiscalAdjustmentRow[]
  });

  if (projectedCanonical.source === "irpf_asset_fiscal_events") {
    return projectedCanonical;
  }

  const operationsResult = await supabase
    .from(dbTables.operations)
    .select(
      "id, expediente_id, isin, operation_type, operation_date, description, amount, currency, quantity, realized_gain, source, manual_notes, created_at"
    )
    .eq("expediente_id", expedienteId)
    .in("operation_type", ["COMPRA", "VENTA"])
    .order("operation_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (operationsResult.error) {
    throw new Error(
      `No se pudo cargar el runtime fiscal legacy del modelo 100: ${operationsResult.error.message}`
    );
  }

  return buildModel100Runtime({
    expedienteId,
    canonicalRegistry,
    legacyOperations: (operationsResult.data ?? []) as RuntimeOperationRow[],
    adjustments: (adjustmentsResult.data ?? []) as FiscalAdjustmentRow[]
  });
}
