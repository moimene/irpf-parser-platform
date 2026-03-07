import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, listAccessibleExpedienteIds, requirePermission } from "@/lib/auth";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type DocumentStatus = "queued" | "processing" | "manual_review" | "completed" | "failed";

async function countDocumentsByStatus(
  supabase: SupabaseClient,
  status: DocumentStatus,
  expedienteIds?: string[]
): Promise<number> {
  let query = supabase
    .from(dbTables.documents)
    .select("id", { count: "exact", head: true })
    .eq("processing_status", status);

  if (expedienteIds && expedienteIds.length > 0) {
    query = query.in("expediente_id", expedienteIds);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`No se pudo contar documentos ${status}: ${error.message}`);
  }

  return count ?? 0;
}

async function countRows(
  supabase: SupabaseClient,
  table: "alerts" | "exports",
  filter?: { column: string; value: string },
  expedienteIds?: string[]
): Promise<number> {
  const tableName = table === "alerts" ? dbTables.alerts : dbTables.exports;
  let query = supabase.from(tableName).select("id", { count: "exact", head: true });
  if (filter) {
    query = query.eq(filter.column, filter.value);
  }
  if (expedienteIds && expedienteIds.length > 0) {
    query = query.in("expediente_id", expedienteIds);
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
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "dashboard.read");
    const accessibleExpedienteIds = await listAccessibleExpedienteIds(supabase, sessionUser);
    const scopedExpedienteIds = sessionUser.role === "admin" ? undefined : accessibleExpedienteIds;

    if (sessionUser.role !== "admin" && accessibleExpedienteIds.length === 0) {
      return NextResponse.json({
        queued: 0,
        processing: 0,
        manualReview: 0,
        completed: 0,
        failed: 0,
        openAlerts: 0,
        exports: 0,
        current_user: {
          reference: sessionUser.reference,
          display_name: sessionUser.display_name,
          role: sessionUser.role
        }
      });
    }

    const [queued, processing, manualReview, completed, failed, openAlerts, exports] = await Promise.all([
      countDocumentsByStatus(supabase, "queued", scopedExpedienteIds),
      countDocumentsByStatus(supabase, "processing", scopedExpedienteIds),
      countDocumentsByStatus(supabase, "manual_review", scopedExpedienteIds),
      countDocumentsByStatus(supabase, "completed", scopedExpedienteIds),
      countDocumentsByStatus(supabase, "failed", scopedExpedienteIds),
      countRows(supabase, "alerts", { column: "status", value: "open" }, scopedExpedienteIds),
      countRows(supabase, "exports", undefined, scopedExpedienteIds)
    ]);

    return NextResponse.json({
      queued,
      processing,
      manualReview,
      completed,
      failed,
      openAlerts,
      exports,
      current_user: {
        reference: sessionUser.reference,
        display_name: sessionUser.display_name,
        role: sessionUser.role
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: accessErrorMessage(error, "No se pudo construir el dashboard")
      },
      { status: accessErrorStatus(error) }
    );
  }
}
