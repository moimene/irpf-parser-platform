import type { SupabaseClient } from "@supabase/supabase-js";
import { dbTables } from "@/lib/db-tables";
import {
  applyCanonicalAssetMetadata,
  type CanonicalAssetSummary,
  type CanonicalEventStatus,
  type CanonicalFiscalEvent
} from "@/lib/fiscal-canonical";

type JsonObject = Record<string, unknown>;

type CanonicalAssetRow = {
  id: string;
  client_id: string;
  asset_key: string;
  isin: string | null;
  label: string;
  currencies: unknown;
  expedientes: unknown;
  fiscal_years: unknown;
  events_total: number;
  dividends: number;
  interests: number;
  acquisitions: number;
  transmissions: number;
  retentions: number;
  gains_losses: number;
  open_lots: number;
  closed_lots: number;
  quantity_open: number | string | null;
  open_cost_basis: number | string | null;
  gross_amount_total: number | string | null;
  realized_gain_total: number | string | null;
  pending_transmissions: number;
  latest_event_date: string | null;
  last_source: string | null;
  metadata: JsonObject | null;
  updated_at?: string | null;
};

type CanonicalFiscalEventRow = {
  id: string;
  client_id: string;
  expediente_id: string;
  asset_id: string | null;
  asset_key: string;
  source_event_id: string;
  asset_label: string;
  isin: string | null;
  event_kind: CanonicalFiscalEvent["event_kind"];
  operation_type: string;
  operation_date: string;
  description: string | null;
  amount: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  retention: number | string | null;
  realized_gain: number | string | null;
  source: string;
  status: CanonicalFiscalEvent["status"];
  metadata: JsonObject | null;
};

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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "number" ? item : typeof item === "string" ? Number(item) : Number.NaN))
    .filter((item) => Number.isFinite(item));
}

export function isMissingCanonicalRuntimeRelation(error: {
  code?: string | null;
  message?: string | null;
} | null): boolean {
  if (!error) {
    return false;
  }

  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("relation") && message.includes("does not exist")
  );
}

function mapCanonicalAssetRow(row: CanonicalAssetRow): CanonicalAssetSummary {
  const metadata = row.metadata ?? {};
  const manualLabel = typeof metadata.manual_label === "string" && metadata.manual_label.trim()
    ? metadata.manual_label.trim()
    : null;
  const manualNotes = typeof metadata.manual_notes === "string" && metadata.manual_notes.trim()
    ? metadata.manual_notes.trim()
    : null;

  return applyCanonicalAssetMetadata({
    canonical_id: row.id,
    asset_key: row.asset_key,
    isin: row.isin,
    label: manualLabel ?? row.label,
    notes: manualNotes,
    currencies: readStringArray(row.currencies),
    expedientes: readStringArray(row.expedientes),
    fiscal_years: readNumberArray(row.fiscal_years),
    events_total: row.events_total,
    dividends: row.dividends,
    interests: row.interests,
    acquisitions: row.acquisitions,
    transmissions: row.transmissions,
    retentions: row.retentions,
    gains_losses: row.gains_losses,
    open_lots: row.open_lots,
    closed_lots: row.closed_lots,
    quantity_open: toNullableNumber(row.quantity_open),
    open_cost_basis: toNullableNumber(row.open_cost_basis),
    gross_amount_total: toNullableNumber(row.gross_amount_total),
    realized_gain_total: toNullableNumber(row.realized_gain_total),
    pending_transmissions: row.pending_transmissions,
    latest_event_date: row.latest_event_date,
    last_source: row.last_source
  }, metadata);
}

function mapCanonicalFiscalEventRow(row: CanonicalFiscalEventRow): CanonicalFiscalEvent {
  const metadata = row.metadata ?? {};
  const manualDescription = typeof metadata.manual_description === "string" && metadata.manual_description.trim()
    ? metadata.manual_description.trim()
    : null;
  const manualAmount = toNullableNumber(
    typeof metadata.manual_amount === "number" || typeof metadata.manual_amount === "string"
      ? metadata.manual_amount
      : null
  );
  const manualQuantity = toNullableNumber(
    typeof metadata.manual_quantity === "number" || typeof metadata.manual_quantity === "string"
      ? metadata.manual_quantity
      : null
  );
  const manualRetention = toNullableNumber(
    typeof metadata.manual_retention === "number" || typeof metadata.manual_retention === "string"
      ? metadata.manual_retention
      : null
  );
  const manualRealizedGain = toNullableNumber(
    typeof metadata.manual_realized_gain === "number" || typeof metadata.manual_realized_gain === "string"
      ? metadata.manual_realized_gain
      : null
  );
  const manualNotes = typeof metadata.manual_notes === "string" && metadata.manual_notes.trim()
    ? metadata.manual_notes.trim()
    : null;
  const manualStatus =
    typeof metadata.manual_status === "string" &&
      ["RECORDED", "MATCHED", "UNRESOLVED", "PENDING_COST_BASIS", "INVALID_DATA"].includes(metadata.manual_status)
      ? (metadata.manual_status as CanonicalEventStatus)
      : null;

  return {
    canonical_id: row.id,
    event_id: row.source_event_id,
    expediente_id: row.expediente_id,
    expediente_reference:
      typeof metadata.expediente_reference === "string" ? metadata.expediente_reference : null,
    fiscal_year:
      typeof metadata.fiscal_year === "number"
        ? metadata.fiscal_year
        : typeof metadata.fiscal_year === "string"
          ? Number(metadata.fiscal_year)
          : null,
    model_type: typeof metadata.model_type === "string" ? metadata.model_type : null,
    asset_key: row.asset_key,
    asset_label: row.asset_label,
    isin: row.isin,
    event_kind: row.event_kind,
    operation_type: row.operation_type,
    operation_date: row.operation_date,
    description: manualDescription ?? row.description,
    amount: manualAmount ?? toNullableNumber(row.amount),
    currency: row.currency,
    quantity: manualQuantity ?? toNullableNumber(row.quantity),
    retention: manualRetention ?? toNullableNumber(row.retention),
    realized_gain: manualRealizedGain ?? toNullableNumber(row.realized_gain),
    source: row.source,
    status: manualStatus ?? row.status,
    notes: manualNotes
  };
}

const assetSelect =
  "id, client_id, asset_key, isin, label, currencies, expedientes, fiscal_years, events_total, dividends, interests, acquisitions, transmissions, retentions, gains_losses, open_lots, closed_lots, quantity_open, open_cost_basis, gross_amount_total, realized_gain_total, pending_transmissions, latest_event_date, last_source, metadata, updated_at";

const fiscalEventSelect =
  "id, client_id, expediente_id, asset_id, asset_key, source_event_id, asset_label, isin, event_kind, operation_type, operation_date, description, amount, currency, quantity, retention, realized_gain, source, status, metadata";

export async function loadPersistedCanonicalExpedienteView(
  supabase: SupabaseClient,
  input: {
    clientId: string | null;
    expedienteId: string;
    expedienteReference: string;
    eventLimit?: number | null;
  }
): Promise<{ assets: CanonicalAssetSummary[]; fiscalEvents: CanonicalFiscalEvent[] } | null> {
  if (!input.clientId) {
    return {
      assets: [],
      fiscalEvents: []
    };
  }

  const fiscalEventsQuery = supabase
    .from(dbTables.fiscalEvents)
    .select(fiscalEventSelect)
    .eq("expediente_id", input.expedienteId)
    .order("operation_date", { ascending: false });

  const [assetsResult, fiscalEventsResult] = await Promise.all([
    supabase.from(dbTables.assets).select(assetSelect).eq("client_id", input.clientId),
    typeof input.eventLimit === "number" && input.eventLimit > 0
      ? fiscalEventsQuery.limit(input.eventLimit)
      : fiscalEventsQuery
  ]);

  if (
    isMissingCanonicalRuntimeRelation(assetsResult.error) ||
    isMissingCanonicalRuntimeRelation(fiscalEventsResult.error)
  ) {
    return null;
  }

  if (assetsResult.error) {
    throw new Error(`No se pudieron cargar activos canónicos persistidos: ${assetsResult.error.message}`);
  }

  if (fiscalEventsResult.error) {
    throw new Error(`No se pudieron cargar eventos fiscales persistidos: ${fiscalEventsResult.error.message}`);
  }

  const assets = ((assetsResult.data ?? []) as CanonicalAssetRow[])
    .map((row) => mapCanonicalAssetRow(row))
    .filter((asset) => asset.expedientes.includes(input.expedienteReference));

  const assetLabelByKey = new Map(assets.map((asset) => [asset.asset_key, asset.label]));
  const fiscalEvents = ((fiscalEventsResult.data ?? []) as CanonicalFiscalEventRow[])
    .map((row) => mapCanonicalFiscalEventRow(row))
    .map((event) => ({
      ...event,
      asset_label: assetLabelByKey.get(event.asset_key) ?? event.asset_label
    }));

  return { assets, fiscalEvents };
}

export async function loadPersistedCanonicalClientView(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    eventLimit?: number;
  }
): Promise<{ assets: CanonicalAssetSummary[]; fiscalEvents: CanonicalFiscalEvent[] } | null> {
  const [assetsResult, fiscalEventsResult] = await Promise.all([
    supabase
      .from(dbTables.assets)
      .select(assetSelect)
      .eq("client_id", input.clientId)
      .order("latest_event_date", { ascending: false }),
    supabase
      .from(dbTables.fiscalEvents)
      .select(fiscalEventSelect)
      .eq("client_id", input.clientId)
      .order("operation_date", { ascending: false })
      .limit(input.eventLimit ?? 24)
  ]);

  if (
    isMissingCanonicalRuntimeRelation(assetsResult.error) ||
    isMissingCanonicalRuntimeRelation(fiscalEventsResult.error)
  ) {
    return null;
  }

  if (assetsResult.error) {
    throw new Error(`No se pudieron cargar activos canónicos del cliente: ${assetsResult.error.message}`);
  }

  if (fiscalEventsResult.error) {
    throw new Error(`No se pudieron cargar eventos fiscales del cliente: ${fiscalEventsResult.error.message}`);
  }

  const assets = ((assetsResult.data ?? []) as CanonicalAssetRow[]).map((row) => mapCanonicalAssetRow(row));
  const assetLabelByKey = new Map(assets.map((asset) => [asset.asset_key, asset.label]));

  return {
    assets,
    fiscalEvents: ((fiscalEventsResult.data ?? []) as CanonicalFiscalEventRow[])
      .map((row) => mapCanonicalFiscalEventRow(row))
      .map((event) => ({
        ...event,
        asset_label: assetLabelByKey.get(event.asset_key) ?? event.asset_label
      }))
  };
}
