import type { FiscalUnitRecord } from "@/lib/client-store";
import type { ExportModel } from "@/lib/contracts";
import type { CanonicalApprovalStatus } from "@/lib/expediente-workflow";
import { exportModelForExpediente, isExpedienteModelType, type ExpedienteModelType } from "@/lib/expediente-models";
import { resolveFiscalUnitState } from "@/lib/fiscal-unit-state";
import type { Model714RequirementAssessment, Model720RequirementAssessment } from "@/lib/model-filing-rules";

export type PreparationStatus = "ready" | "attention" | "blocked";
export type PreparationTarget = "client" | "documental" | "revision" | "canonico" | "modelos";
export type PreparationCheckStatus = "ok" | "warning" | "blocked";

export type PreparationCheck = {
  code: string;
  label: string;
  status: PreparationCheckStatus;
  detail: string;
  target: PreparationTarget;
};

export type ModelPreparationState = {
  status: PreparationStatus;
  summary: string;
  export_model: ExportModel | null;
  checklist: PreparationCheck[];
  blockers: number;
  warnings: number;
  next_target: PreparationTarget;
  next_label: string;
};

type PreparationInput = {
  model_type: string;
  has_client: boolean;
  client_nif: string | null;
  fiscal_unit: FiscalUnitRecord | null;
  counts: {
    documents: number;
    pending_review: number;
    open_alerts: number;
    operations: number;
    assets: number;
    foreign_assets: number;
    missing_asset_values: number;
    missing_foreign_values: number;
    missing_ownership_assets?: number;
    missing_foreign_country_assets?: number;
    missing_foreign_block_assets?: number;
    missing_foreign_q4_assets?: number;
    threshold_reached_blocks?: number;
    sales_pending: number;
    exports: number;
  };
  canonical_runtime_mode?: "persisted" | "derived" | null;
  canonical_approval_status?: CanonicalApprovalStatus | null;
  requirements?: {
    model714?: Model714RequirementAssessment | null;
    model720?: Model720RequirementAssessment | null;
  };
};

function nextLabelForTarget(target: PreparationTarget): string {
  switch (target) {
    case "client":
      return "Completar ficha del cliente";
    case "documental":
      return "Completar ingesta documental";
    case "revision":
      return "Resolver revisión manual";
    case "canonico":
      return "Consolidar registro canónico";
    default:
      return "Preparar modelo AEAT";
  }
}

function toExportModel(modelType: string): ExportModel | null {
  return isExpedienteModelType(modelType) ? exportModelForExpediente(modelType) : null;
}

function pushCheck(
  checks: PreparationCheck[],
  input: {
    code: string;
    label: string;
    status: PreparationCheckStatus;
    detail: string;
    target: PreparationTarget;
  }
) {
  checks.push(input);
}

export function evaluateModelPreparation(input: PreparationInput): ModelPreparationState {
  const checks: PreparationCheck[] = [];
  const exportModel = toExportModel(input.model_type);
  const fiscalUnitState = resolveFiscalUnitState(input.fiscal_unit);

  pushCheck(checks, {
    code: "client",
    label: "Cliente vinculado",
    status: input.has_client ? "ok" : "blocked",
    detail: input.has_client
      ? "El expediente ya está vinculado al cliente correcto."
      : "El expediente necesita cliente vinculado antes de entrar en trabajo declarativo.",
    target: "client"
  });

  pushCheck(checks, {
    code: "client_nif",
    label: "NIF del declarante",
    status: input.client_nif?.trim() ? "ok" : "blocked",
    detail: input.client_nif?.trim()
      ? "Existe identificador fiscal para la preparación del fichero."
      : "Falta NIF del declarante en la ficha del cliente o del sujeto pasivo.",
    target: "client"
  });

  pushCheck(checks, {
    code: "fiscal_unit",
    label: "Unidad fiscal",
    status: fiscalUnitState.status === "structured" ? "ok" : "blocked",
    detail: fiscalUnitState.detail,
    target: "client"
  });

  pushCheck(checks, {
    code: "documents",
    label: "Base documental",
    status: input.counts.documents > 0 ? "ok" : "blocked",
    detail:
      input.counts.documents > 0
        ? `${input.counts.documents} documento(s) registrados para el expediente.`
        : "Todavía no existe documentación cargada para este expediente.",
    target: "documental"
  });

  pushCheck(checks, {
    code: "review",
    label: "Revisión manual",
    status: input.counts.pending_review === 0 ? "ok" : "blocked",
    detail:
      input.counts.pending_review === 0
        ? "No quedan documentos pendientes de revisión manual."
        : `${input.counts.pending_review} documento(s) requieren intervención del fiscalista.`,
    target: "revision"
  });

  pushCheck(checks, {
    code: "alerts",
    label: "Alertas abiertas",
    status: input.counts.open_alerts === 0 ? "ok" : "warning",
    detail:
      input.counts.open_alerts === 0
        ? "No hay alertas abiertas que condicionen el cierre declarativo."
        : `${input.counts.open_alerts} alerta(s) abiertas conviene revisar antes de cerrar el modelo.`,
    target: "revision"
  });

  if (exportModel === "100") {
    pushCheck(checks, {
      code: "irpf_runtime",
      label: "Base fiscal IRPF",
      status: input.counts.operations > 0 ? "ok" : "blocked",
      detail:
        input.counts.operations > 0
          ? `${input.counts.operations} operación(es) alimentan el modelo 100.`
          : "No existe base fiscal suficiente para construir el Modelo 100.",
      target: "canonico"
    });

    pushCheck(checks, {
      code: "irpf_sales",
      label: "Ganancias y pérdidas cuadradas",
      status: input.counts.sales_pending === 0 ? "ok" : "blocked",
      detail:
        input.counts.sales_pending === 0
          ? "Las ventas relevantes están cuadradas para consumo fiscal."
          : `${input.counts.sales_pending} venta(s) siguen pendientes de coste o cierre fiscal.`,
      target: "canonico"
    });
  }

  if (exportModel === "714") {
    pushCheck(checks, {
      code: "ip_assets",
      label: "Activos patrimoniales",
      status: input.counts.assets > 0 ? "ok" : "blocked",
      detail:
        input.counts.assets > 0
          ? `${input.counts.assets} activo(s) disponibles para valoración patrimonial.`
          : "No hay activos patrimoniales consolidados para preparar el Modelo 714.",
      target: "canonico"
    });

    pushCheck(checks, {
      code: "ip_ownership",
      label: "Titularidad patrimonial",
      status: (input.counts.missing_ownership_assets ?? 0) === 0 ? "ok" : "blocked",
      detail:
        (input.counts.missing_ownership_assets ?? 0) === 0
          ? "Los activos patrimoniales tienen titularidad y porcentaje de atribución suficientes."
          : `${input.counts.missing_ownership_assets} activo(s) siguen sin titularidad o porcentaje de atribución suficiente para Modelo 714.`,
      target: "canonico"
    });

    pushCheck(checks, {
      code: "ip_values",
      label: "Valoración patrimonial",
      status: input.counts.missing_asset_values === 0 ? "ok" : "blocked",
      detail:
        input.counts.missing_asset_values === 0
          ? "Los activos patrimoniales relevantes tienen valoración declarable."
          : `${input.counts.missing_asset_values} activo(s) siguen sin valoración declarable suficiente para Modelo 714.`,
      target: "canonico"
    });

    if (input.requirements?.model714) {
      pushCheck(checks, {
        code: "ip_requirement",
        label: "Obligación 714",
        status:
          input.requirements.model714.filingDecision === "file"
            ? "ok"
            : input.requirements.model714.filingDecision === "review"
              ? "warning"
              : "warning",
        detail: input.requirements.model714.detail,
        target: "modelos"
      });
    }
  }

  if (exportModel === "720") {
    pushCheck(checks, {
      code: "foreign_assets",
      label: "Bienes en el extranjero",
      status: input.counts.foreign_assets > 0 ? "ok" : "blocked",
      detail:
        input.counts.foreign_assets > 0
          ? `${input.counts.foreign_assets} activo(s) extranjeros detectados para el Modelo 720.`
          : "No hay activos extranjeros consolidados para preparar el Modelo 720.",
      target: "canonico"
    });

    pushCheck(checks, {
      code: "foreign_metadata",
      label: "Bloque, país y titularidad 720",
      status:
        (input.counts.missing_ownership_assets ?? 0) === 0 &&
        (input.counts.missing_foreign_country_assets ?? 0) === 0 &&
        (input.counts.missing_foreign_block_assets ?? 0) === 0
          ? "ok"
          : "blocked",
      detail:
        (input.counts.missing_ownership_assets ?? 0) === 0 &&
        (input.counts.missing_foreign_country_assets ?? 0) === 0 &&
        (input.counts.missing_foreign_block_assets ?? 0) === 0
          ? "Los activos extranjeros tienen bloque 720, país y atribución fiscal suficiente."
          : `${
              (input.counts.missing_ownership_assets ?? 0) +
              (input.counts.missing_foreign_country_assets ?? 0) +
              (input.counts.missing_foreign_block_assets ?? 0)
            } incidencia(s) siguen abiertas en bloque, país o titularidad para Modelo 720.`,
      target: "canonico"
    });

    pushCheck(checks, {
      code: "foreign_values",
      label: "Valoración extranjera",
      status: input.counts.missing_foreign_values === 0 ? "ok" : "blocked",
      detail:
        input.counts.missing_foreign_values === 0
          ? "Los activos extranjeros relevantes tienen valoración declarable."
          : `${input.counts.missing_foreign_values} activo(s) extranjeros siguen sin valoración declarable suficiente para Modelo 720.`,
      target: "canonico"
    });

    pushCheck(checks, {
      code: "foreign_q4",
      label: "Saldo medio del cuarto trimestre",
      status: (input.counts.missing_foreign_q4_assets ?? 0) === 0 ? "ok" : "blocked",
      detail:
        (input.counts.missing_foreign_q4_assets ?? 0) === 0
          ? "Las cuentas extranjeras relevantes tienen saldo medio del cuarto trimestre."
          : `${input.counts.missing_foreign_q4_assets} cuenta(s) extranjeras siguen sin saldo medio de Q4 para Modelo 720.`,
      target: "canonico"
    });

    pushCheck(checks, {
      code: "foreign_threshold",
      label: "Obligación 720",
      status:
        input.requirements?.model720?.filingDecision === "file"
          ? "ok"
          : input.requirements?.model720?.filingDecision === "review"
            ? "warning"
            : (input.counts.threshold_reached_blocks ?? 0) > 0
              ? "ok"
              : "warning",
      detail:
        input.requirements?.model720?.detail ??
        ((input.counts.threshold_reached_blocks ?? 0) > 0
          ? `${input.counts.threshold_reached_blocks} bloque(s) superan el umbral operativo de 50.000 EUR.`
          : "Ningún bloque supera el umbral operativo de 50.000 EUR. Revisa si procede cierre sin presentación."),
      target: "modelos"
    });
  }

  pushCheck(checks, {
    code: "canonical_approval",
    label: "Aprobación del canónico",
    status:
      input.canonical_approval_status === "approved"
        ? "ok"
        : input.canonical_approval_status === "reviewed"
          ? "warning"
          : "blocked",
    detail:
      input.canonical_approval_status === "approved"
        ? "El registro canónico ya está aprobado para preparación declarativa."
        : input.canonical_approval_status === "reviewed"
          ? "El canónico fue revisado, pero todavía no está aprobado para salida declarativa."
          : "El canónico sigue en borrador y debe aprobarse antes del cierre AEAT.",
    target: "canonico"
  });

  pushCheck(checks, {
    code: "canonical_runtime",
    label: "Runtime canónico",
    status: input.canonical_runtime_mode === "derived" ? "warning" : "ok",
    detail:
      input.canonical_runtime_mode === "derived"
        ? "El expediente sigue apoyándose en runtime derivado. Conviene persistir o revisar el canónico antes del cierre."
        : "El expediente ya opera sobre registro canónico persistido o no necesita degradación.",
    target: "canonico"
  });

  pushCheck(checks, {
    code: "exports",
    label: "Historial declarativo",
    status: input.counts.exports > 0 ? "ok" : "warning",
    detail:
      input.counts.exports > 0
        ? `${input.counts.exports} validación(es) o exporte(s) ya generados para este expediente.`
        : "Todavía no existe validación/exporte generado para este expediente.",
    target: "modelos"
  });

  const blockedChecks = checks.filter((check) => check.status === "blocked");
  const warningChecks = checks.filter((check) => check.status === "warning");
  const nextTarget = blockedChecks[0]?.target ?? warningChecks[0]?.target ?? "modelos";

  return {
    status: blockedChecks.length > 0 ? "blocked" : warningChecks.length > 0 ? "attention" : "ready",
    summary:
      blockedChecks[0]?.detail ??
      warningChecks[0]?.detail ??
      "El expediente está listo para validación y salida AEAT.",
    export_model: exportModel,
    checklist: checks,
    blockers: blockedChecks.length,
    warnings: warningChecks.length,
    next_target: nextTarget,
    next_label: nextLabelForTarget(nextTarget)
  };
}

export function comparePreparationStatus(left: PreparationStatus, right: PreparationStatus): number {
  const ranking: Record<PreparationStatus, number> = {
    blocked: 3,
    attention: 2,
    ready: 1
  };

  return ranking[right] - ranking[left];
}

export function modelPreparationExportModel(modelType: ExpedienteModelType): ExportModel {
  return exportModelForExpediente(modelType);
}
