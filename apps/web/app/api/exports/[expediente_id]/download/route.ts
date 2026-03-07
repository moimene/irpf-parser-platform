/**
 * GET /api/exports/[expediente_id]/download?model=100|714|720&nif=XXXXXXXX
 *
 * Genera y descarga el fichero AEAT en formato de longitud fija (500 chars/registro).
 * Sprint 4 — Exportación AEAT real.
 */
import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { toAeatRecord } from "@/lib/operations";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { generateAeatFile, type AeatRecord } from "@/lib/aeat/format";

export const dynamic = "force-dynamic";

type OperationRow = {
  id: string;
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

    const { data, error } = await supabase
      .from(dbTables.operations)
      .select(
        "id, isin, operation_type, operation_date, quantity, realized_gain, description, amount, currency, retention, origin_trace, manual_notes"
      )
      .eq("expediente_id", resolvedExpediente.id)
      .order("operation_date", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: `No se pudieron cargar operaciones: ${error.message}` },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as OperationRow[];
    const records: AeatRecord[] = rows.map((row) => toAeatRecord(row));

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
