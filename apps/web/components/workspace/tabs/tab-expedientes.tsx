"use client";

import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { type ClientPayload, resolveExpedientePhase, badgeVariant } from "@/lib/client-types";
import { formatDate } from "@/lib/utils";

type Expediente = ClientPayload["expedientes"][number];

const columns: ColumnDef<Expediente, unknown>[] = [
    {
        accessorKey: "fiscal_year",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ejercicio" />,
        cell: ({ row }) => <span className="font-bold">{row.getValue("fiscal_year")}</span>,
    },
    {
        accessorKey: "model_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Modelo" />,
        cell: ({ row }) => {
            const model = row.getValue("model_type") as string;
            const labels: Record<string, string> = {
                IRPF: "Mod. 100",
                IP: "Mod. 714",
                "720": "Mod. 720",
            };
            return <span className="text-sm">{labels[model] ?? model}</span>;
        },
    },
    {
        accessorKey: "title",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Título" />,
        cell: ({ row }) => (
            <Link
                href={`/expedientes/${row.original.reference}`}
                className="font-medium text-brand hover:text-secondary-700 transition-colors"
                onClick={(e) => e.stopPropagation()}
            >
                {row.getValue("title") || row.original.reference}
            </Link>
        ),
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => {
            const status = row.getValue("status") as string;
            return <Badge variant={badgeVariant(status)}>{status}</Badge>;
        },
    },
    {
        id: "fase",
        header: "Fase actual",
        cell: ({ row }) => {
            const step = resolveExpedientePhase(row.original);
            return (
                <span className="text-xs text-text-secondary">{step.label}</span>
            );
        },
    },
    {
        id: "documents",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Docs" />,
        accessorFn: (row) => row.counts.documents,
        cell: ({ row }) => <span>{row.original.counts.documents}</span>,
    },
    {
        id: "pending_review",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Pendientes" />,
        accessorFn: (row) => row.counts.pending_review,
        cell: ({ row }) => {
            const pending = row.original.counts.pending_review;
            return pending > 0 ? (
                <Badge variant="warning">{pending}</Badge>
            ) : (
                <span className="text-text-secondary">0</span>
            );
        },
    },
    {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Creado" />,
        cell: ({ row }) => (
            <span className="text-xs text-text-secondary">{formatDate(row.getValue("created_at"))}</span>
        ),
    },
];

interface TabExpedientesProps {
    payload: ClientPayload;
}

export function TabExpedientes({ payload }: TabExpedientesProps) {
    const sorted = [...payload.expedientes].sort((a, b) => {
        if (b.fiscal_year !== a.fiscal_year) return b.fiscal_year - a.fiscal_year;
        return b.counts.pending_review - a.counts.pending_review;
    });

    return (
        <DataTable
            columns={columns}
            data={sorted}
            searchPlaceholder="Buscar expedientes..."
            exportFilename="expedientes"
            exportSheetName="Expedientes"
            emptyMessage="Todavía no hay expedientes para este cliente."
            onRowClick={(exp) => {
                window.location.href = `/expedientes/${exp.reference}`;
            }}
            pageSize={25}
        />
    );
}
