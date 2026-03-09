export type DashboardUserRole = "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";

export type DashboardModelType = "IRPF" | "IP" | "720";

export type DashboardCurrentUser = {
  reference: string;
  display_name: string;
  role: DashboardUserRole;
};

export type DashboardSummary = {
  assigned_clients: number;
  active_expedientes: number;
  document_queue: number;
  pending_review: number;
  open_alerts: number;
  critical_alerts: number;
  generated_exports: number;
};

export type DashboardPortfolioClient = {
  id: string;
  reference: string;
  display_name: string;
  nif: string;
  status: "active" | "inactive" | "archived";
  stats: {
    expedientes: number;
    pending_review: number;
    open_alerts: number;
    critical_alerts: number;
    exports: number;
  };
  last_activity_at: string | null;
};

export type DashboardExpedienteWorkItem = {
  id: string;
  reference: string;
  title: string;
  status: string;
  fiscal_year: number;
  model_type: DashboardModelType;
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
  } | null;
  counts: {
    documents: number;
    processing: number;
    pending_review: number;
    open_alerts: number;
    critical_alerts: number;
    exports: number;
  };
  last_activity_at: string | null;
};

export type DashboardModelOverview = {
  model_type: DashboardModelType;
  expedientes: number;
  pending_review: number;
  open_alerts: number;
  exports: number;
};

export type DashboardPayload = {
  queued: number;
  processing: number;
  manualReview: number;
  completed: number;
  failed: number;
  openAlerts: number;
  exports: number;
  current_user: DashboardCurrentUser;
  summary: DashboardSummary;
  portfolio_clients: DashboardPortfolioClient[];
  expedientes: DashboardExpedienteWorkItem[];
  model_overview: DashboardModelOverview[];
};
