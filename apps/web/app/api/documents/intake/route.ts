import { NextResponse } from "next/server";
import { z } from "zod";
import {
  accessErrorMessage,
  accessErrorStatus,
  assertClientAccess,
  assertExpedienteAccess,
  getCurrentSessionUser,
  listAccessibleClientIds,
  requirePermission
} from "@/lib/auth";
import type { ParseDocumentResponse, ProcessingStatus } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { mimeTypeForDocumentSourceType } from "@/lib/document-source";
import { normalizeExpedienteId, isUuid } from "@/lib/expediente-id";
import { emitWorkflowEvent } from "@/lib/events";
import { env } from "@/lib/env";
import { deriveCanonicalRegistryFromParsePayload, replaceDocumentCanonicalRegistry } from "@/lib/canonical-registry";
import { buildOperationsFromRecords, replaceDocumentOperations } from "@/lib/operations";
import { createSupabaseAdminClient } from "@/lib/supabase";

const MAX_PARSE_FILE_BYTES = 15 * 1024 * 1024;

const intakeSchema = z.object({
  expediente_id: z.string().min(3),
  client_id: z.string().optional(),
  uploaded_by: z.string().optional(),
  documents: z
    .array(
      z.object({
        filename: z.string().min(2),
        storage_path: z.string().optional(),
        source_type: z.enum(["PDF", "IMAGE", "CSV", "XLSX", "DOCX"]).optional(),
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
  sourceType?: "PDF" | "IMAGE" | "CSV" | "XLSX" | "DOCX";
  storagePath?: string;
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
    let contentBase64 = payload.contentBase64;

    if (!contentBase64 && payload.storagePath) {
      const { data: storageFile, error: downloadError } = await supabase.storage
        .from(env.supabaseStorageBucket)
        .download(payload.storagePath);

      if (downloadError || !storageFile) {
        throw new Error(
          `No se pudo descargar ${payload.filename} desde storage (${payload.storagePath}): ${
            downloadError?.message ?? "unknown"
          }`
        );
      }

      if (storageFile.size > MAX_PARSE_FILE_BYTES) {
        throw new Error(
          `Documento ${payload.filename} supera el máximo soportado (${Math.round(
            MAX_PARSE_FILE_BYTES / (1024 * 1024)
          )}MB).`
        );
      }

      const fileBuffer = Buffer.from(await storageFile.arrayBuffer());
      contentBase64 = fileBuffer.toString("base64");
    }

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
        source_type: payload.sourceType,
        content_base64: contentBase64,
        entity_hint: payload.entityHint,
        mime_type: mimeTypeForDocumentSourceType(payload.sourceType ?? "PDF")
      })
    });

    if (!response.ok) {
      throw new Error(`Parser respondió ${response.status}`);
    }

    const parsed: ParseDocumentResponse = await response.json();
    const status: ProcessingStatus = parsed.requires_manual_review ? "manual_review" : "completed";
    const canonical = deriveCanonicalRegistryFromParsePayload({
      records: parsed.records,
      assetRecords: parsed.asset_records,
      fiscalEvents: parsed.fiscal_events
    });

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
        source_spans: parsed.source_spans,
        source_type: payload.sourceType ?? "PDF",
        structured_document: parsed.structured_document ?? null
      },
      normalized_payload: {
        records: parsed.records,
        asset_records: canonical.assetRecords,
        fiscal_events: canonical.fiscalEvents,
        parser_strategy: parsed.parser_strategy,
        template_used: parsed.template_used,
        source_type: payload.sourceType ?? "PDF"
      },
      confidence: parsed.confidence,
      requires_manual_review: parsed.requires_manual_review,
      review_status: parsed.requires_manual_review ? "pending" : "not_required"
    });

    if (extractionError) {
      throw new Error(`No se pudo guardar extracción: ${extractionError.message}`);
    }

    if (!parsed.requires_manual_review) {
      const operations = buildOperationsFromRecords({
        records: parsed.records,
        expedienteId: payload.expedienteId,
        documentId: payload.documentId,
        source: "AUTO"
      });

      await replaceDocumentOperations(supabase, payload.documentId, payload.expedienteId, operations);
      await replaceDocumentCanonicalRegistry(supabase, {
        expedienteId: payload.expedienteId,
        documentId: payload.documentId,
        records: parsed.records,
        assetRecords: canonical.assetRecords,
        fiscalEvents: canonical.fiscalEvents,
        source: "AUTO"
      });
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
        asset_records: canonical.assetRecords.length,
        fiscal_events: canonical.fiscalEvents.length,
        source_type: payload.sourceType ?? "PDF",
        structured_backend: parsed.structured_document?.backend ?? null,
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

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "documents.intake");

    const {
      expediente_id: expedienteReference,
      client_id: clientIdRaw,
      documents
    } = parsed.data;

    const resolvedExpediente = normalizeExpedienteId(expedienteReference);
    const clientId = clientIdRaw && isUuid(clientIdRaw) ? clientIdRaw : null;
    const { data: existingExpediente, error: existingExpedienteError } = await supabase
      .from(dbTables.expedientes)
      .select("id, client_id")
      .eq("id", resolvedExpediente.id)
      .maybeSingle();

    if (existingExpedienteError) {
      return NextResponse.json(
        { error: `No se pudo validar expediente: ${existingExpedienteError.message}` },
        { status: 500 }
      );
    }

    let inferredClientId: string | null = null;

    if (existingExpediente) {
      await assertExpedienteAccess(supabase, sessionUser, resolvedExpediente.id, "documents.intake");

      if (existingExpediente.client_id && clientId && existingExpediente.client_id !== clientId) {
        return NextResponse.json(
          { error: "El expediente ya está asociado a otro cliente y no puede cambiarse desde intake." },
          { status: 409 }
        );
      }

      if (!existingExpediente.client_id && clientId) {
        await assertClientAccess(supabase, sessionUser, clientId, "documents.intake");
      }
    } else if (clientId) {
      await assertClientAccess(supabase, sessionUser, clientId, "documents.intake");
    } else {
      const accessibleClientIds = await listAccessibleClientIds(supabase, sessionUser);
      if (accessibleClientIds.length === 1) {
        inferredClientId = accessibleClientIds[0];
        await assertClientAccess(supabase, sessionUser, inferredClientId, "documents.intake");
      } else {
        return NextResponse.json(
          { error: "Debes asociar el expediente a un cliente antes de ingestar documentos." },
          { status: 400 }
        );
      }
    }

    const resolvedClientId = clientId ?? existingExpediente?.client_id ?? inferredClientId ?? null;
    const effectiveUploadedBy = sessionUser.reference;

    const { error: expedienteError } = await supabase.from(dbTables.expedientes).upsert(
      {
        id: resolvedExpediente.id,
        reference: resolvedExpediente.reference,
        client_id: resolvedClientId,
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
            uploaded_by: effectiveUploadedBy,
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
          uploaded_by: effectiveUploadedBy,
          expediente_reference: resolvedExpediente.reference
        });

        if (env.autoParseOnIntake) {
          void processWithParser({
            documentId,
            expedienteId: resolvedExpediente.id,
            filename: document.filename,
            sourceType: document.source_type,
            storagePath: document.storage_path,
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
      items,
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: accessErrorMessage(error, "No se pudo completar la ingesta") },
      { status: accessErrorStatus(error) }
    );
  }
}
