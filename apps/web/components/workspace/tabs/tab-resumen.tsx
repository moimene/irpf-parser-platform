"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
    type ClientPayload,
    type FiscalUnitForm,
    toFiscalUnitForm,
    resolveFiscalUnitState,
    formatDateTime,
    formatMaybeValue,
    filingScopeLabel,
    holderConditionLabel,
    fiscalLinkLabel,
    badgeVariant,
    resolveExpedientePhase,
    priorityScore,
} from "@/lib/client-types";

interface TabResumenProps {
    payload: ClientPayload;
    onReload: () => Promise<void>;
    clientId: string;
}

export function TabResumen({ payload, onReload, clientId }: TabResumenProps) {
    const { client, stats, assignments } = payload;
    const fiscalUnitState = resolveFiscalUnitState(client.fiscal_unit);
    const canEditFiscalUnit =
        payload.current_user?.role === "admin" || payload.current_user?.role === "fiscal_senior";
    const canCreateExpediente = payload.current_user?.role !== "solo_lectura";

    // ─── Expediente creation form state ───
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear().toString());
    const [modelType, setModelType] = useState<"IRPF" | "IP" | "720">("IRPF");
    const [reference, setReference] = useState("");
    const [title, setTitle] = useState("");
    const [createdRef, setCreatedRef] = useState<string | null>(null);

    async function handleCreateExpediente(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setSubmitting(true);
        setError(null);
        setCreatedRef(null);
        try {
            const response = await fetch("/api/expedientes", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    client_id: client.id,
                    fiscal_year: Number(fiscalYear),
                    model_type: modelType,
                    reference: reference.trim() || undefined,
                    title: title.trim() || undefined,
                }),
            });
            const body = await response.json();
            if (!response.ok) {
                setError(body.error ?? "No se pudo crear el expediente");
                return;
            }
            setCreatedRef(body.expediente.reference);
            await onReload();
            setReference("");
            setTitle("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error creando expediente");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            {/* Ficha operativa + Unidad Fiscal + Equipo */}
            <div className="client-meta-grid">
                <article className="stack-item">
                    <h3>Ficha operativa</h3>
                    <p className="muted" style={{ margin: 0 }}>
                        Estado:{" "}
                        <Badge variant={badgeVariant(client.status)}>
                            {client.status === "active" ? "Activo" : client.status === "inactive" ? "Inactivo" : "Archivado"}
                        </Badge>
                    </p>
                    <p className="muted" style={{ marginBottom: 0 }}>
                        Última actividad: {formatDateTime(stats.last_activity_at)}
                        <br />
                        Alta del cliente: {formatDateTime(client.created_at)}
                    </p>
                    {client.notes && (
                        <p className="muted" style={{ marginTop: 8 }}>
                            Notas: {client.notes}
                        </p>
                    )}
                </article>

                <article className="stack-item">
                    <div className="review-item-header">
                        <h3>Unidad fiscal</h3>
                        <Badge variant={badgeVariant(fiscalUnitState.tone)}>{fiscalUnitState.label}</Badge>
                    </div>
                    <p className="muted" style={{ margin: 0 }}>
                        Sujeto pasivo: {formatMaybeValue(client.fiscal_unit.primary_taxpayer_name)} ·{" "}
                        {formatMaybeValue(client.fiscal_unit.primary_taxpayer_nif)}
                        <br />
                        Alcance: {filingScopeLabel(client.fiscal_unit.filing_scope)}
                        <br />
                        Vinculación: {fiscalLinkLabel(client.fiscal_unit.fiscal_link_type)}
                    </p>
                    {canEditFiscalUnit && (
                        <p className="text-xs text-text-secondary mt-2">
                            Edición de unidad fiscal disponible en la sección desplegable del cliente original.
                        </p>
                    )}
                </article>

                <article className="stack-item">
                    <h3>Equipo asignado</h3>
                    {assignments.length === 0 ? (
                        <p className="muted" style={{ margin: 0 }}>
                            No hay usuarios asignados todavía a este cliente.
                        </p>
                    ) : (
                        <div className="muted" style={{ margin: 0 }}>
                            {assignments.map((a) => (
                                <p key={a.id} style={{ margin: "0 0 8px" }}>
                                    <strong>{a.user.display_name}</strong> · {a.assignment_role} · {a.user.role}
                                    <br />
                                    {a.user.email}
                                </p>
                            ))}
                        </div>
                    )}
                </article>
            </div>

            {/* Crear expediente */}
            <section className="card">
                <h3>Nuevo expediente</h3>
                <p className="muted">
                    Abre un expediente vinculado a este cliente con modelo y ejercicio.
                </p>
                {!canCreateExpediente && (
                    <p className="badge warning" style={{ marginBottom: 12 }}>
                        Solo perfiles con permisos pueden crear expedientes.
                    </p>
                )}
                <form className="form" onSubmit={handleCreateExpediente}>
                    <label htmlFor="exp-year">Ejercicio fiscal</label>
                    <input
                        id="exp-year"
                        type="number"
                        value={fiscalYear}
                        onChange={(e) => setFiscalYear(e.target.value)}
                        required
                        disabled={submitting || !canCreateExpediente}
                    />

                    <label htmlFor="exp-model">Modelo</label>
                    <select
                        id="exp-model"
                        value={modelType}
                        onChange={(e) => setModelType(e.target.value as "IRPF" | "IP" | "720")}
                        disabled={submitting || !canCreateExpediente}
                    >
                        <option value="IRPF">IRPF (Mod. 100)</option>
                        <option value="IP">IP (Mod. 714)</option>
                        <option value="720">Bienes Exterior (Mod. 720)</option>
                    </select>

                    <label htmlFor="exp-ref">Referencia (opcional)</label>
                    <input
                        id="exp-ref"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        disabled={submitting || !canCreateExpediente}
                    />

                    <label htmlFor="exp-title">Título (opcional)</label>
                    <input
                        id="exp-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        disabled={submitting || !canCreateExpediente}
                    />

                    <button type="submit" disabled={submitting || !canCreateExpediente}>
                        {submitting ? "Creando..." : "Crear expediente"}
                    </button>
                </form>

                {createdRef && (
                    <p className="badge success" style={{ marginTop: 12 }}>
                        Expediente <Link href={`/expedientes/${createdRef}`}>{createdRef}</Link> creado.
                    </p>
                )}
                {error && <p className="badge danger" style={{ marginTop: 12 }}>{error}</p>}
            </section>
        </div>
    );
}
