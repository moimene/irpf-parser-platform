import type { ExportModel } from "@/lib/contracts";

export type ExpedienteModelType = "IRPF" | "IP" | "720";

const exportModelByExpediente: Record<ExpedienteModelType, ExportModel> = {
  IRPF: "100",
  IP: "714",
  "720": "720"
};

const expedienteModelLabels: Record<ExpedienteModelType, string> = {
  IRPF: "IRPF",
  IP: "Impuesto sobre el Patrimonio",
  "720": "Modelo 720"
};

const exportModelLabels: Record<ExportModel, string> = {
  "100": "Modelo 100",
  "714": "Modelo 714",
  "720": "Modelo 720"
};

export function isExpedienteModelType(value: string): value is ExpedienteModelType {
  return value === "IRPF" || value === "IP" || value === "720";
}

export function exportModelForExpediente(modelType: ExpedienteModelType): ExportModel {
  return exportModelByExpediente[modelType];
}

export function isExportModelCompatibleWithExpediente(
  exportModel: ExportModel,
  expedienteModelType: string
): boolean {
  return (
    isExpedienteModelType(expedienteModelType) &&
    exportModelByExpediente[expedienteModelType] === exportModel
  );
}

export function expedienteModelLabel(modelType: string): string {
  return isExpedienteModelType(modelType) ? expedienteModelLabels[modelType] : modelType;
}

export function exportModelLabel(model: ExportModel): string {
  return exportModelLabels[model];
}
