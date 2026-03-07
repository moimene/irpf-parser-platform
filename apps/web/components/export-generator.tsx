"use client";
import { useState } from "react";

interface ExportGeneratorProps {
 expedienteId: string;
}

type ExportResult = {
 expediente_id: string;
 model: "100" | "714" | "720";
 status: string;
 validation_state: "ok" | "warnings" | "errors";
 artifact_path: string;
 artifact_hash: string;
 generated_at: string;
 messages: string[];
 runtime_issues?: Array<{
 code: string;
 operation_id: string;
 isin?: string | null;
 quantity?: number | null;
 message: string;
 }>;
 blocked_losses?: Array<{
 sale_operation_id: string;
 blocked_by_buy_operation_id: string;
 isin: string;
 sale_date: string;
 blocked_by_buy_date: string;
 window_months: number;
 realized_loss: number | null;
 currency: string | null;
 }>;
};

function formatCurrency(value: number | null, currency: string | null | undefined): string {
 if (value === null) {
 return "-";
 }

 const resolvedCurrency = currency?.trim().toUpperCase() || "EUR";

 try {
 return new Intl.NumberFormat("es-ES", {
 style: "currency",
 currency: resolvedCurrency,
 minimumFractionDigits: 2,
 maximumFractionDigits: 2
 }).format(value);
 } catch {
 return `${value.toFixed(2)} ${resolvedCurrency}`;
 }
}

export function ExportGenerator({ expedienteId }: ExportGeneratorProps) {
 const [model, setModel] = useState<"100" | "714" | "720">("100");
 const [nif, setNif] = useState("");
 const [ejercicio, setEjercicio] = useState(new Date().getFullYear().toString());
 const [loading, setLoading] = useState(false);
 const [result, setResult] = useState<ExportResult | null>(null);
 const [error, setError] = useState<string | null>(null);
 const canDownload =
 result !== null &&
 result.model === model &&
 result.validation_state !== "errors" &&
 !loading;

 async function handleGenerate() {
 setLoading(true);
 setError(null);
 setResult(null);
 try {
 const response = await fetch(`/api/exports/${expedienteId}?model=${model}`, {
 method: "GET",
 });
 const payload = (await response.json()) as ExportResult;
 if (!response.ok) {
 setError((payload as unknown as { error: string }).error ?? "Error al generar");
 return;
 }
 setResult(payload);
 window.dispatchEvent(new Event("expediente:refresh"));
 } catch (err) {
 setError(err instanceof Error ? err.message : "Error desconocido");
 } finally {
 setLoading(false);
 }
 }

 function handleDownload() {
 const nifParam = nif.trim() || "00000000T";
 const url = `/api/exports/${expedienteId}/download?model=${model}&nif=${encodeURIComponent(nifParam)}&ejercicio=${ejercicio}`;
 // Descarga directa del fichero AEAT
 const a = document.createElement("a");
 a.href = url;
 a.download = `MODELO_${model}_${ejercicio}.${model}`;
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 }

 return (
 <section className="card">
 <h2>Exportadores AEAT</h2>
 <p className="muted">
 Genera ficheros <code>.100</code>, <code>.714</code> y <code>.720</code> en formato de
 longitud fija para presentación telemática en la AEAT.
 </p>
 <div className="form">
 <label htmlFor="model-select">Modelo AEAT</label>
 <select
 id="model-select"
 value={model}
 onChange={(e) => setModel(e.target.value as "100" | "714" | "720")}
 >
 <option value="100">Modelo 100 — IRPF (Ganancias y pérdidas)</option>
 <option value="714">Modelo 714 — Impuesto sobre el Patrimonio</option>
 <option value="720">Modelo 720 — Bienes en el extranjero</option>
 </select>

 <label htmlFor="nif-input">NIF del declarante</label>
 <input
 id="nif-input"
 type="text"
 placeholder="Ej: 12345678A"
 value={nif}
 onChange={(e) => setNif(e.target.value.toUpperCase())}
 maxLength={9}
 style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
 />

 <label htmlFor="ejercicio-input">Ejercicio fiscal</label>
 <input
 id="ejercicio-input"
 type="number"
 min={2013}
 max={2030}
 value={ejercicio}
 onChange={(e) => setEjercicio(e.target.value)}
 />

 <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
 <button type="button" className="secondary" onClick={handleGenerate} disabled={loading}>
 {loading ? "Validando..." : "Validar y previsualizar"}
 </button>
 <button
 type="button"
 onClick={handleDownload}
 disabled={!canDownload}
 style={{
 background: "var(--color-primary, #1a365d)",
 color: "white",
 border: "none",
 borderRadius: "4px",
 padding: "8px 16px",
 cursor: canDownload ? "pointer" : "not-allowed",
 opacity: canDownload ? 1 : 0.6,
 fontWeight: 600,
 }}
 >
 Descargar fichero AEAT
 </button>
 </div>
 </div>

 {error ? <p className="badge danger">{error}</p> : null}

 {result ? (
 <div className="result">
 <p>
 <span
 className={`badge ${
 result.validation_state === "ok"
 ? "success"
 : result.validation_state === "warnings"
 ? "warning"
 : "danger"
 }`}
 >
 {result.validation_state === "ok"
 ? "Validación correcta"
 : result.validation_state === "warnings"
 ? "Con advertencias"
 : "Con errores"}
 </span>
 </p>
 {result.messages.length > 0 && (
 <ul style={{ marginTop: "8px", paddingLeft: "1.2rem" }}>
 {result.messages.map((msg, i) => (
 <li key={i} className="muted" style={{ fontSize: "0.85rem" }}>
 {msg}
 </li>
 ))}
 </ul>
 )}
 {result.runtime_issues && result.runtime_issues.length > 0 ? (
 <div style={{ marginTop: "12px" }}>
 <p className="muted" style={{ marginBottom: "8px" }}>
 Incidencias de runtime detectadas antes de exportar:
 </p>
 <ul style={{ marginTop: "8px", paddingLeft: "1.2rem" }}>
 {result.runtime_issues.map((issue) => (
 <li key={`${issue.code}-${issue.operation_id}`} className="muted" style={{ fontSize: "0.85rem" }}>
 {issue.message}
 </li>
 ))}
 </ul>
 </div>
 ) : null}
 {result.blocked_losses && result.blocked_losses.length > 0 ? (
 <div style={{ marginTop: "12px" }}>
 <p className="muted" style={{ marginBottom: "8px" }}>
 Trazabilidad de pérdidas bloqueadas detectadas:
 </p>
 <div className="table-wrap">
 <table>
 <thead>
 <tr>
 <th>Venta</th>
 <th>Recompra</th>
 <th>Pérdida</th>
 <th>Regla</th>
 </tr>
 </thead>
 <tbody>
 {result.blocked_losses.map((blockedLoss) => (
 <tr key={`${blockedLoss.sale_operation_id}-${blockedLoss.blocked_by_buy_operation_id}`}>
 <td>{new Date(blockedLoss.sale_date).toLocaleDateString("es-ES")} · {blockedLoss.isin}</td>
 <td>{new Date(blockedLoss.blocked_by_buy_date).toLocaleDateString("es-ES")}</td>
 <td>{formatCurrency(blockedLoss.realized_loss, blockedLoss.currency)}</td>
 <td>{blockedLoss.window_months} meses</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 ) : null}
 {result?.validation_state === "errors" ? (
 <p className="muted" style={{ marginTop: "8px" }}>
 Corrige los errores de validación antes de descargar el fichero AEAT.
 </p>
 ) : null}
 <details style={{ marginTop: "12px" }}>
 <summary className="muted">Ver metadatos técnicos</summary>
 <pre style={{ fontSize: "0.75rem", overflowX: "auto" }}>
 {JSON.stringify(
 {
 artifact_path: result.artifact_path,
 artifact_hash: result.artifact_hash.slice(0, 16) + "...",
 generated_at: result.generated_at,
 },
 null,
 2
 )}
 </pre>
 </details>
 </div>
 ) : null}
 </section>
 );
}
