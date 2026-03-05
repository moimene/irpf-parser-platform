import { NextResponse } from "next/server";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const url = new URL(request.url);
  const documentId = url.searchParams.get("document_id");

  if (!documentId) {
    return NextResponse.json({ error: "document_id requerido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from(dbTables.extractions)
    .select("id, document_id, confidence, review_status, normalized_payload, created_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Extracción no encontrada para este documento" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    extraction_id: data.id,
    document_id: data.document_id,
    confidence: data.confidence,
    review_status: data.review_status,
    records_count: Array.isArray((data.normalized_payload as Record<string, unknown>)?.records)
      ? ((data.normalized_payload as Record<string, unknown>).records as unknown[]).length
      : 0,
    created_at: data.created_at,
  });
}
