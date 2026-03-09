"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { DashboardPayload, DashboardExpedienteWorkItem, DashboardPortfolioClient } from "@/lib/dashboard";
import { formatDate } from "@/lib/utils";
import { badgeVariant } from "@/lib/client-types";

const emptyPayload: DashboardPayload = {
  queued: 0, processing: 0, manualReview: 0, completed: 0, failed: 0, openAlerts: 0, exports: 0,
  current_user: { reference: "", display_name: "", role: "solo_lectura" },
  summary: { assigned_clients: 0, active_expedientes: 0, document_queue: 0, pending_review: 0, open_alerts: 0, critical_alerts: 0, generated_exports: 0 },
  portfolio_clients: [], expedientes: [], model_overview: [],
};

function recommendation(payload: DashboardPayload): { label: string; href: string; detail: string } {
  if (payload.summary.pending_review > 0) return { label: "Resolver revisiones pendientes", href: "/review", detail: `${payload.summary.pending_review} documentos esperan decisión manual.` };
  if (payload.summary.critical_alerts > 0) return { label: "Atender alertas críticas", href: "/review", detail: `${payload.summary.critical_alerts} alertas de prioridad alta.` };
  if (payload.summary.document_queue > 0) return { label: "Seguir ingesta documental", href: "/review", detail: `${payload.summary.document_queue} documentos en cola.` };
  return { label: "Panel de modelos AEAT", href: "/modelos", detail: "Todo al día. Revisa el estado de los modelos declarativos." };
}

// ─── Client columns ─────────────────────────────────────────────────
const clientColumns: ColumnDef<DashboardPortfolioClient, unknown>[] = [
  { accessorKey: "display_name", header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />, cell: ({ row }) => <Link href={`/clientes/${row.original.id}`} className="font-medium text-brand hover:text-secondary-700 transition-colors">{row.getValue("display_name")}</Link> },
  { accessorKey: "nif", header: "NIF", cell: ({ row }) => <span className="font-mono text-xs">{row.getValue("nif")}</span> },
  { accessorKey: "status", header: "Estado", cell: ({ row }) => <Badge variant={badgeVariant(row.getValue("status") as string)}>{row.getValue("status")}</Badge> },
  { id: "expedientes", header: "Exp.", accessorFn: (row) => row.stats.expedientes },
  { id: "pending", header: "Pend.", accessorFn: (row) => row.stats.pending_review, cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <Badge variant="warning">{v}</Badge> : <span>0</span>; } },
  { id: "alerts", header: "Alertas", accessorFn: (row) => row.stats.open_alerts, cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <Badge variant="destructive">{v}</Badge> : <span>0</span>; } },
  { accessorKey: "last_activity_at", header: ({ column }) => <DataTableColumnHeader column={column} title="Actividad" />, cell: ({ row }) => <span className="text-xs text-text-secondary">{formatDate(row.getValue("last_activity_at"))}</span> },
];

// ─── Expediente columns ─────────────────────────────────────────────
const expColumns: ColumnDef<DashboardExpedienteWorkItem, unknown>[] = [
  { accessorKey: "reference", header: ({ column }) => <DataTableColumnHeader column={column} title="Ref." />, cell: ({ row }) => <Link href={`/expedientes/${row.original.reference}`} className="font-mono text-xs text-brand">{row.getValue("reference")}</Link> },
  { accessorKey: "title", header: ({ column }) => <DataTableColumnHeader column={column} title="Título" /> },
  { id: "client", header: "Cliente", accessorFn: (row) => row.client?.display_name ?? "—" },
  { accessorKey: "fiscal_year", header: ({ column }) => <DataTableColumnHeader column={column} title="Año" /> },
  { accessorKey: "model_type", header: "Modelo" },
  { accessorKey: "status", header: "Estado", cell: ({ row }) => <Badge variant={badgeVariant(row.getValue("status") as string)}>{row.getValue("status")}</Badge> },
  { id: "pending", header: "Pend.", accessorFn: (row) => row.counts.pending_review, cell: ({ getValue }) => { const v = getValue() as number; return v > 0 ? <Badge variant="warning">{v}</Badge> : <span>0</span>; } },
  { accessorKey: "last_activity_at", header: ({ column }) => <DataTableColumnHeader column={column} title="Actividad" />, cell: ({ row }) => <span className="text-xs text-text-secondary">{formatDate(row.getValue("last_activity_at"))}</span> },
];

export function DashboardWorkspace() {
  const [payload, setPayload] = useState<DashboardPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando dashboard");
        if (mounted) setPayload(data);
      } catch { /* empty */ } finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  const rec = recommendation(payload);
  const s = payload.summary;

  return (
    <div className="page">
      <section className="card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">Dashboard</span>
            <h2 className="text-xl font-bold mt-1">Plataforma Fiscal Patrimonial</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              {payload.current_user.display_name || "Fiscalista"} · {payload.current_user.role}
            </p>
          </div>
        </div>

        <div className="kpi-grid mt-4">
          <article className="kpi"><span>Clientes</span><strong>{s.assigned_clients}</strong></article>
          <article className="kpi"><span>Expedientes</span><strong>{s.active_expedientes}</strong></article>
          <article className="kpi"><span>Cola docs</span><strong>{s.document_queue}</strong></article>
          <article className="kpi"><span>Revisión</span><strong>{s.pending_review}</strong></article>
          <article className="kpi"><span>Alertas</span><strong>{s.open_alerts}</strong></article>
          <article className="kpi"><span>Exportes</span><strong>{s.generated_exports}</strong></article>
        </div>

        {/* Next step CTA */}
        <div className="mt-4 p-3 rounded-md border border-border-default bg-surface-alt">
          <p className="text-xs font-medium uppercase tracking-wider text-text-secondary mb-1">Siguiente paso</p>
          <p className="text-sm font-medium">{rec.label}</p>
          <p className="text-xs text-text-secondary mt-0.5">{rec.detail}</p>
          <Link href={rec.href} className="button-link text-sm mt-2 inline-block">{rec.label}</Link>
        </div>
      </section>

      <section className="card mt-4">
        <Tabs defaultValue="clientes">
          <TabsList>
            <TabsTrigger value="clientes">Mis clientes</TabsTrigger>
            <TabsTrigger value="expedientes">Expedientes activos</TabsTrigger>
          </TabsList>

          <TabsContent value="clientes">
            <DataTable
              columns={clientColumns}
              data={payload.portfolio_clients}
              searchPlaceholder="Buscar clientes..."
              exportFilename="dashboard_clientes"
              exportSheetName="Clientes"
              isLoading={loading}
              emptyMessage="No hay clientes asignados."
              onRowClick={(client) => { window.location.href = `/clientes/${client.id}`; }}
            />
          </TabsContent>

          <TabsContent value="expedientes">
            <DataTable
              columns={expColumns}
              data={payload.expedientes}
              searchPlaceholder="Buscar expedientes..."
              exportFilename="dashboard_expedientes"
              exportSheetName="Expedientes"
              isLoading={loading}
              emptyMessage="No hay expedientes activos."
              onRowClick={(exp) => { window.location.href = `/expedientes/${exp.reference}`; }}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
