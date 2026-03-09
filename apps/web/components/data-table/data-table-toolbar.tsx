"use client";

import { Table } from "@tanstack/react-table";
import { X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface DataTableToolbarProps<TData> {
    table: Table<TData>;
    searchKey?: string;
    searchPlaceholder?: string;
    children?: React.ReactNode;
}

export function DataTableToolbar<TData>({
    table,
    searchKey,
    searchPlaceholder = "Buscar...",
    children,
}: DataTableToolbarProps<TData>) {
    const isFiltered = table.getState().columnFilters.length > 0 ||
        table.getState().globalFilter;

    return (
        <div className="flex items-center justify-between gap-2 py-4">
            <div className="flex flex-1 items-center space-x-2">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary/60" />
                    {searchKey ? (
                        <Input
                            placeholder={searchPlaceholder}
                            value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
                            onChange={(event) =>
                                table.getColumn(searchKey)?.setFilterValue(event.target.value)
                            }
                            className="pl-9"
                        />
                    ) : (
                        <Input
                            placeholder={searchPlaceholder}
                            value={table.getState().globalFilter ?? ""}
                            onChange={(event) => table.setGlobalFilter(event.target.value)}
                            className="pl-9"
                        />
                    )}
                </div>
                {isFiltered && (
                    <Button
                        variant="ghost"
                        onClick={() => {
                            table.resetColumnFilters();
                            table.setGlobalFilter("");
                        }}
                        className="h-8 px-2 lg:px-3"
                    >
                        Limpiar
                        <X className="ml-2 h-4 w-4" />
                    </Button>
                )}
            </div>
            <div className="flex items-center space-x-2">
                {children}
            </div>
        </div>
    );
}
