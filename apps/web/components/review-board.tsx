"use client";
import { useEffect, useState } from "react";

type PendingDocument = {
  id: string;
  expedienteId: string;
  filename: string;
  status: string;
  confidence: number;
  createdAt: string;
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
type ReviewPayload = {
  pending_documents: PendingDocument[];
  open_alerts: OpenAlert[];
  workflow_events: WorkflowEvent[];
};
type ReviewActionResult = {
  extraction_id: string;
  review_status: string;
  operations_saved: number;
  message: string;
};

const initialPayload: ReviewPayload = {
  pending_documents: [],
  open_alerts: [],
  workflow_events: [],
};

function badgeClass(status: string): string {
  if (status === "manual_review") return "badge warning";
  if (status === "failed") return "badge danger";
  if (status === "completed") return "badge success";
  return "badge info";
}

export function ReviewBoard() {
  const [payload, setPayload] = useState<ReviewPayload>(initialPayload);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, ReviewActionResult>>({});

  async function load() {
    const response = await fetch("/api/review", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as ReviewPayload;
    setPayload(body);
  }

  useEffect(() => {
    let mounted = true;
    async function loadMounted() {
      if (!mounted) return;
      await load();
    }
    void loadMounted();
    const id = window.setInterval(() => void loadMounted(), 5000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  async function handleReviewAction(
    documentId: string,
    action: "approve" | "reject" | "request_correction"
  ) {
    setActionLoading(documentId);
    try {
      const extractionRes = await fetch(`/api/extractions?document_id=${documentId}`);
      if (!extractionRes.ok) {
        alert("No se encontró la extracción para este documento.");
        return;
      }
      const { extraction_id } = (await extractionRes.json()) as { extraction_id: string };
      const res = await fetch(`/api/review/${extraction_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reviewer: "fiscalista.demo" }),
      });
      const result = (await res.json()) as ReviewActionResult;
      setActionResults((prev) => ({ ...prev, [documentId]: result }));
      await load();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="page">
      <section className="card">
        <h2>Documentos pendientes de revisión</h2>
        {payload.pending_documents.length === 0 ? (
          <p className="muted">Sin documentos pendientes. ✓</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Estado</th>
                  <th>Confianza</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {payload.pending_documents.map((doc) => {
                  const isLoading = actionLoading === doc.id;
                  const result = actionResults[doc.id];
                  const pct = Math.round(doc.confidence * 100);
                  return (
                    <tr key={doc.id}>
                      <td>
                        <strong>{doc.filename}</strong>
                        <br />
                        <span className="muted" style={{ fontSize: "0.75rem" }}>
                          {doc.id.slice(0, 8)}…
                        </span>
                      </td>
                      <td>
                        <span className={badgeClass(doc.status)}>{doc.status}</span>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: "60px", height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden", display: "inline-block" }}>
                            <span style={{ width: `${pct}%`, height: "100%", background: pct >= 85 ? "#009a77" : pct >= 70 ? "#e6a817" : "#e53e3e", display: "block", borderRadius: "3px" }} />
                          </span>
                          {pct}%
                        </span>
                      </td>
                      <td>{new Date(doc.createdAt).toLocaleString("es-ES")}</td>
                      <td>
                        {result ? (
                          <span className="badge success" style={{ fontSize: "0.75rem" }}>{result.message}</span>
                        ) : (
                          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                            <button className="secondary" style={{ fontSize: "0.75rem", padding: "4px 10px" }} disabled={isLoading} onClick={() => handleReviewAction(doc.id, "approve")}>
                              {isLoading ? "…" : "✓ Aprobar"}
                            </button>
                            <button className="secondary" style={{ fontSize: "0.75rem", padding: "4px 10px", borderColor: "#e53e3e", color: "#e53e3e" }} disabled={isLoading} onClick={() => handleReviewAction(doc.id, "reject")}>
                              {isLoading ? "…" : "✗ Rechazar"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Alertas fiscales abiertas</h2>
        {payload.open_alerts.length === 0 ? (
          <p className="muted">No hay alertas abiertas. ✓</p>
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
                      <span className={`badge ${alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}`}>{alert.severity}</span>
                    </td>
                    <td>{alert.message}</td>
                    <td>{alert.category}</td>
                    <td><span className="muted" style={{ fontSize: "0.75rem" }}>{alert.expedienteId?.slice(0, 8)}…</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                      <span className={`badge ${event.eventType === "parse.completed" ? "success" : event.eventType === "parse.failed" ? "danger" : event.eventType === "manual.review.required" ? "warning" : "info"}`}>{event.eventType}</span>
                    </td>
                    <td><span className="muted" style={{ fontSize: "0.75rem" }}>{event.documentId?.slice(0, 8)}…</span></td>
                    <td>{new Date(event.createdAt).toLocaleString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
