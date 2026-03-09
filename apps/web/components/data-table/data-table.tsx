"use client";

import {
    ColumnDef,
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
    type GlobalFilterTableState,
} from "@tanstack/react-table";
import * as React from "react";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTableExport } from "./data-table-export";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    searchKey?: string;
    searchPlaceholder?: string;
    exportFilename?: string;
    exportSheetName?: string;
    onRowClick?: (row: TData) => void;
    isLoading?: boolean;
    emptyMessage?: string;
    emptyCta?: React.ReactNode;
    pageSize?: number;
    toolbarChildren?: React.ReactNode;
}

export function DataTable<TData, TValue>({
    columns,
    data,
    searchKey,
    searchPlaceholder,
    exportFilename,
    exportSheetName,
    onRowClick,
    isLoading = false,
    emptyMessage = "No se encontraron resultados.",
    emptyCta,
    pageSize = 25,
    toolbarChildren,
}: DataTableProps<TData, TValue>) {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
    const [rowSelection, setRowSelection] = React.useState({});
    const [globalFilter, setGlobalFilter] = React.useState("");

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
            globalFilter,
        },
        initialState: {
            pagination: {
                pageSize,
            },
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        globalFilterFn: "includesString",
    });

    if (isLoading) {
        return (
            <div className="space-y-3">
                <div className="flex items-center justify-between py-4">
                    <div className="h-10 w-[300px] animate-pulse rounded-md bg-surface-subtle" />
                    <div className="h-8 w-[120px] animate-pulse rounded-md bg-surface-subtle" />
                </div>
                <div className="rounded-md border border-border">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className={`flex gap-4 px-4 py-3 ${i === 0 ? "bg-surface-subtle/70" : ""} ${i > 0 ? "border-t border-border-subtle" : ""}`}
                        >
                            {Array.from({ length: Math.min(columns.length, 6) }).map((_, j) => (
                                <div
                                    key={j}
                                    className="h-4 flex-1 animate-pulse rounded bg-surface-subtle"
                                    style={{ animationDelay: `${(i * 4 + j) * 50}ms` }}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-0">
            <DataTableToolbar
                table={table}
                searchKey={searchKey}
                searchPlaceholder={searchPlaceholder}
            >
                {toolbarChildren}
                {exportFilename && (
                    <DataTableExport
                        table={table}
                        filename={exportFilename}
                        sheetName={exportSheetName}
                    />
                )}
            </DataTableToolbar>

            <div className="rounded-md border border-border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead key={header.id}>
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                header.column.columnDef.header,
                                                header.getContext()
                                            )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    className={onRowClick ? "cursor-pointer" : undefined}
                                    onClick={() => onRowClick?.(row.original)}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    <div className="flex flex-col items-center gap-2 py-8">
                                        <p className="text-text-secondary">{emptyMessage}</p>
                                        {emptyCta}
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            <DataTablePagination table={table} />
        </div>
    );
}
