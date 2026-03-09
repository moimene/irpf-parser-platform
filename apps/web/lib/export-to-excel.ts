"use client";

import type { Table } from "@tanstack/react-table";

/**
 * Professional Excel export utility powered by ExcelJS.
 *
 * Features:
 * - Brand-colored headers (#004438 text inverse)
 * - EUR currency format (#,##0.00 €)
 * - Percentage format (0.00%)
 * - Thin borders on all cells
 * - Auto-width columns
 * - Frozen header row
 *
 * Lazy-loads ExcelJS (~180KB) only when export is triggered.
 */

export interface ExportColumn {
    header: string;
    key: string;
    width?: number;
    /** 'currency' | 'percent' | 'date' | 'text' (default) */
    format?: "currency" | "percent" | "date" | "text";
}

export interface ExportOptions {
    filename: string;
    sheetName?: string;
    columns?: ExportColumn[];
}

const BRAND_COLOR = "004438";
const HEADER_FONT_COLOR = "FFFFFF";

export async function exportToExcel<TData>(
    table: Table<TData>,
    options: ExportOptions
): Promise<void> {
    const { filename, sheetName = "Datos", columns: explicitColumns } = options;

    // Lazy-load ExcelJS and file-saver
    const [ExcelJS, { saveAs }] = await Promise.all([
        import("exceljs"),
        import("file-saver"),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Plataforma Fiscal";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(sheetName, {
        views: [{ state: "frozen", ySplit: 1 }],
    });

    // Resolve columns from table if not explicitly provided
    const visibleColumns = table
        .getAllColumns()
        .filter((col) => col.getIsVisible())
        .filter((col) => col.id !== "select" && col.id !== "actions");

    const exportColumns: ExportColumn[] =
        explicitColumns ??
        visibleColumns.map((col) => ({
            header:
                typeof col.columnDef.header === "string"
                    ? col.columnDef.header
                    : col.id,
            key: col.id,
            format: "text" as const,
        }));

    // Set columns with widths
    worksheet.columns = exportColumns.map((col) => ({
        header: col.header,
        key: col.key,
        width: col.width ?? 18,
    }));

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = {
        bold: true,
        color: { argb: HEADER_FONT_COLOR },
        size: 11,
    };
    headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BRAND_COLOR },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "center" };
    headerRow.height = 28;

    // Add borders to header
    headerRow.eachCell((cell) => {
        cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "medium" },
            right: { style: "thin" },
        };
    });

    // Get all filtered/sorted rows (respects current view)
    const rows = table.getFilteredRowModel().rows;

    // Add data rows
    rows.forEach((row) => {
        const rowData: Record<string, unknown> = {};
        visibleColumns.forEach((col) => {
            rowData[col.id] = row.getValue(col.id) ?? "";
        });
        const excelRow = worksheet.addRow(rowData);

        // Style data cells
        excelRow.eachCell((cell, colNumber) => {
            const colDef = exportColumns[colNumber - 1];

            // Borders
            cell.border = {
                top: { style: "thin" },
                left: { style: "thin" },
                bottom: { style: "thin" },
                right: { style: "thin" },
            };

            // Number formats
            if (colDef?.format === "currency") {
                cell.numFmt = '#,##0.00 "€"';
                cell.alignment = { horizontal: "right" };
            } else if (colDef?.format === "percent") {
                cell.numFmt = "0.00%";
                cell.alignment = { horizontal: "right" };
            } else if (colDef?.format === "date") {
                cell.numFmt = "DD/MM/YYYY";
            }
        });
    });

    // Auto-fit column widths based on content
    worksheet.columns.forEach((column) => {
        if (!column.values) return;
        let maxLength = 0;
        column.values.forEach((cellValue) => {
            const length = String(cellValue ?? "").length;
            if (length > maxLength) maxLength = length;
        });
        column.width = Math.min(Math.max(maxLength + 4, 12), 50);
    });

    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().split("T")[0];
    const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, `${filename}_${dateStr}.xlsx`);
}
