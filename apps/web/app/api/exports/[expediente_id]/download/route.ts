/**
 * GET /api/exports/[expediente_id]/download?model=100|714|720&format=aeat|report|xls&nif=XXXXXXXX
 *
 * Genera salidas operativas del modelo:
 * - AEAT fijo
 * - informe textual para revisión de despacho
 * - hoja XLS operativa (TSV compatible con Excel)
 */
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
  buildOperationalRowsForModel100,
  buildOperationalRowsForModel714,
  buildOperationalRowsForModel720,
  buildModel714RecordsFromCanonicalAssets,
  buildModel720RecordsFromCanonicalAssets,
  summarizeCanonicalAssets
} from "@/lib/canonical-exports";
import { loadPersistedCanonicalExpedienteView } from "@/lib/canonical-store";
import { findClientCompat } from "@/lib/client-store";
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
  buildOperationalReport,
  buildOperationalSpreadsheet,
  type OperationalDownloadFormat
} from "@/lib/export-operational";
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
import { createSupabaseAdminClient } from "@/lib/supabase";
import { generateAeatFile, type AeatRecord } from "@/lib/aeat/format";

export const dynamic = "force-dynamic";

type OperationRow = {
  id: string;
  expediente_id: string;
  isin: string | null;
  operation_type: string;
  operation_date: string;
  quantity: number | string | null;
  realized_gain: number | string | null;
  description?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  retention?: number | string | null;
  manual_notes?: string | null;
  source?: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";
  created_at?: string;
};

type AllocationRow = {
  sale_operation_id: string;
  quantity: number | string;
  sale_amount_allocated: number | string | null;
  total_cost: number | string | null;
  realized_gain: number | string | null;
  acquisition_date: string;
  acquisition_operation_id: string | null;
  currency: string | null;
};

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

function isOperationalDownloadFormat(value: string): value is OperationalDownloadFormat {
  return ["aeat", "report", "xls"].includes(value);
}

function downloadFilename(input: {
  format: OperationalDownloadFormat;
  model: "100" | "714" | "720";
  expedienteReference: string;
  fiscalYear: string;
}): string {
  if (input.format === "report") {
    return `MODELO_${input.model}_${input.expedienteReference}_${input.fiscalYear}_informe.txt`;
  }

  if (input.format === "xls") {
    return `MODELO_${input.model}_${input.expedienteReference}_${input.fiscalYear}_operativo.xls`;
  }

  return `MODELO_${input.model}_${input.expedienteReference}_${input.fiscalYear}.${input.model}`;
}

function operationalSummaryLines(input: {
  model: "100" | "714" | "720";
  recordsCount: number;
  assetsCount: number;
  foreignAssetsCount: number;
  missingValuationAssetsCount: number;
  missingForeignValuationAssetsCount: number;
  missingOwnershipAssetsCount: number;
  missingForeignCountryAssetsCount: number;
  missingForeignBlockAssetsCount: number;
  missingForeignQ4BalanceAssetsCount: number;
  thresholdReachedBlocksCount: number;
  totalValuation: number;
  totalForeignValuation: number;
  pendingSalesCount: number;
  fiscalEventsCount: number;
}): string[] {
  const common = [
    `Registros operativos: ${input.recordsCount}`,
    `Eventos fiscales canónicos: ${input.fiscalEventsCount}`
  ];

  if (input.model === "100") {
    return [
      ...common,
      `Ventas pendientes de cierre fiscal: ${input.pendingSalesCount}`
    ];
  }

  if (input.model === "714") {
    return [
      ...common,
      `Activos patrimoniales: ${input.assetsCount}`,
      `Activos sin valoración declarable: ${input.missingValuationAssetsCount}`,
      `Activos sin titularidad suficiente: ${input.missingOwnershipAssetsCount}`,
      `Valor patrimonial total: ${input.totalValuation}`
    ];
  }

  return [
    ...common,
    `Activos extranjeros: ${input.foreignAssetsCount}`,
    `Activos extranjeros sin valoración: ${input.missingForeignValuationAssetsCount}`,
    `Activos extranjeros sin país: ${input.missingForeignCountryAssetsCount}`,
    `Activos extranjeros sin bloque 720: ${input.missingForeignBlockAssetsCount}`,
    `Cuentas extranjeras sin saldo medio Q4: ${input.missingForeignQ4BalanceAssetsCount}`,
    `Bloques sobre umbral operativo: ${input.thresholdReachedBlocksCount}`,
    `Valor extranjero total: ${input.totalForeignValuation}`
  ];
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
}> {
  const [operationsResult, allocationsResult, lotsResult] = await Promise.all([
    supabase
      .from(dbTables.operations)
      .select(
        "id, expediente_id, isin, operation_type, operation_date, quantity, realized_gain, description, amount, currency, retention, manual_notes, source, created_at"
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

  const rows = (operationsResult.data ?? []) as OperationRow[];
  const saleSummaries = summarizeSalesFromOperations({
    operations: rows as RuntimeOperationRow[],
    allocations: (allocationsResult.data ?? []) as PersistedSaleAllocationRow[]
  });

  const derivedCanonicalViews = deriveCanonicalAssetViews({
    operations: rows.map((row) => ({
      id: row.id,
      expediente_id: row.expediente_id,
      operation_type: row.operation_type,
      operation_date: row.operation_date,
      isin: row.isin,
      description: row.description ?? row.manual_notes ?? null,
      amount: toNullableNumber(row.amount),
      currency: row.currency ?? null,
      quantity: toNullableNumber(row.quantity),
      retention: toNullableNumber(row.retention),
      realized_gain: toNullableNumber(row.realized_gain),
      source: row.source ?? "AUTO"
    })),
    lots: ((lotsResult.data ?? []) as LotRow[]).map((row) => ({
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
      (rows.length > 0 ||
        ((lotsResult.data ?? []) as LotRow[]).length > 0 ||
        saleSummaries.length > 0)
    );

  return shouldFallbackToDerived ? derivedCanonicalViews : persistedCanonicalViews;
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

export async function GET(
  request: Request,
  { params }: { params: { expediente_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "exports.generate");
    const url = new URL(request.url);
    const modelParam = url.searchParams.get("model") ?? "100";
    const formatParam = url.searchParams.get("format") ?? "aeat";
    const requestedNif = url.searchParams.get("nif")?.trim().toUpperCase() ?? "";
    const requestedEjercicio = url.searchParams.get("ejercicio")?.trim() ?? "";

    if (!["100", "714", "720"].includes(modelParam)) {
      return NextResponse.json(
        { error: "Parámetro model inválido. Valores: 100, 714, 720" },
        { status: 400 }
      );
    }

    if (!isOperationalDownloadFormat(formatParam)) {
      return NextResponse.json(
        { error: "Parámetro format inválido. Valores: aeat, report, xls" },
        { status: 400 }
      );
    }

    const resolvedExpediente = normalizeExpedienteId(params.expediente_id);
    const { data: expediente, error: expedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, client_id, fiscal_year, model_type")
      .eq("id", resolvedExpediente.id)
      .maybeSingle();

    if (expedienteError) {
      return NextResponse.json(
        { error: `No se pudo cargar el expediente para descarga: ${expedienteError.message}` },
        { status: 500 }
      );
    }

    if (!expediente) {
      return NextResponse.json(
        { error: "El expediente no existe. Crea el expediente antes de descargar salidas del modelo." },
        { status: 404 }
      );
    }

    if (!expediente.client_id) {
      return NextResponse.json(
        { error: "El expediente no está vinculado a un cliente. Corrige la ficha antes de descargar." },
        { status: 409 }
      );
    }

    await assertClientAccess(supabase, sessionUser, expediente.client_id, "exports.generate");

    if (!isExpedienteModelType(expediente.model_type)) {
      return NextResponse.json(
        { error: `El expediente tiene un modelo no soportado: ${expediente.model_type}` },
        { status: 409 }
      );
    }

    if (!isExportModelCompatibleWithExpediente(modelParam as "100" | "714" | "720", expediente.model_type)) {
      const expectedModel = exportModelForExpediente(expediente.model_type);
      return NextResponse.json(
        {
          error: `El expediente ${expediente.reference} es ${expedienteModelLabel(
            expediente.model_type
          )} y solo puede descargar ${exportModelLabel(expectedModel)}.`
        },
        { status: 409 }
      );
    }

    if (requestedEjercicio && requestedEjercicio !== String(expediente.fiscal_year)) {
      return NextResponse.json(
        {
          error: `El expediente pertenece al ejercicio ${expediente.fiscal_year}. Ajusta el contexto antes de descargar.`
        },
        { status: 409 }
      );
    }

    const client = await findClientCompat(supabase, expediente.client_id);
    const nif = requestedNif || client?.nif?.trim().toUpperCase() || "";
    if (formatParam === "aeat" && !nif) {
      return NextResponse.json(
        { error: "Indica el NIF del declarante o completa el NIF del cliente antes de descargar." },
        { status: 400 }
      );
    }

    const workflowSnapshot = await syncExpedienteWorkflowById(supabase, {
      expedienteId: expediente.id
    });

    if (formatParam === "aeat" && workflowSnapshot?.canonical_approval_status !== "approved") {
      return NextResponse.json(
        {
          error: "El canónico del expediente no está aprobado. Puedes descargar informe o XLS, pero no el fichero AEAT final."
        },
        { status: 409 }
      );
    }

    const ejercicio = String(expediente.fiscal_year);
    const canonicalContext = await loadCanonicalExportContext(supabase, {
      id: expediente.id,
      reference: expediente.reference,
      client_id: expediente.client_id,
      fiscal_year: expediente.fiscal_year,
      model_type: expediente.model_type
    });
    const model100Runtime =
      modelParam === "100"
        ? buildModel100RuntimeFromCanonical({ fiscalEvents: canonicalContext.fiscalEvents })
        : null;
    const assetMetrics = summarizeCanonicalAssets({ assets: canonicalContext.assets });
    const model714Requirement =
      modelParam === "714"
        ? assessModel714Requirement({
            totalValuation: assetMetrics.totalValuation
          })
        : null;
    const prior720Context =
      modelParam === "720"
        ? await loadLatestPrior720FilingContext(supabase, {
            clientId: expediente.client_id,
            currentFiscalYear: expediente.fiscal_year
          })
        : null;
    const model720Requirement =
      modelParam === "720"
        ? assessModel720Requirement({
            metrics: assetMetrics,
            priorFiledYear: prior720Context?.priorFiledYear ?? null,
            previousBlockTotals: prior720Context?.previousBlockTotals ?? null,
            foreignTransmissionEvents: countForeignTransmissionEvents(canonicalContext)
          })
        : null;

    const validation =
      modelParam === "100"
        ? validateModel100(model100Runtime ?? {
            trades: [],
            unresolvedSales: 0,
            pendingCostBasisSales: 0,
            invalidSales: 0
          })
        : modelParam === "714"
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

    const records: AeatRecord[] =
      modelParam === "100"
        ? (model100Runtime?.saleRecords ?? []).map(
            (summary) => ({
              isin: summary.isin,
              description: summary.description,
              operation_date: summary.operation_date,
              amount: summary.amount,
              currency: summary.currency ?? "EUR",
              quantity: summary.quantity,
              realized_gain: summary.realized_gain,
              operation_type: "VENTA"
            })
          )
        : modelParam === "714"
          ? buildModel714RecordsFromCanonicalAssets({ assets: canonicalContext.assets })
          : buildModel720RecordsFromCanonicalAssets({ assets: canonicalContext.assets });

    const operationalRows =
      modelParam === "100"
        ? buildOperationalRowsForModel100({ saleRecords: model100Runtime?.saleRecords ?? [] })
        : modelParam === "714"
          ? buildOperationalRowsForModel714({ assets: canonicalContext.assets })
          : buildOperationalRowsForModel720({ assets: canonicalContext.assets });

    const summaryLines = operationalSummaryLines({
      model: modelParam as "100" | "714" | "720",
      recordsCount: formatParam === "aeat" ? records.length : operationalRows.length,
      assetsCount: assetMetrics.totalAssets,
      foreignAssetsCount: assetMetrics.foreignAssets,
      missingValuationAssetsCount: assetMetrics.missingValuationAssets,
      missingForeignValuationAssetsCount: assetMetrics.missingForeignValuationAssets,
      missingOwnershipAssetsCount: assetMetrics.missingOwnershipAssets,
      missingForeignCountryAssetsCount: assetMetrics.missingForeignCountryAssets,
      missingForeignBlockAssetsCount: assetMetrics.missingForeignBlockAssets,
      missingForeignQ4BalanceAssetsCount: assetMetrics.missingForeignQ4BalanceAssets,
      thresholdReachedBlocksCount: assetMetrics.thresholdReachedBlocks.length,
      totalValuation: assetMetrics.totalValuation,
      totalForeignValuation: assetMetrics.totalForeignValuation,
      pendingSalesCount: model100Runtime?.saleRecords.filter((sale) => sale.status !== "MATCHED").length ?? 0,
      fiscalEventsCount: canonicalContext.fiscalEvents.length
    });

    if (formatParam === "aeat" && (validation.validationState === "errors" || validation.aeatAllowed === false)) {
      const modelLabel =
        modelParam === "100"
          ? "El modelo 100 tiene ventas no cuadradas o sin coste fiscal"
          : modelParam === "714"
            ? "El modelo 714 no tiene patrimonio valorado suficiente"
            : "El modelo 720 no tiene bienes extranjeros valorados suficientes";

      return NextResponse.json(
        {
          error:
            validation.aeatAllowed === false && validation.validationState !== "errors"
              ? "La revisión normativa indica que no procede generar fichero AEAT final para este expediente en el estado actual."
              : `${modelLabel} y no puede descargarse en formato AEAT.`,
          messages: validation.messages
        },
        { status: 409 }
      );
    }

    const filename = downloadFilename({
      format: formatParam,
      model: modelParam as "100" | "714" | "720",
      expedienteReference: expediente.reference,
      fiscalYear: ejercicio
    });

    const fileContent =
      formatParam === "aeat"
        ? generateAeatFile(modelParam as "100" | "714" | "720", records, nif, ejercicio)
        : formatParam === "report"
          ? buildOperationalReport({
              model: modelParam as "100" | "714" | "720",
              expediente_reference: expediente.reference,
              fiscal_year: expediente.fiscal_year,
              client_name: client?.display_name ?? null,
              nif: nif || null,
              summary_lines: summaryLines,
              validation,
              rows: operationalRows
            })
          : buildOperationalSpreadsheet({ rows: operationalRows });

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: expediente.id,
      user_id: sessionUser.reference,
      action: `export.download.${modelParam}.${formatParam}`,
      entity_type: "export",
      entity_id: expediente.id,
      after_data: {
        filename,
        format: formatParam,
        validation_state: validation.validationState,
        records_count: formatParam === "aeat" ? records.length : operationalRows.length,
        ejercicio,
        nif_masked: nif ? nif.slice(0, 3) + "****" + nif.slice(-1) : null
      }
    });

    return new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type":
          formatParam === "xls"
            ? "application/vnd.ms-excel; charset=utf-8"
            : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename=\"${filename}\"`,
        "Content-Length": Buffer.byteLength(fileContent, "utf8").toString(),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo descargar la salida operativa del modelo") },
      { status: accessErrorStatus(error) }
    );
  }
}
