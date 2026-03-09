import type { SupabaseClient } from "@supabase/supabase-js";
import { buildModel100RuntimeFromCanonical } from "@/lib/canonical-exports";
import { loadPersistedCanonicalExpedienteView } from "@/lib/canonical-store";
import { dbTables } from "@/lib/db-tables";

export type DocumentalWorkflowStatus = "not_started" | "in_progress" | "blocked" | "ready";
export type RevisionWorkflowStatus = "not_started" | "pending" | "ready";
export type CanonicalWorkflowStatus = "not_started" | "in_progress" | "ready" | "approved";
export type DeclarativeWorkflowStatus = "blocked" | "ready" | "prepared";
export type FilingWorkflowStatus = "draft" | "ready" | "filed";
export type CanonicalApprovalStatus = "draft" | "reviewed" | "approved";
export type ExpedienteLifecycleStatus = "BORRADOR" | "EN_REVISION" | "VALIDADO" | "PRESENTADO" | "MODIFICADO";

export type ExpedienteWorkflowCounts = {
  documents: number;
  queued: number;
  processing: number;
  manual_review: number;
  failed: number;
  operations: number;
  assets: number;
  fiscal_events: number;
  exports: number;
  sales_pending: number;
};

export type PersistedExpedienteWorkflowRow = {
  expediente_id: string;
  documental_status: DocumentalWorkflowStatus;
  revision_status: RevisionWorkflowStatus;
  canonical_status: CanonicalWorkflowStatus;
  declarative_status: DeclarativeWorkflowStatus;
  filing_status: FilingWorkflowStatus;
  canonical_approval_status: CanonicalApprovalStatus;
  workflow_owner_ref: string | null;
  workflow_owner_name: string | null;
  pending_task: string | null;
  pending_reason: string | null;
  workflow_updated_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExpedienteWorkflowSnapshot = {
  expediente_id: string;
  documental_status: DocumentalWorkflowStatus;
  revision_status: RevisionWorkflowStatus;
  canonical_status: CanonicalWorkflowStatus;
  declarative_status: DeclarativeWorkflowStatus;
  filing_status: FilingWorkflowStatus;
  canonical_approval_status: CanonicalApprovalStatus;
  workflow_owner_ref: string | null;
  workflow_owner_name: string | null;
  pending_task: string | null;
  pending_reason: string | null;
  workflow_updated_at: string | null;
  expediente_status: ExpedienteLifecycleStatus;
};

type WorkflowDerivationInput = {
  expediente_id: string;
  expediente_status: string;
  has_client: boolean;
  counts: ExpedienteWorkflowCounts;
  persisted?: PersistedExpedienteWorkflowRow | null;
  overrides?: {
    canonical_approval_status?: CanonicalApprovalStatus;
    filing_status?: FilingWorkflowStatus;
    workflow_owner_ref?: string | null;
    workflow_owner_name?: string | null;
    pending_task?: string | null;
    pending_reason?: string | null;
  };
};

type WorkflowExpedienteRow = {
  id: string;
  client_id: string | null;
  reference: string;
  fiscal_year: number;
  model_type: string;
  status: string;
};

type DocumentStatusRow = {
  processing_status: "queued" | "processing" | "completed" | "manual_review" | "failed";
};

type WorkflowStorageError = {
  code?: string | null;
  message?: string | null;
} | null;

const workflowSelect =
  "expediente_id, documental_status, revision_status, canonical_status, declarative_status, filing_status, canonical_approval_status, workflow_owner_ref, workflow_owner_name, pending_task, pending_reason, workflow_updated_at, created_at, updated_at";

function isWorkflowStorageUnavailable(error: WorkflowStorageError): boolean {
  if (!error) {
    return false;
  }

  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST205" ||
    (message.includes("irpf_expediente_workflow") &&
      (message.includes("does not exist") ||
        message.includes("could not find the table") ||
        message.includes("schema cache")))
  );
}

function toNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeApprovalStatus(
  persisted: PersistedExpedienteWorkflowRow | null | undefined,
  expedienteStatus: string
): CanonicalApprovalStatus {
  if (persisted?.canonical_approval_status) {
    return persisted.canonical_approval_status;
  }

  return expedienteStatus === "VALIDADO" || expedienteStatus === "PRESENTADO" ? "approved" : "draft";
}

function normalizeFilingStatus(
  persisted: PersistedExpedienteWorkflowRow | null | undefined,
  expedienteStatus: string
): FilingWorkflowStatus {
  if (persisted?.filing_status) {
    return persisted.filing_status;
  }

  return expedienteStatus === "PRESENTADO" ? "filed" : "draft";
}

export function buildExpedienteWorkflowSnapshot(
  input: WorkflowDerivationInput
): ExpedienteWorkflowSnapshot {
  const hasDocuments = input.counts.documents > 0;
  const hasCanonicalBase =
    input.counts.operations > 0 || input.counts.assets > 0 || input.counts.fiscal_events > 0;

  const documental_status: DocumentalWorkflowStatus =
    !hasDocuments
      ? "not_started"
      : input.counts.failed > 0
        ? "blocked"
        : input.counts.queued > 0 || input.counts.processing > 0
          ? "in_progress"
          : "ready";

  const revision_status: RevisionWorkflowStatus =
    !hasDocuments
      ? "not_started"
      : input.counts.manual_review > 0 || input.counts.failed > 0
        ? "pending"
        : "ready";

  let canonical_approval_status =
    input.overrides?.canonical_approval_status ??
    normalizeApprovalStatus(input.persisted, input.expediente_status);

  if (!hasCanonicalBase) {
    canonical_approval_status = "draft";
  } else if (
    canonical_approval_status === "approved" &&
    (documental_status !== "ready" ||
      revision_status !== "ready" ||
      input.counts.sales_pending > 0)
  ) {
    canonical_approval_status = "reviewed";
  }

  const canonical_status: CanonicalWorkflowStatus =
    !hasCanonicalBase
      ? "not_started"
      : input.counts.sales_pending > 0
        ? "in_progress"
        : canonical_approval_status === "approved"
          ? "approved"
          : "ready";

  const declarative_status: DeclarativeWorkflowStatus =
    !input.has_client ||
    documental_status !== "ready" ||
    revision_status !== "ready" ||
    !hasCanonicalBase ||
    input.counts.sales_pending > 0 ||
    canonical_approval_status !== "approved"
      ? "blocked"
      : input.counts.exports > 0
        ? "prepared"
        : "ready";

  let filing_status =
    input.overrides?.filing_status ?? normalizeFilingStatus(input.persisted, input.expediente_status);
  if (filing_status !== "filed") {
    filing_status = declarative_status === "blocked" ? "draft" : "ready";
  }

  const hasProgress =
    input.counts.documents > 0 ||
    input.counts.operations > 0 ||
    input.counts.assets > 0 ||
    input.counts.fiscal_events > 0 ||
    input.counts.exports > 0;

  const expediente_status: ExpedienteLifecycleStatus =
    filing_status === "filed"
      ? "PRESENTADO"
      : input.counts.exports > 0 && declarative_status === "blocked"
        ? "MODIFICADO"
        : canonical_approval_status === "approved" && declarative_status !== "blocked"
          ? "VALIDADO"
          : hasProgress
            ? "EN_REVISION"
            : "BORRADOR";

  return {
    expediente_id: input.expediente_id,
    documental_status,
    revision_status,
    canonical_status,
    declarative_status,
    filing_status,
    canonical_approval_status,
    workflow_owner_ref:
      input.overrides?.workflow_owner_ref !== undefined
        ? input.overrides.workflow_owner_ref
        : input.persisted?.workflow_owner_ref ?? null,
    workflow_owner_name:
      input.overrides?.workflow_owner_name !== undefined
        ? input.overrides.workflow_owner_name
        : input.persisted?.workflow_owner_name ?? null,
    pending_task:
      input.overrides?.pending_task !== undefined
        ? input.overrides.pending_task
        : input.persisted?.pending_task ?? null,
    pending_reason:
      input.overrides?.pending_reason !== undefined
        ? input.overrides.pending_reason
        : input.persisted?.pending_reason ?? null,
    workflow_updated_at: input.persisted?.workflow_updated_at ?? null,
    expediente_status
  };
}

export async function loadPersistedExpedienteWorkflowMap(
  supabase: SupabaseClient,
  expedienteIds: string[]
): Promise<Map<string, PersistedExpedienteWorkflowRow>> {
  if (expedienteIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from(dbTables.expedienteWorkflow)
    .select(workflowSelect)
    .in("expediente_id", expedienteIds);

  if (isWorkflowStorageUnavailable(error)) {
    return new Map();
  }

  if (error) {
    throw new Error(`No se pudo cargar workflow de expedientes: ${error.message}`);
  }

  return new Map(((data ?? []) as PersistedExpedienteWorkflowRow[]).map((row) => [row.expediente_id, row]));
}

export async function loadPersistedExpedienteWorkflow(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<PersistedExpedienteWorkflowRow | null> {
  const workflowMap = await loadPersistedExpedienteWorkflowMap(supabase, [expedienteId]);
  return workflowMap.get(expedienteId) ?? null;
}

export async function persistExpedienteWorkflowSnapshot(
  supabase: SupabaseClient,
  snapshot: ExpedienteWorkflowSnapshot
): Promise<void> {
  const { error: workflowError } = await supabase.from(dbTables.expedienteWorkflow).upsert(
    {
      expediente_id: snapshot.expediente_id,
      documental_status: snapshot.documental_status,
      revision_status: snapshot.revision_status,
      canonical_status: snapshot.canonical_status,
      declarative_status: snapshot.declarative_status,
      filing_status: snapshot.filing_status,
      canonical_approval_status: snapshot.canonical_approval_status,
      workflow_owner_ref: snapshot.workflow_owner_ref,
      workflow_owner_name: snapshot.workflow_owner_name,
      pending_task: snapshot.pending_task,
      pending_reason: snapshot.pending_reason,
      workflow_updated_at: new Date().toISOString()
    },
    { onConflict: "expediente_id" }
  );

  if (workflowError && !isWorkflowStorageUnavailable(workflowError)) {
    throw new Error(`No se pudo persistir workflow de expediente: ${workflowError.message}`);
  }

  const { error: expedienteError } = await supabase
    .from(dbTables.expedientes)
    .update({ status: snapshot.expediente_status })
    .eq("id", snapshot.expediente_id);

  if (expedienteError) {
    throw new Error(`No se pudo sincronizar estado del expediente: ${expedienteError.message}`);
  }
}

async function loadWorkflowCountsForExpediente(
  supabase: SupabaseClient,
  expedienteId: string,
  expediente: WorkflowExpedienteRow
): Promise<ExpedienteWorkflowCounts> {
  const [documentsResult, operationsResult, exportsResult] = await Promise.all([
    supabase
      .from(dbTables.documents)
      .select("processing_status")
      .eq("expediente_id", expedienteId),
    supabase
      .from(dbTables.operations)
      .select("id", { count: "exact", head: true })
      .eq("expediente_id", expedienteId),
    supabase
      .from(dbTables.exports)
      .select("id", { count: "exact", head: true })
      .eq("expediente_id", expedienteId)
  ]);

  if (documentsResult.error || operationsResult.error || exportsResult.error) {
    throw new Error(
      documentsResult.error?.message ??
        operationsResult.error?.message ??
        exportsResult.error?.message ??
        "No se pudo cargar el workflow del expediente"
    );
  }

  const documentRows = (documentsResult.data ?? []) as DocumentStatusRow[];
  const canonicalView = await loadPersistedCanonicalExpedienteView(supabase, {
    clientId: expediente.client_id,
    expedienteId,
    expedienteReference: expediente.reference,
    eventLimit: null
  });
  const canonicalAssets = canonicalView?.assets ?? [];
  const canonicalEvents = canonicalView?.fiscalEvents ?? [];
  const saleRuntime = buildModel100RuntimeFromCanonical({ fiscalEvents: canonicalEvents });

  return {
    documents: documentRows.length,
    queued: documentRows.filter((row) => row.processing_status === "queued").length,
    processing: documentRows.filter((row) => row.processing_status === "processing").length,
    manual_review: documentRows.filter((row) => row.processing_status === "manual_review").length,
    failed: documentRows.filter((row) => row.processing_status === "failed").length,
    operations: operationsResult.count ?? 0,
    assets: canonicalAssets.length,
    fiscal_events: canonicalEvents.length,
    exports: exportsResult.count ?? 0,
    sales_pending: saleRuntime.saleRecords.filter((sale) => sale.status !== "MATCHED").length
  };
}

export async function syncExpedienteWorkflowById(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    overrides?: WorkflowDerivationInput["overrides"];
  }
): Promise<ExpedienteWorkflowSnapshot | null> {
  const { data: expediente, error: expedienteError } = await supabase
    .from(dbTables.expedientes)
    .select("id, client_id, reference, fiscal_year, model_type, status")
    .eq("id", input.expedienteId)
    .maybeSingle();

  if (expedienteError) {
    throw new Error(`No se pudo cargar el expediente para workflow: ${expedienteError.message}`);
  }

  if (!expediente) {
    return null;
  }

  const [persisted, counts] = await Promise.all([
    loadPersistedExpedienteWorkflow(supabase, input.expedienteId),
    loadWorkflowCountsForExpediente(supabase, input.expedienteId, expediente as WorkflowExpedienteRow)
  ]);

  const snapshot = buildExpedienteWorkflowSnapshot({
    expediente_id: input.expedienteId,
    expediente_status: expediente.status,
    has_client: Boolean(expediente.client_id),
    counts,
    persisted,
    overrides: input.overrides
  });

  await persistExpedienteWorkflowSnapshot(supabase, snapshot);
  return snapshot;
}

export function workflowTone(
  value:
    | DocumentalWorkflowStatus
    | RevisionWorkflowStatus
    | CanonicalWorkflowStatus
    | DeclarativeWorkflowStatus
    | FilingWorkflowStatus
    | CanonicalApprovalStatus
): "success" | "warning" | "danger" | "info" {
  if (value === "ready" || value === "approved" || value === "prepared" || value === "filed") {
    return "success";
  }

  if (value === "blocked") {
    return "danger";
  }

  if (value === "in_progress" || value === "pending" || value === "reviewed") {
    return "warning";
  }

  return "info";
}
