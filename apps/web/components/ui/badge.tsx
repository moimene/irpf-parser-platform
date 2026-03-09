import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2",
    {
        variants: {
            variant: {
                default: "border-border-subtle bg-surface-card text-text-secondary",
                success: "border-status-success/45 bg-status-success/10 text-status-success",
                warning: "border-status-warning/48 bg-status-warning/14 text-status-warning",
                destructive: "border-status-error/42 bg-status-error/10 text-status-error",
                info: "border-status-info/45 bg-status-info/10 text-status-info",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <div className={cn(badgeVariants({ variant }), className)} {...props} />
    );
}

export { Badge, badgeVariants };
