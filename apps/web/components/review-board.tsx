"use client";

import { useEffect, useState } from "react";

type ReviewPayload = {
  pending_documents: Array<{
    id: string;
    expedienteId: string;
    filename: string;
    status: string;
    confidence: number;
    createdAt: string;
  }>;
  open_alerts: Array<{
    id: string;
    expedienteId: string;
    severity: "info" | "warning" | "critical";
    message: string;
    category: string;
    createdAt: string;
  }>;
  workflow_events: Array<{
    id: string;
    eventType: string;
    documentId: string;
    createdAt: string;
  }>;
};

const initialPayload: ReviewPayload = {
  pending_documents: [],
  open_alerts: [],
  workflow_events: []
};

function badgeClass(status: string): string {
  if (status === "manual_review") return "badge warning";
  if (status === "failed") return "badge danger";
  return "badge success";
}

export function ReviewBoard() {
  const [payload, setPayload] = useState<ReviewPayload>(initialPayload);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const response = await fetch("/api/review", { cache: "no-store" });
      if (!response.ok || !mounted) {
        return;
      }
      const body = (await response.json()) as ReviewPayload;
      setPayload(body);
    }

    void load();
    const id = window.setInterval(() => void load(), 3500);

    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="page">
      <section className="card">
        <h2>Documentos pendientes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Documento</th>
                <th>Expediente</th>
                <th>Estado</th>
                <th>Confianza</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {payload.pending_documents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    Sin pendientes por ahora.
                  </td>
                </tr>
              ) : (
                payload.pending_documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.filename}</td>
                    <td>{doc.expedienteId}</td>
                    <td>
                      <span className={badgeClass(doc.status)}>{doc.status}</span>
                    </td>
                    <td>{(doc.confidence * 100).toFixed(1)}%</td>
                    <td>{new Date(doc.createdAt).toLocaleString("es-ES")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Alertas abiertas</h2>
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
              {payload.open_alerts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No hay alertas abiertas.
                  </td>
                </tr>
              ) : (
                payload.open_alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      <span className={`badge ${alert.severity === "critical" ? "danger" : "warning"}`}>
                        {alert.severity}
                      </span>
                    </td>
                    <td>{alert.message}</td>
                    <td>{alert.category}</td>
                    <td>{alert.expedienteId}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
