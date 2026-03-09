"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ExportGenerator } from "@/components/export-generator";
import { IntakeForm } from "@/components/intake-form";
import {
  canonicalAssetTypes,
  canonicalForeignAssetBlocks,
  canonicalHolderRoles,
  canonicalValuationMethods,
  type CanonicalAssetSummary,
  type CanonicalFiscalEvent
} from "@/lib/fiscal-canonical";
import type {
  CanonicalApprovalStatus,
  CanonicalWorkflowStatus,
  DeclarativeWorkflowStatus,
  DocumentalWorkflowStatus,
  FilingWorkflowStatus,
  RevisionWorkflowStatus
} from "@/lib/expediente-workflow";

type ExpedienteDocument = {
  id: string;
  filename: string;
  processing_status: string;
  confidence: number;
  manual_review_required: boolean;
  uploaded_at: string | null;
  processed_at: string | null;
  uploaded_by: string | null;
  latest_extraction: {
    id: string;
    confidence: number;
    requires_manual_review: boolean;
    review_status: string;
    records_count: number;
    created_at: string;
  } | null;
};

type ExpedienteExport = {
  id: string;
  model: "100" | "714" | "720";
  status: string;
  validation_state: string;
  artifact_path: string;
  generated_at: string;
};

type ExpedienteOperation = {
  id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  retention: number | null;
  realized_gain: number | null;
  source: string;
  confidence: number | null;
  manual_notes: string | null;
};

type ExpedienteLot = {
  id: string;
  acquisition_operation_id: string | null;
  isin: string;
  description: string | null;
  acquisition_date: string;
  quantity_original: number;
  quantity_open: number;
  quantity_sold: number;
  unit_cost: number | null;
  total_cost: number | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
  source: string;
  sales_count: number;
};

type ExpedienteSaleSummary = {
  sale_operation_id: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  sale_amount: number | null;
  sale_amount_allocated: number | null;
  quantity_allocated: number;
  missing_quantity: number;
  cost_basis: number | null;
  realized_gain: number | null;
  reported_realized_gain: number | null;
  currency: string | null;
  allocations_count: number;
  status: "MATCHED" | "UNRESOLVED" | "PENDING_COST_BASIS" | "INVALID_DATA";
  source: string;
};

type ExpedientePayload = {
  current_user?: {
    reference: string;
    display_name: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  canonical_runtime_mode?: "persisted" | "derived";
  canonical_editable?: boolean;
  expediente_id: string;
  expediente_reference: string;
  title: string;
  status: string;
  fiscal_year: number;
  model_type: string;
  workflow: {
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
    expediente_status: string;
  };
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
  } | null;
  counts: {
    total: number;
    queued: number;
    processing: number;
    manual_review: number;
    completed: number;
    failed: number;
    assets: number;
    fiscal_events: number;
    operations: number;
    exports: number;
    lots_open: number;
    lots_closed: number;
    sales_matched: number;
    sales_pending: number;
  };
  documents: ExpedienteDocument[];
  assets: CanonicalAssetSummary[];
  fiscal_events: CanonicalFiscalEvent[];
  operations: ExpedienteOperation[];
  lots: ExpedienteLot[];
  sale_summaries: ExpedienteSaleSummary[];
  exports: ExpedienteExport[];
};

type CanonicalAssetForm = {
  asset_key: string;
  label: string;
  notes: string;
  asset_type: CanonicalAssetSummary["asset_type"];
  holder_role: CanonicalAssetSummary["holder_role"];
  ownership_pct: string;
  country: string;
  year_end_value: string;
  q4_avg_balance: string;
  valuation_method: CanonicalAssetSummary["valuation_method"];
  foreign_block: CanonicalAssetSummary["foreign_block"];
};

type CanonicalEventForm = {
  event_id: string;
  description: string;
  amount: string;
  quantity: string;
  retention: string;
  realized_gain: string;
  status: CanonicalFiscalEvent["status"];
  notes: string;
};

type WorkflowForm = {
  pending_task: string;
  pending_reason: string;
};

type WorkspacePhase = "resumen" | "documental" | "revision" | "canonico" | "modelos";

type PhaseState = {
  label: string;
  tone: "success" | "warning" | "danger" | "info";
  detail: string;
};

const emptyState: ExpedientePayload = {
  current_user: undefined,
  canonical_runtime_mode: "derived",
  canonical_editable: false,
  expediente_id: "",
  expediente_reference: "",
  title: "",
  status: "BORRADOR",
  fiscal_year: new Date().getFullYear(),
  model_type: "IRPF",
  workflow: {
    expediente_id: "",
    documental_status: "not_started",
    revision_status: "not_started",
    canonical_status: "not_started",
    declarative_status: "blocked",
    filing_status: "draft",
    canonical_approval_status: "draft",
    workflow_owner_ref: null,
    workflow_owner_name: null,
    pending_task: null,
    pending_reason: null,
    workflow_updated_at: null,
    expediente_status: "BORRADOR"
  },
  client: null,
  counts: {
    total: 0,
    queued: 0,
    processing: 0,
    manual_review: 0,
    completed: 0,
    failed: 0,
    assets: 0,
    fiscal_events: 0,
    operations: 0,
    exports: 0,
    lots_open: 0,
    lots_closed: 0,
    sales_matched: 0,
    sales_pending: 0
  },
  documents: [],
  assets: [],
  fiscal_events: [],
  operations: [],
  lots: [],
  sale_summaries: [],
  exports: []
};

const emptyAssetForm: CanonicalAssetForm = {
  asset_key: "",
  label: "",
  notes: "",
  asset_type: "other",
  holder_role: "titular",
  ownership_pct: "100",
  country: "",
  year_end_value: "",
  q4_avg_balance: "",
  valuation_method: "pending",
  foreign_block: null
};

const emptyEventForm: CanonicalEventForm = {
  event_id: "",
  description: "",
  amount: "",
  quantity: "",
  retention: "",
  realized_gain: "",
  status: "RECORDED",
  notes: ""
};

const emptyWorkflowForm: WorkflowForm = {
  pending_task: "",
  pending_reason: ""
};

const workspacePhases: Array<{
  id: WorkspacePhase;
  label: string;
  shortLabel: string;
}> = [
  { id: "resumen", label: "Resumen", shortLabel: "Estado general" },
  { id: "documental", label: "Documental", shortLabel: "Ingesta y parseo" },
  { id: "revision", label: "Revisión", shortLabel: "Control manual" },
  { id: "canonico", label: "Registro canónico", shortLabel: "Activos, eventos y lotes" },
  { id: "modelos", label: "Modelos AEAT", shortLabel: "Preparación y exportes" }
];

const phaseGuidance: Record<
  WorkspacePhase,
  {
    title: string;
    detail: string;
  }
> = {
  resumen: {
    title: "Resumen",
    detail: "Mide si el expediente está bloqueado por documental, revisión, canónico o preparación declarativa."
  },
  documental: {
    title: "Documental",
    detail: "Sirve para cargar documentos, seguir el parseo y comprobar si la ingesta ya aterrizó en el expediente correcto."
  },
  revision: {
    title: "Revisión",
    detail: "Aquí se corrigen registros extraídos y se decide si el documento se mantiene, se rechaza o se incorpora al runtime."
  },
  canonico: {
    title: "Registro canónico",
    detail: "Gobierna el dato patrimonial-fiscal consolidado: activos, eventos, lotes, titularidad y valoración."
  },
  modelos: {
    title: "Modelos AEAT",
    detail: "Valida prerequisitos del modelo, genera salidas y deja claro si el expediente está listo para declaración."
  }
};

function isWorkspacePhase(value: string | null): value is WorkspacePhase {
  return workspacePhases.some((phase) => phase.id === value);
}

function badgeClass(value: string): string {
  if (
    value === "completed" ||
    value === "generated" ||
    value === "validated" ||
    value === "ok" ||
    value === "approved" ||
    value === "prepared" ||
    value === "filed" ||
    value === "OPEN" ||
    value === "MATCHED" ||
    value === "success"
  ) {
    return "badge success";
  }

  if (
    value === "manual_review" ||
    value === "warnings" ||
    value === "pending" ||
    value === "reviewed" ||
    value === "draft" ||
    value === "in_progress" ||
    value === "PENDING_COST_BASIS" ||
    value === "CLOSED" ||
    value === "warning"
  ) {
    return "badge warning";
  }

  if (
    value === "failed" ||
    value === "blocked" ||
    value === "rejected" ||
    value === "errors" ||
    value === "UNRESOLVED" ||
    value === "INVALID_DATA" ||
    value === "danger"
  ) {
    return "badge danger";
  }

  return "badge info";
}

function formatNumber(value: number | null, maximumFractionDigits = 6): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) {
    return "-";
  }

  const resolvedCurrency = currency?.trim().toUpperCase() || "EUR";

  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${formatNumber(value, 2)} ${resolvedCurrency}`;
  }
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("es-ES") : "Sin actividad";
}

function formatFormNumber(value: number | null): string {
  return value === null ? "" : String(value);
}

function parseNullableFormNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function assetTypeLabel(value: CanonicalAssetSummary["asset_type"]): string {
  const labels: Record<CanonicalAssetSummary["asset_type"], string> = {
    security: "Valor",
    fund: "Fondo",
    account: "Cuenta",
    insurance: "Seguro",
    real_estate: "Inmueble",
    cash: "Tesorería",
    other: "Otro"
  };

  return labels[value];
}

function holderRoleLabel(value: CanonicalAssetSummary["holder_role"]): string {
  const labels: Record<CanonicalAssetSummary["holder_role"], string> = {
    titular: "Titular",
    conyuge: "Cónyuge",
    cotitular: "Cotitular",
    usufructuario: "Usufructuario",
    nudo_propietario: "Nudo propietario",
    otro: "Otro"
  };

  return labels[value];
}

function valuationMethodLabel(value: CanonicalAssetSummary["valuation_method"]): string {
  const labels: Record<CanonicalAssetSummary["valuation_method"], string> = {
    market_value: "Valor mercado",
    cost_basis: "Coste fiscal",
    year_end_value: "Valor fin ejercicio",
    q4_average: "Saldo medio Q4",
    manual: "Manual",
    pending: "Pendiente"
  };

  return labels[value];
}

function foreignBlockLabel(value: CanonicalAssetSummary["foreign_block"]): string {
  if (!value) {
    return "No aplica";
  }

  const labels: Record<NonNullable<CanonicalAssetSummary["foreign_block"]>, string> = {
    accounts: "Cuentas",
    securities: "Valores",
    insurance_real_estate: "Seguros / inmuebles",
    other: "Otros"
  };

  return labels[value];
}

function toAssetForm(asset: CanonicalAssetSummary): CanonicalAssetForm {
  return {
    asset_key: asset.asset_key,
    label: asset.label,
    notes: asset.notes ?? "",
    asset_type: asset.asset_type,
    holder_role: asset.holder_role,
    ownership_pct: formatFormNumber(asset.ownership_pct),
    country: asset.country ?? "",
    year_end_value: formatFormNumber(asset.year_end_value),
    q4_avg_balance: formatFormNumber(asset.q4_avg_balance),
    valuation_method: asset.valuation_method,
    foreign_block: asset.foreign_block
  };
}

function toEventForm(event: CanonicalFiscalEvent): CanonicalEventForm {
  return {
    event_id: event.event_id,
    description: event.description ?? "",
    amount: formatFormNumber(event.amount),
    quantity: formatFormNumber(event.quantity),
    retention: formatFormNumber(event.retention),
    realized_gain: formatFormNumber(event.realized_gain),
    status: event.status,
    notes: event.notes ?? ""
  };
}

function resolveDocumentalState(payload: ExpedientePayload): PhaseState {
  switch (payload.workflow.documental_status) {
    case "blocked":
      return {
        label: "Bloqueado",
        tone: "danger",
        detail: `${payload.counts.failed} documento(s) han fallado y requieren nueva decisión documental.`
      };
    case "in_progress":
      return {
        label: "En curso",
        tone: "warning",
        detail: "Hay documentos aún en cola o en proceso de parseo."
      };
    case "ready":
      return {
        label: "Listo",
        tone: "success",
        detail: "La documentación base del expediente ya está registrada."
      };
    default:
      return {
        label: "Sin iniciar",
        tone: "info",
        detail: "Todavía no hay documentación cargada para este ejercicio."
      };
  }
}

function resolveReviewState(payload: ExpedientePayload): PhaseState {
  switch (payload.workflow.revision_status) {
    case "pending":
      return {
        label: "Pendiente",
        tone: "warning",
        detail: `${payload.counts.manual_review + payload.counts.failed} documento(s) requieren intervención del fiscalista.`
      };
    case "ready":
      return {
        label: "Resuelto",
        tone: "success",
        detail: "No quedan documentos pendientes de revisión manual."
      };
    default:
      return {
        label: "Sin iniciar",
        tone: "info",
        detail: "La revisión manual todavía no aplica porque no existe documentación."
      };
  }
}

function resolveCanonicalState(payload: ExpedientePayload): PhaseState {
  switch (payload.workflow.canonical_status) {
    case "approved":
      return {
        label: "Aprobado",
        tone: "success",
        detail: "El registro canónico está aprobado para trabajo declarativo."
      };
    case "ready":
      return {
        label: "Listo para aprobar",
        tone: "warning",
        detail: "El runtime ya está consistente, pero falta aprobación funcional del canónico."
      };
    case "in_progress":
      return {
        label: "Pendiente de cuadre",
        tone: "warning",
        detail: `${payload.counts.sales_pending} venta(s) siguen pendientes de cierre fiscal o coste.`
      };
    default:
      return {
        label: "Sin iniciar",
        tone: "info",
        detail: "Todavía no existe registro canónico útil para explotación fiscal."
      };
  }
}

function resolveModelsState(payload: ExpedientePayload): PhaseState {
  switch (payload.workflow.declarative_status) {
    case "prepared":
      return {
        label: "Preparado",
        tone: "success",
        detail: "Ya existen exportaciones o validaciones generadas para este expediente."
      };
    case "ready":
      return {
        label: "Listo para preparar",
        tone: "success",
        detail: "El expediente ya puede entrar en validación y preparación AEAT."
      };
    default:
      return {
        label: "Bloqueado",
        tone: "danger",
        detail: "El expediente no debe salir a AEAT hasta cerrar revisión y aprobar el canónico."
      };
  }
}

function resolveNextStep(payload: ExpedientePayload): {
  phase: WorkspacePhase;
  title: string;
  detail: string;
} {
  if (payload.counts.total === 0) {
    return {
      phase: "documental",
      title: "Cargar documentación base",
      detail: "El expediente aún no tiene documentos. El siguiente paso útil es abrir la fase documental."
    };
  }

  if (payload.counts.manual_review > 0 || payload.counts.failed > 0) {
    return {
      phase: "revision",
      title: "Resolver revisión manual",
      detail: "Hay documentos pendientes o fallidos. El expediente no debería avanzar mientras exista esa cola."
    };
  }

  if (
    payload.workflow.canonical_status === "not_started" ||
    payload.workflow.canonical_status === "in_progress" ||
    payload.workflow.canonical_approval_status !== "approved"
  ) {
    return {
      phase: "canonico",
      title: "Consolidar registro canónico",
      detail: "El runtime fiscal necesita cierre funcional y aprobación del canónico antes de pasar a modelos."
    };
  }

  return {
    phase: "modelos",
    title: "Preparar modelo AEAT",
    detail: "La base documental y fiscal ya está suficientemente armada para generar y validar el modelo declarativo."
  };
}

function workflowStatusLabel(
  value:
    | DocumentalWorkflowStatus
    | RevisionWorkflowStatus
    | CanonicalWorkflowStatus
    | DeclarativeWorkflowStatus
    | FilingWorkflowStatus
    | CanonicalApprovalStatus
): string {
  switch (value) {
    case "not_started":
      return "Sin iniciar";
    case "in_progress":
      return "En curso";
    case "blocked":
      return "Bloqueado";
    case "pending":
      return "Pendiente";
    case "ready":
      return "Listo";
    case "approved":
      return "Aprobado";
    case "prepared":
      return "Preparado";
    case "filed":
      return "Presentado";
    case "reviewed":
      return "Revisado";
    case "draft":
      return "Borrador";
    default:
      return value;
  }
}

function visibleDocumentsForReview(payload: ExpedientePayload): ExpedienteDocument[] {
  return payload.documents.filter(
    (document) => document.processing_status === "manual_review" || document.processing_status === "failed"
  );
}

export function ExpedienteSummary({ expedienteId }: { expedienteId: string }) {
  const [payload, setPayload] = useState<ExpedientePayload>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowForm, setWorkflowForm] = useState<WorkflowForm>(emptyWorkflowForm);
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [canonicalMessage, setCanonicalMessage] = useState<string | null>(null);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);
  const [assetForm, setAssetForm] = useState<CanonicalAssetForm>(emptyAssetForm);
  const [eventForm, setEventForm] = useState<CanonicalEventForm>(emptyEventForm);
  const [assetSubmitting, setAssetSubmitting] = useState(false);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const response = await fetch(`/api/expedientes/${expedienteId}`, { cache: "no-store" });
        const body = (await response.json()) as ExpedientePayload | { error: string };
        if (!response.ok) {
          setError((body as { error: string }).error ?? "No se pudo cargar el expediente");
          return;
        }

        setPayload(body as ExpedientePayload);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el expediente");
      } finally {
        setLoading(false);
      }
    }

    void load();

    const intervalId = window.setInterval(() => void load(), 5000);
    const refreshListener = () => void load();
    window.addEventListener("expediente:refresh", refreshListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("expediente:refresh", refreshListener);
    };
  }, [expedienteId]);

  const requestedPhase = searchParams.get("fase");
  const activePhase: WorkspacePhase = isWorkspacePhase(requestedPhase) ? requestedPhase : "resumen";
  const documentalState = resolveDocumentalState(payload);
  const reviewState = resolveReviewState(payload);
  const canonicalState = resolveCanonicalState(payload);
  const modelsState = resolveModelsState(payload);
  const nextStep = resolveNextStep(payload);
  const reviewDocuments = visibleDocumentsForReview(payload);
  const canEditCanonical =
    payload.canonical_editable === true && payload.current_user?.role !== "solo_lectura";
  const canEditWorkflow = payload.current_user?.role !== "solo_lectura";
  const canApproveCanonical =
    payload.current_user?.role === "admin" || payload.current_user?.role === "fiscal_senior";
  const showInitialLoading = loading && !payload.expediente_id && !error;

  useEffect(() => {
    const nextForm = {
      pending_task: payload.workflow.pending_task ?? "",
      pending_reason: payload.workflow.pending_reason ?? ""
    };

    setWorkflowForm((current) => {
      const isDirty =
        current.pending_task !== (payload.workflow.pending_task ?? "") ||
        current.pending_reason !== (payload.workflow.pending_reason ?? "");

      if (isDirty && !workflowSubmitting) {
        return current;
      }

      return nextForm;
    });
  }, [payload.workflow.pending_reason, payload.workflow.pending_task, workflowSubmitting]);

  function navigateToPhase(phase: WorkspacePhase) {
    const params = new URLSearchParams(searchParams.toString());
    if (phase === "resumen") {
      params.delete("fase");
    } else {
      params.set("fase", phase);
    }

    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  async function submitWorkflowPatch(body: Record<string, unknown>) {
    setWorkflowSubmitting(true);
    setWorkflowError(null);
    setWorkflowMessage(null);

    try {
      const response = await fetch(`/api/expedientes/${expedienteId}/workflow`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;

      if (!response.ok) {
        setWorkflowError(payload?.error ?? "No se pudo actualizar el workflow del expediente.");
        return;
      }

      setWorkflowMessage(payload?.message ?? "Workflow del expediente actualizado.");
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setWorkflowError(
        submitError instanceof Error ? submitError.message : "No se pudo actualizar el workflow del expediente."
      );
    } finally {
      setWorkflowSubmitting(false);
    }
  }

  async function submitAssetOverride() {
    if (!assetForm.asset_key) {
      setCanonicalError("Selecciona un activo canónico antes de guardar un ajuste.");
      return;
    }

    setAssetSubmitting(true);
    setCanonicalError(null);
    setCanonicalMessage(null);

    try {
      const response = await fetch(
        `/api/expedientes/${expedienteId}/assets/${encodeURIComponent(assetForm.asset_key)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: assetForm.label.trim(),
            notes: assetForm.notes.trim(),
            asset_type: assetForm.asset_type,
            holder_role: assetForm.holder_role,
            ownership_pct: parseNullableFormNumber(assetForm.ownership_pct),
            country: assetForm.country.trim().toUpperCase(),
            year_end_value: parseNullableFormNumber(assetForm.year_end_value),
            q4_avg_balance: parseNullableFormNumber(assetForm.q4_avg_balance),
            valuation_method: assetForm.valuation_method,
            foreign_block: assetForm.foreign_block
          })
        }
      );
      const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!response.ok) {
        setCanonicalError(body?.error ?? "No se pudo actualizar el activo canónico.");
        return;
      }

      setCanonicalMessage(body?.message ?? "Activo canónico actualizado.");
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setCanonicalError(
        submitError instanceof Error ? submitError.message : "No se pudo actualizar el activo canónico."
      );
    } finally {
      setAssetSubmitting(false);
    }
  }

  async function submitEventOverride() {
    if (!eventForm.event_id) {
      setCanonicalError("Selecciona un evento fiscal antes de guardar un ajuste.");
      return;
    }

    setEventSubmitting(true);
    setCanonicalError(null);
    setCanonicalMessage(null);

    try {
      const response = await fetch(
        `/api/expedientes/${expedienteId}/fiscal-events/${encodeURIComponent(eventForm.event_id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            description: eventForm.description.trim(),
            amount: parseNullableFormNumber(eventForm.amount),
            quantity: parseNullableFormNumber(eventForm.quantity),
            retention: parseNullableFormNumber(eventForm.retention),
            realized_gain: parseNullableFormNumber(eventForm.realized_gain),
            status: eventForm.status,
            notes: eventForm.notes.trim()
          })
        }
      );
      const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!response.ok) {
        setCanonicalError(body?.error ?? "No se pudo actualizar el evento fiscal canónico.");
        return;
      }

      setCanonicalMessage(body?.message ?? "Evento fiscal canónico actualizado.");
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setCanonicalError(
        submitError instanceof Error ? submitError.message : "No se pudo actualizar el evento fiscal canónico."
      );
    } finally {
      setEventSubmitting(false);
    }
  }

  if (showInitialLoading) {
    return (
      <section className="card">
        <p className="muted">Cargando expediente y su contexto operativo...</p>
      </section>
    );
  }

  return (
    <>
      <section className="card expediente-hero">
        <div className="expediente-hero-main">
          <span className="eyebrow">Expediente anual</span>
          <h1>Expediente: {payload.expediente_reference || expedienteId}</h1>
          <p className="muted">
            {payload.title || `Expediente ${expedienteId}`} · {payload.model_type} · ejercicio {payload.fiscal_year}
          </p>
          {payload.client ? (
            <p className="muted" style={{ marginTop: "-4px" }}>
              Cliente:&nbsp;
              <Link href={`/clientes/${payload.client.reference}`}>{payload.client.display_name}</Link>
              &nbsp;· {payload.client.nif}
            </p>
          ) : (
            <p className="badge warning" style={{ marginTop: "10px" }}>
              El expediente sigue sin cliente vinculado
            </p>
          )}
          {error ? <p className="badge danger" style={{ marginTop: "12px" }}>{error}</p> : null}
        </div>

        <aside className="dashboard-side-card">
          <h2>Siguiente hito</h2>
          <p className="muted" style={{ margin: 0 }}>
            {nextStep.detail}
          </p>
          <button type="button" onClick={() => navigateToPhase(nextStep.phase)}>
            Ir a {workspacePhases.find((phase) => phase.id === nextStep.phase)?.label}
          </button>
        </aside>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Fases del expediente</h2>
            <p className="muted">
              El flujo se recorre como trabajo anual: documental, revisión, registro canónico y preparación AEAT.
            </p>
          </div>
        </div>
        <div className="expediente-phase-nav" role="tablist" aria-label="Fases del expediente">
          {workspacePhases.map((phase) => (
            <button
              key={phase.id}
              type="button"
              className={`expediente-phase-button ${activePhase === phase.id ? "active" : ""}`}
              onClick={() => navigateToPhase(phase.id)}
            >
              <strong>{phase.label}</strong>
              <span>{phase.shortLabel}</span>
            </button>
          ))}
        </div>
        <p className="badge info" style={{ marginTop: "14px" }}>
          {phaseGuidance[activePhase].title}: {phaseGuidance[activePhase].detail}
        </p>
      </section>

      {activePhase === "resumen" ? (
        <>
          <section className="card">
            <h2>Estado del expediente</h2>
            <div className="kpi-grid">
              <article className="kpi">
                <span>Documentos</span>
                <strong>{payload.counts.total}</strong>
              </article>
              <article className="kpi">
                <span>En revisión</span>
                <strong>{payload.counts.manual_review + payload.counts.failed}</strong>
              </article>
              <article className="kpi">
                <span>Activos</span>
                <strong>{payload.counts.assets}</strong>
              </article>
              <article className="kpi">
                <span>Eventos fiscales</span>
                <strong>{payload.counts.fiscal_events}</strong>
              </article>
              <article className="kpi">
                <span>Operaciones</span>
                <strong>{payload.counts.operations}</strong>
              </article>
              <article className="kpi">
                <span>Lotes abiertos</span>
                <strong>{payload.counts.lots_open}</strong>
              </article>
              <article className="kpi">
                <span>Ventas pendientes</span>
                <strong>{payload.counts.sales_pending}</strong>
              </article>
              <article className="kpi">
                <span>Exportes AEAT</span>
                <strong>{payload.counts.exports}</strong>
              </article>
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h2>Gobierno del expediente</h2>
                <p className="muted">
                  Ownership, tarea pendiente y gate funcional del registro canónico para este ejercicio.
                </p>
              </div>
            </div>

            {workflowMessage ? <p className="badge success">{workflowMessage}</p> : null}
            {workflowError ? <p className="badge danger">{workflowError}</p> : null}

            <div className="stack">
              <article className="stack-item">
                <h3>Estados persistidos</h3>
                <p style={{ margin: "10px 0 0" }}>
                  <span className={badgeClass(payload.workflow.documental_status)}>
                    Documental {workflowStatusLabel(payload.workflow.documental_status)}
                  </span>{" "}
                  <span className={badgeClass(payload.workflow.revision_status)}>
                    Revisión {workflowStatusLabel(payload.workflow.revision_status)}
                  </span>{" "}
                  <span className={badgeClass(payload.workflow.canonical_status)}>
                    Canónico {workflowStatusLabel(payload.workflow.canonical_status)}
                  </span>{" "}
                  <span className={badgeClass(payload.workflow.declarative_status)}>
                    Modelos {workflowStatusLabel(payload.workflow.declarative_status)}
                  </span>{" "}
                  <span className={badgeClass(payload.workflow.filing_status)}>
                    Presentación {workflowStatusLabel(payload.workflow.filing_status)}
                  </span>
                </p>
                <p className="muted" style={{ margin: "10px 0 0" }}>
                  Owner: {payload.workflow.workflow_owner_name ?? "sin asignar"}
                  <br />
                  Aprobación canónica: {workflowStatusLabel(payload.workflow.canonical_approval_status)}
                  <br />
                  Última actualización: {formatDateTime(payload.workflow.workflow_updated_at)}
                </p>
              </article>

              <article className="stack-item">
                <h3>Trabajo pendiente</h3>
                <div className="form" style={{ marginTop: "12px" }}>
                  <label htmlFor="workflow-pending-task">Tarea pendiente</label>
                  <input
                    id="workflow-pending-task"
                    type="text"
                    value={workflowForm.pending_task}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({ ...current, pending_task: event.target.value }))
                    }
                    disabled={!canEditWorkflow || workflowSubmitting}
                    placeholder="Ej: confirmar valoración patrimonial con cliente"
                  />

                  <label htmlFor="workflow-pending-reason">Contexto / motivo</label>
                  <textarea
                    id="workflow-pending-reason"
                    rows={4}
                    value={workflowForm.pending_reason}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({ ...current, pending_reason: event.target.value }))
                    }
                    disabled={!canEditWorkflow || workflowSubmitting}
                    placeholder="Qué falta y quién debe resolverlo"
                  />

                  <div className="canonical-editor-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!canEditWorkflow || workflowSubmitting}
                      onClick={() =>
                        void submitWorkflowPatch({
                          take_ownership: true
                        })
                      }
                    >
                      Asumir expediente
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!canEditWorkflow || workflowSubmitting || !payload.workflow.workflow_owner_ref}
                      onClick={() =>
                        void submitWorkflowPatch({
                          clear_ownership: true
                        })
                      }
                    >
                      Liberar owner
                    </button>
                    <button
                      type="button"
                      disabled={!canEditWorkflow || workflowSubmitting}
                      onClick={() =>
                        void submitWorkflowPatch({
                          pending_task: workflowForm.pending_task,
                          pending_reason: workflowForm.pending_reason
                        })
                      }
                    >
                      {workflowSubmitting ? "Guardando..." : "Guardar workflow"}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section className="card">
            <h2>Mapa funcional del expediente</h2>
            <div className="expediente-phase-grid">
              {[
                {
                  id: "documental" as const,
                  title: "Documental",
                  state: documentalState,
                  stats: `${payload.counts.total} documento(s) · ${payload.counts.queued + payload.counts.processing} en cola/proceso`
                },
                {
                  id: "revision" as const,
                  title: "Revisión",
                  state: reviewState,
                  stats: `${payload.counts.manual_review} en revisión · ${payload.counts.failed} fallido(s)`
                },
                {
                  id: "canonico" as const,
                  title: "Registro canónico",
                  state: canonicalState,
                  stats: `${payload.counts.operations} operación(es) · ${payload.counts.sales_pending} venta(s) pendiente(s)`
                },
                {
                  id: "modelos" as const,
                  title: "Modelos AEAT",
                  state: modelsState,
                  stats: `${payload.counts.exports} exporte(s) · ${payload.model_type} / ejercicio ${payload.fiscal_year}`
                }
              ].map((phase) => (
                <article key={phase.id} className="expediente-phase-card">
                  <div className="review-item-header">
                    <h3>{phase.title}</h3>
                    <span className={badgeClass(phase.state.tone)}>{phase.state.label}</span>
                  </div>
                  <p className="muted">{phase.state.detail}</p>
                  <p className="muted" style={{ marginTop: "-2px" }}>
                    {phase.stats}
                  </p>
                  <button type="button" className="secondary" onClick={() => navigateToPhase(phase.id)}>
                    Abrir {phase.title}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {activePhase === "documental" ? (
        <>
          <section className="card">
            <div className="section-header">
              <div>
                <h2>Estado documental</h2>
                <p className="muted">
                  Ingesta, parseo y control de la documentación del expediente para este ejercicio.
                </p>
              </div>
              {reviewDocuments.length > 0 ? (
                <Link
                  className="button-link secondary-link"
                  href={`/review?expediente_id=${payload.expediente_reference || expedienteId}`}
                >
                  Abrir revisión del expediente
                </Link>
              ) : null}
            </div>
            {payload.documents.length === 0 ? (
              <p className="muted">
                El expediente todavía no tiene documentos persistidos. La fase documental empieza aquí.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Documento</th>
                      <th>Estado</th>
                      <th>Extracción</th>
                      <th>Alta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.documents.map((document) => (
                      <tr key={document.id}>
                        <td>
                          <strong>{document.filename}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {document.uploaded_by ?? "sin usuario"} · {document.id.slice(0, 8)}...
                          </div>
                        </td>
                        <td>
                          <span className={badgeClass(document.processing_status)}>{document.processing_status}</span>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            confianza {Math.round(document.confidence * 100)}%
                          </div>
                        </td>
                        <td>
                          {document.latest_extraction ? (
                            <>
                              <span className={badgeClass(document.latest_extraction.review_status)}>
                                {document.latest_extraction.review_status}
                              </span>
                              <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                                {document.latest_extraction.records_count} registro(s)
                              </div>
                            </>
                          ) : (
                            <span className="muted">Sin extracción persistida</span>
                          )}
                        </td>
                        <td>
                          {document.uploaded_at ? new Date(document.uploaded_at).toLocaleString("es-ES") : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <IntakeForm expedienteId={expedienteId} />
        </>
      ) : null}

      {activePhase === "revision" ? (
        <>
          <section className="card">
            <div className="section-header">
              <div>
                <h2>Estado de revisión</h2>
                <p className="muted">
                  Validación manual del expediente antes de consolidar operaciones y modelos declarativos.
                </p>
              </div>
              <Link
                className="button-link secondary-link"
                href={`/review?expediente_id=${payload.expediente_reference || expedienteId}`}
              >
                Abrir bandeja filtrada
              </Link>
            </div>

            <div className="stack">
              <article className="stack-item">
                <h3>Cola del expediente</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {payload.counts.manual_review} documento(s) en revisión manual
                  <br />
                  {payload.counts.failed} incidencia(s) documental(es)
                </p>
              </article>
              <article className="stack-item">
                <h3>Criterio de avance</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Esta fase solo debería cerrarse cuando no queden documentos en revisión o fallo para el ejercicio.
                </p>
              </article>
            </div>
          </section>

          <section className="card">
            <h2>Pendientes del expediente</h2>
            {reviewDocuments.length === 0 ? (
              <p className="muted">
                No hay documentos pendientes de revisión para este expediente.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Documento</th>
                      <th>Estado</th>
                      <th>Extracción</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewDocuments.map((document) => (
                      <tr key={document.id}>
                        <td>
                          <strong>{document.filename}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {document.id.slice(0, 8)}...
                          </div>
                        </td>
                        <td>
                          <span className={badgeClass(document.processing_status)}>{document.processing_status}</span>
                        </td>
                        <td>
                          {document.latest_extraction ? (
                            <>
                              <span className={badgeClass(document.latest_extraction.review_status)}>
                                {document.latest_extraction.review_status}
                              </span>
                              <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                                {document.latest_extraction.records_count} registro(s)
                              </div>
                            </>
                          ) : (
                            <span className="muted">Sin extracción revisable</span>
                          )}
                        </td>
                        <td>
                          <Link href={`/review?expediente_id=${payload.expediente_reference || expedienteId}`}>
                            Ir a bandeja
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {activePhase === "canonico" ? (
        <>
          <section className="card">
            <h2>Registro canónico</h2>
            <p className="muted">
              Estado consolidado de activos, eventos, lotes y ganancias/pérdidas del expediente.
            </p>
            <div className="stack" style={{ marginBottom: "18px" }}>
              <article className="stack-item">
                <h3>Modo de runtime</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {payload.canonical_runtime_mode === "persisted"
                    ? "Persistido. Los overrides manuales se guardan sobre el registro canónico."
                    : "Derivado. El expediente se está mostrando desde el runtime calculado y los overrides manuales no están disponibles todavía."}
                </p>
              </article>
              <article className="stack-item">
                <h3>Edición operativa</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {canEditCanonical
                    ? "Puedes ajustar etiqueta de activo, estado fiscal y magnitudes del evento sin tocar la operación cruda."
                    : payload.current_user?.role === "solo_lectura"
                      ? "Tu perfil está en solo lectura para el registro canónico."
                      : "La edición manual requiere runtime canónico persistido y registros ya sincronizados."}
                </p>
              </article>
            </div>
            <div className="kpi-grid">
              <article className="kpi">
                <span>Operaciones</span>
                <strong>{payload.counts.operations}</strong>
              </article>
              <article className="kpi">
                <span>Lotes abiertos</span>
                <strong>{payload.counts.lots_open}</strong>
              </article>
              <article className="kpi">
                <span>Lotes cerrados</span>
                <strong>{payload.counts.lots_closed}</strong>
              </article>
              <article className="kpi">
                <span>Ventas cuadradas</span>
                <strong>{payload.counts.sales_matched}</strong>
              </article>
              <article className="kpi">
                <span>Ventas pendientes</span>
                <strong>{payload.counts.sales_pending}</strong>
              </article>
            </div>
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h2>Aprobación funcional del canónico</h2>
                <p className="muted">
                  El cierre declarativo solo debe avanzar cuando el fiscalista aprueba explícitamente el registro canónico.
                </p>
              </div>
            </div>
            {workflowMessage ? <p className="badge success">{workflowMessage}</p> : null}
            {workflowError ? <p className="badge danger">{workflowError}</p> : null}
            <div className="stack">
              <article className="stack-item">
                <h3>Estado actual</h3>
                <p style={{ margin: "10px 0 0" }}>
                  <span className={badgeClass(payload.workflow.canonical_approval_status)}>
                    {workflowStatusLabel(payload.workflow.canonical_approval_status)}
                  </span>
                </p>
                <p className="muted" style={{ margin: "10px 0 0" }}>
                  {payload.workflow.canonical_approval_status === "approved"
                    ? "El canónico está aprobado para preparar y descargar AEAT."
                    : payload.workflow.canonical_approval_status === "reviewed"
                      ? "El canónico fue revisado pero sigue pendiente de aprobación final."
                      : "El canónico sigue en borrador funcional."}
                </p>
              </article>
              <article className="stack-item">
                <h3>Acción de aprobación</h3>
                <div className="canonical-editor-actions" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!canApproveCanonical || workflowSubmitting}
                    onClick={() =>
                      void submitWorkflowPatch({
                        canonical_approval_status: "draft"
                      })
                    }
                  >
                    Marcar borrador
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!canApproveCanonical || workflowSubmitting}
                    onClick={() =>
                      void submitWorkflowPatch({
                        canonical_approval_status: "reviewed"
                      })
                    }
                  >
                    Marcar revisado
                  </button>
                  <button
                    type="button"
                    disabled={!canApproveCanonical || workflowSubmitting || payload.counts.sales_pending > 0}
                    onClick={() =>
                      void submitWorkflowPatch({
                        canonical_approval_status: "approved"
                      })
                    }
                  >
                    Aprobar canónico
                  </button>
                </div>
                {!canApproveCanonical ? (
                  <p className="muted" style={{ margin: "10px 0 0" }}>
                    Solo fiscal senior o administrador pueden aprobar el canónico.
                  </p>
                ) : null}
              </article>
            </div>
          </section>

          <section className="card">
            <h2>Activos patrimoniales</h2>
            {payload.assets.length === 0 ? (
              <p className="muted">
                El expediente todavia no expone activos patrimoniales canónicos derivados desde el runtime.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Activo</th>
                      <th>Cobertura</th>
                      <th>Eventos</th>
                      <th>Estado patrimonial</th>
                      <th>Ultimo evento</th>
                      <th>Ajuste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.assets.map((asset) => (
                      <tr key={asset.asset_key}>
                        <td>
                          <strong>{asset.label}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.isin ?? asset.asset_key}
                          </div>
                        </td>
                        <td>
                          <div>{asset.expedientes.join(", ") || payload.expediente_reference}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            ejercicios {asset.fiscal_years.join(", ") || payload.fiscal_year}
                          </div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {assetTypeLabel(asset.asset_type)} · {asset.country ?? "sin país"} · {foreignBlockLabel(asset.foreign_block)}
                          </div>
                        </td>
                        <td>
                          <div>{asset.events_total} evento(s)</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.dividends} dividendos · {asset.interests} intereses · {asset.transmissions} transm.
                          </div>
                        </td>
                        <td>
                          <div>{asset.open_lots} lote(s) abiertos</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.pending_transmissions} venta(s) pendiente(s) ·{" "}
                            {formatNumber(asset.quantity_open, 4)}
                          </div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {holderRoleLabel(asset.holder_role)} · {formatNumber(asset.ownership_pct, 2)}%
                            {" · "}
                            {valuationMethodLabel(asset.valuation_method)}
                          </div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Fin ejercicio {formatCurrency(asset.year_end_value, asset.currencies[0] ?? null)}
                            {" · "}
                            Q4 {formatCurrency(asset.q4_avg_balance, asset.currencies[0] ?? null)}
                          </div>
                        </td>
                        <td>{formatDateTime(asset.latest_event_date)}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setAssetForm(toAssetForm(asset));
                              setCanonicalError(null);
                              setCanonicalMessage(null);
                            }}
                            disabled={!canEditCanonical}
                          >
                            {canEditCanonical ? "Editar" : "Ver"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Eventos fiscales</h2>
            {payload.fiscal_events.length === 0 ? (
              <p className="muted">
                Todavia no hay eventos fiscales trazados para este expediente.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Activo</th>
                      <th>Evento</th>
                      <th>Importe</th>
                      <th>Estado</th>
                      <th>Ajuste</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.fiscal_events.slice(0, 24).map((event) => (
                      <tr key={event.event_id}>
                        <td>{new Date(event.operation_date).toLocaleDateString("es-ES")}</td>
                        <td>
                          <strong>{event.asset_label}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {event.isin ?? "sin ISIN"}
                          </div>
                        </td>
                        <td>
                          <div>{event.event_kind}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {event.operation_type} · {event.source}
                          </div>
                        </td>
                        <td>
                          {formatCurrency(event.amount, event.currency)}
                          {event.realized_gain !== null ? (
                            <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                              G/P {formatCurrency(event.realized_gain, event.currency)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={badgeClass(event.status)}>{event.status}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              setEventForm(toEventForm(event));
                              setCanonicalError(null);
                              setCanonicalMessage(null);
                            }}
                            disabled={!canEditCanonical}
                          >
                            {canEditCanonical ? "Editar" : "Ver"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="section-header">
              <div>
                <h2>Edición manual del canónico</h2>
                <p className="muted">
                  Ajustes controlados del fiscalista sobre activos y eventos ya consolidados. El objetivo es gobernar el dato canónico, no corregir el parser desde aquí.
                </p>
              </div>
            </div>

            {canonicalMessage ? <p className="badge success">{canonicalMessage}</p> : null}
            {canonicalError ? <p className="badge danger">{canonicalError}</p> : null}

            <div className="canonical-editor-grid">
              <article className="stack-item">
                <h3>Ajuste de activo</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Renombra el activo patrimonial y fija los campos canónicos que gobiernan 714 y 720.
                </p>
                <div className="form" style={{ marginTop: "14px" }}>
                  <label htmlFor="canonical-asset-select">Activo</label>
                  <select
                    id="canonical-asset-select"
                    value={assetForm.asset_key}
                    onChange={(event) => {
                      const selected = payload.assets.find((asset) => asset.asset_key === event.target.value);
                      setAssetForm(selected ? toAssetForm(selected) : emptyAssetForm);
                    }}
                    disabled={!canEditCanonical || assetSubmitting}
                  >
                    <option value="">Selecciona un activo</option>
                    {payload.assets.map((asset) => (
                      <option key={asset.asset_key} value={asset.asset_key}>
                        {asset.label}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="canonical-asset-label">Etiqueta operativa</label>
                  <input
                    id="canonical-asset-label"
                    type="text"
                    value={assetForm.label}
                    onChange={(event) =>
                      setAssetForm((current) => ({ ...current, label: event.target.value }))
                    }
                    disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                  />

                  <div className="canonical-editor-fields">
                    <div>
                      <label htmlFor="canonical-asset-type">Tipo de activo</label>
                      <select
                        id="canonical-asset-type"
                        value={assetForm.asset_type}
                        onChange={(event) =>
                          setAssetForm((current) => ({
                            ...current,
                            asset_type: event.target.value as CanonicalAssetSummary["asset_type"]
                          }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      >
                        {canonicalAssetTypes.map((option) => (
                          <option key={option} value={option}>
                            {assetTypeLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="canonical-asset-holder-role">Titularidad</label>
                      <select
                        id="canonical-asset-holder-role"
                        value={assetForm.holder_role}
                        onChange={(event) =>
                          setAssetForm((current) => ({
                            ...current,
                            holder_role: event.target.value as CanonicalAssetSummary["holder_role"]
                          }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      >
                        {canonicalHolderRoles.map((option) => (
                          <option key={option} value={option}>
                            {holderRoleLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="canonical-asset-ownership">Porcentaje</label>
                      <input
                        id="canonical-asset-ownership"
                        type="text"
                        inputMode="decimal"
                        value={assetForm.ownership_pct}
                        onChange={(event) =>
                          setAssetForm((current) => ({ ...current, ownership_pct: event.target.value }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      />
                    </div>
                    <div>
                      <label htmlFor="canonical-asset-country">País</label>
                      <input
                        id="canonical-asset-country"
                        type="text"
                        value={assetForm.country}
                        maxLength={2}
                        onChange={(event) =>
                          setAssetForm((current) => ({ ...current, country: event.target.value.toUpperCase() }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      />
                    </div>
                  </div>

                  <div className="canonical-editor-fields">
                    <div>
                      <label htmlFor="canonical-asset-year-end-value">Valor fin ejercicio</label>
                      <input
                        id="canonical-asset-year-end-value"
                        type="text"
                        inputMode="decimal"
                        value={assetForm.year_end_value}
                        onChange={(event) =>
                          setAssetForm((current) => ({ ...current, year_end_value: event.target.value }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      />
                    </div>
                    <div>
                      <label htmlFor="canonical-asset-q4-balance">Saldo medio Q4</label>
                      <input
                        id="canonical-asset-q4-balance"
                        type="text"
                        inputMode="decimal"
                        value={assetForm.q4_avg_balance}
                        onChange={(event) =>
                          setAssetForm((current) => ({ ...current, q4_avg_balance: event.target.value }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      />
                    </div>
                    <div>
                      <label htmlFor="canonical-asset-valuation-method">Método de valoración</label>
                      <select
                        id="canonical-asset-valuation-method"
                        value={assetForm.valuation_method}
                        onChange={(event) =>
                          setAssetForm((current) => ({
                            ...current,
                            valuation_method: event.target.value as CanonicalAssetSummary["valuation_method"]
                          }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      >
                        {canonicalValuationMethods.map((option) => (
                          <option key={option} value={option}>
                            {valuationMethodLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="canonical-asset-foreign-block">Bloque 720</label>
                      <select
                        id="canonical-asset-foreign-block"
                        value={assetForm.foreign_block ?? ""}
                        onChange={(event) =>
                          setAssetForm((current) => ({
                            ...current,
                            foreign_block:
                              event.target.value === ""
                                ? null
                                : (event.target.value as NonNullable<CanonicalAssetSummary["foreign_block"]>)
                          }))
                        }
                        disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                      >
                        <option value="">No aplica</option>
                        {canonicalForeignAssetBlocks.map((option) => (
                          <option key={option} value={option}>
                            {foreignBlockLabel(option)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label htmlFor="canonical-asset-notes">Notas</label>
                  <textarea
                    id="canonical-asset-notes"
                    value={assetForm.notes}
                    onChange={(event) =>
                      setAssetForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key}
                    rows={4}
                  />

                  <div className="canonical-editor-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setAssetForm(emptyAssetForm)}
                      disabled={assetSubmitting}
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={submitAssetOverride}
                      disabled={!canEditCanonical || assetSubmitting || !assetForm.asset_key || !assetForm.label.trim()}
                    >
                      {assetSubmitting ? "Guardando..." : "Guardar activo"}
                    </button>
                  </div>
                </div>
              </article>

              <article className="stack-item">
                <h3>Ajuste de evento fiscal</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Rectifica estado, descripción o magnitudes fiscales del evento que se usará en consumo AEAT.
                </p>
                <div className="form" style={{ marginTop: "14px" }}>
                  <label htmlFor="canonical-event-select">Evento</label>
                  <select
                    id="canonical-event-select"
                    value={eventForm.event_id}
                    onChange={(event) => {
                      const selected = payload.fiscal_events.find((item) => item.event_id === event.target.value);
                      setEventForm(selected ? toEventForm(selected) : emptyEventForm);
                    }}
                    disabled={!canEditCanonical || eventSubmitting}
                  >
                    <option value="">Selecciona un evento</option>
                    {payload.fiscal_events.slice(0, 24).map((event) => (
                      <option key={event.event_id} value={event.event_id}>
                        {new Date(event.operation_date).toLocaleDateString("es-ES")} · {event.asset_label} · {event.event_kind}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="canonical-event-description">Descripción</label>
                  <input
                    id="canonical-event-description"
                    type="text"
                    value={eventForm.description}
                    onChange={(event) =>
                      setEventForm((current) => ({ ...current, description: event.target.value }))
                    }
                    disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                  />

                  <div className="canonical-editor-fields">
                    <div>
                      <label htmlFor="canonical-event-amount">Importe</label>
                      <input
                        id="canonical-event-amount"
                        type="text"
                        inputMode="decimal"
                        value={eventForm.amount}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, amount: event.target.value }))
                        }
                        disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                      />
                    </div>
                    <div>
                      <label htmlFor="canonical-event-quantity">Cantidad</label>
                      <input
                        id="canonical-event-quantity"
                        type="text"
                        inputMode="decimal"
                        value={eventForm.quantity}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, quantity: event.target.value }))
                        }
                        disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                      />
                    </div>
                    <div>
                      <label htmlFor="canonical-event-retention">Retención</label>
                      <input
                        id="canonical-event-retention"
                        type="text"
                        inputMode="decimal"
                        value={eventForm.retention}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, retention: event.target.value }))
                        }
                        disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                      />
                    </div>
                    <div>
                      <label htmlFor="canonical-event-gain">Ganancia/pérdida</label>
                      <input
                        id="canonical-event-gain"
                        type="text"
                        inputMode="decimal"
                        value={eventForm.realized_gain}
                        onChange={(event) =>
                          setEventForm((current) => ({ ...current, realized_gain: event.target.value }))
                        }
                        disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                      />
                    </div>
                  </div>

                  <label htmlFor="canonical-event-status">Estado fiscal</label>
                  <select
                    id="canonical-event-status"
                    value={eventForm.status}
                    onChange={(event) =>
                      setEventForm((current) => ({
                        ...current,
                        status: event.target.value as CanonicalFiscalEvent["status"]
                      }))
                    }
                    disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                  >
                    <option value="RECORDED">RECORDED</option>
                    <option value="MATCHED">MATCHED</option>
                    <option value="UNRESOLVED">UNRESOLVED</option>
                    <option value="PENDING_COST_BASIS">PENDING_COST_BASIS</option>
                    <option value="INVALID_DATA">INVALID_DATA</option>
                  </select>

                  <label htmlFor="canonical-event-notes">Notas</label>
                  <textarea
                    id="canonical-event-notes"
                    value={eventForm.notes}
                    onChange={(event) =>
                      setEventForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                    rows={4}
                  />

                  <div className="canonical-editor-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEventForm(emptyEventForm)}
                      disabled={eventSubmitting}
                    >
                      Limpiar
                    </button>
                    <button
                      type="button"
                      onClick={submitEventOverride}
                      disabled={!canEditCanonical || eventSubmitting || !eventForm.event_id}
                    >
                      {eventSubmitting ? "Guardando..." : "Guardar evento"}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section className="card">
            <h2>Ganancias y pérdidas</h2>
            {payload.sale_summaries.length === 0 ? (
              <p className="muted">
                Todavía no hay ventas fiscalmente trazadas contra lotes.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Venta</th>
                      <th>Activo</th>
                      <th>Cuadre FIFO</th>
                      <th>Resultado fiscal</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.sale_summaries.map((sale) => (
                      <tr key={sale.sale_operation_id}>
                        <td>
                          <div>{new Date(sale.operation_date).toLocaleDateString("es-ES")}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {formatNumber(sale.quantity)} títulos · {formatCurrency(sale.sale_amount, sale.currency)}
                          </div>
                        </td>
                        <td>
                          <strong>{sale.isin ?? "Sin ISIN"}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {sale.description ?? "Sin descripción"}
                          </div>
                        </td>
                        <td>
                          <div>Asignado {formatNumber(sale.quantity_allocated)}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Pendiente {formatNumber(sale.missing_quantity)} · {sale.allocations_count} tramo(s)
                          </div>
                        </td>
                        <td>
                          <div>Coste {formatCurrency(sale.cost_basis, sale.currency)}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            G/P calculada {formatCurrency(sale.realized_gain, sale.currency)}
                          </div>
                          {sale.reported_realized_gain !== null ? (
                            <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                              Parser {formatCurrency(sale.reported_realized_gain, sale.currency)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={badgeClass(sale.status)}>{sale.status}</span>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {sale.source}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Lotes de adquisición</h2>
            {payload.lots.length === 0 ? (
              <p className="muted">
                El runtime todavía no ha derivado lotes válidos desde las operaciones persistidas de este expediente.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Adquisición</th>
                      <th>Activo</th>
                      <th>Cantidades</th>
                      <th>Coste</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.lots.map((lot) => (
                      <tr key={lot.id}>
                        <td>{new Date(lot.acquisition_date).toLocaleDateString("es-ES")}</td>
                        <td>
                          <strong>{lot.isin}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {lot.description ?? "Sin descripción"}
                          </div>
                        </td>
                        <td>
                          <div>Origen {formatNumber(lot.quantity_original)}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Vendido {formatNumber(lot.quantity_sold)} · Abierto {formatNumber(lot.quantity_open)}
                          </div>
                        </td>
                        <td>
                          {formatCurrency(lot.total_cost, lot.currency)}
                          {lot.unit_cost !== null ? (
                            <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                              Unitario {formatCurrency(lot.unit_cost, lot.currency)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={badgeClass(lot.status)}>{lot.status}</span>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {lot.sales_count} consumo(s) FIFO · {lot.source}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {activePhase === "modelos" ? (
        <>
          <section className="card">
            <h2>Estado declarativo</h2>
            <div className="stack">
              <article className="stack-item">
                <h3>Preparación del modelo</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Modelo del expediente: {payload.model_type} · ejercicio {payload.fiscal_year}
                  <br />
                  Exportaciones generadas: {payload.counts.exports}
                  <br />
                  Gate canónico: {workflowStatusLabel(payload.workflow.canonical_approval_status)}
                </p>
              </article>
              <article className="stack-item">
                <h3>Prerequisitos</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Cliente vinculado: {payload.client ? "sí" : "no"}
                  <br />
                  Ventas pendientes: {payload.counts.sales_pending}
                  <br />
                  Revisión manual pendiente: {payload.counts.manual_review + payload.counts.failed}
                  <br />
                  Owner: {payload.workflow.workflow_owner_name ?? "sin asignar"}
                </p>
              </article>
              <article className="stack-item">
                <h3>Presentación</h3>
                <p className="muted" style={{ margin: 0 }}>
                  Estado: {workflowStatusLabel(payload.workflow.filing_status)}
                  <br />
                  Tarea pendiente: {payload.workflow.pending_task ?? "sin tarea pendiente"}
                </p>
                <div className="canonical-editor-actions" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!canApproveCanonical || workflowSubmitting}
                    onClick={() =>
                      void submitWorkflowPatch({
                        filing_status: "draft"
                      })
                    }
                  >
                    Reabrir presentación
                  </button>
                  <button
                    type="button"
                    disabled={!canApproveCanonical || workflowSubmitting || payload.workflow.canonical_approval_status !== "approved"}
                    onClick={() =>
                      void submitWorkflowPatch({
                        filing_status: "filed"
                      })
                    }
                  >
                    Marcar presentado
                  </button>
                </div>
              </article>
            </div>
          </section>

          <ExportGenerator expedienteId={expedienteId} />

          <section className="card">
            <h2>Exportaciones generadas</h2>
            {payload.exports.length === 0 ? (
              <p className="muted">Todavía no hay exportaciones registradas para este expediente.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Modelo</th>
                      <th>Estado</th>
                      <th>Validación</th>
                      <th>Generado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.exports.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.model}</strong>
                        </td>
                        <td>
                          <span className={badgeClass(item.status)}>{item.status}</span>
                        </td>
                        <td>
                          <span className={badgeClass(item.validation_state)}>{item.validation_state}</span>
                        </td>
                        <td>{new Date(item.generated_at).toLocaleString("es-ES")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
