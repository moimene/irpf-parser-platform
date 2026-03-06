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

type UploadUrlItem = {
 client_id: string;
 filename: string;
 storage_path: string;
 signed_url: string;
};

type UploadUrlResponse = {
 uploads: UploadUrlItem[];
};

interface IntakeFormProps {
 expedienteId: string;
}

export function IntakeForm({ expedienteId }: IntakeFormProps) {
 const MAX_FILE_BYTES = 15 * 1024 * 1024;
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
 const oversizedFile = files.find((file) => file.size > MAX_FILE_BYTES);
 if (oversizedFile) {
 setError(`El fichero ${oversizedFile.name} supera el límite de 15 MB.`);
 return;
 }
 setSelectedFiles(files);
 setError(null);
 }

 async function uploadFileToSignedUrl(signedUrl: string, file: File): Promise<void> {
 const formData = new FormData();
 formData.append("cacheControl", "3600");
 formData.append("", file);

 const controller = new AbortController();
 const timeoutId = window.setTimeout(() => controller.abort(), 120_000);

 try {
 const response = await fetch(signedUrl, {
 method: "PUT",
 body: formData,
 signal: controller.signal
 });
 if (!response.ok) {
 const body = await response.text().catch(() => "");
 throw new Error(`Error subiendo ${file.name} (${response.status}): ${body || "sin detalle"}`);
 }
 } finally {
 window.clearTimeout(timeoutId);
 }
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
 setProgress("Preparando subida segura...");

 try {
 const filesForUpload = selectedFiles.map((file, index) => ({
 client_id: String(index),
 filename: file.name,
 content_type: file.type || "application/pdf",
 size_bytes: file.size
 }));

 const uploadUrlsResponse = await fetch("/api/documents/upload-urls", {
 method: "POST",
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 expediente_id: expedienteId,
 files: filesForUpload
 })
 });
 const uploadPayload = (await uploadUrlsResponse.json()) as UploadUrlResponse | { error: string };
 if (!uploadUrlsResponse.ok) {
 setError((uploadPayload as { error: string }).error ?? "No se pudo preparar la subida de ficheros");
 return;
 }

 const uploadPlan = uploadPayload as UploadUrlResponse;
 const fileByClientId = new Map(filesForUpload.map((file, index) => [file.client_id, selectedFiles[index]]));

 for (let i = 0; i < uploadPlan.uploads.length; i += 1) {
 const upload = uploadPlan.uploads[i];
 const file = fileByClientId.get(upload.client_id);
 if (!file) {
 throw new Error(`No se encontró fichero local para ${upload.filename}`);
 }
 setProgress(`Subiendo ${i + 1}/${uploadPlan.uploads.length}: ${upload.filename}`);
 await uploadFileToSignedUrl(upload.signed_url, file);
 }

 const documents = uploadPlan.uploads.map((upload) => ({
 filename: upload.filename,
 source_type: "PDF" as const,
 storage_path: upload.storage_path,
 entity_hint: entityHint || undefined,
 }));

 setProgress(`Registrando ${documents.length} documento(s) para parseo...`);

 const response = await fetch("/api/documents/intake", {
 method: "POST",
 headers: { "content-type": "application/json" },
 body: JSON.stringify({
 expediente_id: expedienteId,
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
 Sube hasta 20 PDFs bancarios (Pictet, Goldman Sachs, Citi u otros). Los ficheros se cargan
 directamente a Supabase Storage y luego se encolan para parseo automático en Railway.
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
 <option value="JPMORGAN">J.P. Morgan</option>
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
