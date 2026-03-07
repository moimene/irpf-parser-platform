import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { isExportModel, type ExportModel } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import {
  buildTradeEventsFromFiscalRuntime,
  detectBlockedLossesFromFiscalRuntime,
  summarizeSalesFromOperations,
  type PersistedSaleAllocationRow,
  type RuntimeOperationRow
} from "@/lib/lots";
import { validateModel100, validateModel714, validateModel720 } from "@/lib/rules/validation";
import { sha256 } from "@/lib/hash";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface OperationRow {
  id: string;
  expediente_id: string;
  isin: string | null;
  operation_type: "COMPRA" | "VENTA";
  operation_date: string;
  description: string | null;
  amount: number | string | null;
  currency: string | null;
  quantity: number | string | null;
  realized_gain: number | string | null;
  source: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";
  manual_notes: string | null;
  created_at?: string;
}

function toModelExtension(model: ExportModel): string {
  return model;
}

async function loadModel100Runtime(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<{
  trades: ReturnType<typeof buildTradeEventsFromFiscalRuntime>;
  saleSummaries: ReturnType<typeof summarizeSalesFromOperations>;
  blockedLosses: ReturnType<typeof detectBlockedLossesFromFiscalRuntime>;
}> {
  const [operationsResult, allocationsResult] = await Promise.all([
    supabase
    .from(dbTables.operations)
      .select(
        "id, expediente_id, isin, operation_type, operation_date, description, amount, currency, quantity, realized_gain, source, manual_notes, created_at"
      )
      .eq("expediente_id", expedienteId)
      .in("operation_type", ["COMPRA", "VENTA"]),
    supabase
      .from(dbTables.saleAllocations)
      .select(
        "sale_operation_id, quantity, sale_amount_allocated, total_cost, realized_gain, acquisition_date, acquisition_operation_id, currency"
      )
      .eq("expediente_id", expedienteId)
  ]);

  if (operationsResult.error || allocationsResult.error) {
    throw new Error(
      `No se pudo cargar el runtime fiscal del modelo 100: ${
        operationsResult.error?.message ?? allocationsResult.error?.message ?? "error desconocido"
      }`
    );
  }

  const operations = (operationsResult.data ?? []) as OperationRow[];
  const allocations = (allocationsResult.data ?? []) as PersistedSaleAllocationRow[];
  const saleSummaries = summarizeSalesFromOperations({
    operations: operations as RuntimeOperationRow[],
    allocations
  });

  return {
    saleSummaries,
    blockedLosses: detectBlockedLossesFromFiscalRuntime({
      operations: operations as RuntimeOperationRow[],
      saleSummaries
    }),
    trades: buildTradeEventsFromFiscalRuntime({
      operations: operations as RuntimeOperationRow[],
      saleSummaries
    })
  };
}

export async function GET(request: Request, context: { params: { expediente_id: string } }) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
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

    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "exports.generate");

    const model = modelCandidate;
    const generatedAt = new Date().toISOString();
    const { error: expedienteError } = await supabase.from(dbTables.expedientes).upsert(
      {
        id: resolvedExpediente.id,
        reference: resolvedExpediente.reference,
        fiscal_year: new Date().getFullYear(),
        model_type: model === "100" ? "IRPF" : model === "714" ? "IP" : "720",
        title: `Expediente ${resolvedExpediente.reference}`,
        status: "EN_REVISION"
      },
      { onConflict: "id" }
    );

    if (expedienteError) {
      return NextResponse.json(
        {
          error: `No se pudo garantizar expediente para exportacion: ${expedienteError.message}`
        },
        { status: 500 }
      );
    }

    const artifactPath = `exports/${resolvedExpediente.id}/MODELO_${model}_${generatedAt.slice(0, 10)}.${toModelExtension(
      model
    )}`;

    const model100Runtime =
      model === "100" ? await loadModel100Runtime(supabase, resolvedExpediente.id) : null;

    const validation =
      model === "100"
        ? validateModel100({
            trades: model100Runtime?.trades ?? [],
            unresolvedSales:
              model100Runtime?.saleSummaries.filter((sale) => sale.status === "UNRESOLVED").length ?? 0,
            pendingCostBasisSales:
              model100Runtime?.saleSummaries.filter((sale) => sale.status === "PENDING_COST_BASIS").length ?? 0,
            invalidSales:
              model100Runtime?.saleSummaries.filter((sale) => sale.status === "INVALID_DATA").length ?? 0
          })
        : model === "714"
          ? validateModel714()
          : validateModel720();

    const artifactHash = sha256(
      JSON.stringify({
        expedienteId: resolvedExpediente.id,
        model,
        generatedAt,
        validation,
        trades: model100Runtime?.trades.length ?? 0,
        sales: model100Runtime?.saleSummaries.length ?? 0
      })
    );

    const payload = {
      expediente_id: resolvedExpediente.id,
      expediente_reference: resolvedExpediente.reference,
      model,
      status: "generated" as const,
      validation_state: validation.validationState,
      artifact_path: artifactPath,
      artifact_hash: artifactHash,
      generated_at: generatedAt,
      messages: validation.messages,
      blocked_losses: model100Runtime?.blockedLosses ?? [],
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      }
    };

    const exportId = crypto.randomUUID();

    const { error: exportError } = await supabase.from(dbTables.exports).insert({
      id: exportId,
      expediente_id: resolvedExpediente.id,
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
        sales_count: model100Runtime?.saleSummaries.length ?? 0,
        blocked_losses: model100Runtime?.blockedLosses ?? [],
        expediente_reference: resolvedExpediente.reference
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
      expediente_id: resolvedExpediente.id,
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

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo generar la exportación") },
      { status: accessErrorStatus(error) }
    );
  }
}
