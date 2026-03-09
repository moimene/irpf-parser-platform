"use client";

import { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface DataTableColumnHeaderProps<TData, TValue>
    extends React.HTMLAttributes<HTMLDivElement> {
    column: Column<TData, TValue>;
    title: string;
}

export function DataTableColumnHeader<TData, TValue>({
    column,
    title,
    className,
}: DataTableColumnHeaderProps<TData, TValue>) {
    if (!column.getCanSort()) {
        return <div className={cn(className)}>{title}</div>;
    }

    return (
        <button
            type="button"
            className={cn(
                "inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors -ml-1 px-1 py-0.5 rounded",
                className
            )}
            onClick={() => column.toggleSorting()}
        >
            <span>{title}</span>
            {column.getIsSorted() === "desc" ? (
                <ArrowDown className="h-3 w-3 text-text-secondary/70" />
            ) : column.getIsSorted() === "asc" ? (
                <ArrowUp className="h-3 w-3 text-text-secondary/70" />
            ) : (
                <ChevronsUpDown className="h-3 w-3 text-text-secondary/40" />
            )}
        </button>
    );
}
