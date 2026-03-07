"use client";

import { useCallback, useEffect, useState } from "react";
import type { ParsedRecord, SourceSpan, StructuredDocument, StructuredPage } from "@/lib/contracts";
import {
  buildReviewCorrectionPayload,
  collectRelevantStructuredPages,
  doesStructuredRowMatchRecord,
  inferReviewFieldKind,
  listRecordFieldKeys,
  normalizeReviewFieldValue
} from "@/lib/review-editor";

type PendingDocument = {
  id: string;
  extractionId: string | null;
  expedienteId: string;
  filename: string;
  sourceType: string;
  status: string;
  confidence: number;
  reviewStatus: string | null;
  recordsCount: number;
  parserStrategy: string;
  templateUsed: string;
  structuredBackend: string | null;
  createdAt: string;
  extractedAt: string | null;
};

type OpenAlert = {
  id: string;
  expedienteId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  category: string;
  createdAt: string;
};

type WorkflowEvent = {
  id: string;
  eventType: string;
  documentId: string;
  createdAt: string;
};

type ReviewQueuePayload = {
  current_user?: {
    reference: string;
    display_name: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  pending_documents: PendingDocument[];
  open_alerts: OpenAlert[];
  workflow_events: WorkflowEvent[];
};

type ReviewDetailPayload = {
  current_user?: ReviewQueuePayload["current_user"];
  extraction: {
    id: string;
    document_id: string;
    expediente_id: string;
    filename: string;
    source_type: string;
    processing_status: string;
    confidence: number;
    requires_manual_review: boolean;
    review_status: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    created_at: string;
    parser_strategy: string;
    template_used: string;
    warnings: string[];
    source_spans: SourceSpan[];
    records: ParsedRecord[];
    structured_document: StructuredDocument | null;
  };
};

type ReviewActionResult = {
  extraction_id: string;
  review_status: string;
  operations_saved: number;
  message: string;
  error?: string;
};

const initialPayload: ReviewQueuePayload = {
  pending_documents: [],
  open_alerts: [],
  workflow_events: [],
};

const recordTypes: ParsedRecord["record_type"][] = [
  "DIVIDENDO",
  "INTERES",
  "COMPRA",
  "VENTA",
  "POSICION",
  "DESCONOCIDO"
];

const fieldLabelMap: Record<string, string> = {
  operation_date: "Fecha operación",
  description: "Descripción",
  isin: "ISIN",
  quantity: "Cantidad",
  amount: "Importe",
  currency: "Divisa",
  retention: "Retención",
  realized_gain: "Ganancia realizada"
};

const suggestedFieldsByType: Record<ParsedRecord["record_type"], string[]> = {
  DIVIDENDO: ["operation_date", "description", "isin", "amount", "currency", "retention"],
  INTERES: ["operation_date", "description", "isin", "amount", "currency", "retention"],
  COMPRA: ["operation_date", "description", "isin", "quantity", "amount", "currency"],
  VENTA: ["operation_date", "description", "isin", "quantity", "amount", "currency", "realized_gain"],
  POSICION: ["operation_date", "description", "isin", "quantity", "amount", "currency"],
  DESCONOCIDO: ["operation_date", "description", "isin", "quantity", "amount", "currency"]
};

function badgeClass(status: string): string {
  if (status === "manual_review" || status === "pending") return "badge warning";
  if (status === "failed" || status === "rejected") return "badge danger";
  if (status === "validated" || status === "completed") return "badge success";
  return "badge info";
}

function fieldLabel(key: string): string {
  return fieldLabelMap[key] ?? key.replaceAll("_", " ");
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "Sin fecha";
  }

  return new Date(value).toLocaleString("es-ES");
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getRecordFieldKeys(record: ParsedRecord): string[] {
  const merged = new Set<string>([
    ...suggestedFieldsByType[record.record_type],
    ...listRecordFieldKeys(record.fields)
  ]);

  return Array.from(merged).sort((left, right) => {
    const ordered = listRecordFieldKeys({
      [left]: null,
      [right]: null
    });

    if (ordered[0] === left && ordered[1] === right) {
      return -1;
    }

    if (ordered[0] === right && ordered[1] === left) {
      return 1;
    }

    return left.localeCompare(right);
  });
}

function normalizeInputValue(value: ParsedRecord["fields"][string]): string {
  if (value === null || typeof value === "boolean") {
    return "";
  }

  return String(value);
}

function isRecordDirty(originalRecord: ParsedRecord | undefined, draftRecord: ParsedRecord): boolean {
  if (!originalRecord) {
    return true;
  }

  return JSON.stringify(originalRecord) !== JSON.stringify(draftRecord);
}

function getRelevantPages(
  record: ParsedRecord | null,
  structuredDocument: StructuredDocument | null
): StructuredPage[] {
  if (!structuredDocument) {
    return [];
  }

  const pageNumbers = collectRelevantStructuredPages(record, structuredDocument);
  return structuredDocument.pages.filter((page) => pageNumbers.includes(page.page));
}

function getSpanSnippet(span: SourceSpan, page: StructuredPage | undefined): string {
  if (span.snippet?.trim()) {
    return span.snippet.trim();
  }

  if (!page?.text) {
    return "Sin snippet";
  }

  const safeStart = Math.max(0, span.start);
  const safeEnd = Math.min(page.text.length, Math.max(span.end, safeStart + 1));
  const excerpt = page.text.slice(safeStart, safeEnd).trim();
  return excerpt || page.text.slice(0, 140).trim() || "Sin snippet";
}

function getStructuredSpanLabel(span: SourceSpan): string | null {
  const structuredRef = span.structured_ref;
  if (!structuredRef) {
    return null;
  }

  if (structuredRef.kind === "table_row") {
    const rowLabel =
      typeof structuredRef.row_index === "number" ? `fila ${structuredRef.row_index + 1}` : "fila";
    const tableLabel = structuredRef.table_id ? `tabla ${structuredRef.table_id}` : "tabla";
    return `${tableLabel} · ${rowLabel}`;
  }

  if (structuredRef.kind === "table_header") {
    return structuredRef.table_id ? `cabecera ${structuredRef.table_id}` : "cabecera de tabla";
  }

  if (typeof structuredRef.line_index === "number") {
    return `línea ${structuredRef.line_index + 1}`;
  }

  return "texto de página";
}

function getStructuredColumnsLabel(span: SourceSpan): string | null {
  const columns = span.structured_ref?.column_indices ?? [];
  if (columns.length === 0) {
    return null;
  }

  return `columnas ${columns.map((column) => column + 1).join(", ")}`;
}

function getReferencedLineIndexes(record: ParsedRecord | null, pageNumber: number): Set<number> {
  const indexes = new Set<number>();

  for (const span of record?.source_spans ?? []) {
    if (span.page !== pageNumber || span.structured_ref?.kind !== "page_text") {
      continue;
    }

    if (typeof span.structured_ref.line_index === "number") {
      indexes.add(span.structured_ref.line_index);
    }
  }

  return indexes;
}

export function ReviewBoard() {
  const [payload, setPayload] = useState<ReviewQueuePayload>(initialPayload);
  const [selectedExtractionId, setSelectedExtractionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetailPayload["extraction"] | null>(null);
  const [draftRecords, setDraftRecords] = useState<ParsedRecord[]>([]);
  const [reviewNotes, setReviewNotes] = useState("");
  const [selectedRecordIndex, setSelectedRecordIndex] = useState(0);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState<"approve" | "reject" | "request_correction" | null>(null);
  const [actionResult, setActionResult] = useState<ReviewActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadQueue = useCallback(async (preferredExtractionId?: string | null) => {
    setLoadingQueue(true);

    try {
      const response = await fetch("/api/review", { cache: "no-store" });
      const body = (await response.json()) as ReviewQueuePayload | { error: string };

      if (!response.ok) {
        setError((body as { error: string }).error ?? "No se pudo cargar la cola de revisión");
        return;
      }

      const nextPayload = body as ReviewQueuePayload;
      setPayload(nextPayload);
      setError(null);

      const availableDocument = nextPayload.pending_documents.find(
        (document) => document.extractionId === (preferredExtractionId ?? selectedExtractionId)
      );
      const fallbackDocument = nextPayload.pending_documents.find((document) => Boolean(document.extractionId));
      const nextSelection = availableDocument?.extractionId ?? fallbackDocument?.extractionId ?? null;

      setSelectedExtractionId((current) => {
        if (preferredExtractionId !== undefined) {
          return nextSelection;
        }

        if (!current) {
          return nextSelection;
        }

        const currentStillExists = nextPayload.pending_documents.some(
          (document) => document.extractionId === current
        );

        return currentStillExists ? current : nextSelection;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la cola de revisión");
    } finally {
      setLoadingQueue(false);
    }
  }, [selectedExtractionId]);

  const loadDetail = useCallback(async (extractionId: string) => {
    setLoadingDetail(true);

    try {
      const response = await fetch(`/api/review/${extractionId}`, { cache: "no-store" });
      const body = (await response.json()) as ReviewDetailPayload | { error: string };

      if (!response.ok) {
        setDetail(null);
        setDraftRecords([]);
        setDetailError((body as { error: string }).error ?? "No se pudo cargar el detalle de revisión");
        return;
      }

      const nextDetail = (body as ReviewDetailPayload).extraction;
      setDetail(nextDetail);
      setDraftRecords(nextDetail.records);
      setSelectedRecordIndex(0);
      setReviewNotes("");
      setActionResult(null);
      setDetailError(null);
    } catch (loadError) {
      setDetail(null);
      setDraftRecords([]);
      setDetailError(
        loadError instanceof Error ? loadError.message : "No se pudo cargar el detalle de revisión"
      );
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadMounted() {
      if (!mounted) {
        return;
      }

      await loadQueue(null);
    }

    void loadMounted();
    const id = window.setInterval(() => {
      void loadMounted();
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [loadQueue]);

  useEffect(() => {
    if (!selectedExtractionId) {
      setDetail(null);
      setDraftRecords([]);
      setDetailError(null);
      return;
    }

    void loadDetail(selectedExtractionId);
  }, [loadDetail, selectedExtractionId]);

  const selectedRecord = draftRecords[selectedRecordIndex] ?? null;
  const originalRecords = detail?.records ?? [];
  const hasUnsavedChanges = JSON.stringify(originalRecords) !== JSON.stringify(draftRecords);
  const structuredPages = getRelevantPages(selectedRecord, detail?.structured_document ?? null);

  function updateRecordField(
    recordIndex: number,
    fieldKey: string,
    rawValue: string | boolean
  ) {
    setDraftRecords((current) =>
      current.map((record, index) => {
        if (index !== recordIndex) {
          return record;
        }

        const previousValue = record.fields[fieldKey] ?? null;
        const nextValue = normalizeReviewFieldValue(fieldKey, rawValue, previousValue);
        return {
          ...record,
          fields: {
            ...record.fields,
            [fieldKey]: nextValue
          }
        };
      })
    );
  }

  function updateRecordType(recordIndex: number, recordType: ParsedRecord["record_type"]) {
    setDraftRecords((current) =>
      current.map((record, index) =>
        index === recordIndex
          ? {
              ...record,
              record_type: recordType
            }
          : record
      )
    );
  }

  async function handleReviewAction(action: "approve" | "reject" | "request_correction") {
    if (!detail) {
      return;
    }

    setActionLoading(action);

    try {
      const response = await fetch(`/api/review/${detail.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          notes: reviewNotes || undefined,
          corrected_fields:
            action === "reject" ? undefined : buildReviewCorrectionPayload(draftRecords)
        })
      });

      const result = (await response.json()) as ReviewActionResult;
      if (!response.ok) {
        throw new Error(result.error ?? result.message ?? "No se pudo guardar la revisión");
      }

      setActionResult(result);
      await loadQueue(detail.id);

      if (action === "request_correction") {
        await loadDetail(detail.id);
      }
    } catch (actionError) {
      setDetailError(actionError instanceof Error ? actionError.message : "No se pudo guardar la revisión");
    } finally {
      setActionLoading(null);
    }
  }

  function handleSelectPendingDocument(document: PendingDocument) {
    if (!document.extractionId) {
      setDetail(null);
      setDraftRecords([]);
      setSelectedExtractionId(null);
      setDetailError("Este documento no tiene extracción asociada todavía.");
      return;
    }

    if (hasUnsavedChanges && selectedExtractionId && selectedExtractionId !== document.extractionId) {
      const shouldContinue = window.confirm(
        "Hay cambios sin guardar en la revisión actual. Si cambias de documento los perderás. ¿Continuar?"
      );

      if (!shouldContinue) {
        return;
      }
    }

    setSelectedExtractionId(document.extractionId);
  }

  return (
    <div className="page">
      <section className="review-workspace">
        <aside className="card review-sidebar">
          <div className="review-sidebar-header">
            <div>
              <h2>Cola de revisión</h2>
              {payload.current_user ? (
                <p className="muted">
                  Sesión activa: <strong>{payload.current_user.display_name}</strong> · {payload.current_user.role}
                </p>
              ) : null}
            </div>
            <span className="badge info">{payload.pending_documents.length} documento(s)</span>
          </div>

          {error ? <p className="badge danger">{error}</p> : null}

          {loadingQueue && payload.pending_documents.length === 0 ? (
            <p className="muted">Cargando cola de revisión...</p>
          ) : null}

          {!error && payload.pending_documents.length === 0 ? (
            <p className="muted">Sin documentos pendientes.</p>
          ) : null}

          <div className="review-queue-list">
            {payload.pending_documents.map((document) => {
              const isSelected = document.extractionId === selectedExtractionId;
              const confidenceClass =
                document.confidence >= 0.85 ? "success" : document.confidence >= 0.7 ? "warning" : "danger";

              return (
                <button
                  key={document.id}
                  type="button"
                  className={`review-queue-item${isSelected ? " is-selected" : ""}`}
                  onClick={() => handleSelectPendingDocument(document)}
                >
                  <div className="review-queue-item-header">
                    <strong>{document.filename}</strong>
                    <span className={badgeClass(document.status)}>{document.status}</span>
                  </div>
                  <div className="review-queue-item-meta">
                    <span className={`badge ${confidenceClass}`}>{formatConfidence(document.confidence)}</span>
                    <span className="badge info">{document.sourceType}</span>
                    <span className="badge info">{document.recordsCount} registro(s)</span>
                  </div>
                  <div className="review-queue-item-details">
                    <span>{document.parserStrategy}</span>
                    <span>{document.structuredBackend ?? "sin backend estructurado"}</span>
                    <span>{formatTimestamp(document.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="review-main">
          {detailError ? <section className="card"><p className="badge danger">{detailError}</p></section> : null}

          {loadingDetail ? (
            <section className="card">
              <p className="muted">Cargando detalle de la extracción...</p>
            </section>
          ) : null}

          {!loadingDetail && !detail && !detailError ? (
            <section className="card">
              <h2>Editor de revisión</h2>
              <p className="muted">Selecciona un documento con extracción disponible para validar y corregir sus registros.</p>
            </section>
          ) : null}

          {detail ? (
            <>
              <section className="card review-detail-header">
                <div className="review-detail-title">
                  <h2>{detail.filename}</h2>
                  <p className="muted">
                    Expediente <strong>{detail.expediente_id}</strong> · plantilla <strong>{detail.template_used}</strong> · estrategia{" "}
                    <strong>{detail.parser_strategy}</strong>
                  </p>
                </div>

                <div className="review-detail-badges">
                  <span className={badgeClass(detail.processing_status)}>{detail.processing_status}</span>
                  <span className={badgeClass(detail.review_status)}>{detail.review_status}</span>
                  <span className="badge info">{detail.source_type}</span>
                  <span className="badge info">{formatConfidence(detail.confidence)}</span>
                  <span className={`badge ${hasUnsavedChanges ? "warning" : "success"}`}>
                    {hasUnsavedChanges ? "borrador pendiente" : "sin cambios locales"}
                  </span>
                </div>

                <div className="review-action-bar">
                  <label className="review-notes-field">
                    Notas de revisión
                    <textarea
                      value={reviewNotes}
                      onChange={(event) => setReviewNotes(event.target.value)}
                      placeholder="Contexto para auditoría interna o motivo de la corrección"
                    />
                  </label>

                  <div className="review-action-buttons">
                    <button
                      type="button"
                      className="secondary"
                      disabled={Boolean(actionLoading)}
                      onClick={() => void handleReviewAction("request_correction")}
                    >
                      {actionLoading === "request_correction" ? "Guardando..." : "Guardar borrador"}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(actionLoading)}
                      onClick={() => void handleReviewAction("approve")}
                    >
                      {actionLoading === "approve" ? "Aprobando..." : "Aprobar y persistir"}
                    </button>
                    <button
                      type="button"
                      className="secondary review-reject-button"
                      disabled={Boolean(actionLoading)}
                      onClick={() => void handleReviewAction("reject")}
                    >
                      {actionLoading === "reject" ? "Rechazando..." : "Rechazar"}
                    </button>
                  </div>
                </div>

                {actionResult ? (
                  <p className="badge success review-action-result">{actionResult.message}</p>
                ) : null}

                {detail.warnings.length > 0 ? (
                  <div className="review-warning-list">
                    {detail.warnings.map((warning) => (
                      <span key={warning} className="badge warning">
                        {warning}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              <div className="review-detail-grid">
                <section className="card review-record-editor">
                  <div className="review-record-list">
                    {draftRecords.map((record, index) => (
                      <button
                        key={`${detail.id}-${index}`}
                        type="button"
                        className={`review-record-tab${index === selectedRecordIndex ? " is-selected" : ""}`}
                        onClick={() => setSelectedRecordIndex(index)}
                      >
                        <div>
                          <strong>Registro {index + 1}</strong>
                          <span className="muted">
                            {fieldLabel("description")}: {String(record.fields.description ?? "sin descripción")}
                          </span>
                        </div>
                        <div className="review-record-tab-meta">
                          <span className={badgeClass(record.record_type)}>{record.record_type}</span>
                          <span
                            className={`badge ${
                              record.confidence >= 0.85 ? "success" : record.confidence >= 0.7 ? "warning" : "danger"
                            }`}
                          >
                            {formatConfidence(record.confidence)}
                          </span>
                          {isRecordDirty(originalRecords[index], record) ? (
                            <span className="badge warning">editado</span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedRecord ? (
                    <div className="review-record-fields">
                      <label>
                        Tipo de registro
                        <select
                          value={selectedRecord.record_type}
                          onChange={(event) =>
                            updateRecordType(
                              selectedRecordIndex,
                              event.target.value as ParsedRecord["record_type"]
                            )
                          }
                        >
                          {recordTypes.map((recordType) => (
                            <option key={recordType} value={recordType}>
                              {recordType}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="review-fields-grid">
                        {getRecordFieldKeys(selectedRecord).map((fieldKey) => {
                          const fieldValue = selectedRecord.fields[fieldKey] ?? null;
                          const kind = inferReviewFieldKind(fieldKey, fieldValue);
                          const inputId = `review-field-${selectedRecordIndex}-${fieldKey}`;

                          return (
                            <label key={fieldKey} htmlFor={inputId}>
                              {fieldLabel(fieldKey)}
                              {kind === "boolean" ? (
                                <input
                                  id={inputId}
                                  type="checkbox"
                                  checked={Boolean(fieldValue)}
                                  onChange={(event) =>
                                    updateRecordField(selectedRecordIndex, fieldKey, event.target.checked)
                                  }
                                />
                              ) : (
                                <input
                                  id={inputId}
                                  type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
                                  step={kind === "number" ? "any" : undefined}
                                  value={normalizeInputValue(fieldValue)}
                                  onChange={(event) =>
                                    updateRecordField(selectedRecordIndex, fieldKey, event.target.value)
                                  }
                                />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <p className="muted">La extracción no contiene registros editables.</p>
                  )}
                </section>

                <section className="card review-source-panel">
                  <h3>Documento estructurado</h3>
                  <p className="muted">
                    Contexto documental de la extracción activa. Se muestran las páginas relevantes para el registro seleccionado.
                  </p>

                  {selectedRecord?.source_spans.length ? (
                    <div className="review-span-list">
                      {selectedRecord.source_spans.map((span, index) => {
                        const page = detail.structured_document?.pages.find((item) => item.page === span.page);
                        const structuredLabel = getStructuredSpanLabel(span);
                        const columnsLabel = getStructuredColumnsLabel(span);
                        return (
                          <div key={`${span.page}-${span.start}-${index}`} className="review-span-card">
                            <div className="review-span-card-meta">
                              <span className="badge info">Página {span.page}</span>
                              {structuredLabel ? <span className="badge success">{structuredLabel}</span> : null}
                              {columnsLabel ? <span className="badge info">{columnsLabel}</span> : null}
                            </div>
                            <p>{getSpanSnippet(span, page)}</p>
                            {span.structured_ref?.kind === "page_text" ? (
                              <span className="muted">offsets {span.start}-{span.end}</span>
                            ) : (
                              <span className="muted">referencia estructurada persistente</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="muted">Este registro no trae spans específicos; se muestra el documento completo disponible.</p>
                  )}

                  {detail.structured_document ? (
                    <div className="review-page-list">
                      {structuredPages.map((page) => {
                        const referencedLineIndexes = getReferencedLineIndexes(selectedRecord, page.page);
                        return (
                        <article key={page.page} className="review-page-card">
                          <div className="review-page-card-header">
                            <strong>Página {page.page}</strong>
                            <span className="muted">{page.tables.length} tabla(s)</span>
                          </div>

                          {page.tables.length > 0 ? (
                            page.tables.map((table) => (
                              <div key={table.table_id} className="review-table-card">
                                <div className="review-table-meta">
                                  <span className="badge info">{table.table_id}</span>
                                  <span className="muted">{table.source}</span>
                                </div>
                                <div className="table-wrap">
                                  <table>
                                    <thead>
                                      <tr>
                                        {table.header.map((cell, cellIndex) => (
                                          <th key={`${table.table_id}-head-${cellIndex}`}>
                                            {cell ?? `col-${cellIndex + 1}`}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {table.rows.map((row, rowIndex) => {
                                        const matches = selectedRecord
                                          ? doesStructuredRowMatchRecord(row, selectedRecord, {
                                              tableId: table.table_id,
                                              rowIndex
                                            })
                                          : false;

                                        return (
                                          <tr
                                            key={`${table.table_id}-row-${rowIndex}`}
                                            className={matches ? "review-table-row-match" : undefined}
                                          >
                                            {row.map((cell, cellIndex) => (
                                              <td key={`${table.table_id}-cell-${rowIndex}-${cellIndex}`}>
                                                {cell ?? "—"}
                                              </td>
                                            ))}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="muted">Sin tablas detectadas en esta página.</p>
                          )}

                          {page.text ? (
                            <details className="review-page-text">
                              <summary>Texto detectado</summary>
                              <div className="review-page-text-lines">
                                {page.text.split(/\r?\n/).map((line, lineIndex) => {
                                  const trimmed = line.trim();
                                  const isMatch = referencedLineIndexes.has(lineIndex);
                                  return (
                                    <div
                                      key={`${page.page}-line-${lineIndex}`}
                                      className={`review-page-text-line${isMatch ? " is-match" : ""}`}
                                    >
                                      <span className="review-page-text-line-number">{lineIndex + 1}</span>
                                      <span className="review-page-text-line-content">
                                        {trimmed || "\u00a0"}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          ) : null}
                        </article>
                      )})}
                    </div>
                  ) : (
                    <p className="muted">Esta extracción no trae `structured_document` todavía.</p>
                  )}
                </section>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {!error ? (
        <section className="card">
          <h2>Alertas fiscales abiertas</h2>
          {payload.open_alerts.length === 0 ? (
            <p className="muted">No hay alertas abiertas.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Severidad</th>
                    <th>Mensaje</th>
                    <th>Categoría</th>
                    <th>Expediente</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.open_alerts.map((alert) => (
                    <tr key={alert.id}>
                      <td>
                        <span
                          className={`badge ${
                            alert.severity === "critical"
                              ? "danger"
                              : alert.severity === "warning"
                                ? "warning"
                                : "info"
                          }`}
                        >
                          {alert.severity}
                        </span>
                      </td>
                      <td>{alert.message}</td>
                      <td>{alert.category}</td>
                      <td>
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {alert.expedienteId?.slice(0, 8)}...
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!error ? (
        <section className="card">
          <h2>Eventos de workflow recientes</h2>
          {payload.workflow_events.length === 0 ? (
            <p className="muted">Sin eventos registrados aún.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Documento</th>
                    <th>Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.workflow_events.slice(0, 20).map((event) => (
                    <tr key={event.id}>
                      <td>
                        <span
                          className={`badge ${
                            event.eventType === "parse.completed"
                              ? "success"
                              : event.eventType === "parse.failed"
                                ? "danger"
                                : event.eventType === "manual.review.required"
                                  ? "warning"
                                  : "info"
                          }`}
                        >
                          {event.eventType}
                        </span>
                      </td>
                      <td>
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {event.documentId?.slice(0, 8)}...
                        </span>
                      </td>
                      <td>{formatTimestamp(event.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
