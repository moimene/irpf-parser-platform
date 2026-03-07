import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { applyCorrectedFieldsToRecords } from "@/lib/extraction-records";
import { normalizeParsedRecords, normalizeSourceSpans, normalizeStructuredDocument } from "@/lib/review-editor";
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

function readString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = (payload as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}

function readWarnings(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidate = (payload as Record<string, unknown>).warnings;
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((item): item is string => typeof item === "string");
}

export async function GET(
  _request: Request,
  { params }: { params: { extraction_id: string } }
) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    const extractionId = params.extraction_id;

    const { data: extraction, error: extractionError } = await supabase
      .from(dbTables.extractions)
      .select(
        "id, document_id, raw_payload, normalized_payload, confidence, requires_manual_review, review_status, reviewed_at, reviewed_by, created_at"
      )
      .eq("id", extractionId)
      .single();

    if (extractionError || !extraction) {
      return NextResponse.json({ error: "Extracción no encontrada" }, { status: 404 });
    }

    const { data: document, error: documentError } = await supabase
      .from(dbTables.documents)
      .select("id, expediente_id, filename, source_type, processing_status, created_at")
      .eq("id", extraction.document_id)
      .single();

    if (documentError || !document) {
      return NextResponse.json({ error: "Documento asociado no encontrado" }, { status: 404 });
    }

    await assertExpedienteAccess(supabase, sessionUser, document.expediente_id, "review.write");

    const rawPayload = extraction.raw_payload as Record<string, unknown> | null;
    const normalizedPayload = extraction.normalized_payload as Record<string, unknown> | null;

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      extraction: {
        id: extraction.id,
        document_id: extraction.document_id,
        expediente_id: document.expediente_id,
        filename: document.filename,
        source_type:
          readString(rawPayload, "source_type") ??
          readString(normalizedPayload, "source_type") ??
          document.source_type,
        processing_status: document.processing_status,
        confidence: Number(extraction.confidence ?? 0),
        requires_manual_review: extraction.requires_manual_review,
        review_status: extraction.review_status,
        reviewed_at: extraction.reviewed_at,
        reviewed_by: extraction.reviewed_by,
        created_at: extraction.created_at,
        parser_strategy: readString(normalizedPayload, "parser_strategy") ?? "manual",
        template_used: readString(normalizedPayload, "template_used") ?? "unknown.v0",
        warnings: readWarnings(rawPayload),
        source_spans: normalizeSourceSpans(rawPayload?.source_spans),
        records: normalizeParsedRecords(normalizedPayload?.records),
        structured_document: normalizeStructuredDocument(rawPayload?.structured_document)
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo cargar el detalle de revisión") },
      { status: accessErrorStatus(error) }
    );
  }
}

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
    const hasCorrections = Boolean(
      corrected_fields && Object.keys(corrected_fields).length > 0 && action !== "reject"
    );

    let updatedPayload = extraction.normalized_payload as Record<string, unknown>;
    if (hasCorrections && corrected_fields) {
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
            : hasCorrections
              ? "Borrador de correcciones guardado. Documento sigue en revisión."
              : "Marcado para corrección."
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo completar la revisión") },
      { status: accessErrorStatus(error) }
    );
  }
}
