"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { summarizeCanonicalAssets } from "@/lib/canonical-exports";
import type { FiscalUnitRecord } from "@/lib/client-store";
import {
  expedienteModelLabel,
  exportModelForExpediente,
  exportModelLabel,
  isExpedienteModelType
} from "@/lib/expediente-models";
import type { OperationalDownloadFormat } from "@/lib/export-operational";
import type { CanonicalAssetSummary } from "@/lib/fiscal-canonical";
import type { FilingDecision } from "@/lib/model-filing-rules";
import { evaluateModelPreparation } from "@/lib/model-preparation";
import type { CanonicalApprovalStatus } from "@/lib/expediente-workflow";

interface ExportGeneratorProps {
  expedienteId: string;
}

type ExportResult = {
  expediente_id: string;
  expediente_reference: string;
  fiscal_year: number;
  model_type: string;
  model: "100" | "714" | "720";
  status: string;
  validation_state: "ok" | "warnings" | "errors";
  artifact_path: string;
  artifact_hash: string;
  generated_at: string;
  messages: string[];
  filing_decision?: FilingDecision | null;
  aeat_allowed?: boolean;
  available_download_formats?: OperationalDownloadFormat[];
};

type ExpedienteContext = {
  expediente_reference: string;
  fiscal_year: number;
  model_type: string;
  canonical_runtime_mode?: "persisted" | "derived";
  workflow: {
    canonical_approval_status: CanonicalApprovalStatus;
    filing_status: "draft" | "ready" | "filed";
    workflow_owner_name: string | null;
    pending_task: string | null;
  };
  counts: {
    total: number;
    manual_review: number;
    failed: number;
    assets: number;
    operations: number;
    sales_pending: number;
    exports: number;
    missing_ownership_assets?: number;
    missing_foreign_country_assets?: number;
    missing_foreign_block_assets?: number;
    missing_foreign_q4_assets?: number;
    threshold_reached_blocks?: number;
  };
  assets: CanonicalAssetSummary[];
  client: {
    reference: string;
    display_name: string;
    nif: string;
    fiscal_unit: FiscalUnitRecord;
  } | null;
  exports: Array<{
    id: string;
    model: "100" | "714" | "720";
    status: string;
    validation_state: string;
    artifact_path: string;
    filing_decision?: FilingDecision | null;
    aeat_allowed?: boolean | null;
    messages?: string[];
    generated_at: string;
  }>;
};

function validationBadgeClass(value: string): string {
  if (value === "ok") return "badge success";
  if (value === "warnings") return "badge warning";
  return "badge danger";
}

function checklistBadgeClass(value: "ok" | "warning" | "blocked"): string {
  if (value === "ok") return "badge success";
  if (value === "warning") return "badge warning";
  return "badge danger";
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("es-ES") : "Sin actividad";
}

function operationalModelCopy(model: "100" | "714" | "720" | null): string {
  if (model === "100") {
    return "Modelo 100: controla transmisiones, ganancias y pérdidas antes del cierre AEAT.";
  }

  if (model === "714") {
    return "Modelo 714: exige valoración patrimonial suficiente sobre activos consolidados.";
  }

  if (model === "720") {
    return "Modelo 720: exige bienes en el extranjero identificados y valorados.";
  }

  return "El expediente no tiene un modelo declarativo compatible.";
}

function downloadFilename(
  format: OperationalDownloadFormat,
  model: "100" | "714" | "720",
  expedienteReference: string,
  fiscalYear: number | undefined
): string {
  const year = fiscalYear ?? "";

  if (format === "report") {
    return `MODELO_${model}_${expedienteReference}_${year}_informe.txt`;
  }

  if (format === "xls") {
    return `MODELO_${model}_${expedienteReference}_${year}_operativo.xls`;
  }

  return `MODELO_${model}_${expedienteReference}_${year}.${model}`;
}

export function ExportGenerator({ expedienteId }: ExportGeneratorProps) {
  const [nif, setNif] = useState("");
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [context, setContext] = useState<ExpedienteContext | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      setContextLoading(true);

      try {
        const response = await fetch(`/api/expedientes/${expedienteId}`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as ExpedienteContext | { error?: string } | null;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          const errorMessage = body && "error" in body ? body.error : undefined;
          throw new Error(errorMessage ?? "No se pudo cargar el expediente para exportación.");
        }

        const nextContext = body as ExpedienteContext;
        setContext(nextContext);
        setNif((current) => current || nextContext.client?.fiscal_unit.primary_taxpayer_nif || nextContext.client?.nif || "");
        setContextError(null);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setContext(null);
        setContextError(
          loadError instanceof Error ? loadError.message : "No se pudo cargar el contexto de exportación."
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

  const allowedModel =
    context && isExpedienteModelType(context.model_type)
      ? exportModelForExpediente(context.model_type)
      : null;
  const declaredNif =
    nif.trim().toUpperCase() ||
    context?.client?.fiscal_unit.primary_taxpayer_nif ||
    context?.client?.nif ||
    null;
  const assetMetrics = useMemo(() => (context ? summarizeCanonicalAssets({ assets: context.assets }) : null), [context]);
  const preparation = useMemo(
    () =>
      context
        ? evaluateModelPreparation({
            model_type: context.model_type,
            has_client: Boolean(context.client),
            client_nif: declaredNif,
            fiscal_unit: context.client?.fiscal_unit ?? null,
            counts: {
              documents: context.counts.total,
              pending_review: context.counts.manual_review + context.counts.failed,
              open_alerts: 0,
              operations: context.counts.operations,
              assets: context.counts.assets,
              foreign_assets: assetMetrics?.foreignAssets ?? 0,
              missing_asset_values: assetMetrics?.missingValuationAssets ?? 0,
              missing_foreign_values: assetMetrics?.missingForeignValuationAssets ?? 0,
              missing_ownership_assets: assetMetrics?.missingOwnershipAssets ?? 0,
              missing_foreign_country_assets: assetMetrics?.missingForeignCountryAssets ?? 0,
              missing_foreign_block_assets: assetMetrics?.missingForeignBlockAssets ?? 0,
              missing_foreign_q4_assets: assetMetrics?.missingForeignQ4BalanceAssets ?? 0,
              threshold_reached_blocks: assetMetrics?.thresholdReachedBlocks.length ?? 0,
              sales_pending: context.counts.sales_pending,
              exports: context.counts.exports
            },
            canonical_runtime_mode: context.canonical_runtime_mode ?? "derived",
            canonical_approval_status: context.workflow.canonical_approval_status
          })
        : null,
    [assetMetrics, context, declaredNif]
  );

  const latestExport = context?.exports[0] ?? null;
  const aeatAllowedByPolicy = result?.aeat_allowed ?? latestExport?.aeat_allowed ?? true;
  const canGenerate =
    !loading &&
    !contextLoading &&
    Boolean(context?.client) &&
    Boolean(allowedModel) &&
    preparation?.status !== "blocked";
  const canDownloadOperational =
    !loading && !contextLoading && Boolean(context?.client) && Boolean(allowedModel);
  const canDownloadAeat =
    canDownloadOperational && preparation?.status !== "blocked" && Boolean(declaredNif) && aeatAllowedByPolicy;
  const nextHref =
    !context || !preparation
      ? null
      : preparation.next_target === "client"
        ? context.client
          ? `/clientes/${context.client.reference}`
          : null
        : preparation.next_target === "modelos"
          ? `/expedientes/${context.expediente_reference}?fase=modelos`
          : `/expedientes/${context.expediente_reference}?fase=${preparation.next_target}`;

  async function handleGenerate() {
    if (!allowedModel) {
      setError("El expediente no tiene un modelo declarativo compatible para exportación.");
      return;
    }

    if (!context?.client) {
      setError("El expediente debe estar vinculado a un cliente antes de preparar modelos AEAT.");
      return;
    }

    if (preparation?.status === "blocked") {
      setError(preparation.summary);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`/api/exports/${expedienteId}?model=${allowedModel}`, {
        method: "GET"
      });
      const payload = (await response.json()) as ExportResult | { error?: string };
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Error al generar");
        return;
      }
      setResult(payload as ExportResult);
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  function handleDownload(format: OperationalDownloadFormat) {
    if (!allowedModel) {
      setError("El expediente no tiene un modelo declarativo compatible para descarga.");
      return;
    }

    const nifParam = declaredNif?.trim().toUpperCase() ?? "";
    if (format === "aeat" && !nifParam) {
      setError("Indica el NIF del declarante antes de descargar el fichero AEAT.");
      return;
    }

    const searchParams = new URLSearchParams({ model: allowedModel, format });
    if (nifParam) {
      searchParams.set("nif", nifParam);
    }
    const url = `/api/exports/${expedienteId}/download?${searchParams.toString()}`;

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadFilename(
      format,
      allowedModel,
      context?.expediente_reference ?? expedienteId,
      context?.fiscal_year
    );
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>Workspace declarativo</h2>
          <p className="muted">
            Preparación operativa del expediente para salida AEAT, informe de trabajo y hoja XLS.
            Aquí se comprueban prerequisitos, se valida el modelo y se decide qué salida puede usarse.
          </p>
        </div>
        {context && allowedModel ? (
          <span className="badge info">
            {context.expediente_reference} · {expedienteModelLabel(context.model_type)} · {exportModelLabel(allowedModel)}
          </span>
        ) : null}
      </div>

      {context ? (
        <div className="model-generator-grid">
          <article className="stack-item">
            <h3>Estado declarativo</h3>
            {preparation ? (
              <>
                <p style={{ marginTop: "10px" }}>
                  <span
                    className={
                      preparation.status === "ready"
                        ? "badge success"
                        : preparation.status === "attention"
                          ? "badge warning"
                          : "badge danger"
                    }
                  >
                    {preparation.status === "ready"
                      ? "Listo"
                      : preparation.status === "attention"
                        ? "Con atención"
                        : "Bloqueado"}
                  </span>
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  {preparation.summary}
                </p>
                <p className="muted" style={{ margin: "10px 0 0" }}>
                  Bloqueos: {preparation.blockers} · advertencias: {preparation.warnings}
                </p>
                {nextHref ? (
                  <div className="model-workspace-actions" style={{ marginTop: "12px" }}>
                    <Link href={nextHref} className="button-link">
                      {preparation.next_label}
                    </Link>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Cargando estado declarativo...
              </p>
            )}
          </article>

          <article className="stack-item">
            <h3>Contexto fiscal</h3>
            <p className="muted" style={{ margin: 0 }}>
              Cliente: {context.client ? context.client.display_name : "sin cliente"}
              <br />
              Declarante: {declaredNif ?? "sin NIF"}
              <br />
              Runtime canónico: {context.canonical_runtime_mode === "persisted" ? "persistido" : "derivado"}
              <br />
              Gate canónico: {context.workflow.canonical_approval_status}
              <br />
              Documentos: {context.counts.total} · revisión pendiente: {context.counts.manual_review + context.counts.failed}
              <br />
              Operaciones: {context.counts.operations} · activos: {assetMetrics?.totalAssets ?? context.counts.assets}
              <br />
              Activos extranjeros: {assetMetrics?.foreignAssets ?? 0} · sin valorar: {assetMetrics?.missingForeignValuationAssets ?? 0}
              <br />
              Sin titularidad: {assetMetrics?.missingOwnershipAssets ?? 0} · bloques 720 sobre umbral: {assetMetrics?.thresholdReachedBlocks.length ?? 0}
              <br />
              Ventas pendientes: {context.counts.sales_pending}
              <br />
              Owner: {context.workflow.workflow_owner_name ?? "sin asignar"}
            </p>
          </article>
        </div>
      ) : null}

      {preparation ? (
        <div className="model-checklist-grid" style={{ marginTop: "18px" }}>
          {preparation.checklist.map((check) => (
            <article className="stack-item" key={check.code}>
              <div className="review-item-header">
                <h3>{check.label}</h3>
                <span className={checklistBadgeClass(check.status)}>{check.status}</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {check.detail}
              </p>
            </article>
          ))}
        </div>
      ) : null}

      <div className="model-generator-grid" style={{ marginTop: "18px" }}>
        <article className="stack-item">
          <h3>Acción AEAT</h3>
          <div className="form" style={{ marginTop: "10px" }}>
            <label htmlFor="nif-input">NIF del declarante</label>
            <input
              id="nif-input"
              type="text"
              placeholder="Ej: 12345678A"
              value={nif}
              onChange={(event) => setNif(event.target.value.toUpperCase())}
              maxLength={20}
              style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}
              disabled={contextLoading || loading}
            />

            <p className="muted" style={{ marginTop: "-4px" }}>
              Se usa como valor inicial el NIF del sujeto pasivo principal o, en su defecto, el de la ficha del cliente.
            </p>
            <p className="muted" style={{ marginTop: "-4px" }}>
              {operationalModelCopy(allowedModel)}
            </p>
            <p className="muted" style={{ marginTop: "-4px" }}>
              El informe y la hoja XLS pueden descargarse para trabajo interno aunque la salida AEAT siga bloqueada.
            </p>

            <div className="model-workspace-actions">
              <button type="button" className="secondary" onClick={handleGenerate} disabled={!canGenerate}>
                {loading ? "Validando..." : "Validar preparación"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleDownload("report")}
                disabled={!canDownloadOperational}
              >
                Descargar informe
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleDownload("xls")}
                disabled={!canDownloadOperational}
              >
                Descargar hoja XLS
              </button>
              <button type="button" onClick={() => handleDownload("aeat")} disabled={!canDownloadAeat}>
                Descargar fichero AEAT
              </button>
            </div>
          </div>
        </article>

        <article className="stack-item">
          <h3>Informe de preparación</h3>
          <p className="muted" style={{ margin: 0 }}>
            Modelo: {allowedModel ? exportModelLabel(allowedModel) : "sin modelo"}
            <br />
            Expediente: {context?.expediente_reference ?? expedienteId}
            <br />
            Ejercicio: {context?.fiscal_year ?? "-"}
            <br />
            Unidad fiscal: {context?.client?.fiscal_unit ? "informada" : "sin estructurar"}
            <br />
            Historial declarativo: {context?.counts.exports ?? 0} validación(es) o exporte(s)
            <br />
            Patrimonio consolidado: {assetMetrics?.totalValuation ?? 0} · extranjero: {assetMetrics?.totalForeignValuation ?? 0}
            <br />
            Tarea pendiente: {context?.workflow.pending_task ?? "sin tarea pendiente"}
          </p>
          {latestExport ? (
            <p style={{ marginTop: "10px" }}>
              <span className="badge info">{latestExport.status}</span>{" "}
              <span className={validationBadgeClass(latestExport.validation_state)}>
                {latestExport.validation_state}
              </span>
            </p>
          ) : null}
        </article>
      </div>

      {contextError ? <p className="badge warning">{contextError}</p> : null}
      {error ? <p className="badge danger">{error}</p> : null}

      {result ? (
        <div className="result model-result-panel">
          <div className="review-item-header">
            <h3>Última validación</h3>
            <span className={validationBadgeClass(result.validation_state)}>
              {result.validation_state === "ok"
                ? "Validación correcta"
                : result.validation_state === "warnings"
                  ? "Con advertencias"
                  : "Con errores"}
            </span>
          </div>
          {result.messages.length > 0 ? (
            <ul style={{ marginTop: "8px", paddingLeft: "1.2rem" }}>
              {result.messages.map((msg, index) => (
                <li key={index} className="muted" style={{ fontSize: "0.85rem" }}>
                  {msg}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginTop: "8px" }}>
              Sin observaciones.
            </p>
          )}
          <details style={{ marginTop: "12px" }}>
            <summary className="muted">Ver metadatos técnicos</summary>
            <pre style={{ fontSize: "0.75rem", overflowX: "auto" }}>
              {JSON.stringify(
                {
                  artifact_path: result.artifact_path,
                  artifact_hash: `${result.artifact_hash.slice(0, 16)}...`,
                  generated_at: result.generated_at,
                  expediente_reference: result.expediente_reference,
                  fiscal_year: result.fiscal_year,
                  available_download_formats: result.available_download_formats ?? ["aeat", "report", "xls"]
                },
                null,
                2
              )}
            </pre>
          </details>
        </div>
      ) : latestExport ? (
        <div className="result model-result-panel">
          <div className="review-item-header">
            <h3>Última salida registrada</h3>
            <span className={validationBadgeClass(latestExport.validation_state)}>
              {latestExport.validation_state}
            </span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            {latestExport.model} · {formatDate(latestExport.generated_at)}
          </p>
          {latestExport.messages && latestExport.messages.length > 0 ? (
            <ul style={{ marginTop: "8px", paddingLeft: "1.2rem" }}>
              {latestExport.messages.map((message, index) => (
                <li key={index} className="muted" style={{ fontSize: "0.85rem" }}>
                  {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
