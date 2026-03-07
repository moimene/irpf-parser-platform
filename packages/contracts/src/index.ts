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
}

export interface ParsedRecord {
  record_type:
    | "CUENTA"
    | "VALOR"
    | "IIC"
    | "SEGURO"
    | "INMUEBLE"
    | "BIEN_MUEBLE"
    | "DIVIDENDO"
    | "INTERES"
    | "RENTA"
    | "RETENCION"
    | "COMPRA"
    | "VENTA"
    | "POSICION"
    | "CUENTA_BANCARIA"
    | "MOVIMIENTO"
    | "DESCONOCIDO";
  fields: Record<string, string | number | boolean | null>;
  confidence: number;
  source_spans: SourceSpan[];
}

export interface CanonicalAssetRecord {
  asset_link_key?: string | null;
  expediente_id?: string;
  declaration_profile_id?: string | null;
  client_id?: string | null;
  asset_class:
    | "ACCOUNT"
    | "SECURITY"
    | "COLLECTIVE_INVESTMENT"
    | "INSURANCE"
    | "REAL_ESTATE"
    | "MOVABLE_ASSET";
  condition_key: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
  asset_key: "C" | "V" | "I" | "S" | "B" | "M";
  asset_subkey: string;
  country_code: string;
  location_key: "ES" | "EX";
  tax_territory_code?: string | null;
  incorporation_date: string;
  origin_key: "A" | "M" | "C";
  extinction_date?: string | null;
  valuation_1_eur: number;
  valuation_2_eur?: number | null;
  ownership_percentage: number;
  currency?: string | null;
  ownership_type_description?: string | null;
  entity_name?: string | null;
  asset_description?: string | null;
  address?: {
    street_line?: string | null;
    complement?: string | null;
    city?: string | null;
    region?: string | null;
    postal_code?: string | null;
    country_code?: string | null;
  } | null;
  account?: {
    account_identification_key?: "I" | "O" | null;
    bic?: string | null;
    account_code?: string | null;
    entity_tax_id?: string | null;
  } | null;
  security?: {
    identification_key?: "1" | "2" | null;
    security_identifier?: string | null;
    entity_tax_id?: string | null;
    representation_key?: "A" | "B" | null;
    units?: number | null;
    listed?: boolean | null;
    regulated?: boolean | null;
  } | null;
  collective_investment?: {
    identification_key?: "1" | "2" | null;
    security_identifier?: string | null;
    entity_tax_id?: string | null;
    representation_key?: "A" | "B" | null;
    units?: number | null;
    listed?: boolean | null;
    regulated?: boolean | null;
  } | null;
  insurance?: {
    insurance_kind?: "LIFE" | "DISABILITY" | "TEMPORARY_ANNUITY" | "LIFETIME_ANNUITY" | null;
    entity_tax_id?: string | null;
  } | null;
  real_estate?: {
    real_estate_type_key?: "U" | "R" | null;
    real_right_description?: string | null;
    cadastral_reference?: string | null;
  } | null;
  movable?: {
    movable_kind?: "GENERAL" | "ART" | "JEWELRY" | "VEHICLE" | "BOAT" | "AIRCRAFT" | "COLLECTION" | "OTHER" | null;
    registry_reference?: string | null;
    valuation_method?: string | null;
  } | null;
  metadata?: Record<string, unknown>;
}

export interface CanonicalFiscalEvent {
  asset_link_key?: string | null;
  event_type:
    | "ACQUISITION"
    | "DISPOSAL"
    | "INTEREST"
    | "DIVIDEND"
    | "RENT"
    | "WITHHOLDING"
    | "GAIN"
    | "LOSS"
    | "ADJUSTMENT";
  event_date: string;
  asset_id?: string | null;
  quantity?: number | null;
  gross_amount_eur?: number | null;
  net_amount_eur?: number | null;
  withholding_amount_eur?: number | null;
  proceeds_amount_eur?: number | null;
  cost_basis_amount_eur?: number | null;
  realized_result_eur?: number | null;
  currency?: string | null;
  notes?: string | null;
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
  asset_records?: CanonicalAssetRecord[];
  fiscal_events?: CanonicalFiscalEvent[];
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
