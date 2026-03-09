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

// ─── Derived row type ──────────────────────────────────────────────
type PortfolioRow = {
    asset: CanonicalAssetSummary;
    assetClass: string;
    assetClassKey: string;
    applies720: boolean;
    issues: string[];
    declarableValue: number | null;
};

function assetPortfolioClass(asset: CanonicalAssetSummary): { label: string; key: string } {
    switch (asset.asset_type) {
        case "account": case "cash": return { label: "Cuentas", key: "CUE" };
        case "fund": return { label: "IIC", key: "IIC" };
        case "security": return { label: "Valores", key: "VAL" };
        case "insurance": return { label: "Seguros", key: "SEG" };
        case "real_estate": return { label: "Inmuebles", key: "INM" };
        default: return { label: "Otros", key: "OTR" };
    }
}

function assetAppliesTo720(asset: CanonicalAssetSummary): boolean {
    if (asset.foreign_block) return true;
    if (asset.country) return asset.country !== "ES";
    return typeof asset.isin === "string" && asset.isin.trim().toUpperCase().slice(0, 2) !== "ES";
}

function portfolioIssues(asset: CanonicalAssetSummary): string[] {
    if (!assetAppliesTo720(asset)) return [];
    const issues: string[] = [];
    if (resolveCanonicalAssetDeclarableValue(asset) === null) issues.push("Sin valoración");
    if (!asset.country) issues.push("Sin país");
    if (!asset.foreign_block) issues.push("Sin bloque 720");
    if (typeof asset.ownership_pct !== "number" || asset.ownership_pct <= 0) issues.push("Sin titularidad");
    if (asset.foreign_block === "accounts" && typeof asset.q4_avg_balance !== "number") issues.push("Sin saldo Q4");
    return issues;
}

function block720Label(value: CanonicalAssetSummary["foreign_block"]): string {
    switch (value) {
        case "accounts": return "Cuentas";
        case "securities": return "Valores / IIC";
        case "insurance_real_estate": return "Seguros / Inmuebles";
        case "other": return "Otros bienes";
        default: return "No aplica";
    }
}

function holderRoleLabel(value: CanonicalAssetSummary["holder_role"]): string {
    switch (value) {
        case "titular": return "Titular";
        case "conyuge": return "Cónyuge";
        case "cotitular": return "Cotitular";
        case "usufructuario": return "Usufructuario";
        case "nudo_propietario": return "Nudo propietario";
        default: return "Otro";
    }
}

function valuationMethodLabel(value: CanonicalAssetSummary["valuation_method"]): string {
    switch (value) {
        case "market_value": return "Mercado";
        case "cost_basis": return "Coste";
        case "year_end_value": return "Fin ejercicio";
        case "q4_average": return "Media Q4";
        case "manual": return "Manual";
        default: return "Pendiente";
    }
}

function buildPortfolioRows(assets: CanonicalAssetSummary[]): PortfolioRow[] {
    return assets
        .map((asset) => {
            const cls = assetPortfolioClass(asset);
            return {
                asset,
                assetClass: cls.label,
                assetClassKey: cls.key,
                applies720: assetAppliesTo720(asset),
                issues: portfolioIssues(asset),
                declarableValue: resolveCanonicalAssetDeclarableValue(asset),
            };
        })
        .sort((a, b) => {
            if (Number(b.applies720) !== Number(a.applies720)) return Number(b.applies720) - Number(a.applies720);
            return a.asset.label.localeCompare(b.asset.label);
        });
}

// ─── Column definitions ─────────────────────────────────────────────
const columns: ColumnDef<PortfolioRow, unknown>[] = [
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
        cell: ({ row }) => <span className="text-sm">{row.original.assetClass}</span>,
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        id: "country",
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        accessorFn: (row) => row.asset.country ?? "—",
        cell: ({ row }) => (
            <span className={`text-sm font-mono ${row.original.asset.country !== "ES" ? "text-blue-700 font-bold" : ""}`}>
                {row.original.asset.country ?? "—"}
            </span>
        ),
    },
    {
        id: "foreign_block",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Bloque 720" />,
        accessorFn: (row) => block720Label(row.asset.foreign_block),
        cell: ({ row }) => {
            const block = row.original.asset.foreign_block;
            return block ? (
                <Badge variant="default">{block720Label(block)}</Badge>
            ) : (
                <span className="text-xs text-text-secondary">—</span>
            );
        },
    },
    {
        id: "holder_role",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Titular" />,
        accessorFn: (row) => holderRoleLabel(row.asset.holder_role),
    },
    {
        id: "ownership_pct",
        header: ({ column }) => <DataTableColumnHeader column={column} title="% Titularidad" />,
        accessorFn: (row) => row.asset.ownership_pct,
        cell: ({ row }) => (
            <span className="text-sm">{row.original.asset.ownership_pct ?? 100}%</span>
        ),
    },
    {
        id: "valuation_method",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Valoración" />,
        accessorFn: (row) => valuationMethodLabel(row.asset.valuation_method),
    },
    {
        id: "declarable_value",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Valor declarable" />,
        accessorFn: (row) => row.declarableValue,
        cell: ({ row }) => {
            const val = row.original.declarableValue;
            return val !== null ? (
                <span className="text-sm font-medium tabular-nums">{formatCurrency(val)}</span>
            ) : (
                <span className="text-xs text-red-600">Sin valor</span>
            );
        },
    },
    {
        id: "activities",
        header: "Movimientos",
        cell: ({ row }) => {
            const a = row.original.asset;
            const parts: string[] = [];
            if (a.acquisitions > 0) parts.push(`${a.acquisitions} adq.`);
            if (a.transmissions > 0) parts.push(`${a.transmissions} tr.`);
            if (a.dividends > 0) parts.push(`${a.dividends} div.`);
            return <span className="text-xs text-text-secondary">{parts.join(" · ") || "—"}</span>;
        },
    },
    {
        id: "issues",
        header: "Alertas",
        cell: ({ row }) => {
            const issues = row.original.issues;
            return issues.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {issues.map((issue) => (
                        <Badge key={issue} variant="warning">{issue}</Badge>
                    ))}
                </div>
            ) : row.original.applies720 ? (
                <Badge variant="success">✓ OK</Badge>
            ) : null;
        },
    },
];

// ─── Component ──────────────────────────────────────────────────────
interface TabPortfolioProps {
    payload: ClientPayload;
}

export function TabPortfolio({ payload }: TabPortfolioProps) {
    const rows = buildPortfolioRows(payload.client_assets);
    const foreignCount = rows.filter((r) => r.applies720).length;
    const issueCount = rows.filter((r) => r.issues.length > 0).length;
    const foreignTotal = rows
        .filter((r) => r.applies720)
        .reduce((sum, r) => sum + (r.declarableValue ?? 0), 0);

    return (
        <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center gap-4 flex-wrap text-sm">
                <span>{rows.length} activos totales</span>
                <span className="text-blue-700 font-medium">{foreignCount} extranjeros</span>
                {issueCount > 0 && (
                    <Badge variant="warning">{issueCount} con alertas</Badge>
                )}
                <span className="ml-auto font-bold">{formatCurrency(foreignTotal)} valor 720</span>
            </div>

            <DataTable
                columns={columns}
                data={rows}
                searchPlaceholder="Buscar activos..."
                exportFilename={`portfolio_720_${payload.client.reference}`}
                exportSheetName="Portfolio 720"
                emptyMessage="No hay activos canónicos para este cliente."
                pageSize={50}
            />
        </div>
    );
}
