/**
 * GET /api/exports/[expediente_id]/download?model=100|714|720&nif=XXXXXXXX
 *
 * Genera y descarga el fichero AEAT en formato de longitud fija (500 chars/registro).
 * Sprint 4 — Exportación AEAT real.
 */
import { NextResponse } from "next/server";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";
import { generateAeatFile, type AeatRecord } from "@/lib/aeat/format";

type OperationRow = {
  id: string;
  isin: string | null;
  description: string | null;
  operation_type: string;
  operation_date: string;
  quantity: number | string | null;
  amount: number | string | null;
  currency: string | null;
  retention: number | string | null;
  realized_gain: number | string | null;
};

function toNum(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  request: Request,
  { params }: { params: { expediente_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

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

  // Cargar operaciones aprobadas del expediente
  const { data, error } = await supabase
    .from(dbTables.operations)
    .select(
      "id, isin, description, operation_type, operation_date, quantity, amount, currency, retention, realized_gain"
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
  const records: AeatRecord[] = rows.map((row) => ({
    isin: row.isin,
    description: row.description,
    operation_date: row.operation_date,
    operation_type: row.operation_type,
    amount: toNum(row.amount),
    currency: row.currency ?? "EUR",
    quantity: toNum(row.quantity),
    retention: toNum(row.retention),
    realized_gain: toNum(row.realized_gain),
  }));

  // Generar el fichero AEAT
  const fileContent = generateAeatFile(
    modelParam as "100" | "714" | "720",
    records,
    nif,
    ejercicio
  );

  const filename = `MODELO_${modelParam}_${resolvedExpediente.reference}_${ejercicio}.${modelParam}`;

  // Registrar en audit log
  await supabase.from(dbTables.auditLog).insert({
    expediente_id: resolvedExpediente.id,
    user_id: "api.download",
    action: `export.download.${modelParam}`,
    entity_type: "export",
    entity_id: resolvedExpediente.id,
    after_data: {
      filename,
      records_count: records.length,
      ejercicio,
      nif_masked: nif.slice(0, 3) + "****" + nif.slice(-1),
    },
  });

  return new Response(fileContent, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": Buffer.byteLength(fileContent, "utf8").toString(),
      "Cache-Control": "no-store",
    },
  });
}
