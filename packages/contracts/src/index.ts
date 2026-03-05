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

export interface IntakeDocumentInput {
  filename: string;
  storage_path?: string;
  source_type?: "PDF" | "IMAGE" | "CSV" | "XLSX";
  entity_hint?: string;
  content_base64?: string;
}

export interface DocumentsIntakeRequest {
  expediente_id: string;
  client_id?: string;
  uploaded_by?: string;
  documents: IntakeDocumentInput[];
}

export interface IntakeDocumentResult {
  document_id: string;
  expediente_id: string;
  status: ProcessingStatus;
}

export interface DocumentsIntakeResponse extends IntakeDocumentResult {
  accepted: number;
  items: IntakeDocumentResult[];
}

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

export interface ParseDocumentRequest {
  document_id: string;
  expediente_id: string;
  filename: string;
  mime_type?: string;
  content_base64?: string;
  text?: string;
  entity_hint?: string;
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

export interface ExportArtifactResponse {
  expediente_id: string;
  model: ExportModel;
  status: "draft" | "ready" | "generated" | "failed";
  validation_state: "ok" | "warnings" | "errors";
  artifact_path: string;
  artifact_hash: string;
  generated_at: string;
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
