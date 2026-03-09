import { NextResponse } from "next/server";
import { z } from "zod";
import { accessErrorMessage, accessErrorStatus, assertExpedienteAccess, getCurrentSessionUser } from "@/lib/auth";
import { findClientCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
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

function toFieldMap(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      sanitized[key] = candidate;
    }
  }

  return sanitized;
}

function toSourceSpans(value: unknown): Array<{
  page: number;
  start: number;
  end: number;
  snippet?: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const page = Number((item as Record<string, unknown>).page);
    const start = Number((item as Record<string, unknown>).start);
    const end = Number((item as Record<string, unknown>).end);
    if (!Number.isFinite(page) || !Number.isFinite(start) || !Number.isFinite(end)) {
      return [];
    }

    return [
      {
        page,
        start,
        end,
        snippet:
          typeof (item as Record<string, unknown>).snippet === "string"
            ? ((item as Record<string, unknown>).snippet as string)
            : undefined
      }
    ];
  });
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
        "id, document_id, confidence, review_status, normalized_payload, reviewed_at, reviewed_by, created_at"
      )
      .eq("id", extractionId)
      .single();

    if (extractionError || !extraction) {
      return NextResponse.json({ error: "Extracción no encontrada" }, { status: 404 });
    }

    const { data: document, error: documentError } = await supabase
      .from(dbTables.documents)
      .select("id, expediente_id, filename, processing_status, created_at, processed_at")
      .eq("id", extraction.document_id)
      .single();

    if (documentError || !document) {
      return NextResponse.json({ error: "Documento asociado no encontrado" }, { status: 404 });
    }

    await assertExpedienteAccess(supabase, sessionUser, document.expediente_id, "review.write");

    const { data: expediente, error: expedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, title, status, fiscal_year, model_type, client_id")
      .eq("id", document.expediente_id)
      .maybeSingle();

    if (expedienteError || !expediente) {
      return NextResponse.json({ error: "Expediente asociado no encontrado" }, { status: 404 });
    }

    const client = expediente.client_id ? await findClientCompat(supabase, expediente.client_id) : null;
    const normalizedPayload =
      extraction.normalized_payload && typeof extraction.normalized_payload === "object"
        ? (extraction.normalized_payload as Record<string, unknown>)
        : null;
    const rawRecords = Array.isArray(normalizedPayload?.records) ? normalizedPayload.records : [];
    const corrections =
      normalizedPayload?.corrections && typeof normalizedPayload.corrections === "object"
        ? normalizedPayload.corrections
        : null;

    return NextResponse.json({
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      },
      extraction: {
        id: extraction.id,
        document_id: extraction.document_id,
        confidence: Number(extraction.confidence ?? 0),
        review_status: extraction.review_status,
        reviewed_at: extraction.reviewed_at,
        reviewed_by: extraction.reviewed_by,
        created_at: extraction.created_at
      },
      document: {
        id: document.id,
        expediente_id: document.expediente_id,
        filename: document.filename,
        processing_status: document.processing_status,
        created_at: document.created_at,
        processed_at: document.processed_at
      },
      expediente: {
        id: expediente.id,
        reference: expediente.reference,
        title: expediente.title,
        status: expediente.status,
        fiscal_year: expediente.fiscal_year,
        model_type: expediente.model_type
      },
      client: client
        ? {
            id: client.id,
            reference: client.reference,
            display_name: client.display_name,
            nif: client.nif
          }
        : null,
      records: rawRecords.map((record, index) => {
        const typedRecord = record as Record<string, unknown>;
        return {
          record_index: index,
          record_type: typeof typedRecord.record_type === "string" ? typedRecord.record_type : "DESCONOCIDO",
          confidence:
            typeof typedRecord.confidence === "number" && Number.isFinite(typedRecord.confidence)
              ? typedRecord.confidence
              : 0,
          fields: toFieldMap(typedRecord.fields),
          source_spans: toSourceSpans(typedRecord.source_spans)
        };
      }),
      corrections
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
    }

    const nextDocumentState =
      action === "approve"
        ? {
            processing_status: "completed",
            manual_review_required: false,
            processed_at: new Date().toISOString()
          }
        : action === "reject"
          ? {
              processing_status: "failed",
              manual_review_required: false,
              processed_at: new Date().toISOString()
            }
          : {
              processing_status: "manual_review",
              manual_review_required: true
            };

    const { error: documentStatusError } = await supabase
      .from(dbTables.documents)
      .update(nextDocumentState)
      .eq("id", extraction.document_id);

    if (documentStatusError) {
      return NextResponse.json(
        {
          error: `Revisión guardada pero error al actualizar el estado documental: ${documentStatusError.message}`
        },
        { status: 500 }
      );
    }

    if (action !== "request_correction") {
      const { error: alertUpdateError } = await supabase
        .from(dbTables.alerts)
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: reviewer
        })
        .eq("entity_type", "document")
        .eq("entity_id", extraction.document_id)
        .eq("status", "open");

      if (alertUpdateError) {
        return NextResponse.json(
          {
            error: `Revisión guardada pero error al cerrar alertas del documento: ${alertUpdateError.message}`
          },
          { status: 500 }
        );
      }
    }

    const { error: auditError } = await supabase.from(dbTables.auditLog).insert({
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

    if (auditError) {
      return NextResponse.json(
        { error: `Revisión guardada pero no se pudo auditar la acción: ${auditError.message}` },
        { status: 500 }
      );
    }

    await syncExpedienteWorkflowById(supabase, {
      expedienteId: document.expediente_id
    }).catch((error) => {
      console.error("No se pudo sincronizar workflow tras revisión manual", error);
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
