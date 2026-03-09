import { detectBlockedLosses, type TradeEvent } from "@/lib/rules-core";
import {
  assessModel714Requirement,
  assessModel720Requirement,
  type FilingDecision,
  type Model714RequirementAssessment,
  type Model720RequirementAssessment
} from "@/lib/model-filing-rules";

export interface ExportValidationSummary {
  validationState: "ok" | "warnings" | "errors";
  messages: string[];
  filingDecision?: FilingDecision;
  aeatAllowed?: boolean;
}

export function validateModel100(input: {
  trades: TradeEvent[];
  unresolvedSales: number;
  pendingCostBasisSales: number;
  invalidSales: number;
}): ExportValidationSummary {
  const blockedLosses = detectBlockedLosses(input.trades);
  const messages: string[] = [];

  if (input.invalidSales > 0) {
    messages.push(
      `${input.invalidSales} venta(s) tienen datos incompletos o inválidos y no pueden cerrarse fiscalmente.`
    );
  }

  if (input.unresolvedSales > 0) {
    messages.push(
      `${input.unresolvedSales} venta(s) no tienen lotes suficientes para cuadrar el FIFO completo.`
    );
  }

  if (input.pendingCostBasisSales > 0) {
    messages.push(
      `${input.pendingCostBasisSales} venta(s) siguen sin coste fiscal calculable y no deben exportarse como cierre definitivo.`
    );
  }

  if (blockedLosses.length > 0) {
    messages.push(
      `${blockedLosses.length} perdida(s) bloqueada(s) por recompra detectada(s) en reglas 2/12 meses.`
    );
  }

  if (input.invalidSales > 0 || input.unresolvedSales > 0 || input.pendingCostBasisSales > 0) {
    return {
      validationState: "errors",
      messages
    };
  }

  return {
    validationState: blockedLosses.length > 0 ? "warnings" : "ok",
    messages
  };
}

export function validateModel714(input?: {
  totalAssets: number;
  missingValuationAssets: number;
  missingOwnershipAssets?: number;
  totalValuation?: number;
  requirementAssessment?: Model714RequirementAssessment | null;
}): ExportValidationSummary {
  if (!input) {
    return {
      validationState: "ok",
      messages: ["Valoracion de patrimonio generada con reglas base."],
      aeatAllowed: true
    };
  }

  const messages: string[] = [];

  if (input.totalAssets === 0) {
    messages.push("No hay activos patrimoniales consolidados para preparar el Modelo 714.");
  }

  if (input.missingValuationAssets > 0) {
    messages.push(
      `${input.missingValuationAssets} activo(s) no tienen valoración declarable y no deberían cerrarse en Modelo 714.`
    );
  }

  if ((input.missingOwnershipAssets ?? 0) > 0) {
    messages.push(
      `${input.missingOwnershipAssets} activo(s) no tienen titularidad o porcentaje de atribución suficiente para Modelo 714.`
    );
  }

  if (input.totalAssets === 0 || input.missingValuationAssets > 0 || (input.missingOwnershipAssets ?? 0) > 0) {
    return {
      validationState: "errors",
      messages,
      filingDecision: "review",
      aeatAllowed: false
    };
  }

  const requirementAssessment =
    input.requirementAssessment ??
    assessModel714Requirement({
      totalValuation: input.totalValuation ?? 0
    });

  messages.push(requirementAssessment.detail);

  if (requirementAssessment.filingDecision === "file") {
    return {
      validationState: "ok",
      messages,
      filingDecision: requirementAssessment.filingDecision,
      aeatAllowed: true
    };
  }

  return {
    validationState: "warnings",
    messages,
    filingDecision: requirementAssessment.filingDecision,
    aeatAllowed: true
  };
}

export function validateModel720(input?: {
  foreignAssets: number;
  missingForeignValuationAssets: number;
  missingForeignCountryAssets?: number;
  missingForeignBlockAssets?: number;
  missingForeignOwnershipAssets?: number;
  missingForeignQ4BalanceAssets?: number;
  thresholdReachedBlocks?: number;
  requirementAssessment?: Model720RequirementAssessment | null;
}): ExportValidationSummary {
  if (!input) {
    return {
      validationState: "ok",
      messages: ["Umbrales de bienes en extranjero verificados en modo inicial."],
      aeatAllowed: true
    };
  }

  const messages: string[] = [];

  if (input.foreignAssets === 0) {
    messages.push("No hay activos extranjeros consolidados para preparar el Modelo 720.");
  }

  if (input.missingForeignValuationAssets > 0) {
    messages.push(
      `${input.missingForeignValuationAssets} activo(s) extranjeros no tienen valoración declarable suficiente para el Modelo 720.`
    );
  }

  if ((input.missingForeignCountryAssets ?? 0) > 0) {
    messages.push(
      `${input.missingForeignCountryAssets} activo(s) extranjeros no tienen país de localización consolidado para Modelo 720.`
    );
  }

  if ((input.missingForeignBlockAssets ?? 0) > 0) {
    messages.push(
      `${input.missingForeignBlockAssets} activo(s) extranjeros no tienen bloque 720 asignado.`
    );
  }

  if ((input.missingForeignOwnershipAssets ?? 0) > 0) {
    messages.push(
      `${input.missingForeignOwnershipAssets} activo(s) extranjeros no tienen titularidad o porcentaje de atribución suficiente para Modelo 720.`
    );
  }

  if ((input.missingForeignQ4BalanceAssets ?? 0) > 0) {
    messages.push(
      `${input.missingForeignQ4BalanceAssets} cuenta(s) extranjeras no tienen saldo medio del cuarto trimestre.`
    );
  }

  if (
    input.foreignAssets === 0 ||
    input.missingForeignValuationAssets > 0 ||
    (input.missingForeignCountryAssets ?? 0) > 0 ||
    (input.missingForeignBlockAssets ?? 0) > 0 ||
    (input.missingForeignOwnershipAssets ?? 0) > 0 ||
    (input.missingForeignQ4BalanceAssets ?? 0) > 0
  ) {
    return {
      validationState: "errors",
      messages,
      filingDecision: "review",
      aeatAllowed: false
    };
  }

  const requirementAssessment =
    input.requirementAssessment ??
    assessModel720Requirement({
      metrics: {
        foreignBlockTotals: {
          accounts: 0,
          securities: 0,
          insurance_real_estate: 0,
          other: 0
        },
        thresholdReachedBlocks: []
      }
    });

  messages.push(requirementAssessment.detail);

  if (requirementAssessment.filingDecision === "file") {
    return {
      validationState: "ok",
      messages,
      filingDecision: requirementAssessment.filingDecision,
      aeatAllowed: true
    };
  }

  return {
    validationState: "warnings",
    messages,
    filingDecision: requirementAssessment.filingDecision,
    aeatAllowed: false
  };
}
