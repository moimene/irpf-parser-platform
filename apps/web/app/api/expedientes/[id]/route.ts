import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { findClientCompat } from "@/lib/client-store";
import { loadCanonicalRegistrySnapshot } from "@/lib/asset-registry-store";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import {
  type FiscalRuntimeIssue,
  type RuntimeOperationRow
} from "@/lib/lots";
import { buildModel100Runtime } from "@/lib/model100-runtime";
import { serializeFiscalAdjustment, type FiscalAdjustmentRow } from "@/lib/fiscal-adjustments";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

type DocumentRow = {
  id: string;
  filename: string;
  processing_status: string;
  confidence: number | null;
  manual_review_required: boolean;
  uploaded_at: string | null;
  processed_at: string | null;
  created_at: string;
  metadata: JsonObject | null;
};

type ExtractionRow = {
  id: string;
  document_id: string;
  confidence: number | null;
  requires_manual_review: boolean;
  review_status: string;
  normalized_payload: JsonObject | null;
  created_at: string;
};

type ExportRow = {
  id: string;
  model: "100" | "714" | "720";
  status: string;
  validation_state: string;
  artifact_path: string;
  generated_at: string | null;
  created_at: string;
};

type OperationRow = {
  id: string;
  expediente_id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  retention: number | string | null;
  realized_gain: number | string | null;
  source: string;
  confidence: number | string | null;
  manual_notes: string | null;
  created_at: string;
};

type LotRow = {
  id: string;
  acquisition_operation_id: string | null;
  isin: string;
  description: string | null;
  acquisition_date: string;
  quantity_original: number | string;
  quantity_open: number | string;
  quantity_sold: number | string;
  unit_cost: number | string | null;
  total_cost: number | string | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
  source: string;
  metadata: JsonObject | null;
  created_at: string;
};

type BlockedLossRow = ReturnType<typeof buildModel100Runtime>["blockedLosses"][number];
type RuntimeIssueRow = FiscalRuntimeIssue;

type ExpedienteRow = {
  id: string;
  reference: string;
  client_id: string | null;
  fiscal_year: number;
  model_type: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function countRecords(payload: JsonObject | null): number {
  const candidate = payload?.records;
  return Array.isArray(candidate) ? candidate.length : 0;
}

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

function countLotSales(payload: JsonObject | null): number {
  const candidate = payload?.sales;
  return Array.isArray(candidate) ? candidate.length : 0;
}

function countLotTransfers(payload: JsonObject | null): number {
  const candidate = payload?.transfers_out;
  return Array.isArray(candidate) ? candidate.length : 0;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const resolvedExpediente = normalizeExpedienteId(params.id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "expedientes.read");

    const [expedienteResult, documentsResult, exportsResult, operationsResult, lotsResult, adjustmentsResult, canonicalRegistry] = await Promise.all([
      supabase
        .from(dbTables.expedientes)
        .select("id, reference, client_id, fiscal_year, model_type, title, status, created_at, updated_at")
        .eq("id", resolvedExpediente.id)
        .maybeSingle(),
      supabase
        .from(dbTables.documents)
        .select("id, filename, processing_status, confidence, manual_review_required, uploaded_at, processed_at, created_at, metadata")
        .eq("expediente_id", resolvedExpediente.id)
        .order("created_at", { ascending: false }),
      supabase
        .from(dbTables.exports)
        .select("id, model, status, validation_state, artifact_path, generated_at, created_at")
        .eq("expediente_id", resolvedExpediente.id)
        .order("created_at", { ascending: false }),
      supabase
        .from(dbTables.operations)
        .select(
          "id, expediente_id, operation_type, operation_date, isin, description, amount, currency, quantity, retention, realized_gain, source, confidence, manual_notes, created_at"
        )
        .eq("expediente_id", resolvedExpediente.id)
        .order("operation_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from(dbTables.lots)
        .select(
          "id, acquisition_operation_id, isin, description, acquisition_date, quantity_original, quantity_open, quantity_sold, unit_cost, total_cost, currency, status, source, metadata, created_at"
        )
        .eq("expediente_id", resolvedExpediente.id)
        .order("acquisition_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from(dbTables.fiscalAdjustments)
        .select(
          "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
        )
        .eq("expediente_id", resolvedExpediente.id)
        .order("operation_date", { ascending: true })
        .order("created_at", { ascending: true }),
      loadCanonicalRegistrySnapshot(supabase, resolvedExpediente.id)
    ]);

    if (
      documentsResult.error ||
      exportsResult.error ||
      operationsResult.error ||
      lotsResult.error ||
      adjustmentsResult.error
    ) {
      return NextResponse.json(
        {
          error:
            documentsResult.error?.message ??
            exportsResult.error?.message ??
            operationsResult.error?.message ??
            lotsResult.error?.message ??
            adjustmentsResult.error?.message ??
            "No se pudo cargar el expediente"
        },
        { status: 500 }
      );
    }

    if (expedienteResult.error) {
      return NextResponse.json(
        { error: `No se pudo cargar el expediente: ${expedienteResult.error.message}` },
        { status: 500 }
      );
    }

    const expediente = expedienteResult.data as ExpedienteRow | null;
    const documents = (documentsResult.data ?? []) as DocumentRow[];
    const exportsRows = (exportsResult.data ?? []) as ExportRow[];
    const operationsRows = (operationsResult.data ?? []) as OperationRow[];
    const lotsRows = (lotsResult.data ?? []) as LotRow[];
    const adjustmentsRows = (adjustmentsResult.data ?? []) as FiscalAdjustmentRow[];
    const client = expediente?.client_id ? await findClientCompat(supabase, expediente.client_id) : null;

    const documentIds = documents.map((document) => document.id);
    const extractionResult = documentIds.length === 0
      ? { data: [] as ExtractionRow[], error: null }
      : await supabase
          .from(dbTables.extractions)
          .select("id, document_id, confidence, requires_manual_review, review_status, normalized_payload, created_at")
          .in("document_id", documentIds)
          .order("created_at", { ascending: false });

    if (extractionResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar extracciones: ${extractionResult.error.message}` },
        { status: 500 }
      );
    }

    const latestExtractionByDocument = new Map<string, ExtractionRow>();
    for (const extraction of extractionResult.data ?? []) {
      if (!latestExtractionByDocument.has(extraction.document_id)) {
        latestExtractionByDocument.set(extraction.document_id, extraction);
      }
    }

    const responseDocuments = documents.map((document) => {
      const extraction = latestExtractionByDocument.get(document.id) ?? null;
      return {
        id: document.id,
        filename: document.filename,
        processing_status: document.processing_status,
        confidence: Number(document.confidence ?? 0),
        manual_review_required: document.manual_review_required,
        uploaded_at: document.uploaded_at ?? document.created_at,
        processed_at: document.processed_at,
        uploaded_by:
          document.metadata && typeof document.metadata === "object"
            ? String(document.metadata.uploaded_by ?? "")
            : null,
        latest_extraction: extraction
          ? {
              id: extraction.id,
              confidence: Number(extraction.confidence ?? 0),
              requires_manual_review: extraction.requires_manual_review,
              review_status: extraction.review_status,
              records_count: countRecords(extraction.normalized_payload),
              created_at: extraction.created_at
            }
          : null
      };
    });

    const statusCounts = responseDocuments.reduce(
      (acc, document) => {
        acc.total += 1;
        if (document.processing_status === "completed") acc.completed += 1;
        if (document.processing_status === "manual_review") acc.manual_review += 1;
        if (document.processing_status === "failed") acc.failed += 1;
        if (document.processing_status === "queued") acc.queued += 1;
        if (document.processing_status === "processing") acc.processing += 1;
        return acc;
      },
      { total: 0, queued: 0, processing: 0, manual_review: 0, completed: 0, failed: 0 }
    );

    const responseOperations = operationsRows.map((row) => ({
      id: row.id,
      operation_type: row.operation_type,
      operation_date: row.operation_date,
      isin: row.isin,
      description: row.description,
      amount: toNullableNumber(row.amount),
      currency: row.currency,
      quantity: toNullableNumber(row.quantity),
      retention: toNullableNumber(row.retention),
      realized_gain: toNullableNumber(row.realized_gain),
      source: row.source,
      confidence: toNullableNumber(row.confidence),
      manual_notes: row.manual_notes
    }));

    const persistedLots = lotsRows.map((row) => ({
      id: row.id,
      acquisition_operation_id: row.acquisition_operation_id,
      isin: row.isin,
      description: row.description,
      acquisition_date: row.acquisition_date,
      quantity_original: toNullableNumber(row.quantity_original) ?? 0,
      quantity_open: toNullableNumber(row.quantity_open) ?? 0,
      quantity_sold: toNullableNumber(row.quantity_sold) ?? 0,
      unit_cost: toNullableNumber(row.unit_cost),
      total_cost: toNullableNumber(row.total_cost),
      currency: row.currency,
      status: row.status,
      source: row.source,
      sales_count: countLotSales(row.metadata),
      transfers_count: countLotTransfers(row.metadata)
    }));

    const runtime = buildModel100Runtime({
      expedienteId: resolvedExpediente.id,
      canonicalRegistry,
      legacyOperations: operationsRows as RuntimeOperationRow[],
      adjustments: adjustmentsRows
    });
    const responseLots =
      runtime.source === "irpf_asset_fiscal_events"
        ? runtime.lots.map((lot) => ({
            id: lot.id,
            acquisition_operation_id: lot.acquisition_operation_id,
            isin: lot.isin,
            description: lot.description,
            acquisition_date: lot.acquisition_date,
            quantity_original: lot.quantity_original,
            quantity_open: lot.quantity_open,
            quantity_sold: lot.quantity_sold,
            unit_cost: lot.unit_cost,
            total_cost: lot.total_cost,
            currency: lot.currency,
            status: lot.status,
            source: lot.source,
            sales_count: countLotSales(lot.metadata),
            transfers_count: countLotTransfers(lot.metadata)
          }))
        : persistedLots;

    const saleSummaries = runtime.saleSummaries.map((summary) => ({
      sale_operation_id: summary.sale_operation_id,
      operation_date: summary.operation_date,
      isin: summary.isin,
      description: summary.description,
      quantity: summary.quantity,
      sale_amount: summary.sale_amount,
      sale_amount_allocated: summary.sale_amount_allocated,
      quantity_allocated: summary.quantity_allocated,
      missing_quantity: summary.missing_quantity,
      cost_basis: summary.cost_basis,
      realized_gain: summary.realized_gain,
      reported_realized_gain: summary.reported_realized_gain,
      currency: summary.currency,
      allocations_count: summary.allocations_count,
      status: summary.status,
      source: summary.source
    }));
    const blockedLosses = runtime.blockedLosses.map((blockedLoss: BlockedLossRow) => ({
      sale_operation_id: blockedLoss.sale_operation_id,
      blocked_by_buy_operation_id: blockedLoss.blocked_by_buy_operation_id,
      isin: blockedLoss.isin,
      sale_date: blockedLoss.sale_date,
      blocked_by_buy_date: blockedLoss.blocked_by_buy_date,
      window_months: blockedLoss.window_months,
      sale_quantity: blockedLoss.sale_quantity,
      blocked_by_buy_quantity: blockedLoss.blocked_by_buy_quantity,
      realized_loss: blockedLoss.realized_loss,
      currency: blockedLoss.currency,
      reason: blockedLoss.reason,
      sale_description: blockedLoss.sale_description,
      blocked_by_buy_description: blockedLoss.blocked_by_buy_description,
      sale_source: blockedLoss.sale_source,
      blocked_by_buy_source: blockedLoss.blocked_by_buy_source
    }));
    const runtimeIssues = runtime.issues.map((issue: RuntimeIssueRow) => ({
      code: issue.code,
      operation_id: issue.operation_id,
      isin: issue.isin ?? null,
      quantity: issue.quantity ?? null,
      message: issue.message
    }));

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      expediente_id: resolvedExpediente.id,
      expediente_reference: expediente?.reference ?? resolvedExpediente.reference,
      title: expediente?.title ?? `Expediente ${resolvedExpediente.reference}`,
      status: expediente?.status ?? "BORRADOR",
      fiscal_year: expediente?.fiscal_year ?? new Date().getFullYear(),
      model_type: expediente?.model_type ?? "IRPF",
      client:
      client
        ? {
            id: client.id,
            reference: client.reference,
            display_name: client.display_name,
            nif: client.nif
          }
        : null,
      created_at: expediente?.created_at ?? null,
      updated_at: expediente?.updated_at ?? null,
      counts: {
        ...statusCounts,
        operations: responseOperations.length,
        exports: exportsRows.length,
        lots_open: responseLots.filter((lot) => lot.status === "OPEN").length,
        lots_closed: responseLots.filter((lot) => lot.status === "CLOSED").length,
        sales_matched: saleSummaries.filter((sale) => sale.status === "MATCHED").length,
        sales_pending: saleSummaries.filter((sale) => sale.status !== "MATCHED").length,
        blocked_losses: blockedLosses.length,
        adjustments_active: adjustmentsRows.filter((adjustment) => adjustment.status === "ACTIVE").length,
        runtime_issues: runtimeIssues.length,
        assets_total: canonicalRegistry.assets.length,
        assets_foreign: canonicalRegistry.assets.filter((asset) => asset.is_foreign).length,
        assets_model_720: canonicalRegistry.assets.filter((asset) => asset.supports_720 && asset.is_foreign).length,
        fiscal_events: canonicalRegistry.fiscalEvents.length
      },
      canonical_registry_available: canonicalRegistry.available,
      runtime_source: runtime.source,
      declaration_profile: canonicalRegistry.declarationProfile,
      documents: responseDocuments,
      operations: responseOperations,
      lots: responseLots,
      adjustments: adjustmentsRows.map(serializeFiscalAdjustment),
      assets: canonicalRegistry.assets,
      fiscal_events: canonicalRegistry.fiscalEvents,
      sale_summaries: saleSummaries,
      blocked_losses: blockedLosses,
      runtime_issues: runtimeIssues,
      exports: exportsRows.map((row) => ({
        id: row.id,
        model: row.model,
        status: row.status,
        validation_state: row.validation_state,
        artifact_path: row.artifact_path,
        generated_at: row.generated_at ?? row.created_at
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar el expediente") },
      { status: accessErrorStatus(error) }
    );
  }
}
