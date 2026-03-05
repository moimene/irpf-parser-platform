export type ProcessingStatus =
  | "queued"
  | "processing"
  | "completed"
  | "manual_review"
  | "failed";

export type ExportModel = "100" | "714" | "720";

export type WorkflowEventType =
  | "parse.started"
  | "parse.completed"
  | "parse.failed"
  | "manual.review.required";

export interface SourceSpan {
  page: number;
  start: number;
  end: number;
  snippet?: string;
}

export interface ParsedRecord {
  record_type:
    | "DIVIDENDO"
    | "INTERES"
    | "COMPRA"
    | "VENTA"
    | "POSICION"
    | "DESCONOCIDO";
  fields: Record<string, string | number | boolean | null>;
  confidence: number;
  source_spans: SourceSpan[];
}

export interface ParseDocumentResponse {
  document_id: string;
  expediente_id: string;
  parser_strategy: "template" | "semantic" | "manual";
  template_used: string;
  confidence: number;
  requires_manual_review: boolean;
  records: ParsedRecord[];
  source_spans: SourceSpan[];
  warnings: string[];
}

export interface WorkflowEventPayload<T = Record<string, unknown>> {
  event_type: WorkflowEventType;
  timestamp: string;
  document_id: string;
  expediente_id: string;
  payload: T;
}

export function isWorkflowEventType(value: string): value is WorkflowEventType {
  return [
    "parse.started",
    "parse.completed",
    "parse.failed",
    "manual.review.required"
  ].includes(value);
}

export function isExportModel(value: string): value is ExportModel {
  return ["100", "714", "720"].includes(value);
}
