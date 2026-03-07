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

export type DocumentSourceType = "PDF" | "IMAGE" | "CSV" | "XLSX" | "DOCX";

export interface StructuredRef {
  kind: "page_text" | "table_header" | "table_row";
  table_id?: string | null;
  row_index?: number | null;
  line_index?: number | null;
  column_indices: number[];
}

export interface IntakeDocumentInput {
  filename: string;
  storage_path?: string;
  source_type?: DocumentSourceType;
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
  structured_ref?: StructuredRef | null;
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

export interface StructuredTable {
  table_id: string;
  page: number;
  source: string;
  header: Array<string | null>;
  rows: Array<Array<string | null>>;
}

export interface StructuredPage {
  page: number;
  text: string;
  tables: StructuredTable[];
}

export interface StructuredDocument {
  source_type: DocumentSourceType | "TEXT" | "UNKNOWN";
  backend: "pdfplumber" | "csv" | "xlsx" | "text" | "docling" | "unknown";
  pages: StructuredPage[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface ParseDocumentRequest {
  document_id: string;
  expediente_id: string;
  filename: string;
  mime_type?: string;
  source_type?: DocumentSourceType;
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
  structured_document?: StructuredDocument | null;
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
