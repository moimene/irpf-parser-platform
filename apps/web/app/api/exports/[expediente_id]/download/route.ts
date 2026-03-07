/**
 * GET /api/exports/[expediente_id]/download?model=100|714|720&nif=XXXXXXXX
 *
 * Genera y descarga el fichero AEAT en formato de longitud fija (500 chars/registro).
 * Sprint 4 — Exportación AEAT real.
 */
import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import {
  deriveFiscalRuntimeFromOperations,
  type RuntimeOperationRow
} from "@/lib/lots";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import type { FiscalAdjustmentRow } from "@/lib/fiscal-adjustments";
import { toAeatRecord } from "@/lib/operations";
import { validateModel100 } from "@/lib/rules/validation";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { generateAeatFile, type AeatRecord } from "@/lib/aeat/format";

export const dynamic = "force-dynamic";

type OperationRow = {
  id: string;
  expediente_id?: string;
  isin: string | null;
  operation_type: string;
  operation_date: string;
  quantity: number | string | null;
  realized_gain: number | string | null;
  description?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  retention?: number | string | null;
  origin_trace?: unknown;
  manual_notes?: string | null;
  source?: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL";
  created_at?: string;
};

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
    const url = new URL(request.url);
    const modelParam = url.searchParams.get("model") ?? "100";
    const nif = url.searchParams.get("nif") ?? "00000000T";
    const ejercicio = url.searchParams.get("ejercicio") ?? new Date().getFullYear().toString();

    if (!["100", "714", "720"].includes(modelParam)) {
      return NextResponse.json(
        { error: "Parámetro model inválido. Valores: 100, 714, 720" },
        { status: 400 }
      );
    }

    const resolvedExpediente = normalizeExpedienteId(params.expediente_id);
    await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "exports.generate");

    const [operationsResult, adjustmentsResult] = await Promise.all([
      supabase
        .from(dbTables.operations)
        .select(
          "id, expediente_id, isin, operation_type, operation_date, quantity, realized_gain, description, amount, currency, retention, origin_trace, manual_notes, source, created_at"
        )
        .eq("expediente_id", resolvedExpediente.id)
        .order("operation_date", { ascending: true }),
      modelParam === "100"
        ? supabase
            .from(dbTables.fiscalAdjustments)
            .select(
              "id, expediente_id, adjustment_type, status, target_operation_id, operation_date, isin, description, quantity, total_amount, currency, notes, metadata, created_by, updated_by, created_at, updated_at"
            )
            .eq("expediente_id", resolvedExpediente.id)
        : Promise.resolve({ data: [] as FiscalAdjustmentRow[], error: null })
    ]);

    if (operationsResult.error || adjustmentsResult.error) {
      return NextResponse.json(
        {
          error: `No se pudieron cargar operaciones: ${
            operationsResult.error?.message ?? adjustmentsResult.error?.message
          }`
        },
        { status: 500 }
      );
    }

    const rows = (operationsResult.data ?? []) as OperationRow[];
    const runtime =
      modelParam === "100"
        ? deriveFiscalRuntimeFromOperations({
            expedienteId: resolvedExpediente.id,
            operations: rows as RuntimeOperationRow[],
            adjustments: (adjustmentsResult.data ?? []) as FiscalAdjustmentRow[]
          })
        : null;
    const saleSummaries = runtime?.saleSummaries ?? [];

    if (modelParam === "100") {
      const baseValidation = validateModel100({
        trades: [],
        unresolvedSales: saleSummaries.filter((sale) => sale.status === "UNRESOLVED").length,
        pendingCostBasisSales: saleSummaries.filter((sale) => sale.status === "PENDING_COST_BASIS").length,
        invalidSales: saleSummaries.filter((sale) => sale.status === "INVALID_DATA").length,
        blockedLossesCount: runtime?.blockedLosses.length ?? 0
      });
      const adjustmentIssues =
        runtime?.issues.filter(
          (issue) => issue.code.startsWith("adjustment_") || issue.code.startsWith("transfer_out_")
        ) ?? [];
      const validation =
        adjustmentIssues.length > 0
          ? {
              validationState: "errors" as const,
              messages: [...adjustmentIssues.map((issue) => issue.message), ...baseValidation.messages]
            }
          : baseValidation;

      if (validation.validationState === "errors") {
        return NextResponse.json(
          {
            error: "El modelo 100 tiene ventas no cuadradas o sin coste fiscal y no puede descargarse.",
            messages: validation.messages
          },
          { status: 409 }
        );
      }
    }

    const records: AeatRecord[] =
      modelParam === "100"
        ? saleSummaries.map((summary) => ({
            isin: summary.isin,
            description: summary.description,
            operation_date: summary.operation_date,
            amount: summary.sale_amount,
            currency: summary.currency ?? "EUR",
            quantity: summary.quantity,
            realized_gain: summary.realized_gain,
            operation_type: "VENTA"
          }))
        : rows.map((row) => toAeatRecord(row));

    const fileContent = generateAeatFile(
      modelParam as "100" | "714" | "720",
      records,
      nif,
      ejercicio
    );

    const filename = `MODELO_${modelParam}_${resolvedExpediente.reference}_${ejercicio}.${modelParam}`;

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: resolvedExpediente.id,
      user_id: sessionUser.reference,
      action: `export.download.${modelParam}`,
      entity_type: "export",
      entity_id: resolvedExpediente.id,
      after_data: {
        filename,
        records_count: records.length,
        ejercicio,
        nif_masked: nif.slice(0, 3) + "****" + nif.slice(-1)
      }
    });

    return new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": Buffer.byteLength(fileContent, "utf8").toString(),
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo descargar el fichero AEAT") },
      { status: accessErrorStatus(error) }
    );
  }
}
