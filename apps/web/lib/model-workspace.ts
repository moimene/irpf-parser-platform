import type { DashboardCurrentUser, DashboardModelType } from "@/lib/dashboard";
import type { PreparationStatus, ModelPreparationState } from "@/lib/model-preparation";

export type ModelWorkspaceItem = {
  id: string;
  reference: string;
  title: string;
  status: string;
  fiscal_year: number;
  model_type: DashboardModelType;
  export_model: "100" | "714" | "720";
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
    fiscal_unit_label: string;
    fiscal_unit_detail: string;
  } | null;
  counts: {
    documents: number;
    pending_review: number;
    open_alerts: number;
    exports: number;
    operations: number;
    assets: number;
    foreign_assets: number;
    missing_asset_values: number;
    missing_foreign_values: number;
    missing_ownership_assets: number;
    missing_foreign_country_assets: number;
    missing_foreign_block_assets: number;
    missing_foreign_q4_assets: number;
    threshold_reached_blocks: number;
    sales_pending: number;
  };
  workflow: {
    documental_status: string;
    revision_status: string;
    canonical_status: string;
    declarative_status: string;
    filing_status: string;
    canonical_approval_status: string;
    workflow_owner_ref: string | null;
    workflow_owner_name: string | null;
    pending_task: string | null;
    pending_reason: string | null;
  };
  preparation: ModelPreparationState;
  next_action: {
    label: string;
    href: string;
  };
  latest_export: {
    model: "100" | "714" | "720";
    status: string;
    validation_state: string;
    generated_at: string | null;
  } | null;
  last_activity_at: string | null;
};

export type ModelWorkspaceOverview = {
  model_type: DashboardModelType;
  export_model: "100" | "714" | "720";
  expedientes: number;
  ready: number;
  attention: number;
  blocked: number;
  exports: number;
};

export type ModelWorkspaceSummary = {
  expedientes: number;
  ready: number;
  attention: number;
  blocked: number;
  exports: number;
};

export type ModelWorkspacePayload = {
  current_user: DashboardCurrentUser;
  summary: ModelWorkspaceSummary;
  overview: ModelWorkspaceOverview[];
  work_items: ModelWorkspaceItem[];
};

export const emptyModelWorkspacePayload: ModelWorkspacePayload = {
  current_user: {
    reference: "",
    display_name: "",
    role: "solo_lectura"
  },
  summary: {
    expedientes: 0,
    ready: 0,
    attention: 0,
    blocked: 0,
    exports: 0
  },
  overview: [],
  work_items: []
};

export function countPreparationStatus(items: ModelWorkspaceItem[], status: PreparationStatus): number {
  return items.filter((item) => item.preparation.status === status).length;
}
