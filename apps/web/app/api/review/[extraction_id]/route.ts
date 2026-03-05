import { NextResponse } from "next/server";
import { z } from "zod";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";

const reviewActionSchema = z.object({
  action: z.enum(["approve", "reject", "request_correction"]),
  reviewer: z.string().optional().default("fiscalista.demo"),
  notes: z.string().optional(),
  // Para approve: opcionalmente sobrescribir campos corregidos
  corrected_fields: z.record(z.unknown()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { extraction_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { action, reviewer, notes, corrected_fields } = parsed.data;
  const extractionId = params.extraction_id;

  // Verificar que la extracción existe
  const { data: extraction, error: fetchError } = await supabase
    .from(dbTables.extractions)
    .select("id, document_id, expediente_id, normalized_payload, review_status")
    .eq("id", extractionId)
    .single();

  if (fetchError || !extraction) {
    return NextResponse.json({ error: "Extracción no encontrada" }, { status: 404 });
  }

  // Mapear acción → estado de revisión
  const reviewStatusMap: Record<string, string> = {
    approve: "approved",
    reject: "rejected",
    request_correction: "pending",
  };
  const newReviewStatus = reviewStatusMap[action];

  // Si hay correcciones, actualizar el normalized_payload
  let updatedPayload = extraction.normalized_payload as Record<string, unknown>;
  if (action === "approve" && corrected_fields && Object.keys(corrected_fields).length > 0) {
    updatedPayload = {
      ...updatedPayload,
      records: updatedPayload.records,
      corrections: corrected_fields,
      corrected_by: reviewer,
      corrected_at: new Date().toISOString(),
    };
  }

  // Actualizar la extracción
  const { error: updateError } = await supabase
    .from(dbTables.extractions)
    .update({
      review_status: newReviewStatus,
      normalized_payload: updatedPayload,
    })
    .eq("id", extractionId);

  if (updateError) {
    return NextResponse.json(
      { error: `No se pudo actualizar la revisión: ${updateError.message}` },
      { status: 500 }
    );
  }

  // Si se aprueba, persistir los registros en irpf_operations
  let operationsSaved = 0;
  if (action === "approve") {
    const records = (updatedPayload.records as Array<Record<string, unknown>>) ?? [];
    const operationsToInsert = records
      .filter((rec) => {
        const fields = rec.fields as Record<string, unknown> | undefined;
        const recType = String(rec.record_type ?? "");
        return ["COMPRA", "VENTA", "DIVIDENDO", "INTERES"].includes(recType) && fields;
      })
      .map((rec) => {
        const fields = rec.fields as Record<string, unknown>;
        return {
          id: crypto.randomUUID(),
          expediente_id: extraction.expediente_id,
          document_id: extraction.document_id,
          operation_type: String(rec.record_type),
          operation_date: String(fields.operation_date ?? new Date().toISOString().slice(0, 10)),
          isin: fields.isin ? String(fields.isin) : null,
          description: fields.description ? String(fields.description).slice(0, 500) : null,
          amount: fields.amount != null ? Number(fields.amount) : null,
          currency: fields.currency ? String(fields.currency) : "EUR",
          retention: fields.retention != null ? Number(fields.retention) : null,
          quantity: fields.quantity != null ? Number(fields.quantity) : null,
          realized_gain: rec.record_type === "VENTA" && fields.amount != null
            ? Number(fields.amount)
            : null,
          raw_data: fields,
          source: "parser.auto",
        };
      });

    if (operationsToInsert.length > 0) {
      const { error: opsError } = await supabase
        .from(dbTables.operations)
        .upsert(operationsToInsert, { onConflict: "id" });

      if (opsError) {
        return NextResponse.json(
          { error: `Revisión guardada pero error al persistir operaciones: ${opsError.message}` },
          { status: 207 }
        );
      }
      operationsSaved = operationsToInsert.length;
    }

    // Actualizar estado del documento a "completed"
    await supabase
      .from(dbTables.documents)
      .update({ processing_status: "completed" })
      .eq("id", extraction.document_id);
  }

  // Registrar en audit log
  await supabase.from(dbTables.auditLog).insert({
    expediente_id: extraction.expediente_id,
    user_id: reviewer,
    action: `review.${action}`,
    entity_type: "extraction",
    entity_id: extractionId,
    after_data: {
      review_status: newReviewStatus,
      notes,
      operations_saved: operationsSaved,
    },
  });

  return NextResponse.json({
    extraction_id: extractionId,
    review_status: newReviewStatus,
    operations_saved: operationsSaved,
    message: action === "approve"
      ? `Aprobado. ${operationsSaved} operación(es) guardadas en irpf_operations.`
      : action === "reject"
      ? "Documento rechazado. Requiere nueva ingesta."
      : "Marcado para corrección.",
  });
}
