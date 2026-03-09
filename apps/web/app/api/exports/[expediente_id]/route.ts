import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  accessErrorMessage,
  accessErrorStatus,
  assertClientAccess,
  getCurrentSessionUser,
  requirePermission
} from "@/lib/auth";
import {
  buildModel100RuntimeFromCanonical,
  buildModel714RecordsFromCanonicalAssets,
  buildModel720RecordsFromCanonicalAssets,
  summarizeCanonicalAssets
} from "@/lib/canonical-exports";
import { loadPersistedCanonicalExpedienteView } from "@/lib/canonical-store";
import { isExportModel, type ExportModel } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
import {
  expedienteModelLabel,
  exportModelForExpediente,
  exportModelLabel,
  isExpedienteModelType,
  isExportModelCompatibleWithExpediente
} from "@/lib/expediente-models";
import { deriveCanonicalAssetViews } from "@/lib/fiscal-canonical";
import {
  summarizeSalesFromOperations,
  type PersistedSaleAllocationRow,
  type RuntimeOperationRow
} from "@/lib/lots";
import {
  assessModel714Requirement,
  assessModel720Requirement,
  foreignBlockTotalsFromPayload
} from "@/lib/model-filing-rules";
import { validateModel100, validateModel714, validateModel720 } from "@/lib/rules/validation";
import { sha256 } from "@/lib/hash";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface OperationRow {
  id: string;
  expediente_id: string;
  isin: string | null;
  operation_type: string;
  operation_date: string;
  description: string | null;
  amount: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  retention: number | string | null;
  realized_gain: number | string | null;
  source: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";
  manual_notes: string | null;
  created_at?: string;
}

type LotRow = {
  id: string;
  expediente_id: string;
  isin: string;
  description: string | null;
  quantity_open: number | string;
  total_cost: number | string | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
};

type Prior720FilingContext = {
  priorFiledYear: number | null;
  previousBlockTotals: ReturnType<typeof summarizeCanonicalAssets>["foreignBlockTotals"] | null;
};

function toModelExtension(model: ExportModel): string {
  return model;
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

function countForeignTransmissionEvents(input: {
  assets: ReturnType<typeof deriveCanonicalAssetViews>["assets"];
  fiscalEvents: ReturnType<typeof deriveCanonicalAssetViews>["fiscalEvents"];
}): number {
  const countriesByAssetKey = new Map(input.assets.map((asset) => [asset.asset_key, asset.country]));
  return input.fiscalEvents.filter((event) => {
    if (event.event_kind !== "transmision") {
      return false;
    }

    const country = countriesByAssetKey.get(event.asset_key);
    return Boolean(country && country !== "ES");
  }).length;
}

async function loadCanonicalExportContext(
  supabase: SupabaseClient,
  expediente: {
    id: string;
    reference: string;
    client_id: string;
    fiscal_year: number;
    model_type: string;
  }
): Promise<{
  assets: ReturnType<typeof deriveCanonicalAssetViews>["assets"];
  fiscalEvents: ReturnType<typeof deriveCanonicalAssetViews>["fiscalEvents"];
  runtimeMode: "persisted" | "derived";
}> {
  const [operationsResult, allocationsResult, lotsResult] = await Promise.all([
    supabase
      .from(dbTables.operations)
      .select(
        "id, expediente_id, isin, operation_type, operation_date, description, amount, currency, quantity, retention, realized_gain, source, manual_notes, created_at"
      )
      .eq("expediente_id", expediente.id)
      .order("operation_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from(dbTables.saleAllocations)
      .select(
        "sale_operation_id, quantity, sale_amount_allocated, total_cost, realized_gain, acquisition_date, acquisition_operation_id, currency"
      )
      .eq("expediente_id", expediente.id),
    supabase
      .from(dbTables.lots)
      .select("id, expediente_id, isin, description, quantity_open, total_cost, currency, status")
      .eq("expediente_id", expediente.id)
  ]);

  if (operationsResult.error || allocationsResult.error || lotsResult.error) {
    throw new Error(
      `No se pudo cargar el runtime fiscal canónico: ${
        operationsResult.error?.message ??
        allocationsResult.error?.message ??
        lotsResult.error?.message ??
        "error desconocido"
      }`
    );
  }

  const operations = (operationsResult.data ?? []) as OperationRow[];
  const allocations = (allocationsResult.data ?? []) as PersistedSaleAllocationRow[];
  const lots = (lotsResult.data ?? []) as LotRow[];
  const saleSummaries = summarizeSalesFromOperations({
    operations: operations as RuntimeOperationRow[],
    allocations
  });

  const derivedCanonicalViews = deriveCanonicalAssetViews({
    operations: operations.map((row) => ({
      id: row.id,
      expediente_id: row.expediente_id,
      operation_type: row.operation_type,
      operation_date: row.operation_date,
      isin: row.isin,
      description: row.description ?? row.manual_notes,
      amount: toNullableNumber(row.amount),
      currency: row.currency,
      quantity: toNullableNumber(row.quantity),
      retention: toNullableNumber(row.retention),
      realized_gain: toNullableNumber(row.realized_gain),
      source: row.source
    })),
    lots: lots.map((row) => ({
      id: row.id,
      expediente_id: row.expediente_id,
      isin: row.isin,
      description: row.description,
      quantity_open: toNullableNumber(row.quantity_open) ?? 0,
      total_cost: toNullableNumber(row.total_cost),
      currency: row.currency,
      status: row.status
    })),
    saleSummaries,
    expedienteMetaById: new Map([
      [
        expediente.id,
        {
          reference: expediente.reference,
          fiscal_year: expediente.fiscal_year,
          model_type: expediente.model_type
        }
      ]
    ])
  });

  const persistedCanonicalViews = await loadPersistedCanonicalExpedienteView(supabase, {
    clientId: expediente.client_id,
    expedienteId: expediente.id,
    expedienteReference: expediente.reference,
    eventLimit: null
  });

  const shouldFallbackToDerived =
    persistedCanonicalViews === null ||
    (
      persistedCanonicalViews.assets.length === 0 &&
      persistedCanonicalViews.fiscalEvents.length === 0 &&
      (operations.length > 0 || lots.length > 0 || saleSummaries.length > 0)
    );

  return {
    ...(shouldFallbackToDerived ? derivedCanonicalViews : persistedCanonicalViews),
    runtimeMode: shouldFallbackToDerived ? "derived" : "persisted"
  };
}

async function loadLatestPrior720FilingContext(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    currentFiscalYear: number;
  }
): Promise<Prior720FilingContext> {
  const { data: expedientes, error: expedientesError } = await supabase
    .from(dbTables.expedientes)
    .select("id, reference, client_id, fiscal_year, model_type")
    .eq("client_id", input.clientId)
    .eq("model_type", "720")
    .lt("fiscal_year", input.currentFiscalYear)
    .order("fiscal_year", { ascending: false });

  if (expedientesError) {
    throw new Error(`No se pudo cargar el histórico 720: ${expedientesError.message}`);
  }

  for (const expediente of expedientes ?? []) {
    const { data: exportRows, error: exportError } = await supabase
      .from(dbTables.exports)
      .select("payload, generated_at, created_at")
      .eq("expediente_id", expediente.id)
      .eq("model", "720")
      .order("generated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (exportError) {
      throw new Error(`No se pudo cargar el histórico exportado 720: ${exportError.message}`);
    }

    const latestExport = exportRows?.[0];
    if (!latestExport) {
      continue;
    }

    const totalsFromPayload = foreignBlockTotalsFromPayload(latestExport.payload);
    if (totalsFromPayload) {
      return {
        priorFiledYear: expediente.fiscal_year,
        previousBlockTotals: totalsFromPayload
      };
    }

    const canonicalContext = await loadCanonicalExportContext(supabase, {
      id: expediente.id,
      reference: expediente.reference,
      client_id: input.clientId,
      fiscal_year: expediente.fiscal_year,
      model_type: expediente.model_type
    });

    return {
      priorFiledYear: expediente.fiscal_year,
      previousBlockTotals: summarizeCanonicalAssets({ assets: canonicalContext.assets }).foreignBlockTotals
    };
  }

  return {
    priorFiledYear: null,
    previousBlockTotals: null
  };
}

export async function GET(request: Request, context: { params: { expediente_id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "exports.generate");
    const resolvedExpediente = normalizeExpedienteId(context.params.expediente_id);
    const searchParams = new URL(request.url).searchParams;
    const modelCandidate = searchParams.get("model") ?? "100";

    if (!isExportModel(modelCandidate)) {
      return NextResponse.json(
        {
          error: "Parametro model invalido. Valores permitidos: 100, 714, 720"
        },
        { status: 400 }
      );
    }

    const { data: expediente, error: expedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, client_id, fiscal_year, model_type, title, status")
      .eq("id", resolvedExpediente.id)
      .maybeSingle();

    if (expedienteError) {
      return NextResponse.json(
        { error: `No se pudo cargar el expediente para exportación: ${expedienteError.message}` },
        { status: 500 }
      );
    }

    if (!expediente) {
      return NextResponse.json(
        { error: "El expediente no existe. Crea el expediente antes de generar exportaciones." },
        { status: 404 }
      );
    }

    if (!expediente.client_id) {
      return NextResponse.json(
        { error: "El expediente no está vinculado a un cliente. Corrige la ficha antes de exportar." },
        { status: 409 }
      );
    }

    await assertClientAccess(supabase, sessionUser, expediente.client_id, "exports.generate");

    const model = modelCandidate;
    const generatedAt = new Date().toISOString();

    if (!isExpedienteModelType(expediente.model_type)) {
      return NextResponse.json(
        { error: `El expediente tiene un modelo no soportado: ${expediente.model_type}` },
        { status: 409 }
      );
    }

    if (!isExportModelCompatibleWithExpediente(model, expediente.model_type)) {
      const expectedModel = exportModelForExpediente(expediente.model_type);
      return NextResponse.json(
        {
          error: `El expediente ${expediente.reference} es ${expedienteModelLabel(
            expediente.model_type
          )} y solo puede generar ${exportModelLabel(expectedModel)}.`
        },
        { status: 409 }
      );
    }

    const artifactPath = `exports/${expediente.id}/MODELO_${model}_${generatedAt.slice(0, 10)}.${toModelExtension(
      model
    )}`;

    const canonicalContext = await loadCanonicalExportContext(supabase, {
      id: expediente.id,
      reference: expediente.reference,
      client_id: expediente.client_id,
      fiscal_year: expediente.fiscal_year,
      model_type: expediente.model_type
    });

    const model100Runtime =
      model === "100" ? buildModel100RuntimeFromCanonical({ fiscalEvents: canonicalContext.fiscalEvents }) : null;
    const model714Records =
      model === "714" ? buildModel714RecordsFromCanonicalAssets({ assets: canonicalContext.assets }) : null;
    const model720Records =
      model === "720" ? buildModel720RecordsFromCanonicalAssets({ assets: canonicalContext.assets }) : null;
    const assetMetrics = summarizeCanonicalAssets({ assets: canonicalContext.assets });
    const model714Requirement =
      model === "714"
        ? assessModel714Requirement({
            totalValuation: assetMetrics.totalValuation
          })
        : null;
    const prior720Context =
      model === "720"
        ? await loadLatestPrior720FilingContext(supabase, {
            clientId: expediente.client_id,
            currentFiscalYear: expediente.fiscal_year
          })
        : null;
    const model720Requirement =
      model === "720"
        ? assessModel720Requirement({
            metrics: assetMetrics,
            priorFiledYear: prior720Context?.priorFiledYear ?? null,
            previousBlockTotals: prior720Context?.previousBlockTotals ?? null,
            foreignTransmissionEvents: countForeignTransmissionEvents(canonicalContext)
          })
        : null;

    const validation =
      model === "100"
        ? validateModel100({
            trades: model100Runtime?.trades ?? [],
            unresolvedSales: model100Runtime?.unresolvedSales ?? 0,
            pendingCostBasisSales: model100Runtime?.pendingCostBasisSales ?? 0,
            invalidSales: model100Runtime?.invalidSales ?? 0
          })
        : model === "714"
          ? validateModel714({
              totalAssets: assetMetrics.totalAssets,
              missingValuationAssets: assetMetrics.missingValuationAssets,
              missingOwnershipAssets: assetMetrics.missingOwnershipAssets,
              totalValuation: assetMetrics.totalValuation,
              requirementAssessment: model714Requirement
            })
          : validateModel720({
              foreignAssets: assetMetrics.foreignAssets,
              missingForeignValuationAssets: assetMetrics.missingForeignValuationAssets,
              missingForeignCountryAssets: assetMetrics.missingForeignCountryAssets,
              missingForeignBlockAssets: assetMetrics.missingForeignBlockAssets,
              missingForeignOwnershipAssets: assetMetrics.missingOwnershipAssets,
              missingForeignQ4BalanceAssets: assetMetrics.missingForeignQ4BalanceAssets,
              thresholdReachedBlocks: assetMetrics.thresholdReachedBlocks.length,
              requirementAssessment: model720Requirement
            });

    const artifactHash = sha256(
      JSON.stringify({
        expedienteId: expediente.id,
        model,
        generatedAt,
        validation,
        trades: model100Runtime?.trades.length ?? 0,
        sales: model100Runtime?.saleRecords.length ?? 0,
        assets: canonicalContext.assets.length,
        foreignAssets: assetMetrics.foreignAssets,
        fiscalEvents: canonicalContext.fiscalEvents.length,
        recordsCount:
          model === "100"
            ? model100Runtime?.saleRecords.length ?? 0
            : model === "714"
              ? model714Records?.length ?? 0
              : model720Records?.length ?? 0,
        runtimeMode: canonicalContext.runtimeMode,
        filingDecision: validation.filingDecision ?? null,
        aeatAllowed: validation.aeatAllowed ?? true
      })
    );

    const payload = {
      expediente_id: expediente.id,
      expediente_reference: expediente.reference,
      fiscal_year: expediente.fiscal_year,
      model_type: expediente.model_type,
      model,
      status: "generated" as const,
      validation_state: validation.validationState,
      artifact_path: artifactPath,
      artifact_hash: artifactHash,
      generated_at: generatedAt,
      messages: validation.messages,
      available_download_formats: ["aeat", "report", "xls"] as const,
      filing_decision: validation.filingDecision ?? null,
      aeat_allowed: validation.aeatAllowed ?? true,
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      }
    };

    const exportId = crypto.randomUUID();

    const { error: exportError } = await supabase.from(dbTables.exports).insert({
      id: exportId,
      expediente_id: expediente.id,
      model,
      status: payload.status,
      validation_state: payload.validation_state,
      artifact_path: artifactPath,
      artifact_hash: artifactHash,
      generated_at: generatedAt,
      generated_by: sessionUser.reference,
      payload: {
        messages: validation.messages,
        trades_count: model100Runtime?.trades.length ?? 0,
        sales_count: model100Runtime?.saleRecords.length ?? 0,
        assets_count: canonicalContext.assets.length,
        foreign_assets_count: assetMetrics.foreignAssets,
        missing_valuation_assets_count: assetMetrics.missingValuationAssets,
        missing_foreign_valuation_assets_count: assetMetrics.missingForeignValuationAssets,
        missing_ownership_assets_count: assetMetrics.missingOwnershipAssets,
        missing_foreign_country_assets_count: assetMetrics.missingForeignCountryAssets,
        missing_foreign_block_assets_count: assetMetrics.missingForeignBlockAssets,
        missing_foreign_q4_assets_count: assetMetrics.missingForeignQ4BalanceAssets,
        threshold_reached_blocks: assetMetrics.thresholdReachedBlocks,
        foreign_block_totals: assetMetrics.foreignBlockTotals,
        total_valuation: assetMetrics.totalValuation,
        total_foreign_valuation: assetMetrics.totalForeignValuation,
        filing_decision: validation.filingDecision ?? null,
        aeat_allowed: validation.aeatAllowed ?? true,
        model_714_requirement: model714Requirement,
        model_720_requirement: model720Requirement,
        fiscal_events_count: canonicalContext.fiscalEvents.length,
        records_count:
          model === "100"
            ? model100Runtime?.saleRecords.length ?? 0
            : model === "714"
              ? model714Records?.length ?? 0
              : model720Records?.length ?? 0,
        canonical_runtime_mode: canonicalContext.runtimeMode,
        available_download_formats: ["aeat", "report", "xls"],
        expediente_reference: expediente.reference,
        fiscal_year: expediente.fiscal_year,
        model_type: expediente.model_type
      }
    });

    if (exportError) {
      return NextResponse.json(
        {
          error: `No se pudo guardar exportacion: ${exportError.message}`
        },
        { status: 500 }
      );
    }

    const { error: auditError } = await supabase.from(dbTables.auditLog).insert({
      expediente_id: expediente.id,
      user_id: sessionUser.reference,
      action: `export.generated.${model}`,
      entity_type: "export",
      entity_id: exportId,
      after_data: {
        artifact_path: artifactPath,
        validation_state: payload.validation_state,
        messages: payload.messages
      }
    });

    if (auditError) {
      console.error("No se pudo auditar la exportación", auditError.message);
    }

    await syncExpedienteWorkflowById(supabase, {
      expedienteId: expediente.id
    }).catch(() => null);

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo generar la exportación") },
      { status: accessErrorStatus(error) }
    );
  }
}
