import { NextResponse } from "next/server";
import { z } from "zod";
import {
    accessErrorMessage,
    accessErrorStatus,
    assertExpedienteAccess,
    getCurrentSessionUser
} from "@/lib/auth";
import type { ParseDocumentResponse, ProcessingStatus } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";
import { mimeTypeForDocumentSourceType } from "@/lib/document-source";
import { emitWorkflowEvent } from "@/lib/events";
import { env } from "@/lib/env";
import { syncExpedienteWorkflowById } from "@/lib/expediente-workflow";
import { buildOperationsFromRecords, replaceDocumentOperations } from "@/lib/operations";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reparseSchema = z.object({
    document_id: z.string().uuid()
});

export async function POST(request: Request) {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
        return NextResponse.json(
            { error: "Supabase no configurado" },
            { status: 500 }
        );
    }

    if (!env.parserServiceUrl) {
        return NextResponse.json(
            { error: "PARSER_SERVICE_URL no configurado. Contacta al administrador." },
            { status: 503 }
        );
    }

    const body = await request.json().catch(() => null);
    const parsed = reparseSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Payload inválido", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    try {
        const sessionUser = await getCurrentSessionUser(supabase);
        const { document_id } = parsed.data;

        // Fetch document
        const { data: document, error: docError } = await supabase
            .from(dbTables.documents)
            .select("id, expediente_id, filename, storage_path, source_type, metadata")
            .eq("id", document_id)
            .single();

        if (docError || !document) {
            return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
        }

        // Access check
        await assertExpedienteAccess(supabase, sessionUser, document.expediente_id, "documents.intake");

        // Reset document status to processing
        const { error: statusError } = await supabase
            .from(dbTables.documents)
            .update({
                processing_status: "processing",
                manual_review_required: false,
                processed_at: null,
                confidence: null,
                detected_template: null
            })
            .eq("id", document_id);

        if (statusError) {
            return NextResponse.json(
                { error: `No se pudo reiniciar el estado del documento: ${statusError.message}` },
                { status: 500 }
            );
        }

        // Delete existing extractions for this document
        await supabase
            .from(dbTables.extractions)
            .delete()
            .eq("document_id", document_id);

        // Download file from storage
        let contentBase64: string | undefined;
        if (document.storage_path) {
            const { data: storageFile, error: downloadError } = await supabase.storage
                .from(env.supabaseStorageBucket)
                .download(document.storage_path);

            if (downloadError || !storageFile) {
                // Reset to failed if we can't download
                await supabase
                    .from(dbTables.documents)
                    .update({ processing_status: "failed", manual_review_required: true })
                    .eq("id", document_id);

                return NextResponse.json(
                    { error: `No se pudo descargar el fichero: ${downloadError?.message ?? "unknown"}` },
                    { status: 500 }
                );
            }

            const fileBuffer = Buffer.from(await storageFile.arrayBuffer());
            contentBase64 = fileBuffer.toString("base64");
        }

        const sourceType = (document.source_type ?? "PDF") as "PDF" | "IMAGE" | "CSV" | "XLSX" | "DOCX";
        const entityHint =
            document.metadata && typeof document.metadata === "object"
                ? (document.metadata as Record<string, unknown>).entity_hint as string | undefined
                : undefined;

        // Call parser
        const startedAt = new Date().toISOString();

        const response = await fetch(`${env.parserServiceUrl}/parse-document`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                document_id: document.id,
                expediente_id: document.expediente_id,
                filename: document.filename,
                source_type: sourceType,
                content_base64: contentBase64,
                entity_hint: entityHint,
                mime_type: mimeTypeForDocumentSourceType(sourceType)
            })
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            await supabase
                .from(dbTables.documents)
                .update({
                    processing_status: "failed",
                    manual_review_required: true,
                    processed_at: new Date().toISOString()
                })
                .eq("id", document_id);

            return NextResponse.json(
                { error: `Parser respondió ${response.status}: ${errText.slice(0, 200)}` },
                { status: 502 }
            );
        }

        const result: ParseDocumentResponse = await response.json();
        const status: ProcessingStatus = result.requires_manual_review ? "manual_review" : "completed";

        // Update document
        await supabase
            .from(dbTables.documents)
            .update({
                processing_status: status,
                confidence: result.confidence,
                manual_review_required: result.requires_manual_review,
                processed_at: new Date().toISOString(),
                detected_template: result.template_used
            })
            .eq("id", document_id);

        // Insert extraction
        const extractionId = crypto.randomUUID();
        await supabase.from(dbTables.extractions).insert({
            id: extractionId,
            document_id: document.id,
            version: 1,
            raw_payload: {
                warnings: result.warnings,
                source_spans: result.source_spans,
                source_type: sourceType,
                structured_document: result.structured_document ?? null
            },
            normalized_payload: {
                records: result.records,
                parser_strategy: result.parser_strategy,
                template_used: result.template_used,
                source_type: sourceType
            },
            confidence: result.confidence,
            requires_manual_review: result.requires_manual_review,
            review_status: result.requires_manual_review ? "pending" : "not_required"
        });

        // Build operations if auto-approved
        if (!result.requires_manual_review) {
            const operations = buildOperationsFromRecords({
                records: result.records,
                expedienteId: document.expediente_id,
                documentId: document.id,
                source: "AUTO"
            });
            await replaceDocumentOperations(supabase, document.id, document.expediente_id, operations);
        }

        // Sync workflow
        await syncExpedienteWorkflowById(supabase, {
            expedienteId: document.expediente_id
        }).catch(() => null);

        // Emit event
        await emitWorkflowEvent("reparse.completed", document.id, document.expediente_id, {
            parser_strategy: result.parser_strategy,
            template_used: result.template_used,
            confidence: result.confidence,
            records: result.records.length,
            source_type: sourceType,
            started_at: startedAt,
            completed_at: new Date().toISOString(),
            triggered_by: sessionUser.reference
        });

        return NextResponse.json({
            document_id: document.id,
            extraction_id: extractionId,
            processing_status: status,
            confidence: result.confidence,
            records_count: result.records.length,
            parser_strategy: result.parser_strategy,
            template_used: result.template_used,
            requires_manual_review: result.requires_manual_review,
            message: result.requires_manual_review
                ? `Reparseo completado. ${result.records.length} registro(s), requiere revisión manual.`
                : `Reparseo completado. ${result.records.length} registro(s) aprobados automáticamente.`
        });
    } catch (error) {
        return NextResponse.json(
            { error: accessErrorMessage(error, "No se pudo reparsear el documento") },
            { status: accessErrorStatus(error) }
        );
    }
}
