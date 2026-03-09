import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "flex h-10 w-full rounded-md border border-border-subtle bg-surface-card px-3 py-2 text-sm text-text-primary ring-offset-surface-card file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-text-secondary/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/16 focus-visible:border-border-focus disabled:cursor-not-allowed disabled:opacity-50",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);
Input.displayName = "Input";

export { Input };
