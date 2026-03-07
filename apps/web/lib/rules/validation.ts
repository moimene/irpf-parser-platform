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

export function validateModel714(input?: {
  totalAssets?: number;
  invalidAssetCount?: number;
  missingValuationCount?: number;
  missingClassificationCount?: number;
}): ExportValidationSummary {
  const totalAssets = input?.totalAssets ?? 0;
  const invalidAssetCount = input?.invalidAssetCount ?? 0;
  const missingValuationCount = input?.missingValuationCount ?? 0;
  const missingClassificationCount = input?.missingClassificationCount ?? 0;
  const messages: string[] = [];

  if (totalAssets > 0) {
    messages.push(`Valoracion patrimonial preparada sobre ${totalAssets} activo(s) del registro canonico.`);
  } else {
    messages.push("Valoracion de patrimonio generada con reglas base.");
  }

  if (missingValuationCount > 0) {
    messages.push(`${missingValuationCount} activo(s) no tienen valoracion a cierre completa para IP.`);
  }

  if (missingClassificationCount > 0) {
    messages.push(`${missingClassificationCount} activo(s) no tienen clasificacion patrimonial cerrada.`);
  }

  if (invalidAssetCount > 0) {
    messages.push(`${invalidAssetCount} activo(s) tienen datos inconsistentes y deben revisarse antes de exportar.`);
  }

  return {
    validationState:
      invalidAssetCount > 0 ? "errors" : missingValuationCount > 0 || missingClassificationCount > 0 ? "warnings" : "ok",
    messages
  };
}

export function validateModel720(input?: {
  totalAssets?: number;
  foreignAssets?: number;
  invalidForeignAssetCount?: number;
  missingCountryCount?: number;
  missingOwnershipCount?: number;
}): ExportValidationSummary {
  const totalAssets = input?.totalAssets ?? 0;
  const foreignAssets = input?.foreignAssets ?? 0;
  const invalidForeignAssetCount = input?.invalidForeignAssetCount ?? 0;
  const missingCountryCount = input?.missingCountryCount ?? 0;
  const missingOwnershipCount = input?.missingOwnershipCount ?? 0;
  const messages: string[] = [];

  if (totalAssets > 0) {
    messages.push(
      `${foreignAssets} activo(s) en el extranjero detectado(s) sobre ${totalAssets} activo(s) canonicos del expediente.`
    );
  } else {
    messages.push("Umbrales de bienes en extranjero verificados en modo inicial.");
  }

  if (missingCountryCount > 0) {
    messages.push(`${missingCountryCount} activo(s) no tienen codigo de pais listo para el 720.`);
  }

  if (missingOwnershipCount > 0) {
    messages.push(`${missingOwnershipCount} activo(s) no tienen porcentaje de participacion informado.`);
  }

  if (invalidForeignAssetCount > 0) {
    messages.push(`${invalidForeignAssetCount} activo(s) extranjeros tienen clasificacion o claves AEAT invalidas.`);
  }

  return {
    validationState:
      invalidForeignAssetCount > 0 ? "errors" : missingCountryCount > 0 || missingOwnershipCount > 0 ? "warnings" : "ok",
    messages
  };
}
