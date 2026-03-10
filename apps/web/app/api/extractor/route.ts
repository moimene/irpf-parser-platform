import { NextResponse } from "next/server";
import type { ParseDocumentResponse } from "@/lib/contracts";
import { mimeTypeForDocumentSourceType } from "@/lib/document-source";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/extractor
 * Standalone parsing endpoint — no expediente, no persistence.
 * Accepts a file as base64, calls the parser service, returns raw results.
 */
export async function POST(request: Request) {
    if (!env.parserServiceUrl) {
        return NextResponse.json(
            { error: "PARSER_SERVICE_URL no configurado." },
            { status: 503 }
        );
    }

    const body = await request.json().catch(() => null);
    if (
        !body ||
        typeof body !== "object" ||
        !("filename" in body) ||
        !("content_base64" in body)
    ) {
        return NextResponse.json(
            { error: "Se requiere filename y content_base64." },
            { status: 400 }
        );
    }

    const {
        filename,
        content_base64,
        source_type = "PDF",
        entity_hint,
    } = body as {
        filename: string;
        content_base64: string;
        source_type?: "PDF" | "IMAGE" | "CSV" | "XLSX" | "DOCX";
        entity_hint?: string;
    };

    try {
        const response = await fetch(`${env.parserServiceUrl}/parse-document`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                document_id: "sandbox-" + Date.now(),
                expediente_id: "sandbox",
                filename,
                source_type,
                content_base64,
                entity_hint,
                mime_type: mimeTypeForDocumentSourceType(source_type),
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => "");
            return NextResponse.json(
                { error: `Parser respondió ${response.status}: ${errText.slice(0, 300)}` },
                { status: 502 }
            );
        }

        const result: ParseDocumentResponse = await response.json();

        return NextResponse.json({
            parser_strategy: result.parser_strategy,
            template_used: result.template_used,
            confidence: result.confidence,
            requires_manual_review: result.requires_manual_review,
            records: result.records,
            asset_records: result.asset_records ?? [],
            fiscal_events: result.fiscal_events ?? [],
            source_spans: result.source_spans,
            warnings: result.warnings,
            structured_document: result.structured_document
                ? {
                    backend: result.structured_document.backend,
                    pages_count: result.structured_document.pages.length,
                    source_type: result.structured_document.source_type,
                }
                : null,
        });
    } catch (error) {
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Error inesperado al contactar el parser.",
            },
            { status: 500 }
        );
    }
}
