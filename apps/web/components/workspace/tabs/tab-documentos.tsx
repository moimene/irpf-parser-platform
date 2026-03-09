"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ClientPayload, badgeVariant } from "@/lib/client-types";
import { formatDate } from "@/lib/utils";
import {
    inferDocumentSourceType,
    mimeTypeForDocumentSourceType,
} from "@/lib/document-source";
import {
    Upload,
    ChevronDown,
    ChevronUp,
    FileText,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Clock,
    Eye,
} from "lucide-react";

type ClientDocument = ClientPayload["client_documents"][number];

/* ── helpers ────────────────────────────────────────────────────── */

function reviewStatusLabel(value: string | null): string {
    if (value === "validated") return "Validada";
    if (value === "pending") return "Pendiente";
    if (value === "rejected") return "Rechazada";
    if (value === "not_required") return "No requerida";
    return "Sin extracción";
}

function parseStatusIcon(status: string) {
    switch (status) {
        case "completed":
            return <CheckCircle2 className="h-3 w-3 text-green-600" />;
        case "processing":
            return <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />;
        case "manual_review":
            return <Eye className="h-3 w-3 text-orange-500" />;
        case "error":
        case "failed":
            return <AlertCircle className="h-3 w-3 text-red-500" />;
        default:
            return <Clock className="h-3 w-3 text-text-secondary" />;
    }
}

function parseStatusLabel(status: string): string {
    switch (status) {
        case "completed":
            return "Completado";
        case "processing":
            return "Procesando…";
        case "manual_review":
            return "Rev. manual";
        case "error":
        case "failed":
            return "Error";
        case "pending":
            return "Pendiente";
        default:
            return status;
    }
}

/* ── columns ────────────────────────────────────────────────────── */

const columns: ColumnDef<ClientDocument, unknown>[] = [
    {
        accessorKey: "filename",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Documento" />
        ),
        cell: ({ row }) => (
            <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-text-secondary shrink-0" />
                <span className="font-medium text-sm truncate max-w-[200px]">
                    {row.getValue("filename")}
                </span>
            </div>
        ),
    },
    {
        accessorKey: "expediente_reference",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Expediente" />
        ),
        cell: ({ row }) => (
            <span className="text-xs font-mono">
                {row.getValue("expediente_reference")}
            </span>
        ),
    },
    {
        accessorKey: "processing_status",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Estado parseo" />
        ),
        cell: ({ row }) => {
            const status = row.getValue("processing_status") as string;
            return (
                <div className="flex items-center gap-1.5">
                    {parseStatusIcon(status)}
                    <span className="text-xs">{parseStatusLabel(status)}</span>
                </div>
            );
        },
        filterFn: (row, id, value) => value.includes(row.getValue(id)),
    },
    {
        id: "review_status",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Revisión" />
        ),
        accessorFn: (row) => row.extraction?.review_status ?? null,
        cell: ({ row }) => {
            const status =
                row.original.extraction?.review_status ?? null;
            return (
                <span className="text-xs text-text-secondary">
                    {reviewStatusLabel(status)}
                </span>
            );
        },
    },
    {
        id: "records_count",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Records" />
        ),
        accessorFn: (row) => row.extraction?.records_count ?? 0,
        cell: ({ row }) => (
            <span>{row.original.extraction?.records_count ?? "—"}</span>
        ),
    },
    {
        accessorKey: "confidence",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Confianza" />
        ),
        cell: ({ row }) => {
            const confidence = row.getValue("confidence") as number;
            if (!confidence && confidence !== 0) return <span>—</span>;
            const pct = (confidence * 100).toFixed(0);
            return (
                <span
                    className={`text-sm ${confidence < 0.7 ? "text-red-600 font-medium" : "text-text-secondary"}`}
                >
                    {pct}%
                </span>
            );
        },
    },
    {
        accessorKey: "uploaded_at",
        header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Subido" />
        ),
        cell: ({ row }) => (
            <span className="text-xs text-text-secondary">
                {formatDate(row.getValue("uploaded_at"))}
            </span>
        ),
    },
];

/* ── upload zone ────────────────────────────────────────────────── */

const MAX_FILES = 20;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ACCEPTED_TYPES =
    ".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ENTITY_OPTIONS = [
    { value: "", label: "Detectar automáticamente" },
    { value: "PICTET", label: "Pictet" },
    { value: "GOLDMAN_SACHS", label: "Goldman Sachs" },
    { value: "CITI", label: "Citi" },
    { value: "JPMORGAN", label: "J.P. Morgan" },
];

type UploadUrlItem = {
    client_id: string;
    filename: string;
    storage_path: string;
    signed_url: string;
};

function UploadZone({
    expedientes,
    onComplete,
}: {
    expedientes: ClientPayload["expedientes"];
    onComplete: () => void;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [expedienteId, setExpedienteId] = useState(
        expedientes[0]?.id ?? ""
    );
    const [entityHint, setEntityHint] = useState("");
    const [files, setFiles] = useState<File[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
        const picked = Array.from(e.target.files ?? []);
        if (picked.length > MAX_FILES) {
            setError(`Máximo ${MAX_FILES} ficheros por petición.`);
            return;
        }
        const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
        if (tooBig) {
            setError(`${tooBig.name} supera el límite de 15 MB.`);
            return;
        }
        setFiles(picked);
        setError(null);
        setSuccess(null);
    }

    async function uploadFile(url: string, file: File) {
        const fd = new FormData();
        fd.append("cacheControl", "3600");
        fd.append("", file);
        const ctrl = new AbortController();
        const timeout = window.setTimeout(() => ctrl.abort(), 120_000);
        try {
            const r = await fetch(url, {
                method: "PUT",
                body: fd,
                signal: ctrl.signal,
            });
            if (!r.ok) throw new Error(`Error subiendo ${file.name}`);
        } finally {
            window.clearTimeout(timeout);
        }
    }

    async function handleSubmit() {
        if (!expedienteId || files.length === 0) return;
        setSubmitting(true);
        setError(null);
        setSuccess(null);
        setProgress("Preparando subida segura…");

        try {
            // 1. Get signed URLs
            const filesPayload = files.map((f, i) => ({
                source_type: inferDocumentSourceType(f.name, f.type),
                client_id: String(i),
                filename: f.name,
                content_type: mimeTypeForDocumentSourceType(
                    inferDocumentSourceType(f.name, f.type),
                    f.type
                ),
                size_bytes: f.size,
            }));

            const urlsRes = await fetch("/api/documents/upload-urls", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    expediente_id: expedienteId,
                    files: filesPayload,
                }),
            });
            const urlsBody = await urlsRes.json();
            if (!urlsRes.ok) {
                throw new Error(
                    urlsBody.error ?? "No se pudo preparar la subida"
                );
            }

            // 2. Upload files to signed URLs
            const uploads = urlsBody.uploads as UploadUrlItem[];
            const byClientId = new Map(
                filesPayload.map((fp, i) => [fp.client_id, files[i]])
            );

            for (let i = 0; i < uploads.length; i++) {
                const u = uploads[i];
                const file = byClientId.get(u.client_id);
                if (!file) throw new Error(`No se encontró ${u.filename}`);
                setProgress(
                    `Subiendo ${i + 1}/${uploads.length}: ${u.filename}`
                );
                await uploadFile(u.signed_url, file);
            }

            // 3. Register for parsing
            const documents = uploads.map((u) => ({
                source_type:
                    filesPayload.find((fp) => fp.client_id === u.client_id)
                        ?.source_type ?? "PDF",
                filename: u.filename,
                storage_path: u.storage_path,
                entity_hint: entityHint || undefined,
            }));

            setProgress(
                `Registrando ${documents.length} documento(s) para parseo…`
            );

            const intakeRes = await fetch("/api/documents/intake", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    expediente_id: expedienteId,
                    uploaded_by: "fiscalista.demo",
                    documents,
                }),
            });
            const intakeBody = await intakeRes.json();
            if (!intakeRes.ok) {
                throw new Error(
                    intakeBody.error ?? "Error en la ingesta"
                );
            }

            setSuccess(
                `${intakeBody.accepted} documento(s) encolado(s) para parseo.`
            );
            setFiles([]);
            if (fileInputRef.current) fileInputRef.current.value = "";
            window.dispatchEvent(new Event("expediente:refresh"));
            onComplete();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "No se pudo ejecutar la ingesta"
            );
        } finally {
            setSubmitting(false);
            setProgress("");
        }
    }

    if (expedientes.length === 0) {
        return (
            <div className="rounded-md border border-dashed border-border-default p-3 mb-4 text-center">
                <p className="text-xs text-text-secondary">
                    Crea un expediente antes de cargar documentos.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-md border border-border-default mb-4">
            {/* Toggle header */}
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-subtle/30 transition-colors"
            >
                <span className="flex items-center gap-1.5">
                    <Upload className="h-3.5 w-3.5" />
                    Cargar documentos
                </span>
                {open ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                )}
            </button>

            {/* Expanded form */}
            {open && (
                <div className="border-t border-border-default px-3 py-3 space-y-3">
                    {/* Expediente selector */}
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="upload-exp"
                            className="text-xs font-medium text-text-secondary"
                        >
                            Expediente destino
                        </label>
                        <select
                            id="upload-exp"
                            value={expedienteId}
                            onChange={(e) =>
                                setExpedienteId(e.target.value)
                            }
                            disabled={submitting}
                            className="h-8 px-2 text-xs border border-border-default rounded-md bg-surface-card"
                        >
                            {expedientes.map((exp) => (
                                <option key={exp.id} value={exp.id}>
                                    {exp.reference} · {exp.model_type}{" "}
                                    {exp.fiscal_year}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* File picker */}
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="upload-files"
                            className="text-xs font-medium text-text-secondary"
                        >
                            Archivos PDF, CSV o Excel (máx.{" "}
                            {MAX_FILES})
                        </label>
                        <input
                            ref={fileInputRef}
                            id="upload-files"
                            type="file"
                            accept={ACCEPTED_TYPES}
                            multiple
                            onChange={handleFiles}
                            disabled={submitting}
                            className="text-xs file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-surface-subtle file:text-text-primary hover:file:bg-surface-subtle/80"
                        />
                    </div>

                    {/* File list preview */}
                    {files.length > 0 && (
                        <ul className="space-y-1">
                            {files.map((f, i) => (
                                <li
                                    key={`${f.name}-${i}`}
                                    className="flex items-center gap-2 text-xs text-text-secondary"
                                >
                                    <FileText className="h-3 w-3 shrink-0" />
                                    <span className="truncate">
                                        {f.name}
                                    </span>
                                    <span className="text-[10px] tabular-nums">
                                        {(f.size / 1024).toFixed(0)} KB
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Entity hint */}
                    <div className="flex flex-col gap-1">
                        <label
                            htmlFor="upload-entity"
                            className="text-xs font-medium text-text-secondary"
                        >
                            Entidad bancaria (opcional)
                        </label>
                        <select
                            id="upload-entity"
                            value={entityHint}
                            onChange={(e) =>
                                setEntityHint(e.target.value)
                            }
                            disabled={submitting}
                            className="h-8 px-2 text-xs border border-border-default rounded-md bg-surface-card"
                        >
                            {ENTITY_OPTIONS.map((opt) => (
                                <option
                                    key={opt.value}
                                    value={opt.value}
                                >
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Submit */}
                    <Button
                        size="sm"
                        disabled={
                            submitting ||
                            files.length === 0 ||
                            !expedienteId
                        }
                        onClick={handleSubmit}
                        className="w-full"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                {progress}
                            </>
                        ) : (
                            <>
                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                Subir {files.length || 0} documento(s)
                            </>
                        )}
                    </Button>

                    {/* Feedback */}
                    {error && (
                        <p className="text-xs text-red-600 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {error}
                        </p>
                    )}
                    {success && (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {success}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/* ── extraction detail types ─────────────────────────────────────── */

type ExtractionRecord = {
    record_index: number;
    record_type: string;
    confidence: number;
    fields: Record<string, string | number | boolean | null>;
    source_spans: Array<{ page: number; start: number; end: number; snippet?: string }>;
};

type ExtractionDetail = {
    extraction: {
        id: string;
        confidence: number;
        review_status: string;
        created_at: string;
    };
    document: {
        filename: string;
        processing_status: string;
        processed_at: string | null;
    };
    records: ExtractionRecord[];
};

/* ── document detail panel ──────────────────────────────────────── */

function ConfidenceBar({ value }: { value: number }) {
    const pct = Math.round(value * 100);
    const color =
        pct >= 80
            ? "bg-green-500"
            : pct >= 60
                ? "bg-amber-500"
                : "bg-red-500";
    return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-border-default rounded-full overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <span className="text-xs font-mono tabular-nums">{pct}%</span>
        </div>
    );
}

function DocumentDetailPanel({
    doc,
    onClose,
}: {
    doc: ClientDocument;
    onClose: () => void;
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detail, setDetail] = useState<ExtractionDetail | null>(null);
    const [expandedRecord, setExpandedRecord] = useState<number | null>(null);

    useEffect(() => {
        if (!doc.extraction?.id) {
            setLoading(false);
            return;
        }

        fetch(`/api/review/${doc.extraction.id}`)
            .then(async (res) => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(
                        (body as { error?: string }).error ??
                        "No se pudo cargar el detalle"
                    );
                }
                return res.json();
            })
            .then((data) => {
                setDetail(data as ExtractionDetail);
                setLoading(false);
            })
            .catch((err) => {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Error cargando detalle"
                );
                setLoading(false);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc.extraction?.id]);

    return (
        <div className="rounded-md border border-border-default bg-surface-card mb-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-surface-subtle/20 border-b border-border-default">
                <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-text-secondary" />
                    <span className="text-sm font-medium">
                        {doc.filename}
                    </span>
                    <div className="flex items-center gap-1">
                        {parseStatusIcon(doc.processing_status)}
                        <span className="text-xs text-text-secondary">
                            {parseStatusLabel(doc.processing_status)}
                        </span>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="text-xs text-text-secondary hover:text-text-primary transition-colors px-2 py-0.5"
                >
                    ✕ Cerrar
                </button>
            </div>

            {/* Content */}
            <div className="px-3 py-3">
                {loading && (
                    <div className="flex items-center gap-2 text-xs text-text-secondary py-4 justify-center">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cargando detalle de extracción…
                    </div>
                )}

                {error && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {error}
                    </p>
                )}

                {!loading && !error && !doc.extraction && (
                    <div className="text-center py-4">
                        <Clock className="h-5 w-5 text-text-secondary mx-auto mb-1" />
                        <p className="text-xs text-text-secondary">
                            Este documento aún no ha sido procesado.
                            El parseo se ejecuta de forma asíncrona tras
                            la subida.
                        </p>
                    </div>
                )}

                {!loading && !error && detail && (
                    <div className="space-y-3">
                        {/* Summary grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-text-secondary">
                                    Confianza
                                </p>
                                <ConfidenceBar
                                    value={
                                        detail.extraction.confidence
                                    }
                                />
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-text-secondary">
                                    Revisión
                                </p>
                                <span className="text-sm">
                                    {reviewStatusLabel(
                                        detail.extraction
                                            .review_status
                                    )}
                                </span>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-text-secondary">
                                    Records
                                </p>
                                <span className="text-sm font-medium">
                                    {detail.records.length}
                                </span>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-text-secondary">
                                    Procesado
                                </p>
                                <span className="text-xs">
                                    {detail.document.processed_at
                                        ? formatDate(
                                            detail.document
                                                .processed_at
                                        )
                                        : "En curso"}
                                </span>
                            </div>
                        </div>

                        {/* Records list */}
                        {detail.records.length > 0 && (
                            <div>
                                <p className="text-[10px] uppercase tracking-wide text-text-secondary mb-1">
                                    Registros extraídos
                                </p>
                                <div className="space-y-1">
                                    {detail.records.map((rec) => (
                                        <div
                                            key={rec.record_index}
                                            className="border border-border-default rounded-md"
                                        >
                                            <button
                                                onClick={() =>
                                                    setExpandedRecord(
                                                        expandedRecord ===
                                                            rec.record_index
                                                            ? null
                                                            : rec.record_index
                                                    )
                                                }
                                                className="flex items-center justify-between w-full px-2 py-1.5 text-xs hover:bg-surface-subtle/20 transition-colors"
                                            >
                                                <span className="flex items-center gap-1.5">
                                                    <Badge
                                                        variant={
                                                            rec.confidence >=
                                                                0.8
                                                                ? "success"
                                                                : rec.confidence >=
                                                                    0.6
                                                                    ? "warning"
                                                                    : "destructive"
                                                        }
                                                    >
                                                        {
                                                            rec.record_type
                                                        }
                                                    </Badge>
                                                    <span className="text-text-secondary">
                                                        {
                                                            Object.keys(
                                                                rec.fields
                                                            )
                                                                .length
                                                        }{" "}
                                                        campos
                                                    </span>
                                                    <span className="text-text-secondary">
                                                        ·{" "}
                                                        {(
                                                            rec.confidence *
                                                            100
                                                        ).toFixed(
                                                            0
                                                        )}
                                                        %
                                                    </span>
                                                </span>
                                                {expandedRecord ===
                                                    rec.record_index ? (
                                                    <ChevronUp className="h-3 w-3" />
                                                ) : (
                                                    <ChevronDown className="h-3 w-3" />
                                                )}
                                            </button>

                                            {expandedRecord ===
                                                rec.record_index && (
                                                    <div className="border-t border-border-default px-2 py-2">
                                                        {/* Fields table */}
                                                        <table className="w-full text-xs">
                                                            <thead>
                                                                <tr className="text-left">
                                                                    <th className="pr-2 py-0.5 text-text-secondary font-medium">
                                                                        Campo
                                                                    </th>
                                                                    <th className="py-0.5 text-text-secondary font-medium">
                                                                        Valor
                                                                    </th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {Object.entries(
                                                                    rec.fields
                                                                ).map(
                                                                    ([
                                                                        key,
                                                                        val,
                                                                    ]) => (
                                                                        <tr
                                                                            key={
                                                                                key
                                                                            }
                                                                            className="border-t border-border-default/50"
                                                                        >
                                                                            <td className="pr-2 py-0.5 text-text-secondary font-mono">
                                                                                {
                                                                                    key
                                                                                }
                                                                            </td>
                                                                            <td className="py-0.5">
                                                                                {String(
                                                                                    val ??
                                                                                    "—"
                                                                                )}
                                                                            </td>
                                                                        </tr>
                                                                    )
                                                                )}
                                                            </tbody>
                                                        </table>

                                                        {/* Source spans */}
                                                        {rec.source_spans
                                                            .length >
                                                            0 && (
                                                                <div className="mt-2">
                                                                    <p className="text-[10px] text-text-secondary mb-0.5">
                                                                        Origen
                                                                        en
                                                                        documento
                                                                    </p>
                                                                    {rec.source_spans.map(
                                                                        (
                                                                            span,
                                                                            i
                                                                        ) => (
                                                                            <p
                                                                                key={
                                                                                    i
                                                                                }
                                                                                className="text-[10px] text-text-secondary"
                                                                            >
                                                                                Pág.
                                                                                {
                                                                                    span.page
                                                                                }
                                                                                ,
                                                                                pos.
                                                                                {
                                                                                    span.start
                                                                                }
                                                                                –
                                                                                {
                                                                                    span.end
                                                                                }
                                                                                {span.snippet && (
                                                                                    <span className="italic ml-1">
                                                                                        {'"'}
                                                                                        {
                                                                                            span
                                                                                                .snippet
                                                                                                .length >
                                                                                                60
                                                                                                ? span.snippet.slice(
                                                                                                    0,
                                                                                                    60
                                                                                                ) +
                                                                                                "…"
                                                                                                : span.snippet
                                                                                        }
                                                                                        {'"'}
                                                                                    </span>
                                                                                )}
                                                                            </p>
                                                                        )
                                                                    )}
                                                                </div>
                                                            )}
                                                    </div>
                                                )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {detail.records.length === 0 && (
                            <p className="text-xs text-text-secondary text-center py-2">
                                La extracción no produjo registros
                                estructurados.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── tab component ──────────────────────────────────────────────── */

interface TabDocumentosProps {
    payload: ClientPayload;
    onRefresh?: () => void;
}

export function TabDocumentos({ payload, onRefresh }: TabDocumentosProps) {
    const router = useRouter();
    const [selectedDoc, setSelectedDoc] = useState<ClientDocument | null>(
        null
    );

    return (
        <div>
            <UploadZone
                expedientes={payload.expedientes}
                onComplete={() => {
                    onRefresh?.();
                    router.refresh();
                }}
            />

            {/* Detail panel if document selected */}
            {selectedDoc && (
                <DocumentDetailPanel
                    key={selectedDoc.id}
                    doc={selectedDoc}
                    onClose={() => setSelectedDoc(null)}
                />
            )}

            <DataTable
                columns={columns}
                data={payload.client_documents}
                searchPlaceholder="Buscar documentos..."
                exportFilename={`docs_${payload.client.reference}`}
                exportSheetName="Documentos"
                emptyMessage="Todavía no hay documentos para este cliente."
                pageSize={25}
                onRowClick={(row) => {
                    const doc = row as ClientDocument;
                    setSelectedDoc(
                        selectedDoc?.id === doc.id ? null : doc
                    );
                }}
            />
        </div>
    );
}
