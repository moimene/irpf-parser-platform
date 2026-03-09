/**
 * Shared types extracted from client-profile.tsx and expediente-summary.tsx.
 * These types mirror the API contracts of GET /api/clientes/[id].
 * DO NOT MODIFY — these reflect the existing backend contracts.
 */

import type { CanonicalAssetSummary, CanonicalFiscalEvent } from "@/lib/fiscal-canonical";

// ─── Fiscal Unit ─────────────────────────────────────────────────────
export type FiscalUnit = {
    primary_taxpayer_name: string | null;
    primary_taxpayer_nif: string | null;
    spouse_name: string | null;
    spouse_nif: string | null;
    filing_scope: "individual" | "joint" | "pending";
    declarant_condition: "titular" | "cotitular" | "no_titular" | "pending";
    spouse_condition: "sin_conyuge" | "titular" | "cotitular" | "no_titular" | "pending";
    fiscal_link_type: "sin_conyuge" | "gananciales" | "separacion_bienes" | "pareja_hecho" | "otro" | "pending";
    notes: string | null;
};

export type FiscalUnitForm = {
    primary_taxpayer_name: string;
    primary_taxpayer_nif: string;
    spouse_name: string;
    spouse_nif: string;
    filing_scope: FiscalUnit["filing_scope"];
    declarant_condition: FiscalUnit["declarant_condition"];
    spouse_condition: FiscalUnit["spouse_condition"];
    fiscal_link_type: FiscalUnit["fiscal_link_type"];
    notes: string;
};

// ─── Client Payload (GET /api/clientes/[id]) ─────────────────────────
export type ClientPayload = {
    current_user?: {
        reference: string;
        display_name: string;
        role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
    };
    client: {
        id: string;
        reference: string;
        display_name: string;
        nif: string;
        email: string | null;
        status: "active" | "inactive" | "archived";
        contact_person: string | null;
        notes: string | null;
        fiscal_unit: FiscalUnit;
        created_at: string;
        updated_at: string;
    };
    stats: {
        expedientes: number;
        documents: number;
        pending_review: number;
        exports: number;
        assets: number;
        fiscal_events: number;
        last_activity_at: string | null;
    };
    assignments: Array<{
        id: string;
        assignment_role: string;
        user: {
            display_name: string;
            email: string;
            role: string;
        };
    }>;
    expedientes: Array<{
        id: string;
        reference: string;
        title: string;
        model_type: "IRPF" | "IP" | "720";
        fiscal_year: number;
        status: string;
        counts: {
            documents: number;
            pending_review: number;
            exports: number;
        };
        latest_export: {
            model: string;
            status: string;
            generated_at: string;
        } | null;
        created_at: string;
    }>;
    client_documents: Array<{
        id: string;
        filename: string;
        processing_status: string;
        confidence: number;
        manual_review_required: boolean;
        uploaded_at: string | null;
        processed_at: string | null;
        uploaded_by: string | null;
        expediente_id: string;
        expediente_reference: string;
        extraction: {
            id: string;
            review_status: string;
            records_count: number;
            created_at: string;
        } | null;
    }>;
    client_assets: CanonicalAssetSummary[];
    client_fiscal_events: CanonicalFiscalEvent[];
};

// ─── Response types ──────────────────────────────────────────────────
export type CreateExpedienteResponse = {
    expediente: {
        reference: string;
    };
};

export type UpdateFiscalUnitResponse = {
    client: ClientPayload["client"];
};

// ─── Workspace types ─────────────────────────────────────────────────
export type WorkspaceTab = "resumen" | "portfolio" | "irpf" | "patrimonio" | "expedientes" | "documentos";

export const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string; shortLabel: string }> = [
    { id: "resumen", label: "Resumen", shortLabel: "Vista ejecutiva" },
    { id: "portfolio", label: "Portfolio 720", shortLabel: "Activos extranjero" },
    { id: "irpf", label: "Operaciones IRPF", shortLabel: "Rendimientos y ganancias" },
    { id: "patrimonio", label: "Patrimonio IP", shortLabel: "Valoración a cierre" },
    { id: "expedientes", label: "Expedientes", shortLabel: "Carpetas por ejercicio" },
    { id: "documentos", label: "Documentos", shortLabel: "Trazabilidad documental" },
];

// ─── Helpers (extracted from the monolith) ───────────────────────────
export function toFiscalUnitForm(unit: FiscalUnit): FiscalUnitForm {
    return {
        primary_taxpayer_name: unit.primary_taxpayer_name ?? "",
        primary_taxpayer_nif: unit.primary_taxpayer_nif ?? "",
        spouse_name: unit.spouse_name ?? "",
        spouse_nif: unit.spouse_nif ?? "",
        filing_scope: unit.filing_scope,
        declarant_condition: unit.declarant_condition,
        spouse_condition: unit.spouse_condition,
        fiscal_link_type: unit.fiscal_link_type,
        notes: unit.notes ?? "",
    };
}

export async function fetchClientPayload(clientId: string): Promise<ClientPayload> {
    const response = await fetch(`/api/clientes/${clientId}`, { cache: "no-store" });
    const body = (await response.json()) as ClientPayload | { error: string };
    if (!response.ok) {
        throw new Error((body as { error: string }).error ?? "No se pudo cargar el cliente");
    }
    return body as ClientPayload;
}

export function formatDateTime(value: string | null): string {
    return value ? new Date(value).toLocaleString("es-ES") : "Sin actividad";
}

export function formatMaybeValue(value: string | null): string {
    return value && value.trim().length > 0 ? value : "pendiente";
}

export function filingScopeLabel(value: FiscalUnit["filing_scope"]): string {
    if (value === "individual") return "Individual";
    if (value === "joint") return "Conjunta";
    return "Pendiente";
}

export function holderConditionLabel(
    value: FiscalUnit["declarant_condition"] | FiscalUnit["spouse_condition"]
): string {
    if (value === "titular") return "Titular";
    if (value === "cotitular") return "Cotitular";
    if (value === "no_titular") return "No titular";
    if (value === "sin_conyuge") return "Sin cónyuge";
    return "Pendiente";
}

export function fiscalLinkLabel(value: FiscalUnit["fiscal_link_type"]): string {
    if (value === "gananciales") return "Gananciales";
    if (value === "separacion_bienes") return "Separación de bienes";
    if (value === "pareja_hecho") return "Pareja de hecho";
    if (value === "otro") return "Otro";
    if (value === "sin_conyuge") return "Sin cónyuge";
    return "Pendiente";
}

export function resolveFiscalUnitState(unit: FiscalUnit): {
    label: string;
    tone: "success" | "warning" | "danger";
    detail: string;
} {
    if (!unit.primary_taxpayer_name || !unit.primary_taxpayer_nif) {
        return {
            label: "Incompleta",
            tone: "danger",
            detail: "Falta identificar correctamente el sujeto pasivo principal.",
        };
    }

    if (
        unit.filing_scope === "pending" ||
        unit.declarant_condition === "pending" ||
        unit.spouse_condition === "pending" ||
        unit.fiscal_link_type === "pending"
    ) {
        return {
            label: "Pendiente",
            tone: "warning",
            detail: "La unidad fiscal existe, pero todavía no está cerrada para trabajo anual consistente.",
        };
    }

    if (unit.spouse_condition === "sin_conyuge" && unit.fiscal_link_type !== "sin_conyuge") {
        return {
            label: "Inconsistente",
            tone: "warning",
            detail: "La vinculación fiscal no cuadra con el estado sin cónyuge.",
        };
    }

    if (unit.spouse_condition !== "sin_conyuge" && (!unit.spouse_name || !unit.spouse_nif)) {
        return {
            label: "Incompleta",
            tone: "warning",
            detail: "Existe cónyuge o vínculo fiscal, pero falta su identificación completa.",
        };
    }

    return {
        label: "Estructurada",
        tone: "success",
        detail: "La unidad fiscal ya puede gobernar los expedientes y modelos del cliente.",
    };
}

export function resolveExpedientePhase(expediente: ClientPayload["expedientes"][number]): {
    phase: "documental" | "revision" | "modelos" | "resumen";
    label: string;
    detail: string;
} {
    if (expediente.counts.documents === 0) {
        return {
            phase: "documental",
            label: "Cargar documentación",
            detail: "El expediente todavía no tiene documentación base.",
        };
    }
    if (expediente.counts.pending_review > 0) {
        return {
            phase: "revision",
            label: "Resolver revisión",
            detail: "Hay trabajo manual pendiente antes de consolidar.",
        };
    }
    if (expediente.counts.exports === 0) {
        return {
            phase: "modelos",
            label: "Preparar modelo AEAT",
            detail: "Base documental lista, siguiente paso: modelo declarativo.",
        };
    }
    return {
        phase: "resumen",
        label: "Revisar estado general",
        detail: "El expediente ya tiene actividad declarativa.",
    };
}

export function priorityScore(expediente: ClientPayload["expedientes"][number]): number {
    if (expediente.counts.pending_review > 0) return 400 + expediente.counts.pending_review;
    if (expediente.counts.documents === 0) return 300;
    if (expediente.counts.exports === 0) return 200;
    return 100;
}

export function badgeVariant(
    value: string
): "success" | "warning" | "destructive" | "default" {
    if (value === "active" || value === "VALIDADO" || value === "PRESENTADO" || value === "success") {
        return "success";
    }
    if (
        value === "EN_REVISION" || value === "BORRADOR" || value === "MODIFICADO" ||
        value === "inactive" || value === "warning"
    ) {
        return "warning";
    }
    if (value === "archived" || value === "danger") {
        return "destructive";
    }
    return "default";
}

export const emptyFiscalUnit: FiscalUnit = {
    primary_taxpayer_name: null,
    primary_taxpayer_nif: null,
    spouse_name: null,
    spouse_nif: null,
    filing_scope: "pending",
    declarant_condition: "pending",
    spouse_condition: "pending",
    fiscal_link_type: "pending",
    notes: null,
};

export const emptyClientPayload: ClientPayload = {
    client: {
        id: "",
        reference: "",
        display_name: "",
        nif: "",
        email: null,
        status: "active",
        contact_person: null,
        notes: null,
        fiscal_unit: emptyFiscalUnit,
        created_at: "",
        updated_at: "",
    },
    stats: {
        expedientes: 0,
        documents: 0,
        pending_review: 0,
        exports: 0,
        assets: 0,
        fiscal_events: 0,
        last_activity_at: null,
    },
    assignments: [],
    expedientes: [],
    client_documents: [],
    client_assets: [],
    client_fiscal_events: [],
};
