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
};

export function ExportGenerator({ expedienteId }: ExportGeneratorProps) {
  const [model, setModel] = useState<"100" | "714" | "720">("100");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);

  async function handleGenerate() {
    setLoading(true);
    try {
      const response = await fetch(`/api/exports/${expedienteId}?model=${model}`, {
        method: "GET"
      });
      const payload = (await response.json()) as ExportResult;
      setResult(payload);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card">
      <h2>Exportadores · Previsualización y generación</h2>
      <p className="muted">Genera artefactos `.100`, `.714` y `.720` con estado de validación.</p>
      <div className="form">
        <label htmlFor="model">Modelo AEAT</label>
        <select id="model" value={model} onChange={(event) => setModel(event.target.value as "100" | "714" | "720")}> 
          <option value="100">Modelo 100 (IRPF)</option>
          <option value="714">Modelo 714 (IP)</option>
          <option value="720">Modelo 720</option>
        </select>
        <button type="button" className="secondary" onClick={handleGenerate} disabled={loading}>
          {loading ? "Generando..." : "Generar fichero"}
        </button>
      </div>

      {result ? (
        <div className="result">
          <strong>Resultado export:</strong>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </section>
  );
}
