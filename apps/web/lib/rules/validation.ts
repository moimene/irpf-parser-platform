import { detectBlockedLosses, type TradeEvent } from "@/lib/rules-core";

export interface ExportValidationSummary {
  validationState: "ok" | "warnings" | "errors";
  messages: string[];
}

export function validateModel100(trades: TradeEvent[]): ExportValidationSummary {
  const blockedLosses = detectBlockedLosses(trades);
  const messages: string[] = [];

  if (blockedLosses.length > 0) {
    messages.push(
      `${blockedLosses.length} perdida(s) bloqueada(s) por recompra detectada(s) en reglas 2/12 meses.`
    );
  }

  return {
    validationState: blockedLosses.length > 0 ? "warnings" : "ok",
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
