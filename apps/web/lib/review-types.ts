// ─── ReviewBoard shared types ────────────────────────────────────
// Extracted from review-board.tsx monolith for modular use.

export type ReviewPriority = "critical" | "high" | "normal";
export type ReviewQueueType = "manual_review" | "document_failure";

export type ReviewWorkItem = {
    document_id: string;
    extraction_id: string | null;
    expediente_id: string;
    expediente_reference: string;
    expediente_title: string;
    expediente_status: string;
    fiscal_year: number;
    model_type: string;
    client: {
        id: string;
        reference: string;
        display_name: string;
        nif: string;
    } | null;
    filename: string;
    status: string;
    queue_type: ReviewQueueType;
    review_status: string | null;
    confidence: number;
    records_count: number;
    open_alerts: number;
    critical_alerts: number;
    latest_alert_severity: "info" | "warning" | "critical" | null;
    workflow: {
        workflow_owner_ref: string | null;
        workflow_owner_name: string | null;
        pending_task: string | null;
        canonical_approval_status: string;
        documental_status: string;
        revision_status: string;
        canonical_status: string;
        declarative_status: string;
        filing_status: string;
    } | null;
    priority_score: number;
    priority_label: ReviewPriority;
    next_action: string;
    created_at: string;
    updated_at: string;
    latest_event_type: string | null;
};

export type ReviewAlert = {
    id: string;
    expediente_id: string;
    expediente_reference: string;
    expediente_title: string;
    fiscal_year: number;
    model_type: string;
    client: {
        id: string;
        reference: string;
        display_name: string;
        nif: string;
    } | null;
    severity: "info" | "warning" | "critical";
    message: string;
    category: string;
    created_at: string;
};

export type ReviewEvent = {
    id: string;
    expediente_id: string | null;
    expediente_reference: string | null;
    event_type: string;
    document_id: string;
    created_at: string;
};

export type ReviewSummary = {
    pending_items: number;
    manual_review_items: number;
    document_failures: number;
    critical_priority_items: number;
    open_alerts: number;
    critical_alerts: number;
};

export type ReviewPayload = {
    current_user?: {
        reference: string;
        display_name: string;
        role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
    };
    summary: ReviewSummary;
    filters: {
        model_types: string[];
        fiscal_years: number[];
        queue_types: ReviewQueueType[];
        priority_labels: ReviewPriority[];
    };
    pending_documents: Array<{
        id: string;
        expedienteId: string;
        filename: string;
        status: string;
        confidence: number;
        createdAt: string;
    }>;
    open_alerts: ReviewAlert[];
    workflow_events: ReviewEvent[];
    work_items: ReviewWorkItem[];
};

export type ReviewRecord = {
    record_index: number;
    record_type: string;
    confidence: number;
    fields: Record<string, string | number | boolean | null>;
    source_spans: Array<{
        page: number;
        start: number;
        end: number;
        snippet?: string;
    }>;
};

export type ReviewDetailPayload = {
    extraction: {
        id: string;
        document_id: string;
        confidence: number;
        review_status: string;
        reviewed_at: string | null;
        reviewed_by: string | null;
        created_at: string;
    };
    document: {
        id: string;
        expediente_id: string;
        filename: string;
        processing_status: string;
        created_at: string;
        processed_at: string | null;
    };
    expediente: {
        id: string;
        reference: string;
        title: string;
        status: string;
        fiscal_year: number;
        model_type: string;
    };
    client: {
        id: string;
        reference: string;
        display_name: string;
        nif: string;
    } | null;
    records: ReviewRecord[];
    corrections: unknown;
};

export type ReviewActionResult = {
    extraction_id: string;
    review_status: string;
    operations_saved: number;
    message: string;
    error?: string;
};

export type DraftRecord = {
    record_type: string;
    confidence: string;
    fields: Record<string, string>;
};

export type ActionOutcome = {
    tone: "success" | "warning" | "info";
    title: string;
    detail: string;
    expediente_reference: string;
    client_reference: string | null;
    phase_href: string;
};

export const initialPayload: ReviewPayload = {
    summary: { pending_items: 0, manual_review_items: 0, document_failures: 0, critical_priority_items: 0, open_alerts: 0, critical_alerts: 0 },
    filters: { model_types: [], fiscal_years: [], queue_types: ["manual_review", "document_failure"], priority_labels: ["critical", "high", "normal"] },
    pending_documents: [],
    open_alerts: [],
    workflow_events: [],
    work_items: [],
};

export const recordTypeOptions = ["DIVIDENDO", "INTERES", "COMPRA", "VENTA", "POSICION", "DESCONOCIDO"];

// ─── Helpers ────────────────────────────────────────────────────
export function priorityLabel(value: ReviewPriority): string {
    if (value === "critical") return "Crítica";
    if (value === "high") return "Alta";
    return "Normal";
}

export function queueTypeLabel(value: ReviewQueueType): string {
    return value === "document_failure" ? "Incidencia documental" : "Revisión manual";
}

export function reviewStatusLabel(status: string | null): string {
    if (status === "validated") return "Validada";
    if (status === "pending") return "Pendiente";
    if (status === "rejected") return "Rechazada";
    if (status === "not_required") return "No requerida";
    return "Sin extracción";
}

export function priorityVariant(value: ReviewPriority): "destructive" | "warning" | "default" {
    if (value === "critical") return "destructive";
    if (value === "high") return "warning";
    return "default";
}

export function normalizeFieldForInput(value: string | number | boolean | null): string {
    if (value === null) return "";
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value);
}

export function buildDraftRecords(detail: ReviewDetailPayload | null): DraftRecord[] {
    if (!detail) return [];
    return detail.records.map((record) => ({
        record_type: record.record_type,
        confidence: String(record.confidence),
        fields: Object.fromEntries(
            Object.entries(record.fields).map(([k, v]) => [k, normalizeFieldForInput(v)])
        ),
    }));
}

export function coerceDraftValue(rawValue: string, originalValue: string | number | boolean | null) {
    const trimmed = rawValue.trim();
    if (trimmed === "") return null;
    if (typeof originalValue === "number") { const p = Number(trimmed); return Number.isFinite(p) ? p : originalValue; }
    if (typeof originalValue === "boolean") { if (trimmed.toLowerCase() === "true") return true; if (trimmed.toLowerCase() === "false") return false; return originalValue; }
    if (originalValue === null) { if (trimmed.toLowerCase() === "true") return true; if (trimmed.toLowerCase() === "false") return false; const p = Number(trimmed); return Number.isFinite(p) && /^-?\d+(?:\.\d+)?$/.test(trimmed) ? p : trimmed; }
    return trimmed;
}

export function buildCorrectedFields(detail: ReviewDetailPayload | null, drafts: DraftRecord[]) {
    if (!detail) return undefined;
    const corrections = detail.records.flatMap((record) => {
        const draft = drafts[record.record_index];
        if (!draft) return [];
        const fieldPatch: Record<string, string | number | boolean | null> = {};
        for (const [fieldKey, originalValue] of Object.entries(record.fields)) {
            const nextValue = coerceDraftValue(draft.fields[fieldKey] ?? "", originalValue);
            if (nextValue !== originalValue) fieldPatch[fieldKey] = nextValue;
        }
        const correction: Record<string, unknown> = { record_index: record.record_index };
        if (Object.keys(fieldPatch).length > 0) correction.fields = fieldPatch;
        if (draft.record_type !== record.record_type) correction.record_type = draft.record_type;
        const conf = Number(draft.confidence);
        if (Number.isFinite(conf) && conf !== record.confidence) correction.confidence = conf;
        return Object.keys(correction).length > 1 ? [correction] : [];
    });
    return corrections.length === 0 ? undefined : { records: corrections };
}
