import type { FiscalUnitRecord } from "@/lib/client-store";

export type FiscalUnitState = {
  status: "structured" | "pending" | "incomplete" | "inconsistent";
  label: string;
  tone: "success" | "warning" | "danger";
  detail: string;
};

export function resolveFiscalUnitState(unit: FiscalUnitRecord | null | undefined): FiscalUnitState {
  if (!unit?.primary_taxpayer_name || !unit.primary_taxpayer_nif) {
    return {
      status: "incomplete",
      label: "Incompleta",
      tone: "danger",
      detail: "Falta identificar correctamente el sujeto pasivo principal."
    };
  }

  if (
    unit.filing_scope === "pending" ||
    unit.declarant_condition === "pending" ||
    unit.spouse_condition === "pending" ||
    unit.fiscal_link_type === "pending"
  ) {
    return {
      status: "pending",
      label: "Pendiente",
      tone: "warning",
      detail: "La unidad fiscal existe, pero todavía no está cerrada para trabajo anual consistente."
    };
  }

  if (unit.spouse_condition === "sin_conyuge" && unit.fiscal_link_type !== "sin_conyuge") {
    return {
      status: "inconsistent",
      label: "Inconsistente",
      tone: "warning",
      detail: "La vinculación fiscal no cuadra con el estado sin cónyuge."
    };
  }

  if (unit.spouse_condition !== "sin_conyuge" && (!unit.spouse_name || !unit.spouse_nif)) {
    return {
      status: "incomplete",
      label: "Incompleta",
      tone: "warning",
      detail: "Existe cónyuge o vínculo fiscal, pero falta su identificación completa."
    };
  }

  return {
    status: "structured",
    label: "Estructurada",
    tone: "success",
    detail: "La unidad fiscal ya puede gobernar los expedientes y modelos del cliente."
  };
}
