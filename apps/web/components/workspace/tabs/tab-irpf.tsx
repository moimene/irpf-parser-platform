"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { type ClientPayload } from "@/lib/client-types";
import { type CanonicalFiscalEvent } from "@/lib/fiscal-canonical";
import { formatCurrency, formatDate } from "@/lib/utils";

function eventKindLabel(kind: CanonicalFiscalEvent["event_kind"]): string {
    switch (kind) {
        case "dividendo": return "Dividendo";
        case "interes": return "Interés";
        case "adquisicion": return "Adquisición";
        case "transmision": return "Transmisión";
        case "retencion": return "Retención";
        case "ganancia_perdida": return "Ganancia/Pérdida";
        case "posicion": return "Posición";
        default: return kind;
    }
}

function statusVariant(status: CanonicalFiscalEvent["status"]): "success" | "warning" | "destructive" | "default" {
    switch (status) {
        case "RECORDED": case "MATCHED": return "success";
        case "PENDING_COST_BASIS": case "UNRESOLVED": return "warning";
        case "INVALID_DATA": return "destructive";
        default: return "default";
    }
}

const columns: ColumnDef<CanonicalFiscalEvent, unknown>[] = [
    {
        accessorKey: "operation_date",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => (
            <span className="text-sm tabular-nums">{formatDate(row.getValue("operation_date"))}</span>
        ),
    },
    {
        accessorKey: "event_kind",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Tipo" />,
        cell: ({ row }) => (
            <Badge variant="default">{eventKindLabel(row.getValue("event_kind"))}</Badge>
        ),
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        accessorKey: "asset_label",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Activo" />,
        cell: ({ row }) => (
            <div>
                <span className="font-medium text-sm">{row.original.asset_label}</span>
                {row.original.isin && (
                    <span className="text-xs text-text-secondary ml-2 font-mono">{row.original.isin}</span>
                )}
            </div>
        ),
    },
    {
        accessorKey: "operation_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Operación" />,
        cell: ({ row }) => <span className="text-xs font-mono">{row.getValue("operation_type")}</span>,
    },
    {
        accessorKey: "amount",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Importe" />,
        cell: ({ row }) => {
            const amount = row.getValue("amount") as number | null;
            return amount !== null ? (
                <span className="text-sm tabular-nums">{formatCurrency(amount, row.original.currency ?? "EUR")}</span>
            ) : <span className="text-text-secondary">—</span>;
        },
    },
    {
        accessorKey: "quantity",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Uds." />,
        cell: ({ row }) => {
            const qty = row.getValue("quantity") as number | null;
            return <span className="text-sm tabular-nums">{qty !== null ? qty.toLocaleString("es-ES") : "—"}</span>;
        },
    },
    {
        accessorKey: "retention",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Retención" />,
        cell: ({ row }) => {
            const ret = row.getValue("retention") as number | null;
            return ret !== null ? (
                <span className="text-sm tabular-nums text-red-600">{formatCurrency(ret)}</span>
            ) : <span className="text-text-secondary">—</span>;
        },
    },
    {
        accessorKey: "realized_gain",
        header: ({ column }) => <DataTableColumnHeader column={column} title="G/P" />,
        cell: ({ row }) => {
            const gain = row.getValue("realized_gain") as number | null;
            if (gain === null) return <span className="text-text-secondary">—</span>;
            const color = gain >= 0 ? "text-green-700" : "text-red-600";
            return <span className={`text-sm tabular-nums font-medium ${color}`}>{formatCurrency(gain)}</span>;
        },
    },
    {
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => {
            const status = row.getValue("status") as CanonicalFiscalEvent["status"];
            return <Badge variant={statusVariant(status)}>{status}</Badge>;
        },
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        id: "expediente",
        header: "Expediente",
        accessorFn: (row) => row.expediente_reference,
        cell: ({ row }) => (
            <span className="text-xs text-text-secondary">{row.original.expediente_reference ?? "—"}</span>
        ),
    },
];

interface TabIrpfProps {
    payload: ClientPayload;
}

export function TabIrpf({ payload }: TabIrpfProps) {
    const events = payload.client_fiscal_events;
    const irpfEvents = events.filter((e) =>
        ["dividendo", "interes", "transmision", "ganancia_perdida", "retencion"].includes(e.event_kind)
    );

    // Summary calculations
    const totalDividends = irpfEvents
        .filter((e) => e.event_kind === "dividendo")
        .reduce((sum, e) => sum + (e.amount ?? 0), 0);
    const totalGains = irpfEvents
        .filter((e) => e.event_kind === "ganancia_perdida")
        .reduce((sum, e) => sum + (e.realized_gain ?? 0), 0);
    const totalRetentions = irpfEvents
        .filter((e) => e.event_kind === "retencion")
        .reduce((sum, e) => sum + (e.amount ?? 0), 0);

    return (
        <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-6 flex-wrap text-sm">
                <span>{irpfEvents.length} eventos IRPF</span>
                <span>Dividendos: <strong>{formatCurrency(totalDividends)}</strong></span>
                <span className={totalGains >= 0 ? "text-green-700" : "text-red-600"}>
                    G/P: <strong>{formatCurrency(totalGains)}</strong>
                </span>
                <span className="text-red-600">Retenciones: <strong>{formatCurrency(totalRetentions)}</strong></span>
            </div>

            <DataTable
                columns={columns}
                data={irpfEvents.sort((a, b) => new Date(b.operation_date).getTime() - new Date(a.operation_date).getTime())}
                searchPlaceholder="Buscar operaciones..."
                exportFilename={`irpf_${payload.client.reference}`}
                exportSheetName="Operaciones IRPF"
                emptyMessage="No hay eventos fiscales IRPF para este cliente."
                pageSize={50}
            />
        </div>
    );
}
