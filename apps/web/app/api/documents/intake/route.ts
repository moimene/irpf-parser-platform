import { NextResponse } from "next/server";
import { z } from "zod";
import type { ParseDocumentResponse, ProcessingStatus } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId, isUuid } from "@/lib/expediente-id";
import { emitWorkflowEvent } from "@/lib/events";
import { env } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase";

const intakeSchema = z.object({
  expediente_id: z.string().min(3),
  client_id: z.string().optional(),
  uploaded_by: z.string().optional(),
  documents: z
    .array(
      z.object({
        filename: z.string().min(2),
        storage_path: z.string().optional(),
        source_type: z.enum(["PDF", "IMAGE", "CSV", "XLSX"]).optional(),
        entity_hint: z.string().optional(),
        content_base64: z.string().optional()
      })
    )
    .min(1)
    .max(20)
});

async function processWithParser(payload: {
  documentId: string;
  expedienteId: string;
  filename: string;
  contentBase64?: string;
  entityHint?: string;
}) {
  if (!env.parserServiceUrl) {
    return;
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return;
  }

  try {
    const startedAt = new Date().toISOString();

    const { error: statusError } = await supabase
      .from(dbTables.documents)
      .update({ processing_status: "processing" })
      .eq("id", payload.documentId);

    if (statusError) {
      throw new Error(`No se pudo mover el documento a processing: ${statusError.message}`);
    }

    const response = await fetch(`${env.parserServiceUrl}/parse-document`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        document_id: payload.documentId,
        expediente_id: payload.expedienteId,
        filename: payload.filename,
        content_base64: payload.contentBase64,
        entity_hint: payload.entityHint,
        mime_type: "application/pdf"
      })
    });

    if (!response.ok) {
      throw new Error(`Parser respondió ${response.status}`);
    }

    const parsed: ParseDocumentResponse = await response.json();
    const status: ProcessingStatus = parsed.requires_manual_review ? "manual_review" : "completed";

    const { error: updateError } = await supabase
      .from(dbTables.documents)
      .update({
        processing_status: status,
        confidence: parsed.confidence,
        manual_review_required: parsed.requires_manual_review,
        processed_at: new Date().toISOString(),
        detected_template: parsed.template_used
      })
      .eq("id", payload.documentId);

    if (updateError) {
      throw new Error(`No se pudo actualizar documento parseado: ${updateError.message}`);
    }

    const { error: extractionError } = await supabase.from(dbTables.extractions).insert({
      id: crypto.randomUUID(),
      document_id: payload.documentId,
      version: 1,
      raw_payload: {
        warnings: parsed.warnings,
        source_spans: parsed.source_spans
      },
      normalized_payload: {
        records: parsed.records,
        parser_strategy: parsed.parser_strategy,
        template_used: parsed.template_used
      },
      confidence: parsed.confidence,
      requires_manual_review: parsed.requires_manual_review,
      review_status: parsed.requires_manual_review ? "pending" : "not_required"
    });

    if (extractionError) {
      throw new Error(`No se pudo guardar extracción: ${extractionError.message}`);
    }

    await emitWorkflowEvent(
      parsed.requires_manual_review ? "manual.review.required" : "parse.completed",
      payload.documentId,
      payload.expedienteId,
      {
        parser_strategy: parsed.parser_strategy,
        template_used: parsed.template_used,
        confidence: parsed.confidence,
        warnings: parsed.warnings,
        records: parsed.records.length,
        started_at: startedAt,
        completed_at: new Date().toISOString()
      }
    );
  } catch (error) {
    await supabase
      .from(dbTables.documents)
      .update({
        processing_status: "failed",
        manual_review_required: true,
        processed_at: new Date().toISOString()
      })
      .eq("id", payload.documentId);

    await emitWorkflowEvent("parse.failed", payload.documentId, payload.expedienteId, {
      error: error instanceof Error ? error.message : "error desconocido"
    });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = intakeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Payload inválido",
        details: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Persistencia no disponible. Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_PUBLISHABLE_KEY)."
      },
      { status: 500 }
    );
  }

  const { expediente_id: expedienteReference, client_id: clientIdRaw, documents, uploaded_by: uploadedBy } =
    parsed.data;

  const resolvedExpediente = normalizeExpedienteId(expedienteReference);
  const clientId = clientIdRaw && isUuid(clientIdRaw) ? clientIdRaw : null;

  const { error: expedienteError } = await supabase.from(dbTables.expedientes).upsert(
    {
      id: resolvedExpediente.id,
      reference: resolvedExpediente.reference,
      client_id: clientId,
      fiscal_year: new Date().getFullYear(),
      model_type: "IRPF",
      title: `Expediente ${resolvedExpediente.reference}`,
      status: "BORRADOR"
    },
    { onConflict: "id" }
  );

  if (expedienteError) {
    return NextResponse.json(
      {
        error: `No se pudo crear/actualizar expediente: ${expedienteError.message}`
      },
      { status: 500 }
    );
  }

  const items = await Promise.all(
    documents.map(async (document) => {
      const documentId = crypto.randomUUID();

      const { error: documentError } = await supabase.from(dbTables.documents).insert({
        id: documentId,
        expediente_id: resolvedExpediente.id,
        filename: document.filename,
        storage_path: document.storage_path,
        source_type: document.source_type ?? "PDF",
        processing_status: "queued",
        metadata: {
          uploaded_by: uploadedBy,
          entity_hint: document.entity_hint,
          expediente_reference: resolvedExpediente.reference
        }
      });

      if (documentError) {
        throw new Error(`No se pudo insertar documento ${document.filename}: ${documentError.message}`);
      }

      await emitWorkflowEvent("parse.started", documentId, resolvedExpediente.id, {
        filename: document.filename,
        source_type: document.source_type ?? "PDF",
        uploaded_by: uploadedBy ?? "system",
        expediente_reference: resolvedExpediente.reference
      });

      if (env.autoParseOnIntake) {
        void processWithParser({
          documentId,
          expedienteId: resolvedExpediente.id,
          filename: document.filename,
          contentBase64: document.content_base64,
          entityHint: document.entity_hint
        });
      }

      return {
        document_id: documentId,
        expediente_id: resolvedExpediente.id,
        status: "queued" as const
      };
    })
  );

  return NextResponse.json({
    document_id: items[0].document_id,
    expediente_id: resolvedExpediente.id,
    expediente_reference: resolvedExpediente.reference,
    status: items[0].status,
    accepted: items.length,
    items
  });
}
