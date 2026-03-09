"use client";

import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
    Stepper,
    StepperContext,
    STEPPER_PHASES,
    type StepperPhase,
    type PhaseStatus,
} from "@/components/stepper/stepper";

// ─── Expediente types (mirrors GET /api/expedientes/[id]) ───────────
// These are already defined in expediente-summary.tsx. For Sprint S1 we keep
// a lighter version that covers all render paths of the 3 phases we implement.

interface ExpedienteDocument {
    id: string;
    filename: string;
    processing_status: string;
    confidence: number;
    uploaded_at: string | null;
    expediente_reference: string;
    extraction: {
        review_status: string;
        records_count: number;
    } | null;
}

interface ExpedienteExport {
    id: string;
    model: "100" | "714" | "720";
    status: string;
    validation_state: string;
    generated_at: string;
}

interface ExpedientePayload {
    current_user?: {
        reference: string;
        display_name: string;
        role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
    };
    expediente_id: string;
    expediente_reference: string;
    title: string;
    status: string;
    model_type: "IRPF" | "IP" | "720";
    fiscal_year: number;
    client_id: string;
    client_reference: string;
    client_display_name: string;
    client_nif: string;
    counts: {
        documents: number;
        pending_review: number;
        assets: number;
        fiscal_events: number;
        exports: number;
    };
    workflow: {
        documental_status: string;
        revision_status: string;
        canonical_status: string;
        declarative_status: string;
        filing_status: string;
        pending_task: string | null;
        pending_reason: string | null;
    };
    documents: ExpedienteDocument[];
    exports: ExpedienteExport[];
    // These exist in the full payload but are S2+ concern:
    // assets, fiscal_events, operations, lots, sale_summaries
    [key: string]: unknown;
}

const emptyPayload: ExpedientePayload = {
    expediente_id: "",
    expediente_reference: "",
    title: "",
    status: "BORRADOR",
    model_type: "IRPF",
    fiscal_year: new Date().getFullYear(),
    client_id: "",
    client_reference: "",
    client_display_name: "",
    client_nif: "",
    counts: { documents: 0, pending_review: 0, assets: 0, fiscal_events: 0, exports: 0 },
    workflow: {
        documental_status: "PENDIENTE",
        revision_status: "PENDIENTE",
        canonical_status: "PENDIENTE",
        declarative_status: "PENDIENTE",
        filing_status: "PENDIENTE",
        pending_task: null,
        pending_reason: null,
    },
    documents: [],
    exports: [],
};

// ─── Fetch ─────────────────────────────────────────────────────────
async function fetchExpedientePayload(id: string): Promise<ExpedientePayload> {
    const res = await fetch(`/api/expedientes/${id}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "No se pudo cargar el expediente");
    return body as ExpedientePayload;
}

// ─── Phase status resolver ─────────────────────────────────────────
function resolvePhaseStatus(
    phase: StepperPhase,
    payload: ExpedientePayload
): PhaseStatus {
    const { counts, workflow } = payload;

    switch (phase) {
        case "resumen":
            return "completed"; // always viewable
        case "documental":
            if (counts.documents === 0) return "pending";
            if (workflow.documental_status === "COMPLETADO") return "completed";
            return "active";
        case "revision":
            if (counts.documents === 0) return "blocked";
            if (counts.pending_review === 0) return "completed";
            return "active";
        case "canonico":
            if (counts.documents === 0) return "blocked";
            if (counts.pending_review > 0) return "blocked";
            if (workflow.canonical_status === "COMPLETADO" || workflow.canonical_status === "APROBADO")
                return "completed";
            return counts.assets > 0 ? "active" : "pending";
        case "modelos":
            if (counts.documents === 0) return "blocked";
            if (counts.pending_review > 0) return "blocked";
            if (counts.exports > 0) return "completed";
            return "pending";
        default:
            return "pending";
    }
}

// ─── Phase content placeholders for S1 ─────────────────────────────
function PhaseResumen({ payload }: { payload: ExpedientePayload }) {
    const { counts, workflow } = payload;
    return (
        <div className="space-y-4">
            <div className="kpi-grid">
                <article className="kpi"><span>Documentos</span><strong>{counts.documents}</strong></article>
                <article className="kpi"><span>Pendientes</span><strong>{counts.pending_review}</strong></article>
                <article className="kpi"><span>Activos</span><strong>{counts.assets}</strong></article>
                <article className="kpi"><span>Eventos</span><strong>{counts.fiscal_events}</strong></article>
                <article className="kpi"><span>Exportes</span><strong>{counts.exports}</strong></article>
            </div>
            <section className="card">
                <h3>Workflow</h3>
                <div className="space-y-1 text-sm">
                    <p>Documental: <span className="font-medium">{workflow.documental_status}</span></p>
                    <p>Revisión: <span className="font-medium">{workflow.revision_status}</span></p>
                    <p>Canónico: <span className="font-medium">{workflow.canonical_status}</span></p>
                    <p>Declarativo: <span className="font-medium">{workflow.declarative_status}</span></p>
                    <p>Presentación: <span className="font-medium">{workflow.filing_status}</span></p>
                </div>
                {workflow.pending_task && (
                    <div className="mt-3 p-3 rounded-md border border-border-default bg-surface-alt">
                        <p className="text-xs font-medium uppercase tracking-wider text-text-secondary">Tarea pendiente</p>
                        <p className="text-sm font-medium mt-1">{workflow.pending_task}</p>
                        {workflow.pending_reason && (
                            <p className="text-xs text-text-secondary mt-0.5">{workflow.pending_reason}</p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}

function PhaseDocumental({ payload }: { payload: ExpedientePayload }) {
    const docs = payload.documents;
    return (
        <div className="space-y-4">
            <section className="card">
                <h3>Documentos del expediente</h3>
                <p className="muted">{docs.length} documentos cargados.</p>
                {docs.length === 0 ? (
                    <p className="text-sm text-text-secondary mt-2">
                        Todavía no se han cargado documentos. Utiliza el formulario de carga para iniciar la ingesta.
                    </p>
                ) : (
                    <table className="w-full text-sm mt-3">
                        <thead>
                            <tr className="border-b text-left text-text-secondary">
                                <th className="py-2 font-medium">Archivo</th>
                                <th className="py-2 font-medium">Estado</th>
                                <th className="py-2 font-medium">Confianza</th>
                                <th className="py-2 font-medium">Records</th>
                            </tr>
                        </thead>
                        <tbody>
                            {docs.map((doc) => (
                                <tr key={doc.id} className="border-b border-border-subtle">
                                    <td className="py-2 font-medium">{doc.filename}</td>
                                    <td className="py-2">{doc.processing_status}</td>
                                    <td className="py-2">{(doc.confidence * 100).toFixed(0)}%</td>
                                    <td className="py-2">{doc.extraction?.records_count ?? "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    );
}

function PhaseRevision({ payload }: { payload: ExpedientePayload }) {
    const pending = payload.documents.filter(
        (d) => d.extraction?.review_status === "pending" || d.processing_status === "manual_review"
    );
    return (
        <div className="space-y-4">
            <section className="card">
                <h3>Pendientes de revisión</h3>
                <p className="muted">{pending.length} documentos requieren revisión manual.</p>
                {pending.length === 0 ? (
                    <p className="text-sm text-green-700 mt-2">
                        ✓ No hay documentos pendientes de revisión.
                    </p>
                ) : (
                    <div className="space-y-2 mt-3">
                        {pending.map((doc) => (
                            <div
                                key={doc.id}
                                className="flex items-center justify-between p-3 rounded-md border border-border-default"
                            >
                                <div>
                                    <p className="text-sm font-medium">{doc.filename}</p>
                                    <p className="text-xs text-text-secondary">
                                        {doc.processing_status} · {(doc.confidence * 100).toFixed(0)}% confianza
                                    </p>
                                </div>
                                <Link
                                    href={`/review?expediente=${payload.expediente_reference}&doc=${doc.id}`}
                                    className="button-link text-sm"
                                >
                                    Revisar
                                </Link>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

// ─── Main component ─────────────────────────────────────────────────
export function ExpedienteStepperLayout({ expedienteId }: { expedienteId: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const initialPhase = (searchParams.get("fase") as StepperPhase) || "resumen";

    const [payload, setPayload] = useState<ExpedientePayload>(emptyPayload);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activePhase, setActivePhase] = useState<StepperPhase>(initialPhase);

    useEffect(() => {
        let mounted = true;
        async function load() {
            setLoading(true);
            try {
                const data = await fetchExpedientePayload(expedienteId);
                if (!mounted) return;
                setPayload(data);
            } catch (err) {
                if (!mounted) return;
                setError(err instanceof Error ? err.message : "Error cargando expediente");
            } finally {
                if (mounted) setLoading(false);
            }
        }
        void load();
        return () => { mounted = false; };
    }, [expedienteId]);

    function handlePhaseChange(phase: StepperPhase) {
        setActivePhase(phase);
        const params = new URLSearchParams(searchParams.toString());
        if (phase === "resumen") {
            params.delete("fase");
        } else {
            params.set("fase", phase);
        }
        const qs = params.toString();
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    }

    if (loading) {
        return (
            <section className="card">
                <p className="muted">Cargando expediente...</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className="card">
                <p className="badge danger">{error}</p>
            </section>
        );
    }

    return (
        <>
            {/* Fixed context header */}
            <StepperContext
                clientName={payload.client_display_name}
                clientNif={payload.client_nif}
                expedienteRef={payload.expediente_reference}
                title={payload.title}
                modelType={payload.model_type}
                fiscalYear={payload.fiscal_year}
                status={payload.status}
            />

            {/* Stepper navigation */}
            <div className="mt-4">
                <Stepper
                    phases={STEPPER_PHASES}
                    activePhase={activePhase}
                    onPhaseChange={handlePhaseChange}
                    getPhaseStatus={(phase) => resolvePhaseStatus(phase, payload)}
                />
            </div>

            {/* Phase content */}
            <div className="mt-4">
                {activePhase === "resumen" && <PhaseResumen payload={payload} />}
                {activePhase === "documental" && <PhaseDocumental payload={payload} />}
                {activePhase === "revision" && <PhaseRevision payload={payload} />}
                {activePhase === "canonico" && (
                    <section className="card">
                        <h3>Fase Canónico</h3>
                        <p className="muted">Edición de activos y eventos canónicos — disponible en Sprint S2.</p>
                    </section>
                )}
                {activePhase === "modelos" && (
                    <section className="card">
                        <h3>Modelos AEAT</h3>
                        <p className="muted">Preparación y exportes declarativos — disponible en Sprint S3.</p>
                    </section>
                )}
            </div>
        </>
    );
}
