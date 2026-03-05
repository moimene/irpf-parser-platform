"use client";
import { useRef, useState } from "react";

type IntakeItem = {
 document_id: string;
 expediente_id: string;
 status: string;
};
type IntakeResponse = {
 document_id: string;
 expediente_id: string;
 expediente_reference: string;
 status: string;
 accepted: number;
 items: IntakeItem[];
};

interface IntakeFormProps {
 expedienteId: string;
}

export function IntakeForm({ expedienteId }: IntakeFormProps) {
 const fileInputRef = useRef<HTMLInputElement>(null);
 const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
 const [entityHint, setEntityHint] = useState<string>("");
 const [submitting, setSubmitting] = useState(false);
 const [result, setResult] = useState<IntakeResponse | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [progress, setProgress] = useState<string>("");

 function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
 const files = Array.from(event.target.files ?? []);
 if (files.length > 20) {
 setError("Máximo 20 ficheros por petición (HU-001).");
 return;
 }
 setSelectedFiles(files);
 setError(null);
 }

 async function fileToBase64(file: File): Promise<string> {
 return new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = () => {
 const result = reader.result as string;
 // Eliminar el prefijo "data:application/pdf;base64,"
 const base64 = result.split(",")[1] ?? result;
 resolve(base64);
 };
 reader.onerror = reject;
 reader.readAsDataURL(file);
 });
 }

 async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
 event.preventDefault();
 if (selectedFiles.length === 0) {
 setError("Selecciona al menos un fichero PDF.");
 return;
 }
 setError(null);
 setResult(null);
 setSubmitting(true);
 setProgress("Leyendo ficheros...");

 try {
 // Convertir todos los PDFs a base64
 const documents = await Promise.all(
 selectedFiles.map(async (file) => {
 const base64 = await fileToBase64(file);
 return {
 filename: file.name,
 source_type: "PDF" as const,
 content_base64: base64,
 entity_hint: entityHint || undefined,
 };
 })
 );

 setProgress(`Enviando ${documents.length} documento(s) al parser...`);

 const response = await fetch("/api/documents/intake", {
 method: "POST",
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 expediente_id: expedienteId,
 uploaded_by: "fiscalista.demo",
 documents,
 }),
 });

 const payload = await response.json() as IntakeResponse | { error: string };
 if (!response.ok) {
 setError((payload as { error: string }).error ?? "Error en la ingesta");
 return;
 }
 setResult(payload as IntakeResponse);
 setSelectedFiles([]);
 if (fileInputRef.current) fileInputRef.current.value = "";
 } catch (err) {
 setError(err instanceof Error ? err.message : "No se pudo ejecutar la ingesta");
 } finally {
 setSubmitting(false);
 setProgress("");
 }
 }

 return (
 <section className="card">
 <h2>Ingesta de Documentos</h2>
 <p className="muted">
 Sube hasta 20 PDFs bancarios (Pictet, Goldman Sachs, Citi u otros). El contenido se
 envía al parser en Railway para extracción automática.
 </p>
 <form className="form" onSubmit={handleSubmit}>
 <label htmlFor="pdf-files">Archivos PDF (máx. 20)</label>
 <input
 ref={fileInputRef}
 id="pdf-files"
 type="file"
 accept=".pdf,application/pdf"
 multiple
 onChange={handleFileChange}
 disabled={submitting}
 />
 {selectedFiles.length > 0 && (
 <ul className="file-list">
 {selectedFiles.map((f, i) => (
 <li key={i}>
 <span className="badge info">{f.name}</span>
 <span className="muted"> — {(f.size / 1024).toFixed(0)} KB</span>
 </li>
 ))}
 </ul>
 )}

 <label htmlFor="entity-hint">Entidad bancaria (opcional)</label>
 <select
 id="entity-hint"
 value={entityHint}
 onChange={(e) => setEntityHint(e.target.value)}
 disabled={submitting}
 >
 <option value="">Detectar automáticamente</option>
 <option value="PICTET">Pictet</option>
 <option value="GOLDMAN_SACHS">Goldman Sachs</option>
 <option value="CITI">Citi</option>
 </select>

 <button
 type="submit"
 disabled={submitting || selectedFiles.length === 0 || selectedFiles.length > 20}
 >
 {submitting
 ? progress || "Procesando..."
 : `Encolar ${selectedFiles.length || 0} documento(s)`}
 </button>
 </form>

 {error ? <p className="badge danger">{error}</p> : null}

 {result ? (
 <div className="result">
 <p className="badge success">
 {result.accepted} documento(s) encolado(s) — Expediente:{" "}
 <strong>{result.expediente_reference}</strong>
 </p>
 <details>
 <summary className="muted">Ver detalle técnico</summary>
 <pre>{JSON.stringify(result, null, 2)}</pre>
 </details>
 </div>
 ) : null}
 </section>
 );
}
