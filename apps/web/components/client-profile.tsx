"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ClientPayload = {
  current_user?: {
    reference: string;
    display_name: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
    email: string | null;
    status: "active" | "inactive" | "archived";
    contact_person: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
  };
  stats: {
    expedientes: number;
    documents: number;
    pending_review: number;
    exports: number;
    last_activity_at: string | null;
  };
  assignments: Array<{
    id: string;
    assignment_role: "owner" | "manager" | "support" | "viewer";
    created_at: string;
    user: {
      id: string;
      reference: string;
      display_name: string;
      email: string;
      role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
      status: "active" | "inactive";
    };
  }>;
  expedientes: Array<{
    id: string;
    reference: string;
    title: string;
    status: string;
    fiscal_year: number;
    model_type: string;
    counts: {
      documents: number;
      pending_review: number;
      completed: number;
      exports: number;
    };
    latest_export_model: string | null;
    last_activity_at: string | null;
  }>;
};

type CreateExpedienteResponse = {
  expediente: {
    reference: string;
  };
};

const emptyPayload: ClientPayload = {
  client: {
    id: "",
    reference: "",
    display_name: "",
    nif: "",
    email: null,
    status: "active",
    contact_person: null,
    notes: null,
    created_at: "",
    updated_at: ""
  },
  stats: {
    expedientes: 0,
    documents: 0,
    pending_review: 0,
    exports: 0,
    last_activity_at: null
  },
  assignments: [],
  expedientes: []
};

function badgeClass(value: string): string {
  if (value === "active" || value === "VALIDADO" || value === "PRESENTADO") return "badge success";
  if (value === "EN_REVISION" || value === "BORRADOR" || value === "MODIFICADO") return "badge warning";
  return "badge";
}

export function ClientProfile({ clientId }: { clientId: string }) {
  const [payload, setPayload] = useState<ClientPayload>(emptyPayload);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear().toString());
  const [modelType, setModelType] = useState<"IRPF" | "IP" | "720">("IRPF");
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [createdReference, setCreatedReference] = useState<string | null>(null);
  const canCreateExpediente = payload.current_user?.role !== "solo_lectura";

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/clientes/${clientId}`, { cache: "no-store" });
        const body = (await response.json()) as ClientPayload | { error: string };
        if (!response.ok) {
          setError((body as { error: string }).error ?? "No se pudo cargar el cliente");
          return;
        }

        setPayload(body as ClientPayload);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el cliente");
      }
    }

    void load();
  }, [clientId]);

  async function handleCreateExpediente(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreatedReference(null);

    try {
      const response = await fetch("/api/expedientes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: payload.client.id,
          fiscal_year: Number(fiscalYear),
          model_type: modelType,
          reference: reference.trim() || undefined,
          title: title.trim() || undefined
        })
      });

      const body = (await response.json()) as CreateExpedienteResponse | { error: string };
      if (!response.ok) {
        setError((body as { error: string }).error ?? "No se pudo crear el expediente");
        return;
      }

      const created = body as CreateExpedienteResponse;
      setCreatedReference(created.expediente.reference);

      const reloadResponse = await fetch(`/api/clientes/${clientId}`, { cache: "no-store" });
      if (reloadResponse.ok) {
        setPayload((await reloadResponse.json()) as ClientPayload);
      }

      setReference("");
      setTitle("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo crear el expediente");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>{payload.client.display_name || "Cliente"}</h2>
        <p className="muted">
          {payload.client.nif || "Sin NIF"} · referencia {payload.client.reference || clientId}
        </p>
        <div className="kpi-grid">
          <article className="kpi">
            <span>Expedientes</span>
            <strong>{payload.stats.expedientes}</strong>
          </article>
          <article className="kpi">
            <span>Documentos</span>
            <strong>{payload.stats.documents}</strong>
          </article>
          <article className="kpi">
            <span>En revisión</span>
            <strong>{payload.stats.pending_review}</strong>
          </article>
          <article className="kpi">
            <span>Exportaciones</span>
            <strong>{payload.stats.exports}</strong>
          </article>
        </div>
        <div className="stack" style={{ marginTop: "14px" }}>
          <article className="stack-item">
            <h3>Ficha operativa</h3>
            <p className="muted" style={{ margin: 0 }}>
              Estado: <span className={badgeClass(payload.client.status)}>{payload.client.status}</span>
            </p>
            <p className="muted" style={{ marginBottom: 0 }}>
              Email: {payload.client.email || "sin email"}<br />
              Contacto: {payload.client.contact_person || "sin contacto"}<br />
              Última actividad:{" "}
              {payload.stats.last_activity_at
                ? new Date(payload.stats.last_activity_at).toLocaleString("es-ES")
                : "sin actividad"}
            </p>
          </article>
          <article className="stack-item">
            <h3>Notas</h3>
            <p className="muted" style={{ margin: 0 }}>
              {payload.client.notes || "Sin notas operativas registradas todavía."}
            </p>
          </article>
          <article className="stack-item">
            <h3>Equipo asignado</h3>
            {payload.assignments.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No hay usuarios asignados todavía a este cliente.
              </p>
            ) : (
              <div className="muted" style={{ margin: 0 }}>
                {payload.assignments.map((assignment) => (
                  <p key={assignment.id} style={{ margin: "0 0 8px" }}>
                    <strong>{assignment.user.display_name}</strong> · {assignment.assignment_role} ·{" "}
                    {assignment.user.role}
                    <br />
                    {assignment.user.email}
                  </p>
                ))}
              </div>
            )}
          </article>
        </div>
        {error ? <p className="badge danger" style={{ marginTop: "12px" }}>{error}</p> : null}
      </section>

      <section className="card">
        <h2>Nuevo expediente</h2>
        <p className="muted">
          Crea expedientes de IRPF, Patrimonio o 720 ya vinculados al cliente, manteniendo la relación
          operativa para intake, revisión y exportación.
        </p>
        {payload.current_user?.role === "solo_lectura" ? (
          <p className="badge warning" style={{ marginBottom: "12px" }}>
            El perfil solo lectura puede consultar la ficha, pero no crear expedientes.
          </p>
        ) : null}
        <form className="form" onSubmit={handleCreateExpediente}>
          <label htmlFor="expediente-model-type">Modelo</label>
          <select
            id="expediente-model-type"
            value={modelType}
            onChange={(event) => setModelType(event.target.value as "IRPF" | "IP" | "720")}
            disabled={submitting || !canCreateExpediente}
          >
            <option value="IRPF">IRPF</option>
            <option value="IP">Impuesto sobre el Patrimonio</option>
            <option value="720">Modelo 720</option>
          </select>

          <label htmlFor="expediente-fiscal-year">Ejercicio fiscal</label>
          <input
            id="expediente-fiscal-year"
            type="number"
            min={2013}
            max={2035}
            value={fiscalYear}
            onChange={(event) => setFiscalYear(event.target.value)}
            disabled={submitting || !canCreateExpediente}
          />

          <label htmlFor="expediente-reference">Referencia del expediente (opcional)</label>
          <input
            id="expediente-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Ej: fagu-irpf-2025"
            disabled={submitting || !canCreateExpediente}
          />

          <label htmlFor="expediente-title">Título visible (opcional)</label>
          <input
            id="expediente-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej: Expediente IRPF 2025 - FAGU"
            disabled={submitting || !canCreateExpediente}
          />

          <button type="submit" disabled={submitting || !payload.client.id || !canCreateExpediente}>
            {submitting ? "Creando expediente..." : "Crear expediente"}
          </button>
        </form>

        {createdReference ? (
          <p className="badge success" style={{ marginTop: "12px" }}>
            Expediente creado:&nbsp;
            <Link href={`/expedientes/${createdReference}`}>{createdReference}</Link>
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>Expedientes del cliente</h2>
        {payload.expedientes.length === 0 ? (
          <p className="muted">Este cliente todavía no tiene expedientes dados de alta.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Expediente</th>
                  <th>Modelo</th>
                  <th>Estado</th>
                  <th>Operativa</th>
                  <th>Última actividad</th>
                </tr>
              </thead>
              <tbody>
                {payload.expedientes.map((expediente) => (
                  <tr key={expediente.id}>
                    <td>
                      <Link href={`/expedientes/${expediente.reference}`}>
                        <strong>{expediente.title}</strong>
                      </Link>
                      <br />
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        {expediente.reference} · ejercicio {expediente.fiscal_year}
                      </span>
                    </td>
                    <td>{expediente.model_type}</td>
                    <td>
                      <span className={badgeClass(expediente.status)}>{expediente.status}</span>
                    </td>
                    <td>
                      <div>{expediente.counts.documents} documento(s)</div>
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        {expediente.counts.pending_review} en revisión · {expediente.counts.exports} exportación(es)
                      </div>
                    </td>
                    <td>
                      {expediente.last_activity_at
                        ? new Date(expediente.last_activity_at).toLocaleString("es-ES")
                        : "Sin actividad"}
                    </td>
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
