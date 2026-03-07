"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ClientSummary = {
  id: string;
  reference: string;
  display_name: string;
  nif: string;
  email: string | null;
  status: "active" | "inactive" | "archived";
  contact_person: string | null;
  notes: string | null;
  stats: {
    expedientes: number;
    documents: number;
    pending_review: number;
    exports: number;
  };
  models: string[];
  last_activity_at: string | null;
  created_at: string;
};

type ClientsPayload = {
  current_user?: {
    reference: string;
    display_name: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  clients: ClientSummary[];
};

type CreateClientResponse = {
  client: {
    id: string;
    reference: string;
  };
};

const emptyPayload: ClientsPayload = {
  clients: []
};

function badgeClass(value: ClientSummary["status"]): string {
  if (value === "active") return "badge success";
  if (value === "inactive") return "badge warning";
  return "badge";
}

export function ClientsWorkspace() {
  const router = useRouter();
  const [payload, setPayload] = useState<ClientsPayload>(emptyPayload);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [reference, setReference] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [notes, setNotes] = useState("");
  const canCreateClient = payload.current_user?.role === "admin";
  const showReadOnlyNotice = Boolean(payload.current_user) && !canCreateClient;

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/clientes", { cache: "no-store" });
        const body = (await response.json()) as ClientsPayload | { error: string };
        if (!response.ok) {
          setError((body as { error: string }).error ?? "No se pudo cargar clientes");
          return;
        }

        setPayload(body as ClientsPayload);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar clientes");
      }
    }

    void load();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/clientes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reference: reference.trim() || undefined,
          display_name: displayName.trim(),
          nif: nif.trim().toUpperCase(),
          email: email.trim() || undefined,
          contact_person: contactPerson.trim() || undefined,
          notes: notes.trim() || undefined
        })
      });

      const body = (await response.json()) as CreateClientResponse | { error: string };
      if (!response.ok) {
        setError((body as { error: string }).error ?? "No se pudo crear el cliente");
        return;
      }

      const created = body as CreateClientResponse;
      router.push(`/clientes/${created.client.reference}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo crear el cliente");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Alta de cliente</h2>
        <p className="muted">
          Crea la ficha operativa del cliente y deja preparada la relación con sus expedientes de IRPF,
          Patrimonio y 720.
        </p>
        {showReadOnlyNotice ? (
          <p className="badge warning" style={{ marginBottom: "12px" }}>
            Solo el perfil administrador puede dar de alta nuevos clientes.
          </p>
        ) : null}
        <form className="form" onSubmit={handleSubmit}>
          <label htmlFor="client-display-name">Nombre del cliente</label>
          <input
            id="client-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Ej: Francisco Arango / FAGU"
            required
            disabled={submitting || !canCreateClient}
          />

          <label htmlFor="client-reference">Referencia interna (opcional)</label>
          <input
            id="client-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Ej: fagu"
            disabled={submitting || !canCreateClient}
          />

          <label htmlFor="client-nif">NIF</label>
          <input
            id="client-nif"
            value={nif}
            onChange={(event) => setNif(event.target.value)}
            placeholder="Ej: 12345678A"
            required
            disabled={submitting || !canCreateClient}
          />

          <label htmlFor="client-email">Email</label>
          <input
            id="client-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="cliente@despacho.com"
            disabled={submitting || !canCreateClient}
          />

          <label htmlFor="client-contact-person">Persona de contacto</label>
          <input
            id="client-contact-person"
            value={contactPerson}
            onChange={(event) => setContactPerson(event.target.value)}
            placeholder="Ej: Francisco Arango"
            disabled={submitting || !canCreateClient}
          />

          <label htmlFor="client-notes">Notas operativas</label>
          <textarea
            id="client-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Observaciones relevantes para campaña, documentación o revisión fiscal."
            disabled={submitting || !canCreateClient}
          />

          <button type="submit" disabled={submitting || !canCreateClient}>
            {submitting ? "Creando cliente..." : "Crear cliente"}
          </button>
        </form>

        {error ? <p className="badge danger" style={{ marginTop: "12px" }}>{error}</p> : null}
      </section>

      <section className="card">
        <h2>Base de clientes del despacho</h2>
        {payload.clients.length === 0 ? (
          <p className="muted">Todavía no hay clientes dados de alta en el runtime `irpf_*`.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th>Expedientes</th>
                  <th>Operativa</th>
                  <th>Última actividad</th>
                </tr>
              </thead>
              <tbody>
                {payload.clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <Link href={`/clientes/${client.reference}`}>
                        <strong>{client.display_name}</strong>
                      </Link>
                      <br />
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        {client.reference} · {client.nif}
                      </span>
                      {client.contact_person ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Contacto: {client.contact_person}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={badgeClass(client.status)}>{client.status}</span>
                    </td>
                    <td>
                      <strong>{client.stats.expedientes}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        Modelos: {client.models.length > 0 ? client.models.join(", ") : "sin actividad"}
                      </div>
                    </td>
                    <td>
                      <div>{client.stats.documents} documento(s)</div>
                      <div className="muted" style={{ fontSize: "0.75rem" }}>
                        {client.stats.pending_review} en revisión · {client.stats.exports} exportación(es)
                      </div>
                    </td>
                    <td>
                      {client.last_activity_at
                        ? new Date(client.last_activity_at).toLocaleString("es-ES")
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
