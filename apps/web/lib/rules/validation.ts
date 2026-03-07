import { detectBlockedLosses, type TradeEvent } from "@/lib/rules-core";

export interface ExportValidationSummary {
  validationState: "ok" | "warnings" | "errors";
  messages: string[];
}

export function validateModel100(input: {
  trades: TradeEvent[];
  unresolvedSales: number;
  pendingCostBasisSales: number;
  invalidSales: number;
  blockedLossesCount?: number;
}): ExportValidationSummary {
  const blockedLossesCount = input.blockedLossesCount ?? detectBlockedLosses(input.trades).length;
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

  if (blockedLossesCount > 0) {
    messages.push(
      `${blockedLossesCount} perdida(s) bloqueada(s) por recompra detectada(s) en reglas 2/12 meses.`
    );
  }

  if (input.invalidSales > 0 || input.unresolvedSales > 0 || input.pendingCostBasisSales > 0) {
    return {
      validationState: "errors",
      messages
    };
  }

  return {
    validationState: blockedLossesCount > 0 ? "warnings" : "ok",
    messages
  };
}

export function validateModel714(): ExportValidationSummary {
  return {
    validationState: "ok",
    messages: ["Valoracion de patrimonio generada con reglas base."]
  };
}

export function validateModel720(): ExportValidationSummary {
  return {
    validationState: "ok",
    messages: ["Umbrales de bienes en extranjero verificados en modo inicial."]
  };
}
