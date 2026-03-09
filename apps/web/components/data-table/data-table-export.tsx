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
        <Button variant="outline" size="sm" onClick={handleExport} className="h-8">
            <Download className="mr-2 h-4 w-4" />
            Exportar XLS
        </Button>
    );
}
