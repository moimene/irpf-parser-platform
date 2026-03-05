"use client";

import { useMemo, useState } from "react";

type IntakeResponse = {
  document_id: string;
  expediente_id: string;
  status: string;
  accepted: number;
  items: Array<{
    document_id: string;
    expediente_id: string;
    status: string;
  }>;
};

interface IntakeFormProps {
  expedienteId: string;
}

export function IntakeForm({ expedienteId }: IntakeFormProps) {
  const [filenames, setFilenames] = useState(
    "PICTET 001 DIC 2025 FAGU.pdf\nGS 553-4 DIC 2025 FAGU.pdf\nCiti NY 862 DIC 2025 FAGU.pdf"
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IntakeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(
    () =>
      filenames
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [filenames]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/documents/intake", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          expediente_id: expedienteId,
          uploaded_by: "fiscalista.demo",
          documents: names.map((filename) => ({
            filename,
            source_type: "PDF"
          }))
        })
      });

      const payload = (await response.json()) as IntakeResponse | { error: string };

      if (!response.ok) {
        setError((payload as { error: string }).error);
        return;
      }

      setResult(payload as IntakeResponse);
    } catch {
      setError("No se pudo ejecutar la ingesta");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card">
      <h2>Importadores · Carga de documentos</h2>
      <p className="muted">
        Soporta hasta 20 ficheros por petición para cumplir HU-001 (ingesta paralela).
      </p>
      <form className="form" onSubmit={handleSubmit}>
        <label htmlFor="filenames">Lista de archivos (uno por línea)</label>
        <textarea
          id="filenames"
          rows={8}
          value={filenames}
          onChange={(event) => setFilenames(event.target.value)}
        />
        <button type="submit" disabled={submitting || names.length === 0 || names.length > 20}>
          {submitting ? "Encolando..." : `Encolar ${names.length} documento(s)`}
        </button>
      </form>
      {error ? <p className="badge danger">{error}</p> : null}
      {result ? (
        <div className="result">
          <strong>Resultado intake:</strong>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
