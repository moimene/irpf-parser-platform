"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ExpedienteDocument = {
  id: string;
  filename: string;
  processing_status: string;
  confidence: number;
  manual_review_required: boolean;
  uploaded_at: string | null;
  processed_at: string | null;
  uploaded_by: string | null;
  latest_extraction: {
    id: string;
    confidence: number;
    requires_manual_review: boolean;
    review_status: string;
    records_count: number;
    created_at: string;
  } | null;
};

type ExpedienteExport = {
  id: string;
  model: "100" | "714" | "720";
  status: string;
  validation_state: string;
  artifact_path: string;
  generated_at: string;
};

type ExpedienteOperation = {
  id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  retention: number | null;
  realized_gain: number | null;
  source: string;
  confidence: number | null;
  manual_notes: string | null;
};

type ExpedienteLot = {
  id: string;
  acquisition_operation_id: string | null;
  isin: string;
  description: string | null;
  acquisition_date: string;
  quantity_original: number;
  quantity_open: number;
  quantity_sold: number;
  unit_cost: number | null;
  total_cost: number | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
  source: string;
  sales_count: number;
};

type ExpedientePayload = {
  expediente_id: string;
  expediente_reference: string;
  title: string;
  status: string;
  fiscal_year: number;
  model_type: string;
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
  } | null;
  counts: {
    total: number;
    queued: number;
    processing: number;
    manual_review: number;
    completed: number;
    failed: number;
    operations: number;
    exports: number;
    lots_open: number;
    lots_closed: number;
  };
  documents: ExpedienteDocument[];
  operations: ExpedienteOperation[];
  lots: ExpedienteLot[];
  exports: ExpedienteExport[];
};

const emptyState: ExpedientePayload = {
  expediente_id: "",
  expediente_reference: "",
  title: "",
  status: "BORRADOR",
  fiscal_year: new Date().getFullYear(),
  model_type: "IRPF",
  client: null,
  counts: {
    total: 0,
    queued: 0,
    processing: 0,
    manual_review: 0,
    completed: 0,
    failed: 0,
    operations: 0,
    exports: 0,
    lots_open: 0,
    lots_closed: 0
  },
  documents: [],
  operations: [],
  lots: [],
  exports: []
};

function badgeClass(value: string): string {
  if (value === "completed" || value === "generated" || value === "validated" || value === "ok") {
    return "badge success";
  }

  if (value === "manual_review" || value === "warnings" || value === "pending") {
    return "badge warning";
  }

  if (value === "failed" || value === "rejected" || value === "errors") {
    return "badge danger";
  }

  return "badge";
}

function formatNumber(value: number | null, maximumFractionDigits = 6): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function formatCurrency(value: number | null, currency: string | null): string {
  if (value === null) {
    return "-";
  }

  const resolvedCurrency = currency?.trim().toUpperCase() || "EUR";

  try {
    return new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${formatNumber(value, 2)} ${resolvedCurrency}`;
  }
}

export function ExpedienteSummary({ expedienteId }: { expedienteId: string }) {
  const [payload, setPayload] = useState<ExpedientePayload>(emptyState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/expedientes/${expedienteId}`, { cache: "no-store" });
        const body = (await response.json()) as ExpedientePayload | { error: string };
        if (!response.ok) {
          setError((body as { error: string }).error ?? "No se pudo cargar el expediente");
          return;
        }

        setPayload(body as ExpedientePayload);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el expediente");
      }
    }

    void load();

    const intervalId = window.setInterval(() => void load(), 5000);
    const refreshListener = () => void load();
    window.addEventListener("expediente:refresh", refreshListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("expediente:refresh", refreshListener);
    };
  }, [expedienteId]);

  return (
    <>
      <section className="card">
        <h2>Estado del expediente</h2>
        <p className="muted">
          {payload.title || `Expediente ${expedienteId}`} · {payload.model_type} · ejercicio {payload.fiscal_year}
        </p>
        {payload.client ? (
          <p className="muted" style={{ marginTop: "-4px" }}>
            Cliente:&nbsp;
            <Link href={`/clientes/${payload.client.reference}`}>{payload.client.display_name}</Link>
            &nbsp;· {payload.client.nif}
          </p>
        ) : null}
        <div className="kpi-grid">
          <article className="kpi">
            <span>Documentos</span>
            <strong>{payload.counts.total}</strong>
          </article>
          <article className="kpi">
            <span>En revisión</span>
            <strong>{payload.counts.manual_review}</strong>
          </article>
          <article className="kpi">
            <span>Completados</span>
            <strong>{payload.counts.completed}</strong>
          </article>
          <article className="kpi">
            <span>Operaciones</span>
            <strong>{payload.counts.operations}</strong>
          </article>
          <article className="kpi">
            <span>Lotes abiertos</span>
            <strong>{payload.counts.lots_open}</strong>
          </article>
          <article className="kpi">
            <span>Lotes cerrados</span>
            <strong>{payload.counts.lots_closed}</strong>
          </article>
        </div>
        {error ? <p className="badge danger" style={{ marginTop: "12px" }}>{error}</p> : null}
      </section>

      <section className="card">
        <h2>Documentos del expediente</h2>
        {payload.documents.length === 0 ? (
          <p className="muted">
            El expediente todavía no tiene documentos persistidos. La API ya responde aunque el expediente
            esté vacío, así que la UI no queda en falso 404 tras la primera ingesta.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Estado</th>
                  <th>Extracción</th>
                  <th>Alta</th>
                </tr>
              </thead>
              <tbody>
                {payload.documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <strong>{document.filename}</strong>
                      <br />
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        {document.id.slice(0, 8)}...
                      </span>
                    </td>
                    <td>
                      <span className={badgeClass(document.processing_status)}>{document.processing_status}</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        confianza {Math.round(document.confidence * 100)}%
                      </div>
                    </td>
                    <td>
                      {document.latest_extraction ? (
                        <>
                          <span className={badgeClass(document.latest_extraction.review_status)}>
                            {document.latest_extraction.review_status}
                          </span>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {document.latest_extraction.records_count} registro(s)
                          </div>
                        </>
                      ) : (
                        <span className="muted">Sin extracción persistida</span>
                      )}
                    </td>
                    <td>{document.uploaded_at ? new Date(document.uploaded_at).toLocaleString("es-ES") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Operaciones fiscales</h2>
        {payload.operations.length === 0 ? (
          <p className="muted">
            Todavía no hay operaciones fiscales persistidas para este expediente. La slice de Fase 2 ya
            deja listo el contrato runtime para que compras, ventas y posiciones aparezcan aquí.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Activo</th>
                  <th>Importe</th>
                  <th>Cantidad</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {payload.operations.map((operation) => (
                  <tr key={operation.id}>
                    <td>{new Date(operation.operation_date).toLocaleDateString("es-ES")}</td>
                    <td>
                      <span className={badgeClass(operation.operation_type)}>{operation.operation_type}</span>
                    </td>
                    <td>
                      <strong>{operation.isin ?? "Sin ISIN"}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {operation.description ?? operation.manual_notes ?? "Sin descripción"}
                      </div>
                    </td>
                    <td>
                      {formatCurrency(operation.amount, operation.currency)}
                      {operation.realized_gain !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          G/P {formatCurrency(operation.realized_gain, operation.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {formatNumber(operation.quantity)}
                      {operation.retention !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Ret. {formatCurrency(operation.retention, operation.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="badge">{operation.source}</span>
                      {operation.confidence !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          confianza {Math.round(operation.confidence * 100)}%
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Lotes de adquisición</h2>
        {payload.lots.length === 0 ? (
          <p className="muted">
            El runtime todavía no ha derivado lotes válidos desde las operaciones persistidas de este expediente.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Adquisición</th>
                  <th>Activo</th>
                  <th>Cantidades</th>
                  <th>Coste</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {payload.lots.map((lot) => (
                  <tr key={lot.id}>
                    <td>{new Date(lot.acquisition_date).toLocaleDateString("es-ES")}</td>
                    <td>
                      <strong>{lot.isin}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {lot.description ?? "Sin descripción"}
                      </div>
                    </td>
                    <td>
                      <div>Origen {formatNumber(lot.quantity_original)}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        Vendido {formatNumber(lot.quantity_sold)} · Abierto {formatNumber(lot.quantity_open)}
                      </div>
                    </td>
                    <td>
                      {formatCurrency(lot.total_cost, lot.currency)}
                      {lot.unit_cost !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Unitario {formatCurrency(lot.unit_cost, lot.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={badgeClass(lot.status)}>{lot.status}</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {lot.sales_count} consumo(s) FIFO · {lot.source}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Exportaciones generadas</h2>
        {payload.exports.length === 0 ? (
          <p className="muted">Todavía no hay exportaciones registradas para este expediente.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Estado</th>
                  <th>Validación</th>
                  <th>Generado</th>
                </tr>
              </thead>
              <tbody>
                {payload.exports.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.model}</strong>
                    </td>
                    <td>
                      <span className={badgeClass(item.status)}>{item.status}</span>
                    </td>
                    <td>
                      <span className={badgeClass(item.validation_state)}>{item.validation_state}</span>
                    </td>
                    <td>{new Date(item.generated_at).toLocaleString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
