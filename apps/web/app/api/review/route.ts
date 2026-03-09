import { NextResponse } from "next/server";
import {
  accessErrorMessage,
  accessErrorStatus,
  assertExpedienteAccess,
  getCurrentSessionUser,
  listAccessibleExpedienteIds,
  requirePermission
} from "@/lib/auth";
import { listClientsCompat } from "@/lib/client-store";
import { dbTables } from "@/lib/db-tables";
import { normalizeExpedienteId } from "@/lib/expediente-id";
import { loadPersistedExpedienteWorkflowMap } from "@/lib/expediente-workflow";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

type DocumentRow = {
  id: string;
  expediente_id: string;
  filename: string;
  processing_status: "manual_review" | "failed";
  confidence: number | null;
  created_at: string;
  updated_at: string | null;
};

type AlertRow = {
  id: string;
  expediente_id: string;
  severity: "info" | "warning" | "critical";
  message: string;
  category: string;
  created_at: string;
  status: string;
};

type AuditEventRow = {
  id: string | number;
  expediente_id: string | null;
  entity_id: string | null;
  action: string;
  after_data: JsonObject | null;
  created_at: string;
};

type ExtractionRow = {
  id: string;
  document_id: string;
  confidence: number | null;
  review_status: string;
  normalized_payload: JsonObject | null;
  created_at: string;
};

type ExpedienteRow = {
  id: string;
  reference: string;
  client_id: string | null;
  fiscal_year: number;
  model_type: "IRPF" | "IP" | "720";
  title: string;
  status: string;
};

function readStringFromObject(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const candidate = (payload as JsonObject)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function countRecords(payload: JsonObject | null): number {
  const candidate = payload?.records;
  return Array.isArray(candidate) ? candidate.length : 0;
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

function queueTypeForStatus(status: DocumentRow["processing_status"]): "manual_review" | "document_failure" {
  return status === "failed" ? "document_failure" : "manual_review";
}

function reconcileDocumentStatus(
  status: DocumentRow["processing_status"],
  reviewStatus: string | null
): DocumentRow["processing_status"] | "completed" {
  if (reviewStatus === "validated" || reviewStatus === "not_required") {
    return "completed";
  }

  if (reviewStatus === "rejected") {
    return "failed";
  }

  return status;
}

function nextActionForItem(input: {
  status: DocumentRow["processing_status"];
  extractionId: string | null;
  criticalAlerts: number;
}): string {
  if (input.status === "failed") {
    return input.extractionId
      ? "Revisar el error, decidir rechazo o reingesta y devolver el expediente a flujo."
      : "Solicitar nueva ingesta documental desde el expediente antes de continuar el trabajo fiscal.";
  }

  if (input.criticalAlerts > 0) {
    return "Corregir extracción y validar el documento antes de continuar con el expediente.";
  }

  return "Revisar los registros extraídos, corregir campos si procede y aprobar la incorporación al runtime.";
}

function priorityScore(input: {
  status: DocumentRow["processing_status"];
  confidence: number;
  criticalAlerts: number;
  openAlerts: number;
  reviewStatus: string | null;
  createdAt: string;
}): number {
  const ageHours = Math.max(
    0,
    Math.round((Date.now() - new Date(input.createdAt).getTime()) / (1000 * 60 * 60))
  );

  let score = 0;
  score += input.status === "failed" ? 90 : 35;
  score += input.criticalAlerts * 100;
  score += input.openAlerts * 15;
  score += input.reviewStatus === "pending" ? 20 : 0;
  score += input.confidence < 0.7 ? 25 : input.confidence < 0.85 ? 10 : 0;
  score += ageHours >= 72 ? 20 : ageHours >= 24 ? 10 : ageHours >= 8 ? 4 : 0;
  return score;
}

function priorityLabel(score: number): "critical" | "high" | "normal" {
  if (score >= 120) {
    return "critical";
  }

  if (score >= 50) {
    return "high";
  }

  return "normal";
}

function buildEmptyPayload(currentUser: {
  reference: string;
  display_name: string;
  role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
}) {
  return {
    pending_documents: [],
    open_alerts: [],
    workflow_events: [],
    work_items: [],
    summary: {
      pending_items: 0,
      manual_review_items: 0,
      document_failures: 0,
      critical_priority_items: 0,
      open_alerts: 0,
      critical_alerts: 0
    },
    filters: {
      model_types: [],
      fiscal_years: [],
      queue_types: ["manual_review", "document_failure"],
      priority_labels: ["critical", "high", "normal"]
    },
    current_user: currentUser
  };
}

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 500 });
  }

  try {
    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "review.write");

    const expedienteRef = new URL(request.url).searchParams.get("expediente_id") ?? undefined;
    const expedienteId = expedienteRef ? normalizeExpedienteId(expedienteRef).id : undefined;
    const accessibleExpedienteIds = await listAccessibleExpedienteIds(supabase, sessionUser);

    if (expedienteId) {
      await assertExpedienteAccess(supabase, sessionUser, expedienteId, "review.write");
    }

    const currentUser = {
      reference: sessionUser.reference,
      display_name: sessionUser.display_name,
      role: sessionUser.role
    } as const;

    if (sessionUser.role !== "admin" && accessibleExpedienteIds.length === 0) {
      return NextResponse.json(buildEmptyPayload(currentUser));
    }

    let pendingQuery = supabase
      .from(dbTables.documents)
      .select("id, expediente_id, filename, processing_status, confidence, created_at, updated_at")
      .in("processing_status", ["manual_review", "failed"])
      .order("created_at", { ascending: false })
      .limit(200);

    if (sessionUser.role !== "admin") {
      pendingQuery = pendingQuery.in("expediente_id", accessibleExpedienteIds);
    }
    if (expedienteId) {
      pendingQuery = pendingQuery.eq("expediente_id", expedienteId);
    }

    let alertsQuery = supabase
      .from(dbTables.alerts)
      .select("id, expediente_id, severity, message, category, created_at, status")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200);

    if (sessionUser.role !== "admin") {
      alertsQuery = alertsQuery.in("expediente_id", accessibleExpedienteIds);
    }
    if (expedienteId) {
      alertsQuery = alertsQuery.eq("expediente_id", expedienteId);
    }

    let eventsQuery = supabase
      .from(dbTables.auditLog)
      .select("id, expediente_id, entity_id, action, after_data, created_at")
      .like("action", "workflow.event.%")
      .order("created_at", { ascending: false })
      .limit(200);

    if (sessionUser.role !== "admin") {
      eventsQuery = eventsQuery.in("expediente_id", accessibleExpedienteIds);
    }
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

    const pendingDocuments = (pendingResult.data ?? []) as DocumentRow[];
    const openAlertsRows = (alertsResult.data ?? []) as AlertRow[];
    const workflowEventRows = (eventsResult.data ?? []) as AuditEventRow[];

    const relatedExpedienteIds = [
      ...new Set([
        ...pendingDocuments.map((row) => row.expediente_id),
        ...openAlertsRows.map((row) => row.expediente_id),
        ...workflowEventRows
          .map((row) => row.expediente_id)
          .filter((value): value is string => Boolean(value))
      ])
    ];

    const [expedientesResult, clients] = await Promise.all([
      relatedExpedienteIds.length === 0
        ? Promise.resolve({ data: [] as ExpedienteRow[], error: null })
        : supabase
            .from(dbTables.expedientes)
            .select("id, reference, client_id, fiscal_year, model_type, title, status")
            .in("id", relatedExpedienteIds),
      listClientsCompat(supabase)
    ]);

    if (expedientesResult.error) {
      return NextResponse.json(
        {
          error: `No se pudo resolver el contexto de expedientes para revisión: ${expedientesResult.error.message}`
        },
        { status: 500 }
      );
    }

    const documentIds = pendingDocuments.map((row) => row.id);
    const workflowMap = await loadPersistedExpedienteWorkflowMap(supabase, relatedExpedienteIds);
    const extractionsResult =
      documentIds.length === 0
        ? { data: [] as ExtractionRow[], error: null }
        : await supabase
            .from(dbTables.extractions)
            .select("id, document_id, confidence, review_status, normalized_payload, created_at")
            .in("document_id", documentIds)
            .order("created_at", { ascending: false });

    if (extractionsResult.error) {
      return NextResponse.json(
        { error: `No se pudieron cargar extracciones de revisión: ${extractionsResult.error.message}` },
        { status: 500 }
      );
    }

    const expedientesById = new Map((expedientesResult.data ?? []).map((row) => [row.id, row as ExpedienteRow]));
    const clientsById = new Map(clients.map((client) => [client.id, client]));

    const latestExtractionByDocument = new Map<string, ExtractionRow>();
    for (const extraction of extractionsResult.data ?? []) {
      if (!latestExtractionByDocument.has(extraction.document_id)) {
        latestExtractionByDocument.set(extraction.document_id, extraction as ExtractionRow);
      }
    }

    const alertsByExpediente = new Map<string, AlertRow[]>();
    for (const alert of openAlertsRows) {
      const items = alertsByExpediente.get(alert.expediente_id) ?? [];
      items.push(alert);
      alertsByExpediente.set(alert.expediente_id, items);
    }

    const latestEventByDocument = new Map<string, string>();
    for (const event of workflowEventRows) {
      const documentIdFromEvent =
        event.entity_id ?? readStringFromObject(event.after_data, "document_id") ?? null;
      if (!documentIdFromEvent || latestEventByDocument.has(documentIdFromEvent)) {
        continue;
      }

      latestEventByDocument.set(documentIdFromEvent, parseEventType(event.action, event.after_data));
    }

    const workItems = pendingDocuments
      .map((document) => {
        const expediente = expedientesById.get(document.expediente_id) ?? null;
        const client = expediente?.client_id ? clientsById.get(expediente.client_id) ?? null : null;
        const latestExtraction = latestExtractionByDocument.get(document.id) ?? null;
        const effectiveStatus = reconcileDocumentStatus(
          document.processing_status,
          latestExtraction?.review_status ?? null
        );
        if (effectiveStatus === "completed") {
          return null;
        }
        const expedienteAlerts = alertsByExpediente.get(document.expediente_id) ?? [];
        const workflow = workflowMap.get(document.expediente_id) ?? null;
        const criticalAlerts = expedienteAlerts.filter((alert) => alert.severity === "critical").length;
        const confidence = Number(
          latestExtraction?.confidence ?? document.confidence ?? 0
        );
        const score = priorityScore({
          status: effectiveStatus,
          confidence,
          criticalAlerts,
          openAlerts: expedienteAlerts.length,
          reviewStatus: latestExtraction?.review_status ?? null,
          createdAt: document.created_at
        });
        const label = priorityLabel(score);

        return {
          document_id: document.id,
          extraction_id: latestExtraction?.id ?? null,
          expediente_id: document.expediente_id,
          expediente_reference: expediente?.reference ?? document.expediente_id,
          expediente_title: expediente?.title ?? `Expediente ${document.expediente_id}`,
          expediente_status: expediente?.status ?? "BORRADOR",
          fiscal_year: expediente?.fiscal_year ?? new Date().getFullYear(),
          model_type: expediente?.model_type ?? "IRPF",
          client: client
            ? {
                id: client.id,
                reference: client.reference,
                display_name: client.display_name,
                nif: client.nif
              }
            : null,
          filename: document.filename,
          status: effectiveStatus,
          queue_type: queueTypeForStatus(effectiveStatus),
          review_status: latestExtraction?.review_status ?? null,
          confidence,
          records_count: countRecords(latestExtraction?.normalized_payload ?? null),
          open_alerts: expedienteAlerts.length,
          critical_alerts: criticalAlerts,
          latest_alert_severity: expedienteAlerts[0]?.severity ?? null,
          workflow: workflow
            ? {
                workflow_owner_ref: workflow.workflow_owner_ref,
                workflow_owner_name: workflow.workflow_owner_name,
                pending_task: workflow.pending_task,
                canonical_approval_status: workflow.canonical_approval_status,
                documental_status: workflow.documental_status,
                revision_status: workflow.revision_status,
                canonical_status: workflow.canonical_status,
                declarative_status: workflow.declarative_status,
                filing_status: workflow.filing_status
              }
            : null,
          priority_score: score,
          priority_label: label,
          next_action: nextActionForItem({
            status: effectiveStatus,
            extractionId: latestExtraction?.id ?? null,
            criticalAlerts
          }),
          created_at: document.created_at,
          updated_at: document.updated_at ?? document.created_at,
          latest_event_type: latestEventByDocument.get(document.id) ?? null
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => {
        if (right.priority_score !== left.priority_score) {
          return right.priority_score - left.priority_score;
        }

        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
      });

    const enrichedAlerts = openAlertsRows.map((alert) => {
      const expediente = expedientesById.get(alert.expediente_id) ?? null;
      const client = expediente?.client_id ? clientsById.get(expediente.client_id) ?? null : null;
      return {
        id: alert.id,
        expediente_id: alert.expediente_id,
        expediente_reference: expediente?.reference ?? alert.expediente_id,
        expediente_title: expediente?.title ?? `Expediente ${alert.expediente_id}`,
        fiscal_year: expediente?.fiscal_year ?? new Date().getFullYear(),
        model_type: expediente?.model_type ?? "IRPF",
        client: client
          ? {
              id: client.id,
              reference: client.reference,
              display_name: client.display_name,
              nif: client.nif
            }
          : null,
        severity: alert.severity,
        message: alert.message,
        category: alert.category,
        created_at: alert.created_at
      };
    });

    const workflowEvents = workflowEventRows.map((event) => {
      const expediente = event.expediente_id ? expedientesById.get(event.expediente_id) ?? null : null;
      return {
        id: String(event.id),
        expediente_id: event.expediente_id,
        expediente_reference: expediente?.reference ?? event.expediente_id ?? null,
        event_type: parseEventType(event.action, event.after_data),
        document_id: event.entity_id ?? readStringFromObject(event.after_data, "document_id") ?? "",
        created_at: event.created_at
      };
    });

    return NextResponse.json({
      pending_documents: workItems.map((item) => ({
        id: item.document_id,
        extractionId: item.extraction_id,
        expedienteId: item.expediente_id,
        expedienteReference: item.expediente_reference,
        filename: item.filename,
        status: item.status,
        confidence: item.confidence,
        createdAt: item.created_at
      })),
      open_alerts: enrichedAlerts,
      workflow_events: workflowEvents,
      work_items: workItems,
      summary: {
        pending_items: workItems.length,
        manual_review_items: workItems.filter((item) => item.queue_type === "manual_review").length,
        document_failures: workItems.filter((item) => item.queue_type === "document_failure").length,
        critical_priority_items: workItems.filter((item) => item.priority_label === "critical").length,
        open_alerts: enrichedAlerts.length,
        critical_alerts: enrichedAlerts.filter((item) => item.severity === "critical").length
      },
      filters: {
        model_types: [...new Set(workItems.map((item) => item.model_type))],
        fiscal_years: [...new Set(workItems.map((item) => item.fiscal_year))].sort((left, right) => right - left),
        queue_types: ["manual_review", "document_failure"],
        priority_labels: ["critical", "high", "normal"]
      },
      current_user: currentUser
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: accessErrorMessage(error, "No se pudo cargar la bandeja de revisión")
      },
      { status: accessErrorStatus(error) }
    );
  }
}
