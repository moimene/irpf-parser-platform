import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { applyCorrectedFieldsToRecords } from "@/lib/extraction-records";
import { buildOperationsFromRecords, replaceDocumentOperations } from "@/lib/operations";
import { createSupabaseAdminClient } from "@/lib/supabase";

const reviewActionSchema = z.object({
  action: z.enum(["approve", "reject", "request_correction"]),
  reviewer: z.string().optional().default("fiscalista.demo"),
  notes: z.string().optional(),
  // Para approve: opcionalmente sobrescribir campos corregidos
  corrected_fields: z.record(z.string(), z.unknown()).optional(),
});

export const dynamic = "force-dynamic";

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

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const { action, notes, corrected_fields } = parsed.data;
    const extractionId = params.extraction_id;
    const reviewer = sessionUser.reference;

    const { data: extraction, error: fetchError } = await supabase
      .from(dbTables.extractions)
      .select("id, document_id, normalized_payload, review_status")
      .eq("id", extractionId)
      .single();

    if (fetchError || !extraction) {
      return NextResponse.json({ error: "Extracción no encontrada" }, { status: 404 });
    }

    const { data: document, error: documentError } = await supabase
      .from(dbTables.documents)
      .select("id, expediente_id")
      .eq("id", extraction.document_id)
      .single();

    if (documentError || !document) {
      return NextResponse.json({ error: "Documento asociado no encontrado" }, { status: 404 });
    }

    await assertExpedienteAccess(supabase, sessionUser, document.expediente_id, "review.write");

    const reviewStatusMap: Record<string, string> = {
      approve: "validated",
      reject: "rejected",
      request_correction: "pending"
    };
    const newReviewStatus = reviewStatusMap[action];

    let updatedPayload = extraction.normalized_payload as Record<string, unknown>;
    if (action === "approve" && corrected_fields && Object.keys(corrected_fields).length > 0) {
      const currentRecords = Array.isArray(updatedPayload.records)
        ? (updatedPayload.records as Array<Record<string, unknown>>)
        : [];
      const correctedRecords = applyCorrectedFieldsToRecords(currentRecords, corrected_fields);

      updatedPayload = {
        ...updatedPayload,
        records: correctedRecords,
        corrections: corrected_fields,
        corrected_by: reviewer,
        corrected_at: new Date().toISOString()
      };
    }

    const { error: updateError } = await supabase
      .from(dbTables.extractions)
      .update({
        review_status: newReviewStatus,
        normalized_payload: updatedPayload,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewer
      })
      .eq("id", extractionId);

    if (updateError) {
      return NextResponse.json(
        { error: `No se pudo actualizar la revisión: ${updateError.message}` },
        { status: 500 }
      );
    }

    let operationsSaved = 0;
    if (action === "approve") {
      const records = (updatedPayload.records as Array<Record<string, unknown>>) ?? [];
      const operationsToInsert = buildOperationsFromRecords({
        records,
        expedienteId: document.expediente_id,
        documentId: extraction.document_id,
        source: "MANUAL",
        manualNotes: notes,
        reviewedBy: reviewer
      });

      try {
        await replaceDocumentOperations(
          supabase,
          extraction.document_id,
          document.expediente_id,
          operationsToInsert
        );
      } catch (error) {
        return NextResponse.json(
          {
            error: `Revisión guardada pero error al persistir operaciones: ${
              error instanceof Error ? error.message : "desconocido"
            }`
          },
          { status: 207 }
        );
      }
      operationsSaved = operationsToInsert.length;

      await supabase
        .from(dbTables.documents)
        .update({ processing_status: "completed" })
        .eq("id", extraction.document_id);
    } else {
      await supabase
        .from(dbTables.documents)
        .update({ processing_status: action === "reject" ? "failed" : "manual_review" })
        .eq("id", extraction.document_id);
    }

    await supabase.from(dbTables.auditLog).insert({
      expediente_id: document.expediente_id,
      user_id: reviewer,
      action: `review.${action}`,
      entity_type: "extraction",
      entity_id: extractionId,
      after_data: {
        review_status: newReviewStatus,
        notes,
        operations_saved: operationsSaved
      }
    });

    return NextResponse.json({
      extraction_id: extractionId,
      review_status: newReviewStatus,
      operations_saved: operationsSaved,
      message:
        action === "approve"
          ? `Aprobado. ${operationsSaved} operación(es) guardadas en irpf_operations.`
          : action === "reject"
            ? "Documento rechazado. Requiere nueva ingesta."
            : "Marcado para corrección."
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo completar la revisión") },
      { status: accessErrorStatus(error) }
    );
  }
}
