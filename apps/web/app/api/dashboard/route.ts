import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";

type DocumentStatus = "queued" | "processing" | "manual_review" | "completed" | "failed";

async function countDocumentsByStatus(supabase: SupabaseClient, status: DocumentStatus): Promise<number> {
  const { count, error } = await supabase
    .from(dbTables.documents)
    .select("id", { count: "exact", head: true })
    .eq("processing_status", status);

  if (error) {
    throw new Error(`No se pudo contar documentos ${status}: ${error.message}`);
  }

  return count ?? 0;
}

async function countRows(
  supabase: SupabaseClient,
  table: "alerts" | "exports",
  filter?: { column: string; value: string }
): Promise<number> {
  const tableName = table === "alerts" ? dbTables.alerts : dbTables.exports;
  let query = supabase.from(tableName).select("id", { count: "exact", head: true });
  if (filter) {
    query = query.eq(filter.column, filter.value);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`No se pudo consultar ${table}: ${error.message}`);
  }

  return count ?? 0;
}

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new Error("Supabase no configurado");
    }

    const [queued, processing, manualReview, completed, failed, openAlerts, exports] = await Promise.all([
      countDocumentsByStatus(supabase, "queued"),
      countDocumentsByStatus(supabase, "processing"),
      countDocumentsByStatus(supabase, "manual_review"),
      countDocumentsByStatus(supabase, "completed"),
      countDocumentsByStatus(supabase, "failed"),
      countRows(supabase, "alerts", { column: "status", value: "open" }),
      countRows(supabase, "exports")
    ]);

    return NextResponse.json({
      queued,
      processing,
      manualReview,
      completed,
      failed,
      openAlerts,
      exports
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "No se pudo construir el dashboard"
      },
      { status: 500 }
    );
  }
}
