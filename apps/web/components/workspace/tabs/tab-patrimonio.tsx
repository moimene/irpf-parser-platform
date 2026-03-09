"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { type ClientPayload } from "@/lib/client-types";
import {
    type CanonicalAssetSummary,
    resolveCanonicalAssetDeclarableValue,
} from "@/lib/fiscal-canonical";
import { formatCurrency } from "@/lib/utils";

type PatrimonioRow = {
    asset: CanonicalAssetSummary;
    assetClass: string;
    yearEndValue: number | null;
};

function assetClassLabel(type: CanonicalAssetSummary["asset_type"]): string {
    switch (type) {
        case "account": case "cash": return "Cuentas";
        case "fund": return "IIC";
        case "security": return "Valores";
        case "insurance": return "Seguros";
        case "real_estate": return "Inmuebles";
        default: return "Otros";
    }
}

function buildPatrimonioRows(assets: CanonicalAssetSummary[]): PatrimonioRow[] {
    return assets.map((asset) => ({
        asset,
        assetClass: assetClassLabel(asset.asset_type),
        yearEndValue: resolveCanonicalAssetDeclarableValue(asset),
    })).sort((a, b) => (b.yearEndValue ?? 0) - (a.yearEndValue ?? 0));
}

const columns: ColumnDef<PatrimonioRow, unknown>[] = [
    {
        id: "label",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Activo" />,
        accessorFn: (row) => row.asset.label,
        cell: ({ row }) => (
            <div>
                <span className="font-medium text-sm">{row.original.asset.label}</span>
                {row.original.asset.isin && (
                    <span className="text-xs text-text-secondary ml-2 font-mono">{row.original.asset.isin}</span>
                )}
            </div>
        ),
    },
    {
        id: "assetClass",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Clase" />,
        accessorFn: (row) => row.assetClass,
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        id: "country",
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        accessorFn: (row) => row.asset.country ?? "—",
    },
    {
        id: "holder_role",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Titularidad" />,
        accessorFn: (row) => {
            switch (row.asset.holder_role) {
                case "titular": return "Titular";
                case "conyuge": return "Cónyuge";
                case "cotitular": return "Cotitular";
                default: return row.asset.holder_role;
            }
        },
    },
    {
        id: "ownership_pct",
        header: ({ column }) => <DataTableColumnHeader column={column} title="%" />,
        accessorFn: (row) => row.asset.ownership_pct,
        cell: ({ row }) => (
            <span className="tabular-nums">{row.original.asset.ownership_pct ?? 100}%</span>
        ),
    },
    {
        id: "year_end_value",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Valor cierre" />,
        accessorFn: (row) => row.yearEndValue,
        cell: ({ row }) => {
            const val = row.original.yearEndValue;
            return val !== null ? (
                <span className="font-medium tabular-nums">{formatCurrency(val)}</span>
            ) : (
                <span className="text-xs text-red-600">Pendiente</span>
            );
        },
    },
    {
        id: "q4_balance",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Saldo Q4" />,
        accessorFn: (row) => row.asset.q4_avg_balance,
        cell: ({ row }) => {
            const val = row.original.asset.q4_avg_balance;
            return val !== null ? (
                <span className="tabular-nums text-sm">{formatCurrency(val)}</span>
            ) : <span className="text-text-secondary">—</span>;
        },
    },
    {
        id: "open_cost",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Coste" />,
        accessorFn: (row) => row.asset.open_cost_basis,
        cell: ({ row }) => {
            const val = row.original.asset.open_cost_basis;
            return val !== null ? (
                <span className="tabular-nums text-sm">{formatCurrency(val)}</span>
            ) : <span className="text-text-secondary">—</span>;
        },
    },
    {
        id: "lots",
        header: "Lotes",
        cell: ({ row }) => {
            const a = row.original.asset;
            return (
                <span className="text-xs text-text-secondary">
                    {a.open_lots} abiertos · {a.closed_lots} cerrados
                </span>
            );
        },
    },
];

interface TabPatrimonioProps {
    payload: ClientPayload;
}

export function TabPatrimonio({ payload }: TabPatrimonioProps) {
    const rows = buildPatrimonioRows(payload.client_assets);
    const totalValue = rows.reduce((sum, r) => sum + (r.yearEndValue ?? 0), 0);
    const pendingCount = rows.filter((r) => r.yearEndValue === null).length;

    // Group by class for summary
    const byClass = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.assetClass] = (acc[r.assetClass] ?? 0) + (r.yearEndValue ?? 0);
        return acc;
    }, {});

    return (
        <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-4 flex-wrap text-sm">
                <span>{rows.length} activos</span>
                <span className="font-bold">Total: {formatCurrency(totalValue)}</span>
                {pendingCount > 0 && <Badge variant="warning">{pendingCount} sin valorar</Badge>}
                <span className="ml-auto text-xs text-text-secondary">
                    {Object.entries(byClass).map(([cls, val]) => `${cls}: ${formatCurrency(val)}`).join(" · ")}
                </span>
            </div>

            <DataTable
                columns={columns}
                data={rows}
                searchPlaceholder="Buscar patrimonio..."
                exportFilename={`patrimonio_IP_${payload.client.reference}`}
                exportSheetName="Patrimonio IP"
                emptyMessage="No hay activos patrimoniales."
                pageSize={50}
            />
        </div>
    );
}
