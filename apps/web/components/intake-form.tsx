"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { inferDocumentSourceType, mimeTypeForDocumentSourceType } from "@/lib/document-source";

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

type ClientOption = {
  id: string;
  reference: string;
  display_name: string;
  nif: string;
  status: "active" | "inactive" | "archived";
};

type ClientsResponse = {
  clients: ClientOption[];
};

type ExpedienteContextResponse = {
  client: ClientOption | null;
};

interface IntakeFormProps {
  expedienteId: string;
  onSuccess?: () => void;
}

export function IntakeForm({ expedienteId, onSuccess }: IntakeFormProps) {
  const maxFileBytes = 15 * 1024 * 1024;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [entityHint, setEntityHint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [availableClients, setAvailableClients] = useState<ClientOption[]>([]);
  const [boundClient, setBoundClient] = useState<ClientOption | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  const effectiveClientId = boundClient?.id ?? selectedClientId;
  const requiresExplicitClient = !boundClient && availableClients.length > 1;
  const submitDisabled =
    submitting ||
    selectedFiles.length === 0 ||
    selectedFiles.length > 20 ||
    (!boundClient && availableClients.length > 0 && !effectiveClientId) ||
    contextLoading;

  const selectedClient = useMemo(
    () => availableClients.find((client) => client.id === effectiveClientId) ?? null,
    [availableClients, effectiveClientId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      setContextLoading(true);

      try {
        const [clientsResponse, expedienteResponse] = await Promise.all([
          fetch("/api/clientes", { cache: "no-store" }),
          fetch(`/api/expedientes/${expedienteId}`, { cache: "no-store" })
        ]);

        const clientsBody = (await clientsResponse.json().catch(() => null)) as
          | ClientsResponse
          | { error?: string }
          | null;

        if (!clientsResponse.ok) {
          const errorMessage =
            clientsBody && "error" in clientsBody ? clientsBody.error : undefined;
          throw new Error(errorMessage ?? "No se pudo cargar la cartera de clientes.");
        }

        const clients = (clientsBody as ClientsResponse).clients ?? [];
        const expedienteBody = (await expedienteResponse.json().catch(() => null)) as
          | ExpedienteContextResponse
          | { error?: string }
          | null;

        const resolvedBoundClient =
          expedienteResponse.ok && expedienteBody && "client" in expedienteBody
            ? expedienteBody.client
            : null;

        if (cancelled) {
          return;
        }

        setAvailableClients(clients);
        setBoundClient(resolvedBoundClient);
        setSelectedClientId((current) => {
          if (resolvedBoundClient?.id) {
            return resolvedBoundClient.id;
          }

          if (current && clients.some((client) => client.id === current)) {
            return current;
          }

          if (clients.length === 1) {
            return clients[0].id;
          }

          return "";
        });
        setContextError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setContextError(
          loadError instanceof Error ? loadError.message : "No se pudo preparar el contexto del expediente."
        );
      } finally {
        if (!cancelled) {
          setContextLoading(false);
        }
      }
    }

    void loadContext();

    const refreshListener = () => void loadContext();
    window.addEventListener("expediente:refresh", refreshListener);

    return () => {
      cancelled = true;
      window.removeEventListener("expediente:refresh", refreshListener);
    };
  }, [expedienteId]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 20) {
      setError("Máximo 20 ficheros por petición (HU-001).");
      return;
    }

    const oversizedFile = files.find((file) => file.size > maxFileBytes);
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
      setError("Selecciona al menos un fichero PDF, CSV o Excel.");
      return;
    }

    if (!effectiveClientId) {
      setError("Selecciona el cliente al que pertenece este expediente antes de ingestar documentos.");
      return;
    }

    setError(null);
    setResult(null);
    setSubmitting(true);
    setProgress("Preparando subida segura...");

    try {
      const filesForUpload = selectedFiles.map((file, index) => ({
        source_type: inferDocumentSourceType(file.name, file.type),
        client_id: String(index),
        filename: file.name,
        content_type: mimeTypeForDocumentSourceType(
          inferDocumentSourceType(file.name, file.type),
          file.type
        ),
        size_bytes: file.size
      }));

      const uploadUrlsResponse = await fetch("/api/documents/upload-urls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expediente_id: expedienteId,
          client_id: effectiveClientId,
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

      for (let index = 0; index < uploadPlan.uploads.length; index += 1) {
        const upload = uploadPlan.uploads[index];
        const file = fileByClientId.get(upload.client_id);

        if (!file) {
          throw new Error(`No se encontró fichero local para ${upload.filename}`);
        }

        setProgress(`Subiendo ${index + 1}/${uploadPlan.uploads.length}: ${upload.filename}`);
        await uploadFileToSignedUrl(upload.signed_url, file);
      }

      const documents = uploadPlan.uploads.map((upload) => ({
        source_type: filesForUpload.find((file) => file.client_id === upload.client_id)?.source_type ?? "PDF",
        filename: upload.filename,
        storage_path: upload.storage_path,
        entity_hint: entityHint || undefined
      }));

      setProgress(`Registrando ${documents.length} documento(s) para parseo...`);

      const response = await fetch("/api/documents/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expediente_id: expedienteId,
          client_id: effectiveClientId,
          uploaded_by: "fiscalista.demo",
          documents
        })
      });

      const payload = (await response.json()) as IntakeResponse | { error: string };
      if (!response.ok) {
        setError((payload as { error: string }).error ?? "Error en la ingesta");
        return;
      }

      setResult(payload as IntakeResponse);
      if (!boundClient && selectedClient) {
        setBoundClient(selectedClient);
      }
      window.dispatchEvent(new Event("expediente:refresh"));
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onSuccess?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo ejecutar la ingesta");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  }

  return (
    <section className="card">
      <h2>Ingesta de Documentos</h2>
      <p className="muted">
        Sube hasta 20 documentos bancarios en PDF, CSV o Excel. Los ficheros se cargan directamente
        a Supabase Storage y luego se encolan para parseo automático en Railway.
      </p>

      {boundClient ? (
        <p className="badge info" style={{ marginBottom: "12px" }}>
          Expediente vinculado a&nbsp;
          <Link href={`/clientes/${boundClient.reference}`}>{boundClient.display_name}</Link>
          &nbsp;· {boundClient.nif}
        </p>
      ) : null}

      {!boundClient ? (
        <div className="form" style={{ marginBottom: "16px" }}>
          <label htmlFor="intake-client-id">Cliente del expediente</label>
          <select
            id="intake-client-id"
            value={selectedClientId}
            onChange={(event) => setSelectedClientId(event.target.value)}
            disabled={submitting || contextLoading || availableClients.length === 0}
          >
            <option value="">
              {contextLoading
                ? "Cargando clientes accesibles..."
                : availableClients.length === 0
                  ? "No hay clientes accesibles"
                  : "Selecciona un cliente"}
            </option>
            {availableClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.display_name} · {client.nif}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: "6px" }}>
            {requiresExplicitClient
              ? "Este expediente todavía no está asociado a un cliente. Debes elegirlo antes de subir documentos."
              : "El cliente seleccionado se usará para abrir y vincular el expediente en la primera ingesta."}
          </p>
        </div>
      ) : null}

      <form className="form" onSubmit={handleSubmit}>
        <label htmlFor="pdf-files">Archivos PDF, CSV o Excel (máx. 20)</label>
        <input
          ref={fileInputRef}
          id="pdf-files"
          type="file"
          accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          onChange={handleFileChange}
          disabled={submitting}
        />

        {selectedFiles.length > 0 ? (
          <ul className="file-list">
            {selectedFiles.map((file, index) => (
              <li key={`${file.name}-${index}`}>
                <span className="badge info">{file.name}</span>
                <span className="muted"> — {(file.size / 1024).toFixed(0)} KB</span>
              </li>
            ))}
          </ul>
        ) : null}

        <label htmlFor="entity-hint">Entidad bancaria (opcional)</label>
        <select
          id="entity-hint"
          value={entityHint}
          onChange={(event) => setEntityHint(event.target.value)}
          disabled={submitting}
        >
          <option value="">Detectar automáticamente</option>
          <option value="PICTET">Pictet</option>
          <option value="GOLDMAN_SACHS">Goldman Sachs</option>
          <option value="CITI">Citi</option>
          <option value="JPMORGAN">J.P. Morgan</option>
        </select>

        <button type="submit" disabled={submitDisabled}>
          {submitting ? progress || "Procesando..." : `Encolar ${selectedFiles.length || 0} documento(s)`}
        </button>
      </form>

      {contextError ? <p className="badge warning">{contextError}</p> : null}
      {error ? <p className="badge danger">{error}</p> : null}

      {result ? (
        <div className="result">
          <p className="badge success">
            {result.accepted} documento(s) encolado(s) — Expediente: <strong>{result.expediente_reference}</strong>
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
