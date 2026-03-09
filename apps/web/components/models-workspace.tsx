"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  emptyModelWorkspacePayload,
  type ModelWorkspacePayload,
  type ModelWorkspaceItem,
} from "@/lib/model-workspace";
import type { PreparationStatus } from "@/lib/model-preparation";
import { formatDate, formatCurrency } from "@/lib/utils";
import { badgeVariant } from "@/lib/client-types";

function prepStatusVariant(status: PreparationStatus): "success" | "warning" | "destructive" | "default" {
  if (status === "ready") return "success";
  if (status === "attention") return "warning";
  if (status === "blocked") return "destructive";
  return "default";
}

function prepStatusLabel(status: PreparationStatus): string {
  if (status === "ready") return "Listo";
  if (status === "attention") return "Atención";
  if (status === "blocked") return "Bloqueado";
  return status;
}

const workItemColumns: ColumnDef<ModelWorkspaceItem, unknown>[] = [
  {
    accessorKey: "reference",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Ref." />,
    cell: ({ row }) => (
      <Link href={`/expedientes/${row.original.reference}`} className="font-mono text-xs text-brand">
        {row.getValue("reference")}
      </Link>
    ),
  },
  {
    id: "client",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Cliente" />,
    accessorFn: (row) => row.client?.display_name ?? "—",
    cell: ({ row }) => row.original.client ? (
      <Link href={`/clientes/${row.original.client.id}`} className="text-sm text-brand">
        {row.original.client.display_name}
      </Link>
    ) : <span className="text-text-secondary">—</span>,
  },
  {
    accessorKey: "fiscal_year",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Año" />,
    cell: ({ row }) => <span className="font-bold">{row.getValue("fiscal_year")}</span>,
  },
  {
    accessorKey: "export_model",
    header: "Modelo",
    cell: ({ row }) => {
      const m = row.getValue("export_model") as string;
      return <span className="text-sm">Mod. {m}</span>;
    },
  },
  {
    id: "prep_status",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Preparación" />,
    accessorFn: (row) => row.preparation.status,
    cell: ({ row }) => (
      <Badge variant={prepStatusVariant(row.original.preparation.status)}>
        {prepStatusLabel(row.original.preparation.status)}
      </Badge>
    ),
    filterFn: (row, id, value) => value.includes(row.getValue(id)),
  },
  {
    id: "pending",
    header: "Pendientes",
    accessorFn: (row) => row.counts.pending_review,
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v > 0 ? <Badge variant="warning">{v}</Badge> : <span>0</span>;
    },
  },
  {
    id: "assets",
    header: "Activos",
    accessorFn: (row) => row.counts.assets,
  },
  {
    id: "exports",
    header: "Exportes",
    accessorFn: (row) => row.counts.exports,
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v > 0 ? <Badge variant="success">{v}</Badge> : <span>0</span>;
    },
  },
  {
    id: "latest_export",
    header: "Último export",
    cell: ({ row }) => {
      const exp = row.original.latest_export;
      if (!exp) return <span className="text-text-secondary text-xs">—</span>;
      return (
        <div>
          <Badge variant={badgeVariant(exp.validation_state)}>{exp.validation_state}</Badge>
          <span className="text-xs text-text-secondary ml-1">{formatDate(exp.generated_at)}</span>
        </div>
      );
    },
  },
  {
    id: "action",
    header: "Acción",
    cell: ({ row }) => (
      <Link href={row.original.next_action.href} className="button-link text-xs">
        {row.original.next_action.label}
      </Link>
    ),
  },
];

export function ModelsWorkspace() {
  const [payload, setPayload] = useState<ModelWorkspacePayload>(emptyModelWorkspacePayload);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/modelos", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Error cargando modelos");
        if (mounted) setPayload(data);
      } catch { /* empty */ } finally { if (mounted) setLoading(false); }
    }
    void load();
    return () => { mounted = false; };
  }, []);

  const s = payload.summary;

  return (
    <div className="page">
      <section className="card">
        <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">Modelos AEAT</span>
        <h2 className="text-xl font-bold mt-1">Panel de preparación declarativa</h2>
        <p className="text-sm text-text-secondary mt-0.5">
          Estado consolidado de todos los expedientes en preparación para modelos 100, 714 y 720.
        </p>

        <div className="kpi-grid mt-4">
          <article className="kpi"><span>Expedientes</span><strong>{s.expedientes}</strong></article>
          <article className="kpi"><span>Listos</span><strong className="text-green-700">{s.ready}</strong></article>
          <article className="kpi"><span>Atención</span><strong className="text-yellow-700">{s.attention}</strong></article>
          <article className="kpi"><span>Bloqueados</span><strong className="text-red-600">{s.blocked}</strong></article>
          <article className="kpi"><span>Exportes</span><strong>{s.exports}</strong></article>
        </div>

        {/* Model type overview boxes */}
        {payload.overview.length > 0 && (
          <div className="flex gap-3 mt-4 flex-wrap">
            {payload.overview.map((ov) => (
              <div key={ov.model_type} className="p-3 rounded-md border border-border-default bg-surface-alt min-w-[150px]">
                <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Mod. {ov.export_model}</p>
                <p className="text-lg font-bold mt-1">{ov.expedientes} exp.</p>
                <p className="text-xs text-text-secondary">
                  {ov.ready} listos · {ov.attention} atención · {ov.blocked} bloqueados
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-4">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">Todos</TabsTrigger>
            <TabsTrigger value="IRPF">IRPF (100)</TabsTrigger>
            <TabsTrigger value="IP">IP (714)</TabsTrigger>
            <TabsTrigger value="720">720</TabsTrigger>
          </TabsList>

          {["all", "IRPF", "IP", "720"].map((tab) => (
            <TabsContent key={tab} value={tab}>
              <DataTable
                columns={workItemColumns}
                data={tab === "all" ? payload.work_items : payload.work_items.filter((i) => i.model_type === tab)}
                searchPlaceholder={`Buscar modelos${tab !== "all" ? ` ${tab}` : ""}...`}
                exportFilename={`modelos_${tab}`}
                exportSheetName={`Modelos ${tab}`}
                isLoading={loading}
                emptyMessage={`No hay expedientes${tab !== "all" ? ` de tipo ${tab}` : ""}.`}
                onRowClick={(item) => { window.location.href = `/expedientes/${item.reference}`; }}
                pageSize={50}
              />
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </div>
  );
}
