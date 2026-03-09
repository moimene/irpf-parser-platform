"use client";

import { useRef, useState } from "react";
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

/* ── tab component ──────────────────────────────────────────────── */

interface TabDocumentosProps {
    payload: ClientPayload;
    onRefresh?: () => void;
}

export function TabDocumentos({ payload, onRefresh }: TabDocumentosProps) {
    const router = useRouter();

    return (
        <div>
            <UploadZone
                expedientes={payload.expedientes}
                onComplete={() => {
                    onRefresh?.();
                    router.refresh();
                }}
            />
            <DataTable
                columns={columns}
                data={payload.client_documents}
                searchPlaceholder="Buscar documentos..."
                exportFilename={`docs_${payload.client.reference}`}
                exportSheetName="Documentos"
                emptyMessage="Todavía no hay documentos para este cliente."
                pageSize={25}
            />
        </div>
    );
}
