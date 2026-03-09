"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { badgeVariant } from "@/lib/client-types";

// ─── Types ───────────────────────────────────────────────────────────
export type StepperPhase = "resumen" | "documental" | "revision" | "canonico" | "modelos";

export interface StepperPhaseConfig {
    id: StepperPhase;
    label: string;
    shortLabel: string;
}

export const STEPPER_PHASES: StepperPhaseConfig[] = [
    { id: "resumen", label: "Resumen", shortLabel: "Estado general" },
    { id: "documental", label: "Documental", shortLabel: "Ingesta y parseo" },
    { id: "revision", label: "Revisión", shortLabel: "Pendientes de revisión" },
    { id: "canonico", label: "Canónico", shortLabel: "Activos y eventos" },
    { id: "modelos", label: "Modelos AEAT", shortLabel: "Preparación y exportes" },
];

export type PhaseState = {
    label: string;
    tone: "success" | "warning" | "danger" | "info";
    detail: string;
};

export type PhaseStatus = "completed" | "active" | "pending" | "blocked";

interface StepperProps {
    phases: StepperPhaseConfig[];
    activePhase: StepperPhase;
    onPhaseChange: (phase: StepperPhase) => void;
    getPhaseStatus: (phase: StepperPhase) => PhaseStatus;
    className?: string;
}

/**
 * Horizontal stepper with visual states:
 * - completed (green) - phase is done
 * - active (blue) - currently viewing
 * - pending (gray) - not started
 * - blocked (red) - can't proceed
 */
export function Stepper({
    phases,
    activePhase,
    onPhaseChange,
    getPhaseStatus,
    className,
}: StepperProps) {
    return (
        <nav
            className={cn("flex items-center gap-0 overflow-x-auto", className)}
            aria-label="Fases del expediente"
        >
            {phases.map((phase, index) => {
                const status = getPhaseStatus(phase.id);
                const isActive = phase.id === activePhase;
                const isLast = index === phases.length - 1;

                return (
                    <div key={phase.id} className="flex items-center">
                        <button
                            type="button"
                            onClick={() => onPhaseChange(phase.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all",
                                "focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2",
                                isActive && "bg-brand text-white shadow-sm",
                                !isActive && status === "completed" && "bg-green-50 text-green-700 hover:bg-green-100",
                                !isActive && status === "pending" && "bg-gray-50 text-gray-500 hover:bg-gray-100",
                                !isActive && status === "blocked" && "bg-red-50 text-red-600 hover:bg-red-100",
                                !isActive && status === "active" && "bg-blue-50 text-blue-700 hover:bg-blue-100",
                            )}
                            aria-current={isActive ? "step" : undefined}
                        >
                            {/* Step number */}
                            <span
                                className={cn(
                                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                                    isActive && "bg-white/20 text-white",
                                    !isActive && status === "completed" && "bg-green-200 text-green-800",
                                    !isActive && status === "pending" && "bg-gray-200 text-gray-500",
                                    !isActive && status === "blocked" && "bg-red-200 text-red-700",
                                    !isActive && status === "active" && "bg-blue-200 text-blue-700",
                                )}
                            >
                                {status === "completed" ? "✓" : index + 1}
                            </span>

                            {/* Label */}
                            <span className="hidden sm:inline">{phase.label}</span>
                        </button>

                        {/* Connector line */}
                        {!isLast && (
                            <div
                                className={cn(
                                    "h-px w-6 mx-1",
                                    status === "completed" ? "bg-green-300" : "bg-gray-200"
                                )}
                            />
                        )}
                    </div>
                );
            })}
        </nav>
    );
}

// ─── Context block (fixed header for the expediente) ─────────────────
interface StepperContextProps {
    clientName: string;
    clientNif: string;
    expedienteRef: string;
    title: string;
    modelType: string;
    fiscalYear: number;
    status: string;
    className?: string;
}

export function StepperContext({
    clientName,
    clientNif,
    expedienteRef,
    title,
    modelType,
    fiscalYear,
    status,
    className,
}: StepperContextProps) {
    const modelLabels: Record<string, string> = {
        IRPF: "Mod. 100",
        IP: "Mod. 714",
        "720": "Mod. 720",
    };

    return (
        <div className={cn("flex items-center justify-between flex-wrap gap-3 p-4 rounded-md border border-border-default bg-white", className)}>
            <div className="flex items-center gap-4 flex-wrap">
                <div>
                    <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                        Cliente
                    </span>
                    <p className="text-sm font-semibold">{clientName}</p>
                    <p className="text-xs text-text-secondary">{clientNif}</p>
                </div>
                <div className="h-8 w-px bg-border-default" />
                <div>
                    <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                        Expediente
                    </span>
                    <p className="text-sm font-semibold">{title || expedienteRef}</p>
                    <p className="text-xs text-text-secondary">
                        {modelLabels[modelType] ?? modelType} · Ejercicio {fiscalYear}
                    </p>
                </div>
            </div>
            <Badge variant={badgeVariant(status)}>{status}</Badge>
        </div>
    );
}
