import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { isExportModel, type ExportModel } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import type { TradeEvent } from "@/lib/rules-core";
import { validateModel100, validateModel714, validateModel720 } from "@/lib/rules/validation";
import { sha256 } from "@/lib/hash";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface OperationRow {
  id: string;
  isin: string | null;
  operation_type: "COMPRA" | "VENTA";
  operation_date: string;
  quantity: number | string | null;
  realized_gain: number | string | null;
}

function toModelExtension(model: ExportModel): string {
  return model;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

async function loadTrades(supabase: SupabaseClient, expedienteId: string): Promise<TradeEvent[]> {
  const { data, error } = await supabase
    .from(dbTables.operations)
    .select("id, isin, operation_type, operation_date, quantity, realized_gain")
    .eq("expediente_id", expedienteId)
    .in("operation_type", ["COMPRA", "VENTA"]);

  if (error) {
    throw new Error(`No se pudieron cargar operaciones: ${error.message}`);
  }

  const rows = (data ?? []) as OperationRow[];

  return rows.map((item) => ({
    id: item.id,
    isin: item.isin ?? "UNKNOWN",
    type: item.operation_type === "COMPRA" ? "BUY" : "SELL",
    tradeDate: item.operation_date,
    quantity: toNumber(item.quantity),
    gainLossEur: item.operation_type === "VENTA" ? toNumber(item.realized_gain) : undefined,
    assetKind: "LISTED"
  }));
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

    const trades = model === "100" ? await loadTrades(supabase, resolvedExpediente.id) : [];

    const validation =
      model === "100" ? validateModel100(trades) : model === "714" ? validateModel714() : validateModel720();

    const artifactHash = sha256(
      JSON.stringify({
        expedienteId: resolvedExpediente.id,
        model,
        generatedAt,
        validation,
        trades: trades.length
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
        trades_count: trades.length,
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
