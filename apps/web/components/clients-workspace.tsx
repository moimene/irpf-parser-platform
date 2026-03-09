"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

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

const statusVariants: Record<ClientSummary["status"], "success" | "warning" | "default"> = {
  active: "success",
  inactive: "warning",
  archived: "default",
};

const statusLabels: Record<ClientSummary["status"], string> = {
  active: "Activo",
  inactive: "Inactivo",
  archived: "Archivado",
};

const columns: ColumnDef<ClientSummary, unknown>[] = [
  {
    accessorKey: "reference",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Referencia" />
    ),
    cell: ({ row }) => (
      <span className="font-medium text-xs text-text-secondary">{row.getValue("reference")}</span>
    ),
  },
  {
    accessorKey: "display_name",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Nombre" />
    ),
    cell: ({ row }) => (
      <div>
        <Link
          href={`/clientes/${row.original.reference}`}
          className="font-bold text-brand hover:text-secondary-700 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {row.getValue("display_name")}
        </Link>
        {row.original.contact_person && (
          <div className="text-xs text-text-secondary mt-0.5">
            {row.original.contact_person}
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: "nif",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="NIF" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.getValue("nif")}</span>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Estado" />
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as ClientSummary["status"];
      return (
        <Badge variant={statusVariants[status]}>
          {statusLabels[status]}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    id: "expedientes",
    accessorFn: (row) => row.stats.expedientes,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Expedientes" />
    ),
    cell: ({ row }) => {
      const client = row.original;
      return (
        <div>
          <span className="font-bold">{client.stats.expedientes}</span>
          {client.models.length > 0 && (
            <div className="text-xs text-text-secondary mt-0.5">
              {client.models.join(", ")}
            </div>
          )}
        </div>
      );
    },
  },
  {
    id: "documents",
    accessorFn: (row) => row.stats.documents,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Documentos" />
    ),
    cell: ({ row }) => (
      <span>{row.original.stats.documents}</span>
    ),
  },
  {
    id: "pending_review",
    accessorFn: (row) => row.stats.pending_review,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Pendientes" />
    ),
    cell: ({ row }) => {
      const pending = row.original.stats.pending_review;
      return pending > 0 ? (
        <Badge variant="warning">{pending}</Badge>
      ) : (
        <span className="text-text-secondary">0</span>
      );
    },
  },
  {
    accessorKey: "last_activity_at",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Última actividad" />
    ),
    cell: ({ row }) => (
      <span className="text-sm text-text-secondary">
        {formatDate(row.getValue("last_activity_at"))}
      </span>
    ),
  },
];

export function ClientsWorkspace() {
  const router = useRouter();
  const [payload, setPayload] = useState<ClientsPayload>(emptyPayload);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [reference, setReference] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [notes, setNotes] = useState("");
  const canCreateClient = payload.current_user?.role === "admin";
  const showReadOnlyNotice = Boolean(payload.current_user) && !canCreateClient;
  const portfolioSummary = {
    clients: payload.clients.length,
    expedientes: payload.clients.reduce((sum, client) => sum + client.stats.expedientes, 0),
    pendingReview: payload.clients.reduce((sum, client) => sum + client.stats.pending_review, 0),
    exports: payload.clients.reduce((sum, client) => sum + client.stats.exports, 0)
  };

  useEffect(() => {
    async function load() {
      try {
        setIsLoading(true);
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
      } finally {
        setIsLoading(false);
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
        <div className="section-header">
          <div>
            <h2>Cartera de clientes</h2>
            <p className="muted">
              Vista operativa del despacho para entrar a cada cliente y desde ahi recorrer expedientes por
              ejercicio.
            </p>
          </div>
        </div>
        <div className="kpi-grid">
          <article className="kpi">
            <span>Clientes visibles</span>
            <strong>{portfolioSummary.clients}</strong>
          </article>
          <article className="kpi">
            <span>Expedientes</span>
            <strong>{portfolioSummary.expedientes}</strong>
          </article>
          <article className="kpi">
            <span>En revision</span>
            <strong>{portfolioSummary.pendingReview}</strong>
          </article>
          <article className="kpi">
            <span>Exportaciones</span>
            <strong>{portfolioSummary.exports}</strong>
          </article>
        </div>
      </section>

      <section className="card">
        <h2>Base de clientes del despacho</h2>
        <DataTable
          columns={columns}
          data={payload.clients}
          searchPlaceholder="Buscar por nombre, NIF o referencia..."
          exportFilename="clientes"
          exportSheetName="Clientes"
          isLoading={isLoading}
          emptyMessage="Todavia no hay clientes dados de alta."
          onRowClick={(client) => router.push(`/clientes/${client.reference}`)}
          pageSize={25}
        />
      </section>

      <section className="card">
        <h2>Alta de cliente</h2>
        <p className="muted">
          Accion administrativa para crear nuevas fichas. La navegacion principal del modulo sigue siendo la
          cartera ya asignada.
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
    </>
  );
}
