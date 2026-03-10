"use client";

import { useState, useCallback, useRef } from "react";
import {
    Upload,
    FileText,
    Loader2,
    CheckCircle2,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Landmark,
    PiggyBank,
    TrendingUp,
    Shield,
    Home,
    Package,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────── */

interface SourceSpan {
    page: number;
    start: number;
    end: number;
    snippet?: string;
}

interface ParsedRecord {
    record_type: string;
    fields: Record<string, string | number | boolean | null>;
    confidence: number;
    source_spans: SourceSpan[];
}

interface ExtractorResult {
    parser_strategy: string;
    template_used: string;
    confidence: number;
    requires_manual_review: boolean;
    records: ParsedRecord[];
    warnings: string[];
    structured_document: {
        backend: string;
        pages_count: number;
        source_type: string;
    } | null;
}

/* ── Constants ────────────────────────────────────────── */

const CATEGORY_MAP: Record<
    string,
    { label: string; icon: React.ReactNode; color: string }
> = {
    CUENTA: {
        label: "Cuentas",
        icon: <Landmark className="h-4 w-4" />,
        color: "var(--g-brand-3308)",
    },
    CUENTA_BANCARIA: {
        label: "Cuentas bancarias",
        icon: <Landmark className="h-4 w-4" />,
        color: "var(--g-brand-3308)",
    },
    VALOR: {
        label: "Valores",
        icon: <TrendingUp className="h-4 w-4" />,
        color: "#2563eb",
    },
    IIC: {
        label: "IIC (Fondos)",
        icon: <PiggyBank className="h-4 w-4" />,
        color: "#7c3aed",
    },
    SEGURO: {
        label: "Seguros",
        icon: <Shield className="h-4 w-4" />,
        color: "#059669",
    },
    INMUEBLE: {
        label: "Inmuebles",
        icon: <Home className="h-4 w-4" />,
        color: "#d97706",
    },
    BIEN_MUEBLE: {
        label: "Bienes muebles",
        icon: <Package className="h-4 w-4" />,
        color: "#dc2626",
    },
};

const ACCEPTED_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
];

function sourceTypeFromMime(mime: string): string {
    if (mime.includes("pdf")) return "PDF";
    if (mime.includes("sheet") || mime.includes("excel")) return "XLSX";
    if (mime.includes("csv")) return "CSV";
    return "PDF";
}

function confidenceColor(c: number): string {
    if (c >= 0.8) return "#059669";
    if (c >= 0.6) return "#d97706";
    return "#dc2626";
}

/* ── Component ────────────────────────────────────────── */

export default function ExtractorPage() {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ExtractorResult | null>(null);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(
        null
    );
    const [expandedRecord, setExpandedRecord] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback((f: File) => {
        setFile(f);
        setResult(null);
        setError(null);
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
        },
        [handleFile]
    );

    async function handleExtract() {
        if (!file) return;
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const buffer = await file.arrayBuffer();
            const base64 = btoa(
                new Uint8Array(buffer).reduce(
                    (data, byte) => data + String.fromCharCode(byte),
                    ""
                )
            );

            const res = await fetch("/api/extractor", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    filename: file.name,
                    content_base64: base64,
                    source_type: sourceTypeFromMime(file.type),
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(
                    (data as { error?: string }).error ?? "Error del parser"
                );
            }

            setResult(data as ExtractorResult);
            // Auto-expand first category with records
            const cats = groupByCategory(
                (data as ExtractorResult).records
            );
            const firstKey = Object.keys(cats)[0];
            if (firstKey) setExpandedCategory(firstKey);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Error inesperado"
            );
        } finally {
            setLoading(false);
        }
    }

    function groupByCategory(
        records: ParsedRecord[]
    ): Record<string, ParsedRecord[]> {
        const groups: Record<string, ParsedRecord[]> = {};
        for (const r of records) {
            const key = r.record_type;
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
        }
        return groups;
    }

    const categories = result ? groupByCategory(result.records) : {};

    return (
        <div className="page">
            <section className="card">
                <h2 className="text-xl font-bold">Sandbox Extractor</h2>
                <p className="text-sm text-text-secondary mt-1">
                    Sube un PDF o XLS para probar el parseador. Sin vincular a
                    ningún expediente.
                </p>

                {/* Upload zone */}
                <div
                    className="mt-4 border-2 border-dashed border-border-default rounded-lg p-8 text-center cursor-pointer hover:border-brand transition-colors"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => inputRef.current?.click()}
                >
                    <input
                        ref={inputRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.xlsx,.xls,.csv"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFile(f);
                        }}
                    />
                    <Upload className="h-8 w-8 mx-auto text-text-secondary mb-2" />
                    {file ? (
                        <div>
                            <p className="text-sm font-medium">{file.name}</p>
                            <p className="text-xs text-text-secondary mt-1">
                                {(file.size / 1024).toFixed(0)} KB ·{" "}
                                {sourceTypeFromMime(file.type)}
                            </p>
                        </div>
                    ) : (
                        <div>
                            <p className="text-sm font-medium">
                                Arrastra un archivo o haz clic
                            </p>
                            <p className="text-xs text-text-secondary mt-1">
                                PDF, XLSX, XLS, CSV (máx. 15 MB)
                            </p>
                        </div>
                    )}
                </div>

                {/* Extract button */}
                <div className="mt-4 flex items-center gap-3">
                    <button
                        onClick={handleExtract}
                        disabled={!file || loading}
                        className="button-primary text-sm px-4 py-2 disabled:opacity-50"
                    >
                        {loading ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Extrayendo…
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                <FileText className="h-4 w-4" />
                                Extraer registros
                            </span>
                        )}
                    </button>
                    {file && !loading && (
                        <button
                            onClick={() => {
                                setFile(null);
                                setResult(null);
                                setError(null);
                                if (inputRef.current)
                                    inputRef.current.value = "";
                            }}
                            className="text-xs text-text-secondary hover:text-text-primary transition-colors"
                        >
                            Limpiar
                        </button>
                    )}
                </div>

                {error && (
                    <p className="text-sm text-red-600 flex items-center gap-1 mt-3">
                        <AlertCircle className="h-4 w-4" /> {error}
                    </p>
                )}
            </section>

            {/* ── Results ──────────────────────────────────── */}
            {result && (
                <section className="card mt-4">
                    {/* Summary header */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <h3 className="text-lg font-bold">
                                Resultado de extracción
                            </h3>
                            <p className="text-sm text-text-secondary mt-0.5">
                                Estrategia:{" "}
                                <strong>{result.parser_strategy}</strong>
                                {result.template_used !== "none" && (
                                    <>
                                        {" · "}
                                        Template:{" "}
                                        <strong>{result.template_used}</strong>
                                    </>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-center">
                                <span
                                    className="text-2xl font-bold"
                                    style={{
                                        color: confidenceColor(
                                            result.confidence
                                        ),
                                    }}
                                >
                                    {Math.round(result.confidence * 100)}%
                                </span>
                                <p className="text-xs text-text-secondary">
                                    Confianza
                                </p>
                            </div>
                            <div className="text-center">
                                <span className="text-2xl font-bold">
                                    {result.records.length}
                                </span>
                                <p className="text-xs text-text-secondary">
                                    Registros
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Manual review badge */}
                    {result.requires_manual_review && (
                        <div className="mt-2 px-3 py-1.5 rounded-md bg-yellow-50 border border-yellow-200 text-xs text-yellow-800 flex items-center gap-1">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Requiere revisión manual — confianza insuficiente
                        </div>
                    )}

                    {/* Warnings */}
                    {result.warnings.length > 0 && (
                        <div className="mt-2 px-3 py-1.5 rounded-md bg-orange-50 border border-orange-200 text-xs text-orange-800">
                            <strong>Avisos:</strong>{" "}
                            {result.warnings.join(" · ")}
                        </div>
                    )}

                    {/* Structured doc info */}
                    {result.structured_document && (
                        <p className="text-xs text-text-secondary mt-2">
                            Backend: {result.structured_document.backend} ·{" "}
                            {result.structured_document.pages_count} página(s) ·{" "}
                            {result.structured_document.source_type}
                        </p>
                    )}

                    {/* ── Category groups ─────────────────────── */}
                    <div className="mt-4 space-y-2">
                        {Object.entries(categories).map(
                            ([type, records]) => {
                                const meta = CATEGORY_MAP[type] ?? {
                                    label: type,
                                    icon: (
                                        <FileText className="h-4 w-4" />
                                    ),
                                    color: "#6b7280",
                                };
                                const isExpanded =
                                    expandedCategory === type;

                                return (
                                    <div
                                        key={type}
                                        className="border border-border-default rounded-md overflow-hidden"
                                    >
                                        {/* Category header */}
                                        <button
                                            onClick={() =>
                                                setExpandedCategory(
                                                    isExpanded ? null : type
                                                )
                                            }
                                            className="w-full flex items-center justify-between px-3 py-2 bg-surface-subtle/30 hover:bg-surface-subtle/50 transition-colors text-left"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span
                                                    style={{
                                                        color: meta.color,
                                                    }}
                                                >
                                                    {meta.icon}
                                                </span>
                                                <span className="text-sm font-medium">
                                                    {meta.label}
                                                </span>
                                                <span className="text-xs text-text-secondary bg-surface-card px-1.5 py-0.5 rounded-full">
                                                    {records.length}
                                                </span>
                                            </div>
                                            {isExpanded ? (
                                                <ChevronUp className="h-4 w-4 text-text-secondary" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4 text-text-secondary" />
                                            )}
                                        </button>

                                        {/* Records list */}
                                        {isExpanded && (
                                            <div className="divide-y divide-border-default">
                                                {records.map((rec, idx) => {
                                                    const globalIdx =
                                                        result.records.indexOf(
                                                            rec
                                                        );
                                                    const isRecExpanded =
                                                        expandedRecord ===
                                                        globalIdx;
                                                    const fieldEntries =
                                                        Object.entries(
                                                            rec.fields
                                                        ).filter(
                                                            ([, v]) =>
                                                                v !== null &&
                                                                v !== ""
                                                        );

                                                    // Build a summary string from the first 3 fields
                                                    const summary =
                                                        fieldEntries
                                                            .slice(0, 3)
                                                            .map(
                                                                ([k, v]) =>
                                                                    `${k}: ${String(v)}`
                                                            )
                                                            .join(" · ");

                                                    return (
                                                        <div
                                                            key={idx}
                                                            className="px-3"
                                                        >
                                                            <button
                                                                onClick={() =>
                                                                    setExpandedRecord(
                                                                        isRecExpanded
                                                                            ? null
                                                                            : globalIdx
                                                                    )
                                                                }
                                                                className="w-full flex items-center justify-between py-2 text-left"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <span className="text-xs font-medium">
                                                                        Registro{" "}
                                                                        {idx +
                                                                            1}
                                                                    </span>
                                                                    <span
                                                                        className="text-xs ml-2"
                                                                        style={{
                                                                            color: confidenceColor(
                                                                                rec.confidence
                                                                            ),
                                                                        }}
                                                                    >
                                                                        {Math.round(
                                                                            rec.confidence *
                                                                            100
                                                                        )}
                                                                        %
                                                                    </span>
                                                                    <p className="text-xs text-text-secondary truncate mt-0.5">
                                                                        {summary}
                                                                    </p>
                                                                </div>
                                                                <span className="text-xs text-text-secondary ml-2">
                                                                    {fieldEntries.length}{" "}
                                                                    campos
                                                                </span>
                                                            </button>

                                                            {/* Expanded record detail */}
                                                            {isRecExpanded && (
                                                                <div className="pb-3">
                                                                    <table className="w-full text-xs border-collapse">
                                                                        <thead>
                                                                            <tr className="border-b border-border-default">
                                                                                <th className="text-left py-1 pr-3 font-medium text-text-secondary">
                                                                                    Campo
                                                                                </th>
                                                                                <th className="text-left py-1 font-medium text-text-secondary">
                                                                                    Valor
                                                                                </th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {fieldEntries.map(
                                                                                ([
                                                                                    k,
                                                                                    v,
                                                                                ]) => (
                                                                                    <tr
                                                                                        key={
                                                                                            k
                                                                                        }
                                                                                        className="border-b border-border-default/50"
                                                                                    >
                                                                                        <td className="py-1 pr-3 font-mono text-text-secondary">
                                                                                            {
                                                                                                k
                                                                                            }
                                                                                        </td>
                                                                                        <td className="py-1">
                                                                                            {String(
                                                                                                v
                                                                                            )}
                                                                                        </td>
                                                                                    </tr>
                                                                                )
                                                                            )}
                                                                        </tbody>
                                                                    </table>

                                                                    {/* Source spans */}
                                                                    {rec
                                                                        .source_spans
                                                                        .length >
                                                                        0 && (
                                                                            <div className="mt-2">
                                                                                <p className="text-xs font-medium text-text-secondary mb-1">
                                                                                    Origen
                                                                                    en
                                                                                    documento
                                                                                </p>
                                                                                {rec.source_spans.map(
                                                                                    (
                                                                                        span,
                                                                                        si
                                                                                    ) => (
                                                                                        <p
                                                                                            key={
                                                                                                si
                                                                                            }
                                                                                            className="text-xs text-text-secondary"
                                                                                        >
                                                                                            Pág.{" "}
                                                                                            {
                                                                                                span.page
                                                                                            }
                                                                                            ,
                                                                                            pos{" "}
                                                                                            {
                                                                                                span.start
                                                                                            }
                                                                                            –
                                                                                            {
                                                                                                span.end
                                                                                            }
                                                                                            {span.snippet && (
                                                                                                <span className="italic ml-1">
                                                                                                    {
                                                                                                        "\""}
                                                                                                    {span
                                                                                                        .snippet
                                                                                                        .length >
                                                                                                        60
                                                                                                        ? span.snippet.slice(
                                                                                                            0,
                                                                                                            60
                                                                                                        ) +
                                                                                                        "…"
                                                                                                        : span.snippet}
                                                                                                    {
                                                                                                        "\""}
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
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            }
                        )}
                    </div>

                    {result.records.length === 0 && (
                        <div className="text-center py-8">
                            <AlertCircle className="h-8 w-8 mx-auto text-text-secondary mb-2" />
                            <p className="text-sm text-text-secondary">
                                No se extrajeron registros del documento.
                            </p>
                            {result.warnings.length > 0 && (
                                <p className="text-xs text-text-secondary mt-1">
                                    Revisa los avisos arriba.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Success indicator */}
                    {result.records.length > 0 &&
                        !result.requires_manual_review && (
                            <div className="mt-4 flex items-center gap-1 text-xs text-green-600">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Extracción completada con éxito
                            </div>
                        )}
                </section>
            )}
        </div>
    );
}
