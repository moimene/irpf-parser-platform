"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ExpedienteDocument = {
  id: string;
  filename: string;
  processing_status: string;
  confidence: number;
  manual_review_required: boolean;
  uploaded_at: string | null;
  processed_at: string | null;
  uploaded_by: string | null;
  latest_extraction: {
    id: string;
    confidence: number;
    requires_manual_review: boolean;
    review_status: string;
    records_count: number;
    created_at: string;
  } | null;
};

type ExpedienteExport = {
  id: string;
  model: "100" | "714" | "720";
  status: string;
  validation_state: string;
  artifact_path: string;
  generated_at: string;
};

type ExpedienteOperation = {
  id: string;
  operation_type: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  retention: number | null;
  realized_gain: number | null;
  source: string;
  confidence: number | null;
  manual_notes: string | null;
};

type ExpedienteLot = {
  id: string;
  acquisition_operation_id: string | null;
  isin: string;
  description: string | null;
  acquisition_date: string;
  quantity_original: number;
  quantity_open: number;
  quantity_sold: number;
  unit_cost: number | null;
  total_cost: number | null;
  currency: string | null;
  status: "OPEN" | "CLOSED";
  source: string;
  sales_count: number;
  transfers_count: number;
};

type ExpedienteSaleSummary = {
  sale_operation_id: string;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  sale_amount: number | null;
  sale_amount_allocated: number | null;
  quantity_allocated: number;
  missing_quantity: number;
  cost_basis: number | null;
  realized_gain: number | null;
  reported_realized_gain: number | null;
  currency: string | null;
  allocations_count: number;
  status: "MATCHED" | "UNRESOLVED" | "PENDING_COST_BASIS" | "INVALID_DATA";
  source: string;
};

type ExpedienteBlockedLoss = {
  sale_operation_id: string;
  blocked_by_buy_operation_id: string;
  isin: string;
  sale_date: string;
  blocked_by_buy_date: string;
  window_months: number;
  sale_quantity: number;
  blocked_by_buy_quantity: number;
  realized_loss: number | null;
  currency: string | null;
  reason: string;
  sale_description: string | null;
  blocked_by_buy_description: string | null;
  sale_source: string;
  blocked_by_buy_source: string;
};

type ExpedienteAdjustment = {
  id: string;
  adjustment_type: "COST_BASIS" | "INHERITANCE" | "TRANSFER_IN" | "TRANSFER_OUT";
  status: "ACTIVE" | "ARCHIVED";
  target_operation_id: string | null;
  operation_date: string;
  isin: string | null;
  description: string | null;
  quantity: number | null;
  total_amount: number | null;
  currency: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string | null;
};

type DeclarationProfile = {
  id: string;
  declarant_nif: string;
  declared_nif: string;
  legal_representative_nif: string | null;
  declared_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  residence_country_code: string | null;
  residence_territory_code: string | null;
  default_asset_location_key: "ES" | "EX" | null;
};

type ExpedienteAsset = {
  id: string;
  asset_class:
    | "ACCOUNT"
    | "SECURITY"
    | "COLLECTIVE_INVESTMENT"
    | "INSURANCE"
    | "REAL_ESTATE"
    | "MOVABLE_ASSET";
  asset_key: "C" | "V" | "I" | "S" | "B" | "M";
  asset_subkey: string;
  condition_key: string;
  country_code: string;
  tax_territory_code: string | null;
  location_key: "ES" | "EX";
  incorporation_date: string;
  extinction_date: string | null;
  valuation_1_eur: number;
  valuation_2_eur: number | null;
  ownership_percentage: number;
  currency: string | null;
  entity_name: string | null;
  asset_description: string | null;
  display_name: string;
  supports_714: boolean;
  supports_720: boolean;
  is_foreign: boolean;
};

type ExpedienteFiscalEvent = {
  id: string;
  asset_id: string | null;
  event_type:
    | "ACQUISITION"
    | "DISPOSAL"
    | "INTEREST"
    | "DIVIDEND"
    | "RENT"
    | "WITHHOLDING"
    | "GAIN"
    | "LOSS"
    | "ADJUSTMENT";
  event_date: string;
  capital_operation_key: string | null;
  irpf_group: "RCM" | "GYP" | "OTRO" | null;
  irpf_subgroup: string | null;
  quantity: number | null;
  gross_amount_eur: number | null;
  net_amount_eur: number | null;
  withholding_amount_eur: number | null;
  proceeds_amount_eur: number | null;
  cost_basis_amount_eur: number | null;
  realized_result_eur: number | null;
  currency: string | null;
  expense_amount_eur: number | null;
  original_currency: string | null;
  gross_amount_original: number | null;
  fx_rate: number | null;
  unit_price_eur: number | null;
  is_closing_operation: boolean | null;
  is_stock_dividend: boolean | null;
  irpf_box_code: string | null;
  source: string;
  notes: string | null;
};

type ExpedienteRuntimeIssue = {
  code: string;
  operation_id: string;
  isin: string | null;
  quantity: number | null;
  message: string;
};

type ExpedientePayload = {
  expediente_id: string;
  expediente_reference: string;
  title: string;
  status: string;
  fiscal_year: number;
  model_type: string;
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
  } | null;
  canonical_registry_available: boolean;
  declaration_profile: DeclarationProfile | null;
  counts: {
    total: number;
    queued: number;
    processing: number;
    manual_review: number;
    completed: number;
    failed: number;
    operations: number;
    exports: number;
    lots_open: number;
    lots_closed: number;
    sales_matched: number;
    sales_pending: number;
    blocked_losses: number;
    adjustments_active: number;
    runtime_issues: number;
    assets_total: number;
    assets_foreign: number;
    assets_model_720: number;
    fiscal_events: number;
  };
  documents: ExpedienteDocument[];
  operations: ExpedienteOperation[];
  lots: ExpedienteLot[];
  adjustments: ExpedienteAdjustment[];
  assets: ExpedienteAsset[];
  fiscal_events: ExpedienteFiscalEvent[];
  sale_summaries: ExpedienteSaleSummary[];
  blocked_losses: ExpedienteBlockedLoss[];
  runtime_issues: ExpedienteRuntimeIssue[];
  exports: ExpedienteExport[];
};

const emptyState: ExpedientePayload = {
  expediente_id: "",
  expediente_reference: "",
  title: "",
  status: "BORRADOR",
  fiscal_year: new Date().getFullYear(),
  model_type: "IRPF",
  client: null,
  canonical_registry_available: false,
  declaration_profile: null,
  counts: {
    total: 0,
    queued: 0,
    processing: 0,
    manual_review: 0,
    completed: 0,
    failed: 0,
    operations: 0,
    exports: 0,
    lots_open: 0,
    lots_closed: 0,
    sales_matched: 0,
    sales_pending: 0,
    blocked_losses: 0,
    adjustments_active: 0,
    runtime_issues: 0,
    assets_total: 0,
    assets_foreign: 0,
    assets_model_720: 0,
    fiscal_events: 0
  },
  documents: [],
  operations: [],
  lots: [],
  adjustments: [],
  assets: [],
  fiscal_events: [],
  sale_summaries: [],
  blocked_losses: [],
  runtime_issues: [],
  exports: []
};

function badgeClass(value: string): string {
  if (
    value === "completed" ||
    value === "generated" ||
    value === "validated" ||
    value === "ok" ||
    value === "OPEN" ||
    value === "MATCHED"
  ) {
    return "badge success";
  }

  if (
    value === "manual_review" ||
    value === "warnings" ||
    value === "pending" ||
    value === "PENDING_COST_BASIS" ||
    value === "CLOSED"
  ) {
    return "badge warning";
  }

  if (
    value === "failed" ||
    value === "rejected" ||
    value === "errors" ||
    value === "UNRESOLVED" ||
    value === "INVALID_DATA"
  ) {
    return "badge danger";
  }

  return "badge";
}

function formatNumber(value: number | null, maximumFractionDigits = 6): string {
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(value);
}

function formatCurrency(value: number | null, currency: string | null): string {
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
    return `${formatNumber(value, 2)} ${resolvedCurrency}`;
  }
}

function assetClassLabel(value: ExpedienteAsset["asset_class"]): string {
  switch (value) {
    case "ACCOUNT":
      return "Cuenta";
    case "SECURITY":
      return "Valor";
    case "COLLECTIVE_INVESTMENT":
      return "IIC";
    case "INSURANCE":
      return "Seguro";
    case "REAL_ESTATE":
      return "Inmueble";
    case "MOVABLE_ASSET":
      return "Bien mueble";
    default:
      return value;
  }
}

function eventAmountSummary(event: ExpedienteFiscalEvent): string {
  if (event.net_amount_eur !== null) {
    return formatCurrency(event.net_amount_eur, event.currency);
  }

  if (event.gross_amount_eur !== null) {
    return formatCurrency(event.gross_amount_eur, event.currency);
  }

  if (event.proceeds_amount_eur !== null) {
    return formatCurrency(event.proceeds_amount_eur, event.currency);
  }

  if (event.realized_result_eur !== null) {
    return formatCurrency(event.realized_result_eur, event.currency);
  }

  return "-";
}

export function ExpedienteSummary({ expedienteId }: { expedienteId: string }) {
  const [payload, setPayload] = useState<ExpedientePayload>(emptyState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/expedientes/${expedienteId}`, { cache: "no-store" });
        const body = (await response.json()) as ExpedientePayload | { error: string };
        if (!response.ok) {
          setError((body as { error: string }).error ?? "No se pudo cargar el expediente");
          return;
        }

        setPayload(body as ExpedientePayload);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el expediente");
      }
    }

    void load();

    const intervalId = window.setInterval(() => void load(), 5000);
    const refreshListener = () => void load();
    window.addEventListener("expediente:refresh", refreshListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("expediente:refresh", refreshListener);
    };
  }, [expedienteId]);

  return (
    <>
      <section className="card">
        <h2>Estado del expediente</h2>
        <p className="muted">
          {payload.title || `Expediente ${expedienteId}`} · {payload.model_type} · ejercicio {payload.fiscal_year}
        </p>
        {payload.client ? (
          <p className="muted" style={{ marginTop: "-4px" }}>
            Cliente:&nbsp;
            <Link href={`/clientes/${payload.client.reference}`}>{payload.client.display_name}</Link>
            &nbsp;· {payload.client.nif}
          </p>
        ) : null}
        <div className="kpi-grid">
          <article className="kpi">
            <span>Documentos</span>
            <strong>{payload.counts.total}</strong>
          </article>
          <article className="kpi">
            <span>En revisión</span>
            <strong>{payload.counts.manual_review}</strong>
          </article>
          <article className="kpi">
            <span>Completados</span>
            <strong>{payload.counts.completed}</strong>
          </article>
          <article className="kpi">
            <span>Operaciones</span>
            <strong>{payload.counts.operations}</strong>
          </article>
          <article className="kpi">
            <span>Lotes abiertos</span>
            <strong>{payload.counts.lots_open}</strong>
          </article>
          <article className="kpi">
            <span>Lotes cerrados</span>
            <strong>{payload.counts.lots_closed}</strong>
          </article>
          <article className="kpi">
            <span>Ventas cuadradas</span>
            <strong>{payload.counts.sales_matched}</strong>
          </article>
          <article className="kpi">
            <span>Ventas pendientes</span>
            <strong>{payload.counts.sales_pending}</strong>
          </article>
          <article className="kpi">
            <span>Pérdidas bloqueadas</span>
            <strong>{payload.counts.blocked_losses}</strong>
          </article>
          <article className="kpi">
            <span>Ajustes activos</span>
            <strong>{payload.counts.adjustments_active}</strong>
          </article>
          <article className="kpi">
            <span>Incidencias runtime</span>
            <strong>{payload.counts.runtime_issues}</strong>
          </article>
          <article className="kpi">
            <span>Activos canónicos</span>
            <strong>{payload.counts.assets_total}</strong>
          </article>
          <article className="kpi">
            <span>Activos extranjeros</span>
            <strong>{payload.counts.assets_foreign}</strong>
          </article>
          <article className="kpi">
            <span>Modelo 720</span>
            <strong>{payload.counts.assets_model_720}</strong>
          </article>
          <article className="kpi">
            <span>Eventos fiscales</span>
            <strong>{payload.counts.fiscal_events}</strong>
          </article>
        </div>
        {error ? <p className="badge danger" style={{ marginTop: "12px" }}>{error}</p> : null}
      </section>

      <section className="card">
        <h2>Documentos del expediente</h2>
        {payload.documents.length === 0 ? (
          <p className="muted">
            El expediente todavía no tiene documentos persistidos. La API ya responde aunque el expediente
            esté vacío, así que la UI no queda en falso 404 tras la primera ingesta.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Estado</th>
                  <th>Extracción</th>
                  <th>Alta</th>
                </tr>
              </thead>
              <tbody>
                {payload.documents.map((document) => (
                  <tr key={document.id}>
                    <td>
                      <strong>{document.filename}</strong>
                      <br />
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        {document.id.slice(0, 8)}...
                      </span>
                    </td>
                    <td>
                      <span className={badgeClass(document.processing_status)}>{document.processing_status}</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        confianza {Math.round(document.confidence * 100)}%
                      </div>
                    </td>
                    <td>
                      {document.latest_extraction ? (
                        <>
                          <span className={badgeClass(document.latest_extraction.review_status)}>
                            {document.latest_extraction.review_status}
                          </span>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {document.latest_extraction.records_count} registro(s)
                          </div>
                        </>
                      ) : (
                        <span className="muted">Sin extracción persistida</span>
                      )}
                    </td>
                    <td>{document.uploaded_at ? new Date(document.uploaded_at).toLocaleString("es-ES") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Perfil declarativo</h2>
        {!payload.canonical_registry_available ? (
          <p className="muted">
            El schema canónico no está disponible en este entorno. Cuando lo esté, aquí se mostrará el
            perfil del declarante para 714/720 e IP.
          </p>
        ) : !payload.declaration_profile ? (
          <p className="muted">
            El expediente todavía no tiene perfil declarativo persistido. La ingesta ya puede crearlo
            automáticamente desde cliente y review.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th>Declarante</th>
                  <td>{payload.declaration_profile.declared_name}</td>
                  <th>NIF</th>
                  <td>{payload.declaration_profile.declarant_nif}</td>
                </tr>
                <tr>
                  <th>NIF declarado</th>
                  <td>{payload.declaration_profile.declared_nif}</td>
                  <th>Territorio</th>
                  <td>{payload.declaration_profile.residence_territory_code ?? "ES-COMUN"}</td>
                </tr>
                <tr>
                  <th>País residencia</th>
                  <td>{payload.declaration_profile.residence_country_code ?? "ES"}</td>
                  <th>Situación por defecto</th>
                  <td>{payload.declaration_profile.default_asset_location_key ?? "ES"}</td>
                </tr>
                <tr>
                  <th>Contacto</th>
                  <td>{payload.declaration_profile.contact_name ?? "-"}</td>
                  <th>Teléfono</th>
                  <td>{payload.declaration_profile.contact_phone ?? "-"}</td>
                </tr>
                <tr>
                  <th>Representante legal</th>
                  <td colSpan={3}>{payload.declaration_profile.legal_representative_nif ?? "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Registro canónico de activos</h2>
        {!payload.canonical_registry_available ? (
          <p className="muted">
            El expediente todavía no puede cargar activos canónicos en este entorno.
          </p>
        ) : payload.assets.length === 0 ? (
          <p className="muted">
            Todavía no hay activos canónicos persistidos. En cuanto la ingesta o la review emitan cuentas,
            valores, IIC, seguros, inmuebles o bienes muebles, aparecerán aquí.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Activo</th>
                  <th>Clasificación</th>
                  <th>Situación</th>
                  <th>Valoración</th>
                  <th>Modelos</th>
                </tr>
              </thead>
              <tbody>
                {payload.assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <strong>{asset.display_name}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {asset.entity_name ?? asset.asset_description ?? "Sin entidad"} · {asset.country_code}
                      </div>
                    </td>
                    <td>
                      <span className="badge">{assetClassLabel(asset.asset_class)}</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {asset.asset_key}/{asset.asset_subkey} · cond. {asset.condition_key}
                      </div>
                    </td>
                    <td>
                      <div>{asset.location_key === "EX" ? "Extranjero" : "España"}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {asset.tax_territory_code ?? "ES-COMUN"} · {formatNumber(asset.ownership_percentage, 2)}%
                      </div>
                    </td>
                    <td>
                      <div>{formatCurrency(asset.valuation_1_eur, "EUR")}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        Alta {new Date(asset.incorporation_date).toLocaleDateString("es-ES")}
                      </div>
                      {asset.valuation_2_eur !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Secundaria {formatCurrency(asset.valuation_2_eur, "EUR")}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className={asset.supports_714 ? "badge success" : "badge"}>714</div>
                      <div className={asset.supports_720 && asset.is_foreign ? "badge success" : "badge"} style={{ marginTop: "6px" }}>
                        720
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Eventos fiscales canónicos</h2>
        {!payload.canonical_registry_available ? (
          <p className="muted">
            El entorno actual no devuelve todavía eventos fiscales canónicos.
          </p>
        ) : payload.fiscal_events.length === 0 ? (
          <p className="muted">
            Aún no hay dividendos, intereses, transmisiones o ajustes normalizados en el registro canónico.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Activo</th>
                  <th>Importe</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {payload.fiscal_events.map((event) => {
                  const linkedAsset = payload.assets.find((asset) => asset.id === event.asset_id) ?? null;

                  return (
                    <tr key={event.id}>
                      <td>
                        <div>{new Date(event.event_date).toLocaleDateString("es-ES")}</div>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {event.quantity !== null ? `${formatNumber(event.quantity)} unidades` : "Sin cantidad"}
                        </div>
                      </td>
                      <td>
                        <span className={badgeClass(event.event_type)}>{event.event_type}</span>
                        {event.capital_operation_key ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {event.capital_operation_key}
                          </div>
                        ) : null}
                        {event.irpf_group || event.irpf_subgroup ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {[event.irpf_group, event.irpf_subgroup].filter(Boolean).join(" · ")}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <strong>{linkedAsset?.display_name ?? "Activo no enlazado"}</strong>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {linkedAsset?.asset_class ? assetClassLabel(linkedAsset.asset_class) : "Sin clase"}
                        </div>
                      </td>
                      <td>
                        <div>{eventAmountSummary(event)}</div>
                        {event.withholding_amount_eur !== null ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Ret. {formatCurrency(event.withholding_amount_eur, event.currency)}
                          </div>
                        ) : null}
                        {event.expense_amount_eur !== null ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Gastos {formatCurrency(event.expense_amount_eur, event.currency)}
                          </div>
                        ) : null}
                        {event.realized_result_eur !== null ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Resultado {formatCurrency(event.realized_result_eur, event.currency)}
                          </div>
                        ) : null}
                        {event.unit_price_eur !== null ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Precio unit. {formatCurrency(event.unit_price_eur, "EUR")}
                          </div>
                        ) : null}
                        {event.gross_amount_original !== null && event.original_currency ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Original {formatCurrency(event.gross_amount_original, event.original_currency)}
                            {event.fx_rate !== null ? ` · FX ${formatNumber(event.fx_rate, 6)}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className="badge">{event.source}</span>
                        {event.is_closing_operation ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Cierre de posicion
                          </div>
                        ) : null}
                        {event.is_stock_dividend ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Dividendo en acciones
                          </div>
                        ) : null}
                        {event.irpf_box_code ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            Casilla {event.irpf_box_code}
                          </div>
                        ) : null}
                        {event.notes ? (
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {event.notes}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Incidencias de runtime fiscal</h2>
        {payload.runtime_issues.length === 0 ? (
          <p className="muted">
            El runtime fiscal no reporta incidencias activas sobre ventas, lotes o ajustes manuales.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Activo</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {payload.runtime_issues.map((issue) => (
                  <tr key={`${issue.code}-${issue.operation_id}`}>
                    <td>
                      <span className="badge danger">{issue.code}</span>
                    </td>
                    <td>
                      <strong>{issue.isin ?? "Sin ISIN"}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {issue.quantity !== null ? `${formatNumber(issue.quantity)} títulos` : "Sin cantidad"}
                      </div>
                    </td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Ganancias y pérdidas</h2>
        {payload.sale_summaries.length === 0 ? (
          <p className="muted">
            Todavía no hay ventas fiscalmente trazadas contra lotes. Cuando existan ventas válidas,
            esta tabla mostrará coste fiscal consumido y ganancia/pérdida calculada.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Venta</th>
                  <th>Activo</th>
                  <th>Cuadre FIFO</th>
                  <th>Resultado fiscal</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {payload.sale_summaries.map((sale) => (
                  <tr key={sale.sale_operation_id}>
                    <td>
                      <div>{new Date(sale.operation_date).toLocaleDateString("es-ES")}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {formatNumber(sale.quantity)} títulos · {formatCurrency(sale.sale_amount, sale.currency)}
                      </div>
                    </td>
                    <td>
                      <strong>{sale.isin ?? "Sin ISIN"}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {sale.description ?? "Sin descripción"}
                      </div>
                    </td>
                    <td>
                      <div>Asignado {formatNumber(sale.quantity_allocated)}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        Pendiente {formatNumber(sale.missing_quantity)} · {sale.allocations_count} tramo(s)
                      </div>
                      {sale.sale_amount_allocated !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Ingreso asignado {formatCurrency(sale.sale_amount_allocated, sale.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div>Coste {formatCurrency(sale.cost_basis, sale.currency)}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        G/P calculada {formatCurrency(sale.realized_gain, sale.currency)}
                      </div>
                      {sale.reported_realized_gain !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Parser {formatCurrency(sale.reported_realized_gain, sale.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={badgeClass(sale.status)}>{sale.status}</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {sale.source}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Pérdidas bloqueadas por recompra</h2>
        {payload.blocked_losses.length === 0 ? (
          <p className="muted">
            No se han detectado ventas con pérdida bloqueada en la ventana 2/12 meses para este expediente.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Venta</th>
                  <th>Recompra bloqueante</th>
                  <th>Pérdida</th>
                  <th>Regla</th>
                </tr>
              </thead>
              <tbody>
                {payload.blocked_losses.map((blockedLoss) => (
                  <tr key={`${blockedLoss.sale_operation_id}-${blockedLoss.blocked_by_buy_operation_id}`}>
                    <td>
                      <div>{new Date(blockedLoss.sale_date).toLocaleDateString("es-ES")}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        <strong>{blockedLoss.isin}</strong> · {formatNumber(blockedLoss.sale_quantity)} títulos
                      </div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {blockedLoss.sale_description ?? "Venta sin descripción"} · {blockedLoss.sale_source}
                      </div>
                    </td>
                    <td>
                      <div>{new Date(blockedLoss.blocked_by_buy_date).toLocaleDateString("es-ES")}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {formatNumber(blockedLoss.blocked_by_buy_quantity)} títulos · {blockedLoss.blocked_by_buy_source}
                      </div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {blockedLoss.blocked_by_buy_description ?? "Compra sin descripción"}
                      </div>
                    </td>
                    <td>
                      <div>{formatCurrency(blockedLoss.realized_loss, blockedLoss.currency)}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        Pendiente de integración fiscal en el modelo 100
                      </div>
                    </td>
                    <td>
                      <span className="badge warning">{blockedLoss.window_months} meses</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {blockedLoss.reason}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Operaciones fiscales</h2>
        {payload.operations.length === 0 ? (
          <p className="muted">
            Todavía no hay operaciones fiscales persistidas para este expediente. La slice de Fase 2 ya
            deja listo el contrato runtime para que compras, ventas y posiciones aparezcan aquí.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Activo</th>
                  <th>Importe</th>
                  <th>Cantidad</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {payload.operations.map((operation) => (
                  <tr key={operation.id}>
                    <td>{new Date(operation.operation_date).toLocaleDateString("es-ES")}</td>
                    <td>
                      <span className={badgeClass(operation.operation_type)}>{operation.operation_type}</span>
                    </td>
                    <td>
                      <strong>{operation.isin ?? "Sin ISIN"}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {operation.description ?? operation.manual_notes ?? "Sin descripción"}
                      </div>
                    </td>
                    <td>
                      {formatCurrency(operation.amount, operation.currency)}
                      {operation.realized_gain !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          G/P {formatCurrency(operation.realized_gain, operation.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {formatNumber(operation.quantity)}
                      {operation.retention !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Ret. {formatCurrency(operation.retention, operation.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className="badge">{operation.source}</span>
                      {operation.confidence !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          confianza {Math.round(operation.confidence * 100)}%
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Lotes de adquisición</h2>
        {payload.lots.length === 0 ? (
          <p className="muted">
            El runtime todavía no ha derivado lotes válidos desde las operaciones persistidas de este expediente.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Adquisición</th>
                  <th>Activo</th>
                  <th>Cantidades</th>
                  <th>Coste</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {payload.lots.map((lot) => (
                  <tr key={lot.id}>
                    <td>{new Date(lot.acquisition_date).toLocaleDateString("es-ES")}</td>
                    <td>
                      <strong>{lot.isin}</strong>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {lot.description ?? "Sin descripción"}
                      </div>
                    </td>
                    <td>
                      <div>Origen {formatNumber(lot.quantity_original)}</div>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        Consumido {formatNumber(lot.quantity_sold)} · Abierto {formatNumber(lot.quantity_open)}
                      </div>
                    </td>
                    <td>
                      {formatCurrency(lot.total_cost, lot.currency)}
                      {lot.unit_cost !== null ? (
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          Unitario {formatCurrency(lot.unit_cost, lot.currency)}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span className={badgeClass(lot.status)}>{lot.status}</span>
                      <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                        {lot.sales_count} venta(s) FIFO · {lot.transfers_count} traspaso(s) · {lot.source}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Exportaciones generadas</h2>
        {payload.exports.length === 0 ? (
          <p className="muted">Todavía no hay exportaciones registradas para este expediente.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>Estado</th>
                  <th>Validación</th>
                  <th>Generado</th>
                </tr>
              </thead>
              <tbody>
                {payload.exports.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.model}</strong>
                    </td>
                    <td>
                      <span className={badgeClass(item.status)}>{item.status}</span>
                    </td>
                    <td>
                      <span className={badgeClass(item.validation_state)}>{item.validation_state}</span>
                    </td>
                    <td>{new Date(item.generated_at).toLocaleString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
