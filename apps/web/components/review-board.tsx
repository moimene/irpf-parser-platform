"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  type ReviewPayload, type ReviewDetailPayload, type ReviewWorkItem,
  type DraftRecord, type ActionOutcome, type ReviewQueueType, type ReviewPriority,
  initialPayload, recordTypeOptions,
  priorityLabel, queueTypeLabel, reviewStatusLabel, priorityVariant,
  buildDraftRecords, buildCorrectedFields,
} from "@/lib/review-types";

export function ReviewBoard() {
  const [payload, setPayload] = useState<ReviewPayload>(initialPayload);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetailPayload | null>(null);
  const [draftRecords, setDraftRecords] = useState<DraftRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<ReviewQueueType | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<ReviewPriority | "all">("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [queueLoading, setQueueLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<"approve" | "reject" | "request_correction" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionOutcome, setActionOutcome] = useState<ActionOutcome | null>(null);

  async function loadQueue() {
    setQueueLoading(true);
    try {
      const response = await fetch("/api/review", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "No se pudo cargar la bandeja"); return; }
      setPayload(body as ReviewPayload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la bandeja");
    } finally { setQueueLoading(false); }
  }

  useEffect(() => { void loadQueue(); const id = window.setInterval(() => void loadQueue(), 10_000); return () => window.clearInterval(id); }, []);

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filteredItems = payload.work_items.filter((item) => {
    if (statusFilter !== "all" && item.queue_type !== statusFilter) return false;
    if (priorityFilter !== "all" && item.priority_label !== priorityFilter) return false;
    if (modelFilter !== "all" && item.model_type !== modelFilter) return false;
    if (yearFilter !== "all" && String(item.fiscal_year) !== yearFilter) return false;
    if (!normalizedSearch) return true;
    return [item.filename, item.expediente_reference, item.expediente_title, item.client?.display_name ?? "", item.client?.nif ?? ""].join(" ").toLowerCase().includes(normalizedSearch);
  });

  const selectedItem = filteredItems.find((item) => item.document_id === selectedDocumentId) ?? filteredItems[0] ?? null;

  useEffect(() => {
    if (selectedItem && selectedItem.document_id !== selectedDocumentId) setSelectedDocumentId(selectedItem.document_id);
    if (!selectedItem && selectedDocumentId) setSelectedDocumentId(null);
  }, [selectedDocumentId, selectedItem]);

  useEffect(() => {
    let cancelled = false;
    async function loadDetail(extractionId: string) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/review/${extractionId}`, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) throw new Error(body?.error ?? "No se pudo cargar el detalle.");
        setDetail(body as ReviewDetailPayload);
        setDraftRecords(buildDraftRecords(body as ReviewDetailPayload));
        setDetailError(null);
      } catch (err) { if (!cancelled) { setDetail(null); setDraftRecords([]); setDetailError(err instanceof Error ? err.message : "Error"); } }
      finally { if (!cancelled) setDetailLoading(false); }
    }
    if (!selectedItem?.extraction_id) { setDetail(null); setDraftRecords([]); setDetailError(null); return () => { cancelled = true; }; }
    void loadDetail(selectedItem.extraction_id);
    return () => { cancelled = true; };
  }, [selectedItem?.extraction_id]);

  const selectedAlerts = selectedItem ? payload.open_alerts.filter((a) => a.expediente_id === selectedItem.expediente_id) : [];
  const selectedEvents = selectedItem ? payload.workflow_events.filter((e) => e.document_id === selectedItem.document_id).slice(0, 5) : [];

  async function handleAction(action: "approve" | "reject" | "request_correction") {
    if (!selectedItem?.extraction_id) { setDetailError("Sin extracción revisable."); return; }
    setActionLoading(action); setActionMessage(null); setDetailError(null); setActionOutcome(null);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "approve") { const cf = buildCorrectedFields(detail, draftRecords); if (cf) body.corrected_fields = cf; }
      const res = await fetch(`/api/review/${selectedItem.extraction_id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) { setDetailError(result.error ?? result.message ?? "Error."); return; }
      setActionMessage(result.message);
      setActionOutcome({
        tone: action === "approve" ? "success" : action === "reject" ? "warning" : "info",
        title: action === "approve" ? "Documento incorporado al runtime fiscal" : action === "reject" ? "Documento rechazado" : "Documento en corrección",
        detail: action === "approve" ? "La extracción sale de la cola manual." : action === "reject" ? "El documento exige nueva ingesta." : "La extracción sigue en cola manual.",
        expediente_reference: selectedItem.expediente_reference,
        client_reference: selectedItem.client?.reference ?? null,
        phase_href: action === "approve" ? `/expedientes/${selectedItem.expediente_reference}?fase=canonico` : `/expedientes/${selectedItem.expediente_reference}?fase=revision`,
      });
      await loadQueue();
      if (selectedItem.extraction_id) {
        const dr = await fetch(`/api/review/${selectedItem.extraction_id}`, { cache: "no-store" });
        if (dr.ok) { const nd = await dr.json(); setDetail(nd); setDraftRecords(buildDraftRecords(nd)); }
        else if (action !== "request_correction") { setDetail(null); setDraftRecords([]); }
      }
    } catch (err) { setDetailError(err instanceof Error ? err.message : "Error."); }
    finally { setActionLoading(null); }
  }

  function updateDraftRecordType(idx: number, val: string) { setDraftRecords((c) => c.map((r, i) => i === idx ? { ...r, record_type: val } : r)); }
  function updateDraftConfidence(idx: number, val: string) { setDraftRecords((c) => c.map((r, i) => i === idx ? { ...r, confidence: val } : r)); }
  function updateDraftField(idx: number, key: string, val: string) { setDraftRecords((c) => c.map((r, i) => i === idx ? { ...r, fields: { ...r.fields, [key]: val } } : r)); }

  const s = payload.summary;

  return (
    <>
      {/* KPIs */}
      <section className="card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">Bandeja de trabajo</span>
            <h2 className="text-xl font-bold mt-1">Cola operativa</h2>
            <p className="text-sm text-text-secondary mt-0.5">Priorización de revisión manual e incidencias documentales.</p>
          </div>
          {payload.current_user && <p className="text-xs text-text-secondary">{payload.current_user.display_name} · {payload.current_user.role}</p>}
        </div>
        {error && <p className="badge danger mt-2">{error}</p>}
        <div className="kpi-grid mt-3">
          <article className="kpi"><span>Pendientes</span><strong>{s.pending_items}</strong></article>
          <article className="kpi"><span>Revisión manual</span><strong>{s.manual_review_items}</strong></article>
          <article className="kpi"><span>Incidencias</span><strong>{s.document_failures}</strong></article>
          <article className="kpi"><span>Críticos</span><strong>{s.critical_priority_items}</strong></article>
          <article className="kpi"><span>Alertas</span><strong>{s.open_alerts}</strong></article>
          <article className="kpi"><span>Alertas críticas</span><strong>{s.critical_alerts}</strong></article>
        </div>
      </section>

      {/* Filters */}
      <section className="card mt-4">
        <div className="review-filters">
          <label>Buscar<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cliente, expediente o documento" /></label>
          <label>Cola<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ReviewQueueType | "all")}><option value="all">Todas</option><option value="manual_review">Revisión manual</option><option value="document_failure">Incidencia documental</option></select></label>
          <label>Prioridad<select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as ReviewPriority | "all")}><option value="all">Todas</option><option value="critical">Crítica</option><option value="high">Alta</option><option value="normal">Normal</option></select></label>
          <label>Modelo<select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)}><option value="all">Todos</option>{payload.filters.model_types.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label>Ejercicio<select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}><option value="all">Todos</option>{payload.filters.fiscal_years.map((y) => <option key={y} value={String(y)}>{y}</option>)}</select></label>
        </div>
      </section>

      {/* Master-detail workbench */}
      <section className="review-workbench mt-4">
        <article className="card review-list-panel">
          <h3 className="text-sm font-medium mb-2">Cola priorizada · {filteredItems.length} items</h3>
          {queueLoading ? <p className="muted">Cargando...</p> : filteredItems.length === 0 ? <p className="muted">Sin trabajo pendiente.</p> : (
            <div className="review-item-list">
              {filteredItems.map((item) => (
                <button key={item.document_id} type="button"
                  className={`review-item ${selectedItem?.document_id === item.document_id ? "active" : ""}`}
                  onClick={() => { setSelectedDocumentId(item.document_id); setActionMessage(null); }}>
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <Badge variant={priorityVariant(item.priority_label)}>{priorityLabel(item.priority_label)}</Badge>
                    <Badge variant={item.queue_type === "document_failure" ? "destructive" : "warning"}>{queueTypeLabel(item.queue_type)}</Badge>
                  </div>
                  <strong className="text-sm">{item.client?.display_name ?? "Sin vincular"}</strong>
                  <p className="text-xs text-text-secondary mt-0.5">{item.expediente_reference} · {item.model_type} · {item.fiscal_year}</p>
                  <p className="text-sm mt-1">{item.filename}</p>
                  <div className="flex gap-3 text-xs text-text-secondary mt-1">
                    <span>Confianza {Math.round(item.confidence * 100)}%</span>
                    <span>{item.records_count} reg.</span>
                    <span>{item.open_alerts} alertas</span>
                  </div>
                  <p className="text-xs text-text-secondary mt-1">{item.next_action}</p>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="card review-detail-panel">
          {!selectedItem ? (
            actionOutcome ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2"><h3>{actionOutcome.title}</h3><Badge variant={actionOutcome.tone === "success" ? "success" : actionOutcome.tone === "warning" ? "warning" : "default"}>{actionOutcome.tone}</Badge></div>
                <p className="text-sm text-text-secondary">{actionOutcome.detail}</p>
                <div className="flex gap-2"><Link className="button-link" href={actionOutcome.phase_href}>Abrir expediente</Link>{actionOutcome.client_reference && <Link className="button-link secondary-link" href={`/clientes/${actionOutcome.client_reference}`}>Volver al cliente</Link>}</div>
              </div>
            ) : <p className="muted">Selecciona un item de la cola para ver su detalle y tomar acción.</p>
          ) : (
            <>
              {/* Context header */}
              <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-border-default">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Revisión</p>
                  <p className="text-sm font-bold mt-0.5">{selectedItem.filename}</p>
                  <p className="text-xs text-text-secondary">{selectedItem.expediente_reference} · {selectedItem.client?.display_name ?? "—"}</p>
                </div>
                <Badge variant={priorityVariant(selectedItem.priority_label)}>{priorityLabel(selectedItem.priority_label)}</Badge>
              </div>

              {detailError && <p className="badge danger mt-2">{detailError}</p>}
              {actionMessage && <p className="badge success mt-2">{actionMessage}</p>}

              {detailLoading ? <p className="muted mt-3">Cargando detalle...</p> : detail ? (
                <div className="space-y-4 mt-3">
                  {/* Extraction metadata */}
                  <div className="flex gap-4 text-xs text-text-secondary flex-wrap">
                    <span>Estado: <Badge variant={detail.extraction.review_status === "validated" ? "success" : detail.extraction.review_status === "rejected" ? "destructive" : "warning"}>{reviewStatusLabel(detail.extraction.review_status)}</Badge></span>
                    <span>Confianza: {Math.round(detail.extraction.confidence * 100)}%</span>
                    {detail.extraction.reviewed_by && <span>Revisado por: {detail.extraction.reviewed_by}</span>}
                  </div>

                  {/* Records editor */}
                  {draftRecords.map((draft, idx) => {
                    const original = detail.records[idx];
                    return (
                      <div key={idx} className="p-3 rounded-md border border-border-default bg-surface-alt space-y-2">
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-medium">Tipo
                            <select value={draft.record_type} onChange={(e) => updateDraftRecordType(idx, e.target.value)} className="ml-1">
                              {recordTypeOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </label>
                          <label className="text-xs font-medium">Confianza
                            <input type="number" step="0.01" min="0" max="1" value={draft.confidence} onChange={(e) => updateDraftConfidence(idx, e.target.value)} className="ml-1 w-16" />
                          </label>
                          <span className="text-xs text-text-secondary ml-auto">Registro #{idx}</span>
                        </div>
                        <div className="space-y-1">
                          {Object.entries(draft.fields).map(([key, val]) => (
                            <label key={key} className="flex items-center gap-2 text-xs">
                              <span className="font-mono min-w-[100px] text-text-secondary">{key}</span>
                              <input type="text" value={val} onChange={(e) => updateDraftField(idx, key, e.target.value)} className="flex-1 text-xs" />
                            </label>
                          ))}
                        </div>
                        {original?.source_spans?.length > 0 && (
                          <div className="text-xs text-text-secondary mt-1">
                            {original.source_spans.map((span, si) => span.snippet ? <p key={si} className="italic">«{span.snippet}» (p.{span.page})</p> : null)}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap pt-2 border-t border-border-default">
                    <button type="button" className="button-link" disabled={!!actionLoading} onClick={() => handleAction("approve")}>
                      {actionLoading === "approve" ? "Aprobando..." : "✓ Aprobar e incorporar"}
                    </button>
                    <button type="button" className="button-link secondary-link" disabled={!!actionLoading} onClick={() => handleAction("request_correction")}>
                      {actionLoading === "request_correction" ? "Guardando..." : "Mantener en corrección"}
                    </button>
                    <button type="button" className="button-link danger-link" disabled={!!actionLoading} onClick={() => handleAction("reject")}>
                      {actionLoading === "reject" ? "Rechazando..." : "✕ Rechazar"}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Alerts */}
              {selectedAlerts.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Alertas ({selectedAlerts.length})</h4>
                  {selectedAlerts.map((alert) => (
                    <div key={alert.id} className="flex items-start gap-2 p-2 rounded border border-border-subtle">
                      <Badge variant={alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "warning" : "default"}>{alert.severity}</Badge>
                      <div><p className="text-xs">{alert.message}</p><p className="text-xs text-text-secondary">{alert.category}</p></div>
                    </div>
                  ))}
                </div>
              )}

              {/* Events */}
              {selectedEvents.length > 0 && (
                <div className="mt-4 space-y-1">
                  <h4 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Eventos recientes</h4>
                  {selectedEvents.map((ev) => (
                    <p key={ev.id} className="text-xs text-text-secondary">{ev.event_type} · {new Date(ev.created_at).toLocaleString("es-ES")}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </article>
      </section>
    </>
  );
}
