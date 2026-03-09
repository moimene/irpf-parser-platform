import type { AeatRecord } from "@/lib/aeat/format";
import type {
  CanonicalForeignAssetBlock,
  CanonicalAssetSummary,
  CanonicalEventStatus,
  CanonicalFiscalEvent
} from "@/lib/fiscal-canonical";
import { resolveCanonicalAssetDeclarableValue } from "@/lib/fiscal-canonical";
import type { TradeEvent } from "@/lib/rules-core";

export type CanonicalModel100SaleRecord = {
  source_operation_id: string;
  source_event_id: string;
  isin: string | null;
  description: string | null;
  operation_date: string;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  realized_gain: number | null;
  status: CanonicalEventStatus;
};

export type CanonicalAssetMetrics = {
  totalAssets: number;
  domesticAssets: number;
  foreignAssets: number;
  missingValuationAssets: number;
  missingDomesticValuationAssets: number;
  missingForeignValuationAssets: number;
  missingOwnershipAssets: number;
  missingForeignCountryAssets: number;
  missingForeignBlockAssets: number;
  missingForeignQ4BalanceAssets: number;
  foreignBlockTotals: Record<CanonicalForeignAssetBlock, number>;
  thresholdReachedBlocks: CanonicalForeignAssetBlock[];
  totalValuation: number;
  totalForeignValuation: number;
};

export type OperationalExportRow = Record<string, string | number | null>;

function normalizeEventOperationId(eventId: string): string {
  const separatorIndex = eventId.indexOf(":");
  return separatorIndex >= 0 ? eventId.slice(separatorIndex + 1) : eventId;
}

function sortFiscalEvents(events: CanonicalFiscalEvent[]): CanonicalFiscalEvent[] {
  return [...events].sort((left, right) => {
    const byDate = new Date(left.operation_date).getTime() - new Date(right.operation_date).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    return left.event_id.localeCompare(right.event_id);
  });
}

export function buildModel100RuntimeFromCanonical(input: {
  fiscalEvents: CanonicalFiscalEvent[];
}): {
  trades: TradeEvent[];
  saleRecords: CanonicalModel100SaleRecord[];
  unresolvedSales: number;
  pendingCostBasisSales: number;
  invalidSales: number;
} {
  const sortedEvents = sortFiscalEvents(input.fiscalEvents);
  const transmissionsByOperationId = new Map(
    sortedEvents
      .filter((event) => event.event_kind === "transmision")
      .map((event) => [normalizeEventOperationId(event.event_id), event])
  );

  const saleRecords: CanonicalModel100SaleRecord[] = [];
  const gainLossOperationIds = new Set<string>();

  for (const event of sortedEvents) {
    if (event.event_kind !== "ganancia_perdida") {
      continue;
    }

    const operationId = normalizeEventOperationId(event.event_id);
    const transmission = transmissionsByOperationId.get(operationId);
    gainLossOperationIds.add(operationId);

    saleRecords.push({
      source_operation_id: operationId,
      source_event_id: event.event_id,
      isin: event.isin ?? transmission?.isin ?? null,
      description: event.description ?? transmission?.description ?? null,
      operation_date: event.operation_date,
      amount: event.amount ?? transmission?.amount ?? null,
      currency: event.currency ?? transmission?.currency ?? null,
      quantity: event.quantity ?? transmission?.quantity ?? null,
      realized_gain: event.realized_gain,
      status: event.status
    });
  }

  for (const event of sortedEvents) {
    if (event.event_kind !== "transmision") {
      continue;
    }

    const operationId = normalizeEventOperationId(event.event_id);
    if (gainLossOperationIds.has(operationId)) {
      continue;
    }

    saleRecords.push({
      source_operation_id: operationId,
      source_event_id: event.event_id,
      isin: event.isin,
      description: event.description,
      operation_date: event.operation_date,
      amount: event.amount,
      currency: event.currency,
      quantity: event.quantity,
      realized_gain: event.realized_gain,
      status: event.status
    });
  }

  saleRecords.sort((left, right) => {
    const byDate = new Date(left.operation_date).getTime() - new Date(right.operation_date).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    return left.source_event_id.localeCompare(right.source_event_id);
  });

  const trades: TradeEvent[] = [];
  for (const event of sortedEvents) {
    const isin = event.isin?.trim().toUpperCase();
    const quantity = typeof event.quantity === "number" ? Math.abs(event.quantity) : null;
    if (!isin || quantity === null || quantity <= 0) {
      continue;
    }

    if (event.event_kind === "adquisicion") {
      trades.push({
        id: event.event_id,
        isin,
        type: "BUY",
        tradeDate: event.operation_date,
        quantity,
        assetKind: "LISTED"
      });
    }
  }

  for (const sale of saleRecords) {
    const isin = sale.isin?.trim().toUpperCase();
    const quantity = typeof sale.quantity === "number" ? Math.abs(sale.quantity) : null;
    if (!isin || quantity === null || quantity <= 0) {
      continue;
    }

    trades.push({
      id: sale.source_event_id,
      isin,
      type: "SELL",
      tradeDate: sale.operation_date,
      quantity,
      gainLossEur: sale.realized_gain ?? undefined,
      assetKind: "LISTED"
    });
  }

  trades.sort((left, right) => {
    const byDate = new Date(left.tradeDate).getTime() - new Date(right.tradeDate).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    return left.id.localeCompare(right.id);
  });

  return {
    trades,
    saleRecords,
    unresolvedSales: saleRecords.filter((sale) => sale.status === "UNRESOLVED").length,
    pendingCostBasisSales: saleRecords.filter((sale) => sale.status === "PENDING_COST_BASIS").length,
    invalidSales: saleRecords.filter((sale) => sale.status === "INVALID_DATA").length
  };
}

function resolveAssetAmount(asset: CanonicalAssetSummary): number | null {
  return resolveCanonicalAssetDeclarableValue(asset);
}

function resolveAssetCurrency(asset: CanonicalAssetSummary): string {
  return asset.currencies[0] ?? "EUR";
}

function isForeignAsset(asset: CanonicalAssetSummary): boolean {
  if (asset.country) {
    return asset.country !== "ES";
  }

  return typeof asset.isin === "string" && !asset.isin.startsWith("ES");
}

function isValuableAsset(asset: CanonicalAssetSummary): boolean {
  const quantity = asset.quantity_open ?? 0;
  return quantity > 0 || resolveAssetAmount(asset) !== null || typeof asset.q4_avg_balance === "number";
}

export function summarizeCanonicalAssets(input: {
  assets: CanonicalAssetSummary[];
}): CanonicalAssetMetrics {
  let domesticAssets = 0;
  let foreignAssets = 0;
  let missingValuationAssets = 0;
  let missingDomesticValuationAssets = 0;
  let missingForeignValuationAssets = 0;
  let missingOwnershipAssets = 0;
  let missingForeignCountryAssets = 0;
  let missingForeignBlockAssets = 0;
  let missingForeignQ4BalanceAssets = 0;
  let totalValuation = 0;
  let totalForeignValuation = 0;
  const foreignBlockTotals: Record<CanonicalForeignAssetBlock, number> = {
    accounts: 0,
    securities: 0,
    insurance_real_estate: 0,
    other: 0
  };

  for (const asset of input.assets.filter(isValuableAsset)) {
    const amount = resolveAssetAmount(asset);
    const foreign = isForeignAsset(asset);

    if (foreign) {
      foreignAssets += 1;
    } else {
      domesticAssets += 1;
    }

    if (typeof asset.ownership_pct !== "number" || asset.ownership_pct <= 0) {
      missingOwnershipAssets += 1;
    }

    if (foreign && !asset.country) {
      missingForeignCountryAssets += 1;
    }

    if (foreign && !asset.foreign_block) {
      missingForeignBlockAssets += 1;
    }

    if (foreign && asset.foreign_block === "accounts" && typeof asset.q4_avg_balance !== "number") {
      missingForeignQ4BalanceAssets += 1;
    }

    if (amount === null) {
      missingValuationAssets += 1;
      if (foreign) {
        missingForeignValuationAssets += 1;
      } else {
        missingDomesticValuationAssets += 1;
      }
      continue;
    }

    totalValuation += amount;
    if (foreign) {
      totalForeignValuation += amount;
      if (asset.foreign_block) {
        foreignBlockTotals[asset.foreign_block] += amount;
      }
    }
  }

  return {
    totalAssets: domesticAssets + foreignAssets,
    domesticAssets,
    foreignAssets,
    missingValuationAssets,
    missingDomesticValuationAssets,
    missingForeignValuationAssets,
    missingOwnershipAssets,
    missingForeignCountryAssets,
    missingForeignBlockAssets,
    missingForeignQ4BalanceAssets,
    foreignBlockTotals: {
      accounts: Number(foreignBlockTotals.accounts.toFixed(2)),
      securities: Number(foreignBlockTotals.securities.toFixed(2)),
      insurance_real_estate: Number(foreignBlockTotals.insurance_real_estate.toFixed(2)),
      other: Number(foreignBlockTotals.other.toFixed(2))
    },
    thresholdReachedBlocks: (Object.entries(foreignBlockTotals) as Array<[CanonicalForeignAssetBlock, number]>)
      .filter(([, amount]) => amount >= 50000)
      .map(([block]) => block),
    totalValuation: Number(totalValuation.toFixed(2)),
    totalForeignValuation: Number(totalForeignValuation.toFixed(2))
  };
}

export function buildModel714RecordsFromCanonicalAssets(input: {
  assets: CanonicalAssetSummary[];
}): AeatRecord[] {
  return [...input.assets]
    .filter((asset) => {
      const quantity = asset.quantity_open ?? 0;
      return quantity > 0 || resolveAssetAmount(asset) !== null;
    })
    .sort((left, right) => {
      const leftDate = left.latest_event_date ? new Date(left.latest_event_date).getTime() : 0;
      const rightDate = right.latest_event_date ? new Date(right.latest_event_date).getTime() : 0;
      return rightDate - leftDate;
    })
    .map((asset) => ({
      isin: asset.isin,
      description:
        asset.asset_type === "other"
          ? asset.label
          : `${asset.label} · ${asset.asset_type} · ${asset.holder_role}`,
      operation_date: asset.latest_event_date,
      amount: resolveAssetAmount(asset),
      currency: resolveAssetCurrency(asset),
      quantity: asset.quantity_open,
      operation_type: "POSICION"
    }));
}

export function buildModel720RecordsFromCanonicalAssets(input: {
  assets: CanonicalAssetSummary[];
}): AeatRecord[] {
  return input.assets
    .filter((asset) => isValuableAsset(asset) && isForeignAsset(asset))
    .sort((left, right) => {
      const leftDate = left.latest_event_date ? new Date(left.latest_event_date).getTime() : 0;
      const rightDate = right.latest_event_date ? new Date(right.latest_event_date).getTime() : 0;
      return rightDate - leftDate;
    })
    .map((asset) => ({
      isin: asset.isin,
      description:
        asset.foreign_block
          ? `${asset.label} · ${asset.foreign_block} · ${asset.country ?? "sin_pais"}`
          : asset.label,
      operation_date: asset.latest_event_date,
      amount: resolveAssetAmount(asset),
      currency: resolveAssetCurrency(asset),
      quantity: asset.quantity_open,
      operation_type: "POSICION"
    }));
}

export function buildOperationalRowsForModel100(input: {
  saleRecords: CanonicalModel100SaleRecord[];
}): OperationalExportRow[] {
  return input.saleRecords.map((sale) => ({
    fecha_operacion: sale.operation_date,
    isin: sale.isin,
    descripcion: sale.description,
    cantidad: sale.quantity,
    importe_transmision: sale.amount,
    ganancia_perdida: sale.realized_gain,
    divisa: sale.currency ?? "EUR",
    estado_fiscal: sale.status
  }));
}

export function buildOperationalRowsForModel714(input: {
  assets: CanonicalAssetSummary[];
}): OperationalExportRow[] {
  return input.assets
    .filter(isValuableAsset)
    .map((asset) => ({
      activo: asset.label,
      tipo_activo: asset.asset_type,
      titularidad: asset.holder_role,
      porcentaje_titularidad: asset.ownership_pct,
      pais: asset.country,
      isin: asset.isin,
      ejercicios: asset.fiscal_years.join(", "),
      cantidad_abierta: asset.quantity_open,
      valor_declarable: resolveAssetAmount(asset),
      valor_fin_ejercicio: asset.year_end_value,
      metodo_valoracion: asset.valuation_method,
      divisa: resolveAssetCurrency(asset),
      lotes_abiertos: asset.open_lots,
      ultimo_evento: asset.latest_event_date
    }));
}

export function buildOperationalRowsForModel720(input: {
  assets: CanonicalAssetSummary[];
}): OperationalExportRow[] {
  return input.assets
    .filter((asset) => isValuableAsset(asset) && isForeignAsset(asset))
    .map((asset) => ({
      activo: asset.label,
      bloque_720: asset.foreign_block,
      tipo_activo: asset.asset_type,
      titularidad: asset.holder_role,
      porcentaje_titularidad: asset.ownership_pct,
      pais: asset.country,
      isin: asset.isin,
      ejercicios: asset.fiscal_years.join(", "),
      cantidad_abierta: asset.quantity_open,
      valor_extranjero: resolveAssetAmount(asset),
      valor_fin_ejercicio: asset.year_end_value,
      saldo_medio_q4: asset.q4_avg_balance,
      metodo_valoracion: asset.valuation_method,
      divisa: resolveAssetCurrency(asset),
      lotes_abiertos: asset.open_lots,
      ultimo_evento: asset.latest_event_date
    }));
}
