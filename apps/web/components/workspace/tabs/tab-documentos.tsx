"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { type ClientPayload, badgeVariant } from "@/lib/client-types";
import { formatDate } from "@/lib/utils";

type ClientDocument = ClientPayload["client_documents"][number];

function reviewStatusLabel(value: string | null): string {
    if (value === "validated") return "Validada";
    if (value === "pending") return "Pendiente";
    if (value === "rejected") return "Rechazada";
    if (value === "not_required") return "No requerida";
    return "Sin extracción";
}

const columns: ColumnDef<ClientDocument, unknown>[] = [
    {
        accessorKey: "filename",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Documento" />,
        cell: ({ row }) => (
            <span className="font-medium text-sm">{row.getValue("filename")}</span>
        ),
    },
    {
        accessorKey: "expediente_reference",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expediente" />,
        cell: ({ row }) => (
            <span className="text-xs font-mono">{row.getValue("expediente_reference")}</span>
        ),
    },
    {
        accessorKey: "processing_status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado parseo" />,
        cell: ({ row }) => {
            const status = row.getValue("processing_status") as string;
            return <Badge variant={badgeVariant(status)}>{status}</Badge>;
        },
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        id: "review_status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Revisión" />,
        accessorFn: (row) => row.extraction?.review_status ?? null,
        cell: ({ row }) => {
            const status = row.original.extraction?.review_status ?? null;
            return (
                <span className="text-xs text-text-secondary">
                    {reviewStatusLabel(status)}
                </span>
            );
        },
    },
    {
        id: "records_count",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Records" />,
        accessorFn: (row) => row.extraction?.records_count ?? 0,
        cell: ({ row }) => (
            <span>{row.original.extraction?.records_count ?? "—"}</span>
        ),
    },
    {
        accessorKey: "confidence",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Confianza" />,
        cell: ({ row }) => {
            const confidence = row.getValue("confidence") as number;
            return (
                <span className={`text-sm ${confidence < 0.7 ? "text-red-600" : "text-text-secondary"}`}>
                    {(confidence * 100).toFixed(0)}%
                </span>
            );
        },
    },
    {
        accessorKey: "uploaded_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Subido" />,
        cell: ({ row }) => (
            <span className="text-xs text-text-secondary">
                {formatDate(row.getValue("uploaded_at"))}
            </span>
        ),
    },
];

interface TabDocumentosProps {
    payload: ClientPayload;
}

export function TabDocumentos({ payload }: TabDocumentosProps) {
    return (
        <DataTable
            columns={columns}
            data={payload.client_documents}
            searchPlaceholder="Buscar documentos..."
            exportFilename={`docs_${payload.client.reference}`}
            exportSheetName="Documentos"
            emptyMessage="Todavía no hay documentos para este cliente."
            pageSize={25}
        />
    );
}
