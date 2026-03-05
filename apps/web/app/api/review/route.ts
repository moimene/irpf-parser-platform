import { NextResponse } from "next/server";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { createSupabaseAdminClient } from "@/lib/supabase";

type JsonObject = Record<string, unknown>;

function readStringFromObject(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const candidate = (payload as JsonObject)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function parseEventType(action: string, payload: unknown): string {
  const fromPayload = readStringFromObject(payload, "event_type");
  if (fromPayload) {
    return fromPayload;
  }

  if (action.startsWith("workflow.event.")) {
    return action.replace("workflow.event.", "");
  }

  if (action.startsWith("webhook.parse-event.")) {
    return action.replace("webhook.parse-event.", "");
  }

  return action;
}

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  const expedienteRef = new URL(request.url).searchParams.get("expediente_id") ?? undefined;
  const expedienteId = expedienteRef ? normalizeExpedienteId(expedienteRef).id : undefined;

  let pendingQuery = supabase
    .from(dbTables.documents)
    .select("id, expediente_id, filename, processing_status, confidence, created_at")
    .in("processing_status", ["manual_review", "failed"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (expedienteId) {
    pendingQuery = pendingQuery.eq("expediente_id", expedienteId);
  }

  let alertsQuery = supabase
    .from(dbTables.alerts)
    .select("id, expediente_id, severity, message, category, created_at, status")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(200);

  if (expedienteId) {
    alertsQuery = alertsQuery.eq("expediente_id", expedienteId);
  }

  let eventsQuery = supabase
    .from(dbTables.auditLog)
    .select("id, expediente_id, entity_id, action, after_data, created_at")
    .like("action", "workflow.event.%")
    .order("created_at", { ascending: false })
    .limit(200);

  if (expedienteId) {
    eventsQuery = eventsQuery.eq("expediente_id", expedienteId);
  }

  const [pendingResult, alertsResult, eventsResult] = await Promise.all([
    pendingQuery,
    alertsQuery,
    eventsQuery
  ]);

  if (pendingResult.error || alertsResult.error || eventsResult.error) {
    return NextResponse.json(
      {
        error:
          pendingResult.error?.message ??
          alertsResult.error?.message ??
          eventsResult.error?.message ??
          "No se pudo cargar la bandeja de revisión"
      },
      { status: 500 }
    );
  }

  const pendingDocuments = (pendingResult.data ?? []).map((row) => ({
    id: row.id,
    expedienteId: row.expediente_id,
    filename: row.filename,
    status: row.processing_status,
    confidence: Number(row.confidence ?? 0),
    createdAt: row.created_at
  }));

  const openAlerts = (alertsResult.data ?? []).map((row) => ({
    id: row.id,
    expedienteId: row.expediente_id,
    severity: row.severity,
    message: row.message,
    category: row.category,
    createdAt: row.created_at
  }));

  const workflowEvents = (eventsResult.data ?? []).map((row) => ({
    id: String(row.id),
    eventType: parseEventType(row.action, row.after_data),
    documentId: row.entity_id ?? readStringFromObject(row.after_data, "document_id") ?? "",
    createdAt: row.created_at
  }));

  return NextResponse.json({
    pending_documents: pendingDocuments,
    open_alerts: openAlerts,
    workflow_events: workflowEvents
  });
}
