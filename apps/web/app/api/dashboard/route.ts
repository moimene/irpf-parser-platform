import { NextResponse } from "next/server";
import { accessErrorMessage, accessErrorStatus, getCurrentSessionUser, listAccessibleClientIds, requirePermission } from "@/lib/auth";
import { listClientsCompat } from "@/lib/client-store";
import type {
  DashboardExpedienteWorkItem,
  DashboardModelOverview,
  DashboardPayload,
  DashboardPortfolioClient,
  DashboardSummary
} from "@/lib/dashboard";
import { dbTables } from "@/lib/db-tables";
import { createSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ExpedienteRow = {
  id: string;
  reference: string;
  client_id: string | null;
  fiscal_year: number;
  model_type: "IRPF" | "IP" | "720";
  title: string;
  status: string;
  updated_at: string;
};

type DocumentRow = {
  expediente_id: string;
  processing_status: "queued" | "processing" | "manual_review" | "completed" | "failed";
  updated_at: string | null;
  created_at: string;
};

type AlertRow = {
  expediente_id: string;
  severity: "info" | "warning" | "critical";
  created_at: string;
};

type ExportRow = {
  expediente_id: string;
  model: "100" | "714" | "720";
  generated_at: string | null;
  created_at: string;
};

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) {
    return null;
  }

  return [...valid].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function buildEmptyPayload(currentUser: DashboardPayload["current_user"]): DashboardPayload {
  return {
    queued: 0,
    processing: 0,
    manualReview: 0,
    completed: 0,
    failed: 0,
    openAlerts: 0,
    exports: 0,
    current_user: currentUser,
    summary: {
      assigned_clients: 0,
      active_expedientes: 0,
      document_queue: 0,
      pending_review: 0,
      open_alerts: 0,
      critical_alerts: 0,
      generated_exports: 0
    },
    portfolio_clients: [],
    expedientes: [],
    model_overview: [
      { model_type: "IRPF", expedientes: 0, pending_review: 0, open_alerts: 0, exports: 0 },
      { model_type: "IP", expedientes: 0, pending_review: 0, open_alerts: 0, exports: 0 },
      { model_type: "720", expedientes: 0, pending_review: 0, open_alerts: 0, exports: 0 }
    ]
  };
}

function priorityScore(item: DashboardExpedienteWorkItem): number {
  return (
    item.counts.critical_alerts * 100 +
    item.counts.pending_review * 10 +
    item.counts.open_alerts * 5 +
    item.counts.processing * 3 +
    item.counts.documents
  );
}

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      throw new Error("Supabase no configurado");
    }

    const sessionUser = await getCurrentSessionUser(supabase);
    requirePermission(sessionUser, "dashboard.read");

    const currentUser = {
      reference: sessionUser.reference,
      display_name: sessionUser.display_name,
      role: sessionUser.role
    } as const;

    const accessibleClientIds = await listAccessibleClientIds(supabase, sessionUser);
    const allClients = await listClientsCompat(supabase);
    const clients =
      sessionUser.role === "admin"
        ? allClients
        : allClients.filter((client) => accessibleClientIds.includes(client.id));

    if (clients.length === 0) {
      return NextResponse.json(buildEmptyPayload(currentUser));
    }

    const clientIds = clients.map((client) => client.id);
    const { data: expedientesData, error: expedientesError } = await supabase
      .from(dbTables.expedientes)
      .select("id, reference, client_id, fiscal_year, model_type, title, status, updated_at")
      .in("client_id", clientIds);

    if (expedientesError) {
      throw new Error(`No se pudieron cargar expedientes del dashboard: ${expedientesError.message}`);
    }

    const expedientes = (expedientesData ?? []) as ExpedienteRow[];
    const expedienteIds = expedientes.map((item) => item.id);

    const [documentsResult, alertsResult, exportsResult] = await Promise.all([
      expedienteIds.length === 0
        ? Promise.resolve({ data: [] as DocumentRow[], error: null })
        : supabase
            .from(dbTables.documents)
            .select("expediente_id, processing_status, updated_at, created_at")
            .in("expediente_id", expedienteIds),
      expedienteIds.length === 0
        ? Promise.resolve({ data: [] as AlertRow[], error: null })
        : supabase
            .from(dbTables.alerts)
            .select("expediente_id, severity, created_at")
            .eq("status", "open")
            .in("expediente_id", expedienteIds),
      expedienteIds.length === 0
        ? Promise.resolve({ data: [] as ExportRow[], error: null })
        : supabase
            .from(dbTables.exports)
            .select("expediente_id, model, generated_at, created_at")
            .in("expediente_id", expedienteIds)
    ]);

    if (documentsResult.error || alertsResult.error || exportsResult.error) {
      throw new Error(
        documentsResult.error?.message ??
          alertsResult.error?.message ??
          exportsResult.error?.message ??
          "No se pudo construir el dashboard"
      );
    }

    const documentsByExpediente = new Map<string, DocumentRow[]>();
    for (const document of documentsResult.data ?? []) {
      const items = documentsByExpediente.get(document.expediente_id) ?? [];
      items.push(document);
      documentsByExpediente.set(document.expediente_id, items);
    }

    const alertsByExpediente = new Map<string, AlertRow[]>();
    for (const alert of alertsResult.data ?? []) {
      const items = alertsByExpediente.get(alert.expediente_id) ?? [];
      items.push(alert);
      alertsByExpediente.set(alert.expediente_id, items);
    }

    const exportsByExpediente = new Map<string, ExportRow[]>();
    for (const exportRow of exportsResult.data ?? []) {
      const items = exportsByExpediente.get(exportRow.expediente_id) ?? [];
      items.push(exportRow);
      exportsByExpediente.set(exportRow.expediente_id, items);
    }

    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const expedientesByClient = new Map<string, ExpedienteRow[]>();
    for (const expediente of expedientes) {
      if (!expediente.client_id) {
        continue;
      }

      const items = expedientesByClient.get(expediente.client_id) ?? [];
      items.push(expediente);
      expedientesByClient.set(expediente.client_id, items);
    }

    const workItems: DashboardExpedienteWorkItem[] = expedientes
      .map((expediente) => {
        const documents = documentsByExpediente.get(expediente.id) ?? [];
        const alerts = alertsByExpediente.get(expediente.id) ?? [];
        const exports = exportsByExpediente.get(expediente.id) ?? [];
        const client = expediente.client_id ? clientsById.get(expediente.client_id) ?? null : null;

        return {
          id: expediente.id,
          reference: expediente.reference,
          title: expediente.title,
          status: expediente.status,
          fiscal_year: expediente.fiscal_year,
          model_type: expediente.model_type,
          client: client
            ? {
                id: client.id,
                reference: client.reference,
                display_name: client.display_name,
                nif: client.nif
              }
            : null,
          counts: {
            documents: documents.length,
            processing: documents.filter((document) => document.processing_status === "processing").length,
            pending_review: documents.filter((document) => document.processing_status === "manual_review").length,
            open_alerts: alerts.length,
            critical_alerts: alerts.filter((alert) => alert.severity === "critical").length,
            exports: exports.length
          },
          last_activity_at: latestTimestamp(
            expediente.updated_at,
            ...documents.map((document) => document.updated_at ?? document.created_at),
            ...alerts.map((alert) => alert.created_at),
            ...exports.map((item) => item.generated_at ?? item.created_at)
          )
        };
      })
      .sort((left, right) => {
        const scoreDelta = priorityScore(right) - priorityScore(left);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return new Date(right.last_activity_at ?? 0).getTime() - new Date(left.last_activity_at ?? 0).getTime();
      });

    const portfolioClients: DashboardPortfolioClient[] = clients
      .map((client) => {
        const clientExpedientes = expedientesByClient.get(client.id) ?? [];
        const alerts = clientExpedientes.flatMap((expediente) => alertsByExpediente.get(expediente.id) ?? []);
        const exports = clientExpedientes.flatMap((expediente) => exportsByExpediente.get(expediente.id) ?? []);
        const documents = clientExpedientes.flatMap((expediente) => documentsByExpediente.get(expediente.id) ?? []);

        return {
          id: client.id,
          reference: client.reference,
          display_name: client.display_name,
          nif: client.nif,
          status: client.status,
          stats: {
            expedientes: clientExpedientes.length,
            pending_review: documents.filter((document) => document.processing_status === "manual_review").length,
            open_alerts: alerts.length,
            critical_alerts: alerts.filter((alert) => alert.severity === "critical").length,
            exports: exports.length
          },
          last_activity_at: latestTimestamp(
            client.updated_at,
            ...clientExpedientes.map((expediente) => expediente.updated_at),
            ...documents.map((document) => document.updated_at ?? document.created_at),
            ...alerts.map((alert) => alert.created_at),
            ...exports.map((item) => item.generated_at ?? item.created_at)
          )
        };
      })
      .sort((left, right) => {
        const leftScore = left.stats.critical_alerts * 100 + left.stats.pending_review * 10 + left.stats.open_alerts * 5;
        const rightScore = right.stats.critical_alerts * 100 + right.stats.pending_review * 10 + right.stats.open_alerts * 5;

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return new Date(right.last_activity_at ?? 0).getTime() - new Date(left.last_activity_at ?? 0).getTime();
      });

    const summary: DashboardSummary = {
      assigned_clients: clients.length,
      active_expedientes: expedientes.filter((item) => item.status !== "PRESENTADO").length,
      document_queue: (documentsResult.data ?? []).filter((item) =>
        ["queued", "processing"].includes(item.processing_status)
      ).length,
      pending_review: workItems.reduce((sum, item) => sum + item.counts.pending_review, 0),
      open_alerts: (alertsResult.data ?? []).length,
      critical_alerts: (alertsResult.data ?? []).filter((item) => item.severity === "critical").length,
      generated_exports: (exportsResult.data ?? []).length
    };

    const modelOverview: DashboardModelOverview[] = (["IRPF", "IP", "720"] as const).map((modelType) => {
      const modelItems = workItems.filter((item) => item.model_type === modelType);
      return {
        model_type: modelType,
        expedientes: modelItems.length,
        pending_review: modelItems.reduce((sum, item) => sum + item.counts.pending_review, 0),
        open_alerts: modelItems.reduce((sum, item) => sum + item.counts.open_alerts, 0),
        exports: modelItems.reduce((sum, item) => sum + item.counts.exports, 0)
      };
    });

    const documents = documentsResult.data ?? [];

    return NextResponse.json({
      queued: documents.filter((item) => item.processing_status === "queued").length,
      processing: documents.filter((item) => item.processing_status === "processing").length,
      manualReview: documents.filter((item) => item.processing_status === "manual_review").length,
      completed: documents.filter((item) => item.processing_status === "completed").length,
      failed: documents.filter((item) => item.processing_status === "failed").length,
      openAlerts: summary.open_alerts,
      exports: summary.generated_exports,
      current_user: currentUser,
      summary,
      portfolio_clients: portfolioClients,
      expedientes: workItems,
      model_overview: modelOverview
    } satisfies DashboardPayload);
  } catch (error) {
    return NextResponse.json(
      {
        error: accessErrorMessage(error, "No se pudo construir el dashboard")
      },
      { status: accessErrorStatus(error) }
    );
  }
}
