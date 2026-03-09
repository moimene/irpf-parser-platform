"use client";

import { Table } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToExcel, type ExportColumn } from "@/lib/export-to-excel";

interface DataTableExportProps<TData> {
    table: Table<TData>;
    filename?: string;
    sheetName?: string;
    columns?: ExportColumn[];
}

export function DataTableExport<TData>({
    table,
    filename = "export",
    sheetName = "Datos",
    columns,
}: DataTableExportProps<TData>) {
    const handleExport = () => {
        void exportToExcel(table, { filename, sheetName, columns });
    };

    return (
        <Button variant="ghost" size="sm" onClick={handleExport} className="h-7 px-2 text-xs text-text-secondary hover:text-text-primary">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Exportar XLS
        </Button>
    );
}
