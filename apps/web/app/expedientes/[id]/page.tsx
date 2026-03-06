"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { IntakeForm } from "@/components/intake-form";
import { ExportGenerator } from "@/components/export-generator";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Documento {
  id: string;
  filename: string;
  processing_status: string;
  entity: string | null;
  detected_template: string | null;
  confidence: number | null;
  manual_review_required: boolean;
  created_at: string;
}

interface Expediente {
  id: string;
  reference: string;
  fiscal_year: number;
  status: string;
  title: string;
  client_id: string | null;
  irpf_documents: Documento[];
}

interface ClienteResumen {
  id: string;
  full_name: string;
  nif: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  queued:        "En cola",
  processing:    "Procesando",
  completed:     "Completado",
  manual_review: "Revisión manual",
  failed:        "Error",
};

const STATUS_COLORS: Record<string, string> = {
  queued:        "status-queued",
  processing:    "status-processing",
  completed:     "status-completed",
  manual_review: "status-review",
  failed:        "status-failed",
};

function confidenceBar(v: number | null) {
  if (v === null) return null;
  const pct = Math.round(v * 100);
  const color = pct >= 80 ? "#004438" : pct >= 50 ? "#c7a000" : "#c0392b";
  return (
    <span className="conf-bar">
      <span className="conf-fill" style={{ width: `${pct}%`, background: color }} />
      <span className="conf-label">{pct}%</span>
    </span>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ExpedientePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("client_id");

  const [expediente, setExpediente] = useState<Expediente | null>(null);
  const [cliente, setCliente]       = useState<ClienteResumen | null>(null);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState<"ingesta" | "documentos" | "exportacion">("ingesta");
  const [polling, setPolling]       = useState(false);

  // ─── Cargar expediente ──────────────────────────────────────────────────────

  const fetchExpediente = useCallback(async () => {
    if (!id) return;
    try {
      const res  = await fetch(`/api/expedientes/${id}`);
      const data = await res.json();
      if (res.ok && data.expediente) {
        setExpediente(data.expediente);
        // Si hay documentos en proceso, activar polling
        const enProceso = (data.expediente.irpf_documents ?? []).some(
          (d: Documento) => d.processing_status === "queued" || d.processing_status === "processing"
        );
        setPolling(enProceso);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchExpediente();
  }, [fetchExpediente]);

  // Cargar datos del cliente si hay client_id
  useEffect(() => {
    const cid = clientIdParam ?? expediente?.client_id;
    if (!cid) return;
    fetch(`/api/clientes/${cid}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.client) setCliente({ id: data.client.id, full_name: data.client.full_name, nif: data.client.nif });
      })
      .catch(() => {});
  }, [clientIdParam, expediente?.client_id]);

  // Polling cada 5s mientras haya documentos en proceso
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(fetchExpediente, 5000);
    return () => clearInterval(t);
  }, [polling, fetchExpediente]);

  // Tras ingesta exitosa, recargar documentos y cambiar a tab documentos
  function handleIntakeSuccess() {
    setActiveTab("documentos");
    fetchExpediente();
  }

  if (loading) return <div className="loading-full">Cargando expediente...</div>;

  const docs = expediente?.irpf_documents ?? [];
  const numDocs = docs.length;
  const numCompleted = docs.filter((d) => d.processing_status === "completed").length;
  const numReview    = docs.filter((d) => d.processing_status === "manual_review").length;
  const numFailed    = docs.filter((d) => d.processing_status === "failed").length;
  const numQueued    = docs.filter((d) => d.processing_status === "queued" || d.processing_status === "processing").length;

  return (
    <div className="exp-layout">
      {/* ── Cabecera ── */}
      <div className="exp-header">
        <div className="exp-breadcrumb">
          {cliente ? (
            <>
              <Link href="/clientes" className="breadcrumb-link">Clientes</Link>
              <span className="breadcrumb-sep">/</span>
              <Link href={`/clientes/${cliente.id}`} className="breadcrumb-link">{cliente.full_name}</Link>
              <span className="breadcrumb-sep">/</span>
            </>
          ) : (
            <>
              <Link href="/clientes" className="breadcrumb-link">Clientes</Link>
              <span className="breadcrumb-sep">/</span>
            </>
          )}
          <span>{expediente?.reference ?? id}</span>
        </div>

        <div className="exp-meta">
          <h1 className="exp-title">{expediente?.title ?? `Expediente ${id}`}</h1>
          <div className="exp-datos">
            {expediente?.reference && (
              <span className="dato-item"><span className="dato-label">Ref.</span> <span className="dato-mono">{expediente.reference}</span></span>
            )}
            {expediente?.fiscal_year && (
              <span className="dato-item"><span className="dato-label">Ejercicio</span> {expediente.fiscal_year}</span>
            )}
            {cliente && (
              <span className="dato-item"><span className="dato-label">Cliente</span> {cliente.full_name} · <span className="dato-mono">{cliente.nif}</span></span>
            )}
            {expediente?.status && (
              <span className={`status-badge status-${expediente.status.toLowerCase()}`}>{expediente.status}</span>
            )}
          </div>
        </div>

        {/* Estadísticas rápidas */}
        {numDocs > 0 && (
          <div className="exp-stats">
            <div className="stat-item"><span className="stat-num">{numDocs}</span><span className="stat-label">Documentos</span></div>
            <div className="stat-item"><span className="stat-num stat-ok">{numCompleted}</span><span className="stat-label">Completados</span></div>
            {numReview > 0 && <div className="stat-item"><span className="stat-num stat-warn">{numReview}</span><span className="stat-label">Revisión manual</span></div>}
            {numFailed > 0 && <div className="stat-item"><span className="stat-num stat-err">{numFailed}</span><span className="stat-label">Con error</span></div>}
            {numQueued > 0 && <div className="stat-item stat-pulse"><span className="stat-num stat-queue">{numQueued}</span><span className="stat-label">En proceso</span></div>}
          </div>
        )}

        {/* Tabs */}
        <div className="main-tabs">
          {(["ingesta", "documentos", "exportacion"] as const).map((tab) => (
            <button
              key={tab}
              className={`main-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "ingesta"      ? "Nueva ingesta" :
               tab === "documentos"  ? `Documentos${numDocs ? ` (${numDocs})` : ""}` :
                                       "Exportación AEAT"}
              {tab === "documentos" && numQueued > 0 && <span className="tab-pulse" />}
            </button>
          ))}
        </div>
      </div>

      {/* ── Contenido ── */}
      <div className="exp-body">
        {activeTab === "ingesta" && (
          <div className="tab-section">
            <IntakeForm expedienteId={id} onSuccess={handleIntakeSuccess} />
          </div>
        )}

        {activeTab === "documentos" && (
          <div className="tab-section">
            {numDocs === 0 ? (
              <div className="empty-docs">
                <p>No hay documentos en este expediente.</p>
                <button className="btn-primary" onClick={() => setActiveTab("ingesta")}>
                  Iniciar ingesta de PDFs
                </button>
              </div>
            ) : (
              <>
                {numQueued > 0 && (
                  <div className="processing-banner">
                    <span className="spinner" /> {numQueued} documento(s) en proceso — actualizando automáticamente...
                  </div>
                )}
                <table className="docs-table">
                  <thead>
                    <tr>
                      <th>Archivo</th>
                      <th>Entidad</th>
                      <th>Plantilla</th>
                      <th>Confianza</th>
                      <th>Estado</th>
                      <th>Subido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((doc) => (
                      <tr key={doc.id}>
                        <td className="cell-filename">{doc.filename}</td>
                        <td className="cell-muted">{doc.entity ?? "—"}</td>
                        <td className="cell-muted">{doc.detected_template ?? "—"}</td>
                        <td>{confidenceBar(doc.confidence)}</td>
                        <td>
                          <span className={`status-badge ${STATUS_COLORS[doc.processing_status] ?? ""}`}>
                            {STATUS_LABELS[doc.processing_status] ?? doc.processing_status}
                          </span>
                          {doc.manual_review_required && (
                            <span className="review-flag">⚑ Revisión</span>
                          )}
                        </td>
                        <td className="cell-muted">
                          {new Date(doc.created_at).toLocaleDateString("es-ES")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {activeTab === "exportacion" && (
          <div className="tab-section">
            <ExportGenerator expedienteId={id} />
          </div>
        )}
      </div>

      <style>{`
        .exp-layout { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
        .exp-header { padding: 1.25rem 1.5rem 0; border-bottom: 1px solid var(--color-border, #d8d4cc); background: #fff; flex-shrink: 0; }
        .exp-breadcrumb { font-size: 0.8rem; color: var(--color-muted, #888); margin-bottom: 0.75rem; display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
        .breadcrumb-link { color: var(--color-primary, #004438); text-decoration: underline; text-underline-offset: 3px; }
        .breadcrumb-sep { color: var(--color-border, #d8d4cc); }
        .exp-title { font-size: 1.3rem; font-weight: 700; color: var(--color-primary, #004438); margin: 0 0 0.5rem; }
        .exp-datos { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; align-items: center; }
        .dato-item { font-size: 0.82rem; color: var(--color-muted, #888); }
        .dato-label { font-weight: 600; color: var(--color-text, #1a1a1a); margin-right: 0.3rem; }
        .dato-mono { font-family: 'Courier New', monospace; }
        .exp-stats { display: flex; gap: 0; border: 1px solid var(--color-border, #d8d4cc); margin-bottom: 1rem; width: fit-content; }
        .stat-item { padding: 0.4rem 1rem; border-right: 1px solid var(--color-border, #d8d4cc); text-align: center; }
        .stat-item:last-child { border-right: none; }
        .stat-num { display: block; font-size: 1.1rem; font-weight: 700; font-family: 'Courier New', monospace; color: var(--color-primary, #004438); }
        .stat-ok { color: #0a3622; }
        .stat-warn { color: #856404; }
        .stat-err { color: #c0392b; }
        .stat-queue { color: #004438; }
        .stat-label { font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-muted, #888); }
        .stat-pulse { animation: pulse-bg 1.5s ease-in-out infinite; }
        @keyframes pulse-bg { 0%,100% { background: transparent; } 50% { background: #f0f9f5; } }
        .main-tabs { display: flex; gap: 0; }
        .main-tab { position: relative; padding: 0.6rem 1.25rem; font-size: 0.85rem; font-weight: 500; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--color-muted, #888); display: flex; align-items: center; gap: 0.4rem; }
        .main-tab.active { color: var(--color-primary, #004438); border-bottom-color: var(--color-primary, #004438); font-weight: 600; }
        .tab-pulse { width: 6px; height: 6px; border-radius: 50%; background: #c7a000; display: inline-block; animation: blink 1s step-start infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .exp-body { flex: 1; overflow-y: auto; }
        .tab-section { padding: 1.5rem; max-width: 900px; }
        .empty-docs { padding: 3rem; text-align: center; color: var(--color-muted, #888); }
        .empty-docs p { margin-bottom: 1rem; }
        .processing-banner { display: flex; align-items: center; gap: 0.75rem; padding: 0.65rem 1rem; background: #fff8e1; border: 1px solid #f0d060; font-size: 0.82rem; color: #856404; margin-bottom: 1rem; }
        .spinner { width: 14px; height: 14px; border: 2px solid #c7a000; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .docs-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        .docs-table th { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 2px solid var(--color-border, #d8d4cc); font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-primary, #004438); background: #f5f4f0; white-space: nowrap; }
        .docs-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #f0ede6; vertical-align: middle; }
        .docs-table tr:hover td { background: #faf9f6; }
        .cell-filename { font-family: 'Courier New', monospace; font-size: 0.78rem; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cell-muted { color: var(--color-muted, #888); font-size: 0.78rem; }
        .conf-bar { display: inline-flex; align-items: center; gap: 0.4rem; }
        .conf-fill { display: inline-block; height: 6px; border-radius: 2px; min-width: 4px; transition: width 0.3s; }
        .conf-label { font-size: 0.72rem; font-family: 'Courier New', monospace; color: var(--color-muted, #888); }
        .status-badge { display: inline-block; padding: 2px 8px; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
        .status-queued { background: #e2e3e5; color: #41464b; }
        .status-processing { background: #cfe2ff; color: #084298; animation: pulse-bg 1.5s ease-in-out infinite; }
        .status-completed { background: #d1e7dd; color: #0a3622; }
        .status-review, .status-manual_review { background: #fff3cd; color: #856404; }
        .status-failed { background: #f8d7da; color: #842029; }
        .status-en_revision { background: #fff3cd; color: #856404; }
        .status-borrador { background: #e2e3e5; color: #41464b; }
        .review-flag { margin-left: 0.4rem; font-size: 0.68rem; color: #856404; }
        .loading-full { display: flex; align-items: center; justify-content: center; height: 100vh; color: var(--color-muted, #888); }
        .btn-primary { display: inline-block; padding: 0.5rem 1.25rem; background: var(--color-primary, #004438); color: #fff; font-size: 0.875rem; font-weight: 600; border: none; cursor: pointer; text-decoration: none; }
      `}</style>
    </div>
  );
}
