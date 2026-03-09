type CanonicalOperation = {
  id: string;
  expediente_id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  retention: number | null;
  realized_gain: number | null;
  source: string;
};

type CanonicalLot = {
  id: string;
  expediente_id: string;
  isin: string;
  description: string | null;
  quantity_open: number;
  total_cost: number | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
};

type CanonicalSaleSummary = {
  sale_operation_id: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  sale_amount: number | null;
  cost_basis: number | null;
  realized_gain: number | null;
  currency: string | null;
  status: "MATCHED" | "UNRESOLVED" | "PENDING_COST_BASIS" | "INVALID_DATA";
  source: string;
};

type ExpedienteMeta = {
  reference: string;
  fiscal_year: number;
  model_type: string;
};

export const canonicalAssetTypes = [
  "security",
  "fund",
  "account",
  "insurance",
  "real_estate",
  "cash",
  "other"
] as const;

export const canonicalHolderRoles = [
  "titular",
  "conyuge",
  "cotitular",
  "usufructuario",
  "nudo_propietario",
  "otro"
] as const;

export const canonicalValuationMethods = [
  "market_value",
  "cost_basis",
  "year_end_value",
  "q4_average",
  "manual",
  "pending"
] as const;

export const canonicalForeignAssetBlocks = [
  "accounts",
  "securities",
  "insurance_real_estate",
  "other"
] as const;

export type CanonicalAssetType = (typeof canonicalAssetTypes)[number];
export type CanonicalHolderRole = (typeof canonicalHolderRoles)[number];
export type CanonicalValuationMethod = (typeof canonicalValuationMethods)[number];
export type CanonicalForeignAssetBlock = (typeof canonicalForeignAssetBlocks)[number];

type AssetMetadata = Record<string, unknown>;

export type CanonicalAssetSummary = {
  canonical_id: string | null;
  asset_key: string;
  isin: string | null;
  label: string;
  notes: string | null;
  currencies: string[];
  expedientes: string[];
  fiscal_years: number[];
  events_total: number;
  dividends: number;
  interests: number;
  acquisitions: number;
  transmissions: number;
  retentions: number;
  gains_losses: number;
  open_lots: number;
  closed_lots: number;
  quantity_open: number | null;
  open_cost_basis: number | null;
  gross_amount_total: number | null;
  realized_gain_total: number | null;
  pending_transmissions: number;
  latest_event_date: string | null;
  last_source: string | null;
  asset_type: CanonicalAssetType;
  holder_role: CanonicalHolderRole;
  ownership_pct: number | null;
  country: string | null;
  year_end_value: number | null;
  q4_avg_balance: number | null;
  valuation_method: CanonicalValuationMethod;
  foreign_block: CanonicalForeignAssetBlock | null;
};

export type CanonicalEventStatus =
  | "RECORDED"
  | "MATCHED"
  | "UNRESOLVED"
  | "PENDING_COST_BASIS"
  | "INVALID_DATA";

export type CanonicalFiscalEvent = {
  canonical_id: string | null;
  event_id: string;
  expediente_id: string;
  expediente_reference: string | null;
  fiscal_year: number | null;
  model_type: string | null;
  asset_key: string;
  asset_label: string;
  isin: string | null;
  event_kind:
    | "dividendo"
    | "interes"
    | "adquisicion"
    | "transmision"
    | "retencion"
    | "ganancia_perdida"
    | "posicion";
  operation_type: string;
  operation_date: string;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  retention: number | null;
  realized_gain: number | null;
  source: string;
  status: CanonicalEventStatus;
  notes: string | null;
};

function assetKeyFromValues(input: {
  isin: string | null;
  description: string | null;
  fallbackType: string;
  fallbackId: string;
}): string {
  const normalizedIsin = input.isin?.trim().toUpperCase();
  if (normalizedIsin) {
    return normalizedIsin;
  }

  const normalizedDescription = input.description?.trim();
  if (normalizedDescription) {
    return `DESC:${normalizedDescription.toUpperCase()}`;
  }

  return `${input.fallbackType}:${input.fallbackId}`;
}

function assetLabelFromValues(input: { isin: string | null; description: string | null; fallbackType: string }): string {
  const normalizedDescription = input.description?.trim();
  const normalizedIsin = input.isin?.trim().toUpperCase();

  if (normalizedDescription && normalizedIsin) {
    return `${normalizedDescription} (${normalizedIsin})`;
  }

  if (normalizedDescription) {
    return normalizedDescription;
  }

  if (normalizedIsin) {
    return normalizedIsin;
  }

  return input.fallbackType;
}

function normalizedCurrency(value: string | null): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function absNumber(value: number | null): number | null {
  return value === null ? null : Math.abs(value);
}

function sumNullable(current: number | null, next: number | null): number | null {
  if (next === null) {
    return current;
  }

  if (current === null) {
    return next;
  }

  return Number((current + next).toFixed(4));
}

function clampPercentage(value: number | null): number | null {
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, Number(value.toFixed(4))));
}

function normalizeCountry(value: string | null): string | null {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 2);
}

function toNullableNumberFromUnknown(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function hasStringValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function inferAssetType(asset: {
  isin: string | null;
  label: string;
  currencies: string[];
}): CanonicalAssetType {
  const normalizedLabel = asset.label.trim().toLowerCase();

  if (
    normalizedLabel.includes("cuenta") ||
    normalizedLabel.includes("account") ||
    normalizedLabel.includes("deposito")
  ) {
    return "account";
  }

  if (normalizedLabel.includes("seguro")) {
    return "insurance";
  }

  if (
    normalizedLabel.includes("inmueble") ||
    normalizedLabel.includes("vivienda") ||
    normalizedLabel.includes("real estate")
  ) {
    return "real_estate";
  }

  if (normalizedLabel.includes("fondo") || normalizedLabel.includes("fund")) {
    return "fund";
  }

  if (!asset.isin && asset.currencies.length > 0 && normalizedLabel.includes("cash")) {
    return "cash";
  }

  if (asset.isin) {
    return "security";
  }

  return "other";
}

function inferCountry(asset: {
  isin: string | null;
  currencies: string[];
}): string | null {
  const isinPrefix = normalizeCountry(asset.isin?.slice(0, 2) ?? null);
  if (isinPrefix) {
    return isinPrefix;
  }

  if (asset.currencies.length === 1 && asset.currencies[0] === "EUR") {
    return "ES";
  }

  return null;
}

function inferForeignBlock(input: {
  country: string | null;
  assetType: CanonicalAssetType;
}): CanonicalForeignAssetBlock | null {
  if (!input.country || input.country === "ES") {
    return null;
  }

  if (input.assetType === "account" || input.assetType === "cash") {
    return "accounts";
  }

  if (input.assetType === "security" || input.assetType === "fund") {
    return "securities";
  }

  if (input.assetType === "insurance" || input.assetType === "real_estate") {
    return "insurance_real_estate";
  }

  return "other";
}

function inferBaseYearEndValue(asset: {
  open_cost_basis: number | null;
  gross_amount_total: number | null;
  realized_gain_total: number | null;
}): number | null {
  if (typeof asset.open_cost_basis === "number") {
    return asset.open_cost_basis;
  }

  if (typeof asset.gross_amount_total === "number") {
    return asset.gross_amount_total;
  }

  if (typeof asset.realized_gain_total === "number") {
    return asset.realized_gain_total;
  }

  return null;
}

function inferValuationMethod(input: {
  assetType: CanonicalAssetType;
  yearEndValue: number | null;
  q4AvgBalance: number | null;
  baseYearEndValue: number | null;
}): CanonicalValuationMethod {
  if (input.assetType === "account" && typeof input.q4AvgBalance === "number") {
    return "q4_average";
  }

  if (typeof input.yearEndValue === "number") {
    if (input.assetType === "account") {
      return "year_end_value";
    }

    return input.baseYearEndValue === input.yearEndValue ? "cost_basis" : "manual";
  }

  if (typeof input.baseYearEndValue === "number") {
    return input.assetType === "security" || input.assetType === "fund" ? "cost_basis" : "year_end_value";
  }

  return "pending";
}

function resolveStringEnum<T extends readonly string[]>(
  candidate: unknown,
  allowed: T
): T[number] | null {
  if (!hasStringValue(candidate)) {
    return null;
  }

  const normalized = candidate.trim();
  return allowed.includes(normalized as T[number]) ? (normalized as T[number]) : null;
}

export function applyCanonicalAssetMetadata(
  asset: Omit<
    CanonicalAssetSummary,
    | "asset_type"
    | "holder_role"
    | "ownership_pct"
    | "country"
    | "year_end_value"
    | "q4_avg_balance"
    | "valuation_method"
    | "foreign_block"
  >,
  metadata?: AssetMetadata | null
): CanonicalAssetSummary {
  const nextMetadata = metadata ?? {};
  const assetType = resolveStringEnum(nextMetadata.manual_asset_type, canonicalAssetTypes) ?? inferAssetType(asset);
  const country =
    normalizeCountry(
      hasStringValue(nextMetadata.manual_country)
        ? nextMetadata.manual_country
        : inferCountry(asset)
    );
  const yearEndValue =
    toNullableNumberFromUnknown(nextMetadata.manual_year_end_value) ?? inferBaseYearEndValue(asset);
  const q4AvgBalance = toNullableNumberFromUnknown(nextMetadata.manual_q4_avg_balance);
  const valuationMethod =
    resolveStringEnum(nextMetadata.manual_valuation_method, canonicalValuationMethods) ??
    inferValuationMethod({
      assetType,
      yearEndValue,
      q4AvgBalance,
      baseYearEndValue: inferBaseYearEndValue(asset)
    });
  const foreignBlock =
    resolveStringEnum(nextMetadata.manual_foreign_block, canonicalForeignAssetBlocks) ??
    inferForeignBlock({
      country,
      assetType
    });

  return {
    ...asset,
    asset_type: assetType,
    holder_role:
      resolveStringEnum(nextMetadata.manual_holder_role, canonicalHolderRoles) ?? "titular",
    ownership_pct:
      clampPercentage(toNullableNumberFromUnknown(nextMetadata.manual_ownership_pct)) ?? 100,
    country,
    year_end_value: yearEndValue,
    q4_avg_balance: q4AvgBalance,
    valuation_method: valuationMethod,
    foreign_block: foreignBlock
  };
}

export function resolveCanonicalAssetDeclarableValue(asset: Pick<
  CanonicalAssetSummary,
  | "asset_type"
  | "year_end_value"
  | "q4_avg_balance"
  | "valuation_method"
  | "ownership_pct"
  | "open_cost_basis"
  | "gross_amount_total"
  | "realized_gain_total"
>): number | null {
  const accountValueCandidates =
    asset.asset_type === "account"
      ? [asset.year_end_value, asset.q4_avg_balance].filter((value): value is number => typeof value === "number")
      : [];

  const baseValue =
    accountValueCandidates.length > 0
      ? Math.max(...accountValueCandidates)
      : asset.valuation_method === "q4_average"
        ? asset.q4_avg_balance
        : asset.year_end_value ??
          asset.open_cost_basis ??
          asset.gross_amount_total ??
          asset.realized_gain_total;

  if (typeof baseValue !== "number") {
    return null;
  }

  const ownershipPct = typeof asset.ownership_pct === "number" ? asset.ownership_pct : 100;
  return Number((baseValue * (ownershipPct / 100)).toFixed(2));
}

function compareDates(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function sortByRecentDate<T extends { operation_date: string; operation_type: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const byDate = new Date(right.operation_date).getTime() - new Date(left.operation_date).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    return left.operation_type.localeCompare(right.operation_type);
  });
}

export function deriveCanonicalAssetViews(input: {
  operations: CanonicalOperation[];
  lots: CanonicalLot[];
  saleSummaries: CanonicalSaleSummary[];
  expedienteMetaById?: Map<string, ExpedienteMeta>;
}): {
  assets: CanonicalAssetSummary[];
  fiscalEvents: CanonicalFiscalEvent[];
} {
  const assets = new Map<string, CanonicalAssetSummary>();
  const fiscalEvents: CanonicalFiscalEvent[] = [];
  const saleSummaryByOperationId = new Map(
    input.saleSummaries.map((summary) => [summary.sale_operation_id, summary])
  );

  function ensureAsset(params: {
    asset_key: string;
    isin: string | null;
    label: string;
  }): CanonicalAssetSummary {
    const existing = assets.get(params.asset_key);
    if (existing) {
      return existing;
    }

    const created: CanonicalAssetSummary = {
      canonical_id: null,
      asset_key: params.asset_key,
      isin: params.isin?.trim().toUpperCase() ?? null,
      label: params.label,
      notes: null,
      currencies: [],
      expedientes: [],
      fiscal_years: [],
      events_total: 0,
      dividends: 0,
      interests: 0,
      acquisitions: 0,
      transmissions: 0,
      retentions: 0,
      gains_losses: 0,
      open_lots: 0,
      closed_lots: 0,
      quantity_open: null,
      open_cost_basis: null,
      gross_amount_total: null,
      realized_gain_total: null,
      pending_transmissions: 0,
      latest_event_date: null,
      last_source: null,
      asset_type: "other",
      holder_role: "titular",
      ownership_pct: 100,
      country: params.isin?.slice(0, 2).toUpperCase() ?? null,
      year_end_value: null,
      q4_avg_balance: null,
      valuation_method: "pending",
      foreign_block: null
    };

    assets.set(params.asset_key, created);
    return created;
  }

  for (const operation of sortByRecentDate(input.operations)) {
    const assetKey = assetKeyFromValues({
      isin: operation.isin,
      description: operation.description,
      fallbackType: operation.operation_type,
      fallbackId: operation.id
    });
    const assetLabel = assetLabelFromValues({
      isin: operation.isin,
      description: operation.description,
      fallbackType: operation.operation_type
    });
    const asset = ensureAsset({
      asset_key: assetKey,
      isin: operation.isin,
      label: assetLabel
    });
    const meta = input.expedienteMetaById?.get(operation.expediente_id);
    const currency = normalizedCurrency(operation.currency);
    const grossAmount = absNumber(operation.amount);
    const summary = operation.operation_type === "VENTA" ? saleSummaryByOperationId.get(operation.id) : null;

    asset.events_total += 1;
    asset.latest_event_date = compareDates(asset.latest_event_date, operation.operation_date);
    asset.last_source = operation.source;
    asset.gross_amount_total = sumNullable(asset.gross_amount_total, grossAmount);
    if (currency && !asset.currencies.includes(currency)) {
      asset.currencies.push(currency);
    }
    if (meta) {
      if (!asset.expedientes.includes(meta.reference)) {
        asset.expedientes.push(meta.reference);
      }
      if (!asset.fiscal_years.includes(meta.fiscal_year)) {
        asset.fiscal_years.push(meta.fiscal_year);
      }
    }

    let eventKind: CanonicalFiscalEvent["event_kind"] = "posicion";
    switch (operation.operation_type) {
      case "DIVIDENDO":
        asset.dividends += 1;
        eventKind = "dividendo";
        break;
      case "INTERES":
        asset.interests += 1;
        eventKind = "interes";
        break;
      case "COMPRA":
        asset.acquisitions += 1;
        eventKind = "adquisicion";
        break;
      case "VENTA":
        asset.transmissions += 1;
        if (!summary) {
          asset.pending_transmissions += 1;
        }
        eventKind = "transmision";
        break;
      default:
        eventKind = "posicion";
        break;
    }

    fiscalEvents.push({
      canonical_id: null,
      event_id: `op:${operation.id}`,
      expediente_id: operation.expediente_id,
      expediente_reference: meta?.reference ?? null,
      fiscal_year: meta?.fiscal_year ?? null,
      model_type: meta?.model_type ?? null,
      asset_key: assetKey,
      asset_label: assetLabel,
      isin: operation.isin?.trim().toUpperCase() ?? null,
      event_kind: eventKind,
      operation_type: operation.operation_type,
      operation_date: operation.operation_date,
      description: operation.description,
      amount: grossAmount,
      currency,
      quantity: absNumber(operation.quantity),
      retention: absNumber(operation.retention),
      realized_gain: operation.realized_gain,
      source: operation.source,
      status: summary?.status ?? "RECORDED",
      notes: null
    });

    const retentionValue = absNumber(operation.retention);
    if (retentionValue !== null && retentionValue > 0) {
      asset.retentions += 1;
      asset.events_total += 1;
      fiscalEvents.push({
        canonical_id: null,
        event_id: `ret:${operation.id}`,
        expediente_id: operation.expediente_id,
        expediente_reference: meta?.reference ?? null,
        fiscal_year: meta?.fiscal_year ?? null,
        model_type: meta?.model_type ?? null,
        asset_key: assetKey,
        asset_label: assetLabel,
        isin: operation.isin?.trim().toUpperCase() ?? null,
        event_kind: "retencion",
        operation_type: operation.operation_type,
        operation_date: operation.operation_date,
        description: operation.description,
        amount: retentionValue,
        currency,
        quantity: absNumber(operation.quantity),
        retention: retentionValue,
        realized_gain: null,
        source: operation.source,
        status: "RECORDED",
        notes: null
      });
    }
  }

  for (const lot of input.lots) {
    const assetKey = assetKeyFromValues({
      isin: lot.isin,
      description: lot.description,
      fallbackType: "LOTE",
      fallbackId: lot.id
    });
    const assetLabel = assetLabelFromValues({
      isin: lot.isin,
      description: lot.description,
      fallbackType: "Lote"
    });
    const asset = ensureAsset({
      asset_key: assetKey,
      isin: lot.isin,
      label: assetLabel
    });
    const meta = input.expedienteMetaById?.get(lot.expediente_id);
    const currency = normalizedCurrency(lot.currency);

    if (lot.status === "OPEN") {
      asset.open_lots += 1;
    } else {
      asset.closed_lots += 1;
    }

    asset.quantity_open = sumNullable(asset.quantity_open, lot.quantity_open);
    asset.open_cost_basis = sumNullable(asset.open_cost_basis, lot.total_cost);
    if (currency && !asset.currencies.includes(currency)) {
      asset.currencies.push(currency);
    }
    if (meta) {
      if (!asset.expedientes.includes(meta.reference)) {
        asset.expedientes.push(meta.reference);
      }
      if (!asset.fiscal_years.includes(meta.fiscal_year)) {
        asset.fiscal_years.push(meta.fiscal_year);
      }
    }
  }

  for (const saleSummary of input.saleSummaries) {
    const assetKey = assetKeyFromValues({
      isin: saleSummary.isin,
      description: saleSummary.description,
      fallbackType: "VENTA",
      fallbackId: saleSummary.sale_operation_id
    });
    const assetLabel = assetLabelFromValues({
      isin: saleSummary.isin,
      description: saleSummary.description,
      fallbackType: "Transmision"
    });
    const operation = input.operations.find((candidate) => candidate.id === saleSummary.sale_operation_id);
    const meta = operation ? input.expedienteMetaById?.get(operation.expediente_id) : undefined;
    const asset = ensureAsset({
      asset_key: assetKey,
      isin: saleSummary.isin,
      label: assetLabel
    });

    asset.events_total += 1;
    asset.gains_losses += 1;
    if (saleSummary.status !== "MATCHED") {
      asset.pending_transmissions += 1;
    }
    asset.realized_gain_total = sumNullable(asset.realized_gain_total, saleSummary.realized_gain);
    asset.latest_event_date = compareDates(asset.latest_event_date, saleSummary.operation_date);
    if (meta) {
      if (!asset.expedientes.includes(meta.reference)) {
        asset.expedientes.push(meta.reference);
      }
      if (!asset.fiscal_years.includes(meta.fiscal_year)) {
        asset.fiscal_years.push(meta.fiscal_year);
      }
    }

    fiscalEvents.push({
      canonical_id: null,
      event_id: `gp:${saleSummary.sale_operation_id}`,
      expediente_id: operation?.expediente_id ?? "",
      expediente_reference: meta?.reference ?? null,
      fiscal_year: meta?.fiscal_year ?? null,
      model_type: meta?.model_type ?? null,
      asset_key: assetKey,
      asset_label: assetLabel,
      isin: saleSummary.isin?.trim().toUpperCase() ?? null,
      event_kind: "ganancia_perdida",
      operation_type: "VENTA",
      operation_date: saleSummary.operation_date,
      description: saleSummary.description,
      amount: saleSummary.sale_amount,
      currency: normalizedCurrency(saleSummary.currency),
      quantity: absNumber(saleSummary.quantity),
      retention: null,
      realized_gain: saleSummary.realized_gain,
      source: saleSummary.source,
      status: saleSummary.status,
      notes: null
    });
  }

  const assetList = [...assets.values()].map((asset) => ({
    ...applyCanonicalAssetMetadata(
      {
        ...asset,
        currencies: [...asset.currencies].sort(),
        expedientes: [...asset.expedientes].sort(),
        fiscal_years: [...asset.fiscal_years].sort((left, right) => right - left)
      },
      null
    )
  }));

  assetList.sort((left, right) => {
    const leftPending = left.pending_transmissions;
    const rightPending = right.pending_transmissions;
    if (rightPending !== leftPending) {
      return rightPending - leftPending;
    }

    const leftDate = left.latest_event_date ? new Date(left.latest_event_date).getTime() : 0;
    const rightDate = right.latest_event_date ? new Date(right.latest_event_date).getTime() : 0;
    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    return right.events_total - left.events_total;
  });

  fiscalEvents.sort((left, right) => {
    const byDate = new Date(right.operation_date).getTime() - new Date(left.operation_date).getTime();
    if (byDate !== 0) {
      return byDate;
    }

    return left.event_kind.localeCompare(right.event_kind);
  });

  return {
    assets: assetList,
    fiscalEvents
  };
}
