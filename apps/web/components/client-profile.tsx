"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  resolveCanonicalAssetDeclarableValue,
  type CanonicalAssetSummary,
  type CanonicalFiscalEvent
} from "@/lib/fiscal-canonical";

type FiscalUnit = {
  primary_taxpayer_name: string | null;
  primary_taxpayer_nif: string | null;
  spouse_name: string | null;
  spouse_nif: string | null;
  filing_scope: "individual" | "joint" | "pending";
  declarant_condition: "titular" | "cotitular" | "no_titular" | "pending";
  spouse_condition: "sin_conyuge" | "titular" | "cotitular" | "no_titular" | "pending";
  fiscal_link_type: "sin_conyuge" | "gananciales" | "separacion_bienes" | "pareja_hecho" | "otro" | "pending";
  notes: string | null;
};

type FiscalUnitForm = {
  primary_taxpayer_name: string;
  primary_taxpayer_nif: string;
  spouse_name: string;
  spouse_nif: string;
  filing_scope: FiscalUnit["filing_scope"];
  declarant_condition: FiscalUnit["declarant_condition"];
  spouse_condition: FiscalUnit["spouse_condition"];
  fiscal_link_type: FiscalUnit["fiscal_link_type"];
  notes: string;
};

type ClientPayload = {
  current_user?: {
    reference: string;
    display_name: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  client: {
    id: string;
    reference: string;
    display_name: string;
    nif: string;
    email: string | null;
    status: "active" | "inactive" | "archived";
    contact_person: string | null;
    notes: string | null;
    fiscal_unit: FiscalUnit;
    created_at: string;
    updated_at: string;
  };
  stats: {
    expedientes: number;
    documents: number;
    pending_review: number;
    exports: number;
    assets: number;
    fiscal_events: number;
    last_activity_at: string | null;
  };
  assignments: Array<{
    id: string;
    assignment_role: "owner" | "manager" | "support" | "viewer";
    created_at: string;
    user: {
      id: string;
      reference: string;
      display_name: string;
      email: string;
      role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
      status: "active" | "inactive";
    };
  }>;
  expedientes: Array<{
    id: string;
    reference: string;
    title: string;
    status: string;
    fiscal_year: number;
    model_type: string;
    counts: {
      documents: number;
      pending_review: number;
      completed: number;
      exports: number;
    };
    latest_export_model: string | null;
    last_activity_at: string | null;
  }>;
  client_documents: Array<{
    id: string;
    filename: string;
    source_type: string;
    processing_status: string;
    manual_review_required: boolean;
    uploaded_at: string | null;
    processed_at: string | null;
    created_at: string;
    updated_at: string;
    expediente_id: string;
    expediente_reference: string;
    expediente_fiscal_year: number | null;
    expediente_model_type: string | null;
    latest_extraction: {
      id: string;
      confidence: number;
      review_status: string;
      records_count: number;
      created_at: string;
    } | null;
  }>;
  client_assets: CanonicalAssetSummary[];
  client_fiscal_events: CanonicalFiscalEvent[];
};

type CreateExpedienteResponse = {
  expediente: {
    reference: string;
  };
};

type UpdateFiscalUnitResponse = {
  client: ClientPayload["client"];
};

type WorkspacePhase = "resumen" | "documental" | "revision" | "modelos";
type PortfolioFilter = "all" | "foreign" | "issues";

const emptyFiscalUnit: FiscalUnit = {
  primary_taxpayer_name: null,
  primary_taxpayer_nif: null,
  spouse_name: null,
  spouse_nif: null,
  filing_scope: "pending",
  declarant_condition: "pending",
  spouse_condition: "pending",
  fiscal_link_type: "pending",
  notes: null
};

const emptyFiscalUnitForm: FiscalUnitForm = {
  primary_taxpayer_name: "",
  primary_taxpayer_nif: "",
  spouse_name: "",
  spouse_nif: "",
  filing_scope: "pending",
  declarant_condition: "pending",
  spouse_condition: "pending",
  fiscal_link_type: "pending",
  notes: ""
};

const emptyPayload: ClientPayload = {
  client: {
    id: "",
    reference: "",
    display_name: "",
    nif: "",
    email: null,
    status: "active",
    contact_person: null,
    notes: null,
    fiscal_unit: emptyFiscalUnit,
    created_at: "",
    updated_at: ""
  },
  stats: {
    expedientes: 0,
    documents: 0,
    pending_review: 0,
    exports: 0,
    assets: 0,
    fiscal_events: 0,
    last_activity_at: null
  },
  assignments: [],
  expedientes: [],
  client_documents: [],
  client_assets: [],
  client_fiscal_events: []
};

function toFiscalUnitForm(unit: FiscalUnit): FiscalUnitForm {
  return {
    primary_taxpayer_name: unit.primary_taxpayer_name ?? "",
    primary_taxpayer_nif: unit.primary_taxpayer_nif ?? "",
    spouse_name: unit.spouse_name ?? "",
    spouse_nif: unit.spouse_nif ?? "",
    filing_scope: unit.filing_scope,
    declarant_condition: unit.declarant_condition,
    spouse_condition: unit.spouse_condition,
    fiscal_link_type: unit.fiscal_link_type,
    notes: unit.notes ?? ""
  };
}

async function fetchClientPayload(clientId: string): Promise<ClientPayload> {
  const response = await fetch(`/api/clientes/${clientId}`, { cache: "no-store" });
  const body = (await response.json()) as ClientPayload | { error: string };
  if (!response.ok) {
    throw new Error((body as { error: string }).error ?? "No se pudo cargar el cliente");
  }

  return body as ClientPayload;
}

function badgeClass(value: string): string {
  if (value === "active" || value === "VALIDADO" || value === "PRESENTADO" || value === "success") {
    return "badge success";
  }

  if (
    value === "EN_REVISION" ||
    value === "BORRADOR" ||
    value === "MODIFICADO" ||
    value === "inactive" ||
    value === "warning"
  ) {
    return "badge warning";
  }

  if (value === "archived" || value === "danger") {
    return "badge danger";
  }

  return "badge";
}

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("es-ES") : "Sin actividad";
}

function formatMaybeValue(value: string | null): string {
  return value && value.trim().length > 0 ? value : "pendiente";
}

function filingScopeLabel(value: FiscalUnit["filing_scope"]): string {
  if (value === "individual") return "Individual";
  if (value === "joint") return "Conjunta";
  return "Pendiente";
}

function holderConditionLabel(value: FiscalUnit["declarant_condition"] | FiscalUnit["spouse_condition"]): string {
  if (value === "titular") return "Titular";
  if (value === "cotitular") return "Cotitular";
  if (value === "no_titular") return "No titular";
  if (value === "sin_conyuge") return "Sin conyuge";
  return "Pendiente";
}

function fiscalLinkLabel(value: FiscalUnit["fiscal_link_type"]): string {
  if (value === "gananciales") return "Gananciales";
  if (value === "separacion_bienes") return "Separacion de bienes";
  if (value === "pareja_hecho") return "Pareja de hecho";
  if (value === "otro") return "Otro";
  if (value === "sin_conyuge") return "Sin conyuge";
  return "Pendiente";
}

function reviewStatusLabel(value: string | null): string {
  if (value === "validated") return "Validada";
  if (value === "pending") return "Pendiente";
  if (value === "rejected") return "Rechazada";
  if (value === "not_required") return "No requerida";
  return "Sin extracción";
}

function formatAmount(value: number | null, currency?: string | null): string {
  if (typeof value !== "number") {
    return "—";
  }

  return `${value.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency ?? "EUR"}`;
}

function canonicalHolderRoleLabel(value: CanonicalAssetSummary["holder_role"]): string {
  if (value === "titular") return "Titular";
  if (value === "conyuge") return "Cónyuge";
  if (value === "cotitular") return "Cotitular";
  if (value === "usufructuario") return "Usufructuario";
  if (value === "nudo_propietario") return "Nudo propietario";
  return "Otro";
}

function valuationMethodLabel(value: CanonicalAssetSummary["valuation_method"]): string {
  if (value === "market_value") return "Valor de mercado";
  if (value === "cost_basis") return "Coste";
  if (value === "year_end_value") return "Valor fin ejercicio";
  if (value === "q4_average") return "Saldo medio Q4";
  if (value === "manual") return "Manual";
  return "Pendiente";
}

function block720Label(value: CanonicalAssetSummary["foreign_block"]): string {
  if (value === "accounts") return "Cuentas";
  if (value === "securities") return "Valores / IIC";
  if (value === "insurance_real_estate") return "Seguros / inmuebles";
  if (value === "other") return "Otros bienes";
  return "No aplica 720";
}

function assetPortfolioClass(asset: CanonicalAssetSummary): {
  label: string;
  key: string;
} {
  if (asset.asset_type === "account" || asset.asset_type === "cash") {
    return { label: "Cuentas", key: "CUE" };
  }

  if (asset.asset_type === "fund") {
    return { label: "IIC", key: "IIC" };
  }

  if (asset.asset_type === "security") {
    return { label: "Valores", key: "VAL" };
  }

  if (asset.asset_type === "insurance") {
    return { label: "Seguros", key: "SEG" };
  }

  if (asset.asset_type === "real_estate") {
    return { label: "Inmuebles", key: "INM" };
  }

  return { label: "Muebles / otros", key: "MUE" };
}

function assetAppliesTo720(asset: CanonicalAssetSummary): boolean {
  if (asset.foreign_block) {
    return true;
  }

  if (asset.country) {
    return asset.country !== "ES";
  }

  return typeof asset.isin === "string" && asset.isin.trim().toUpperCase().slice(0, 2) !== "ES";
}

function operationLinkageSummary(asset: CanonicalAssetSummary): string {
  const parts: string[] = [];

  if (asset.acquisitions > 0) parts.push(`${asset.acquisitions} adq.`);
  if (asset.transmissions > 0) parts.push(`${asset.transmissions} transm.`);
  if (asset.dividends > 0) parts.push(`${asset.dividends} div.`);
  if (asset.interests > 0) parts.push(`${asset.interests} int.`);
  if (asset.retentions > 0) parts.push(`${asset.retentions} ret.`);
  if (asset.gains_losses > 0) parts.push(`${asset.gains_losses} g/p.`);

  return parts.length > 0 ? parts.join(" · ") : "Sin movimientos fiscales derivados";
}

function portfolioIssues(asset: CanonicalAssetSummary): string[] {
  if (!assetAppliesTo720(asset)) {
    return [];
  }

  const issues: string[] = [];
  const declarableValue = resolveCanonicalAssetDeclarableValue(asset);

  if (declarableValue === null) {
    issues.push("Sin valoración declarable");
  }

  if (!asset.country) {
    issues.push("Sin país");
  }

  if (!asset.foreign_block) {
    issues.push("Sin bloque 720");
  }

  if (typeof asset.ownership_pct !== "number" || asset.ownership_pct <= 0) {
    issues.push("Sin titularidad");
  }

  if (asset.foreign_block === "accounts" && typeof asset.q4_avg_balance !== "number") {
    issues.push("Sin saldo medio Q4");
  }

  return issues;
}

function documentActionForClient(document: ClientPayload["client_documents"][number]): {
  href: string;
  label: string;
  detail: string;
} {
  if (document.processing_status === "manual_review" || document.processing_status === "failed") {
    return {
      href: `/expedientes/${document.expediente_reference}?fase=revision`,
      label: "Abrir revisión",
      detail: "La documentación sigue pendiente de decisión manual."
    };
  }

  if (document.processing_status === "queued" || document.processing_status === "processing") {
    return {
      href: `/expedientes/${document.expediente_reference}?fase=documental`,
      label: "Seguir ingesta",
      detail: "La documentación sigue entrando al flujo documental."
    };
  }

  return {
    href: `/expedientes/${document.expediente_reference}?fase=canonico`,
    label: "Ver canónico",
    detail: "El documento ya alimenta el registro patrimonial-fiscal."
  };
}

function resolveExpedientePhase(expediente: ClientPayload["expedientes"][number]): {
  phase: WorkspacePhase;
  label: string;
  detail: string;
} {
  if (expediente.counts.documents === 0) {
    return {
      phase: "documental",
      label: "Cargar documentacion",
      detail: "El expediente todavia no tiene documentacion base para arrancar el flujo anual."
    };
  }

  if (expediente.counts.pending_review > 0) {
    return {
      phase: "revision",
      label: "Resolver revision",
      detail: "Hay trabajo manual pendiente antes de consolidar el expediente."
    };
  }

  if (expediente.counts.exports === 0) {
    return {
      phase: "modelos",
      label: "Preparar modelo AEAT",
      detail: "La base documental ya existe y el siguiente paso util es preparar el modelo declarativo."
    };
  }

  return {
    phase: "resumen",
    label: "Revisar estado general",
    detail: "El expediente ya tiene actividad declarativa y conviene revisar su estado consolidado."
  };
}

function priorityScore(expediente: ClientPayload["expedientes"][number]): number {
  if (expediente.counts.pending_review > 0) return 400 + expediente.counts.pending_review;
  if (expediente.counts.documents === 0) return 300;
  if (expediente.counts.exports === 0) return 200;
  return 100;
}

function resolveFiscalUnitState(unit: FiscalUnit): {
  label: string;
  tone: "success" | "warning" | "danger";
  detail: string;
} {
  if (!unit.primary_taxpayer_name || !unit.primary_taxpayer_nif) {
    return {
      label: "Incompleta",
      tone: "danger",
      detail: "Falta identificar correctamente el sujeto pasivo principal."
    };
  }

  if (
    unit.filing_scope === "pending" ||
    unit.declarant_condition === "pending" ||
    unit.spouse_condition === "pending" ||
    unit.fiscal_link_type === "pending"
  ) {
    return {
      label: "Pendiente",
      tone: "warning",
      detail: "La unidad fiscal existe, pero todavia no esta cerrada para trabajo anual consistente."
    };
  }

  if (unit.spouse_condition === "sin_conyuge" && unit.fiscal_link_type !== "sin_conyuge") {
    return {
      label: "Inconsistente",
      tone: "warning",
      detail: "La vinculacion fiscal no cuadra con el estado sin conyuge."
    };
  }

  if (unit.spouse_condition !== "sin_conyuge" && (!unit.spouse_name || !unit.spouse_nif)) {
    return {
      label: "Incompleta",
      tone: "warning",
      detail: "Existe conyuge o vinculo fiscal, pero falta su identificacion completa."
    };
  }

  return {
    label: "Estructurada",
    tone: "success",
    detail: "La unidad fiscal ya puede gobernar los expedientes y modelos del cliente."
  };
}

export function ClientProfile({ clientId }: { clientId: string }) {
  const [payload, setPayload] = useState<ClientPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portfolioFilter, setPortfolioFilter] = useState<PortfolioFilter>("all");
  const [submitting, setSubmitting] = useState(false);
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear().toString());
  const [modelType, setModelType] = useState<"IRPF" | "IP" | "720">("IRPF");
  const [reference, setReference] = useState("");
  const [title, setTitle] = useState("");
  const [createdReference, setCreatedReference] = useState<string | null>(null);
  const [fiscalUnitForm, setFiscalUnitForm] = useState<FiscalUnitForm>(emptyFiscalUnitForm);
  const [fiscalUnitSubmitting, setFiscalUnitSubmitting] = useState(false);
  const [fiscalUnitMessage, setFiscalUnitMessage] = useState<string | null>(null);
  const [fiscalUnitError, setFiscalUnitError] = useState<string | null>(null);
  const canCreateExpediente = payload.current_user?.role !== "solo_lectura";
  const canEditFiscalUnit =
    payload.current_user?.role === "admin" || payload.current_user?.role === "fiscal_senior";

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const nextPayload = await fetchClientPayload(clientId);
        if (!mounted) return;

        setPayload(nextPayload);
        setFiscalUnitForm(toFiscalUnitForm(nextPayload.client.fiscal_unit));
        setError(null);
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el cliente");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [clientId]);

  async function reloadClient() {
    const nextPayload = await fetchClientPayload(clientId);
    setPayload(nextPayload);
    setFiscalUnitForm(toFiscalUnitForm(nextPayload.client.fiscal_unit));
    setError(null);
  }

  if (loading) {
    return (
      <section className="card">
        <p className="muted">Cargando ficha operativa del cliente...</p>
      </section>
    );
  }

  async function handleCreateExpediente(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreatedReference(null);

    try {
      const response = await fetch("/api/expedientes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: payload.client.id,
          fiscal_year: Number(fiscalYear),
          model_type: modelType,
          reference: reference.trim() || undefined,
          title: title.trim() || undefined
        })
      });

      const body = (await response.json()) as CreateExpedienteResponse | { error: string };
      if (!response.ok) {
        setError((body as { error: string }).error ?? "No se pudo crear el expediente");
        return;
      }

      const created = body as CreateExpedienteResponse;
      setCreatedReference(created.expediente.reference);
      await reloadClient();
      setReference("");
      setTitle("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo crear el expediente");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFiscalUnitSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFiscalUnitSubmitting(true);
    setFiscalUnitError(null);
    setFiscalUnitMessage(null);

    try {
      const response = await fetch(`/api/clientes/${clientId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fiscal_unit: {
            ...fiscalUnitForm,
            primary_taxpayer_name: fiscalUnitForm.primary_taxpayer_name.trim(),
            primary_taxpayer_nif: fiscalUnitForm.primary_taxpayer_nif.trim().toUpperCase(),
            spouse_name: fiscalUnitForm.spouse_name.trim(),
            spouse_nif: fiscalUnitForm.spouse_nif.trim().toUpperCase(),
            notes: fiscalUnitForm.notes.trim()
          }
        })
      });

      const body = (await response.json()) as UpdateFiscalUnitResponse | { error: string };
      if (!response.ok) {
        setFiscalUnitError((body as { error: string }).error ?? "No se pudo actualizar la unidad fiscal");
        return;
      }

      const updated = body as UpdateFiscalUnitResponse;
      setPayload((current) => ({
        ...current,
        client: updated.client
      }));
      setFiscalUnitForm(toFiscalUnitForm(updated.client.fiscal_unit));
      setFiscalUnitMessage("Unidad fiscal actualizada.");
    } catch (submitError) {
      setFiscalUnitError(
        submitError instanceof Error ? submitError.message : "No se pudo actualizar la unidad fiscal"
      );
    } finally {
      setFiscalUnitSubmitting(false);
    }
  }

  function updateFiscalUnitField<K extends keyof FiscalUnitForm>(field: K, value: FiscalUnitForm[K]) {
    setFiscalUnitForm((current) => {
      if (field === "spouse_condition" && value === "sin_conyuge") {
        return {
          ...current,
          spouse_condition: "sin_conyuge",
          spouse_name: "",
          spouse_nif: "",
          fiscal_link_type: "sin_conyuge"
        };
      }

      if (field === "fiscal_link_type" && value === "sin_conyuge") {
        return {
          ...current,
          spouse_condition: "sin_conyuge",
          spouse_name: "",
          spouse_nif: "",
          fiscal_link_type: "sin_conyuge"
        };
      }

      return {
        ...current,
        [field]: value
      };
    });
  }

  const expedientesSorted = [...payload.expedientes].sort((left, right) => {
    if (right.fiscal_year !== left.fiscal_year) {
      return right.fiscal_year - left.fiscal_year;
    }

    return priorityScore(right) - priorityScore(left);
  });

  const expedientesByYear = expedientesSorted.reduce<Array<{
    fiscalYear: number;
    expedientes: ClientPayload["expedientes"];
  }>>((groups, expediente) => {
    const currentGroup = groups.find((group) => group.fiscalYear === expediente.fiscal_year);
    if (currentGroup) {
      currentGroup.expedientes.push(expediente);
      return groups;
    }

    groups.push({
      fiscalYear: expediente.fiscal_year,
      expedientes: [expediente]
    });
    return groups;
  }, []);

  const priorityExpediente = expedientesSorted[0] ?? null;
  const priorityStep = priorityExpediente ? resolveExpedientePhase(priorityExpediente) : null;
  const fiscalUnitState = resolveFiscalUnitState(payload.client.fiscal_unit);
  const expedientesByReference = new Map(payload.expedientes.map((expediente) => [expediente.reference, expediente]));
  const portfolioRows = [...payload.client_assets]
    .map((asset) => {
      const assetClass = assetPortfolioClass(asset);
      const applies720 = assetAppliesTo720(asset);
      const issues = portfolioIssues(asset);
      const declarableValue = resolveCanonicalAssetDeclarableValue(asset);
      const linkedExpedientes = asset.expedientes
        .map((reference) => expedientesByReference.get(reference))
        .filter((expediente): expediente is ClientPayload["expedientes"][number] => Boolean(expediente))
        .sort((left, right) => right.fiscal_year - left.fiscal_year);

      return {
        asset,
        assetClass,
        applies720,
        issues,
        declarableValue,
        linkedExpedientes
      };
    })
    .sort((left, right) => {
      if (Number(right.applies720) !== Number(left.applies720)) {
        return Number(right.applies720) - Number(left.applies720);
      }

      const blockCompare = block720Label(left.asset.foreign_block).localeCompare(block720Label(right.asset.foreign_block));
      if (blockCompare !== 0) {
        return blockCompare;
      }

      const classCompare = left.assetClass.label.localeCompare(right.assetClass.label);
      if (classCompare !== 0) {
        return classCompare;
      }

      return left.asset.label.localeCompare(right.asset.label);
    });
  const visiblePortfolioRows = portfolioRows.filter((row) => {
    if (portfolioFilter === "foreign") {
      return row.applies720;
    }

    if (portfolioFilter === "issues") {
      return row.issues.length > 0;
    }

    return true;
  });
  const portfolioSummary = {
    totalAssets: portfolioRows.length,
    foreignAssets: portfolioRows.filter((row) => row.applies720).length,
    ready720Assets: portfolioRows.filter((row) => row.applies720 && row.issues.length === 0).length,
    issue720Assets: portfolioRows.filter((row) => row.issues.length > 0).length,
    foreignValueTotal: portfolioRows
      .filter((row) => row.applies720)
      .reduce((sum, row) => sum + (row.declarableValue ?? 0), 0),
    blockTotals: portfolioRows
      .filter((row) => row.applies720 && row.asset.foreign_block)
      .reduce<Record<string, number>>((totals, row) => {
        const block = row.asset.foreign_block!;
        totals[block] = (totals[block] ?? 0) + (row.declarableValue ?? 0);
        return totals;
      }, {})
  };

  return (
    <>
      <section className="card client-hero">
        <div className="client-hero-main">
          <span className="eyebrow">Cliente</span>
          <h2>{payload.client.display_name || "Cliente"}</h2>
          <p className="muted">
            {payload.client.nif || "Sin NIF"} · referencia {payload.client.reference || clientId}
          </p>
          <p className="muted" style={{ marginTop: "-4px" }}>
            Contacto: {payload.client.contact_person || "sin contacto"} · email {payload.client.email || "sin email"}
          </p>
          {error ? <p className="badge danger">{error}</p> : null}
        </div>

        <aside className="dashboard-side-card">
          <h2>Siguiente paso</h2>
          {priorityExpediente && priorityStep ? (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {priorityExpediente.title} · {priorityExpediente.model_type} · ejercicio{" "}
                {priorityExpediente.fiscal_year}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {priorityStep.detail}
              </p>
              <Link
                href={`/expedientes/${priorityExpediente.reference}${
                  priorityStep.phase === "resumen" ? "" : `?fase=${priorityStep.phase}`
                }`}
                className="button-link"
              >
                {priorityStep.label}
              </Link>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Este cliente aun no tiene expediente anual creado. El siguiente paso util es abrir el ejercicio
                correspondiente.
              </p>
              <a href="#nuevo-expediente" className="button-link">
                Crear expediente
              </a>
            </>
          )}
        </aside>
      </section>

      <section className="kpi-grid">
        <article className="kpi">
          <span>Expedientes</span>
          <strong>{payload.stats.expedientes}</strong>
        </article>
        <article className="kpi">
          <span>Documentos</span>
          <strong>{payload.stats.documents}</strong>
        </article>
        <article className="kpi">
          <span>En revision</span>
          <strong>{payload.stats.pending_review}</strong>
        </article>
        <article className="kpi">
          <span>Exportaciones</span>
          <strong>{payload.stats.exports}</strong>
        </article>
        <article className="kpi">
          <span>Activos</span>
          <strong>{payload.stats.assets}</strong>
        </article>
        <article className="kpi">
          <span>Eventos fiscales</span>
          <strong>{payload.stats.fiscal_events}</strong>
        </article>
      </section>

      <section className="client-meta-grid">
        <article className="stack-item">
          <h3>Ficha operativa</h3>
          <p className="muted" style={{ margin: 0 }}>
            Estado: <span className={badgeClass(payload.client.status)}>{payload.client.status}</span>
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Ultima actividad: {formatDateTime(payload.stats.last_activity_at)}
            <br />
            Alta del cliente: {formatDateTime(payload.client.created_at)}
          </p>
        </article>

        <article className="stack-item">
          <div className="review-item-header">
            <h3>Unidad fiscal</h3>
            <span className={badgeClass(fiscalUnitState.tone)}>{fiscalUnitState.label}</span>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Sujeto pasivo: {formatMaybeValue(payload.client.fiscal_unit.primary_taxpayer_name)} ·{" "}
            {formatMaybeValue(payload.client.fiscal_unit.primary_taxpayer_nif)}
            <br />
            Alcance declarativo: {filingScopeLabel(payload.client.fiscal_unit.filing_scope)}
            <br />
            Vinculacion fiscal: {fiscalLinkLabel(payload.client.fiscal_unit.fiscal_link_type)}
          </p>
        </article>

        <article className="stack-item">
          <h3>Equipo asignado</h3>
          {payload.assignments.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No hay usuarios asignados todavia a este cliente.
            </p>
          ) : (
            <div className="muted" style={{ margin: 0 }}>
              {payload.assignments.map((assignment) => (
                <p key={assignment.id} style={{ margin: "0 0 8px" }}>
                  <strong>{assignment.user.display_name}</strong> · {assignment.assignment_role} ·{" "}
                  {assignment.user.role}
                  <br />
                  {assignment.user.email}
                </p>
              ))}
            </div>
          )}
        </article>

        <article className="stack-item">
          <h3>Notas operativas</h3>
          <p className="muted" style={{ margin: 0 }}>
            {payload.client.notes || "Sin notas operativas registradas todavia."}
          </p>
        </article>
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Unidad fiscal y vinculacion</h2>
            <p className="muted">
              Esta ficha fija sujeto pasivo, conyuge, alcance declarativo y condicion patrimonial para gobernar
              todos los expedientes anuales del cliente.
            </p>
          </div>
        </div>

        <div className="stack">
          <article className="stack-item">
            <h3>Identificacion fiscal</h3>
            <p className="muted" style={{ margin: 0 }}>
              Sujeto pasivo: {formatMaybeValue(payload.client.fiscal_unit.primary_taxpayer_name)}
              <br />
              NIF: {formatMaybeValue(payload.client.fiscal_unit.primary_taxpayer_nif)}
              <br />
              Estado: {fiscalUnitState.detail}
            </p>
          </article>
          <article className="stack-item">
            <h3>Condicion declarativa</h3>
            <p className="muted" style={{ margin: 0 }}>
              Alcance: {filingScopeLabel(payload.client.fiscal_unit.filing_scope)}
              <br />
              Declarante: {holderConditionLabel(payload.client.fiscal_unit.declarant_condition)}
              <br />
              Conyuge: {holderConditionLabel(payload.client.fiscal_unit.spouse_condition)}
            </p>
          </article>
          <article className="stack-item">
            <h3>Vinculacion conyugal</h3>
            <p className="muted" style={{ margin: 0 }}>
              Vinculo fiscal: {fiscalLinkLabel(payload.client.fiscal_unit.fiscal_link_type)}
              <br />
              Conyuge: {formatMaybeValue(payload.client.fiscal_unit.spouse_name)}
              <br />
              NIF conyuge: {formatMaybeValue(payload.client.fiscal_unit.spouse_nif)}
            </p>
          </article>
          <article className="stack-item">
            <h3>Observaciones</h3>
            <p className="muted" style={{ margin: 0 }}>
              {payload.client.fiscal_unit.notes || "Sin observaciones de unidad fiscal registradas."}
            </p>
          </article>
        </div>

        {!canEditFiscalUnit ? (
          <p className="badge warning" style={{ marginTop: "14px" }}>
            Solo administracion y fiscal senior pueden editar la unidad fiscal.
          </p>
        ) : null}

        <form className="form" onSubmit={handleFiscalUnitSubmit} style={{ marginTop: "16px" }}>
          <div className="fiscal-unit-form-grid">
            <label htmlFor="fiscal-primary-name">
              Sujeto pasivo
              <input
                id="fiscal-primary-name"
                value={fiscalUnitForm.primary_taxpayer_name}
                onChange={(event) => updateFiscalUnitField("primary_taxpayer_name", event.target.value)}
                disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              />
            </label>

            <label htmlFor="fiscal-primary-nif">
              NIF del sujeto pasivo
              <input
                id="fiscal-primary-nif"
                value={fiscalUnitForm.primary_taxpayer_nif}
                onChange={(event) => updateFiscalUnitField("primary_taxpayer_nif", event.target.value)}
                disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              />
            </label>

            <label htmlFor="fiscal-spouse-name">
              Conyuge
              <input
                id="fiscal-spouse-name"
                value={fiscalUnitForm.spouse_name}
                onChange={(event) => updateFiscalUnitField("spouse_name", event.target.value)}
                disabled={
                  fiscalUnitSubmitting ||
                  !canEditFiscalUnit ||
                  fiscalUnitForm.spouse_condition === "sin_conyuge"
                }
              />
            </label>

            <label htmlFor="fiscal-spouse-nif">
              NIF del conyuge
              <input
                id="fiscal-spouse-nif"
                value={fiscalUnitForm.spouse_nif}
                onChange={(event) => updateFiscalUnitField("spouse_nif", event.target.value)}
                disabled={
                  fiscalUnitSubmitting ||
                  !canEditFiscalUnit ||
                  fiscalUnitForm.spouse_condition === "sin_conyuge"
                }
              />
            </label>

            <label htmlFor="fiscal-filing-scope">
              Alcance declarativo
              <select
                id="fiscal-filing-scope"
                value={fiscalUnitForm.filing_scope}
                onChange={(event) =>
                  updateFiscalUnitField("filing_scope", event.target.value as FiscalUnitForm["filing_scope"])
                }
                disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              >
                <option value="pending">Pendiente</option>
                <option value="individual">Individual</option>
                <option value="joint">Conjunta</option>
              </select>
            </label>

            <label htmlFor="fiscal-declarant-condition">
              Condicion del declarante
              <select
                id="fiscal-declarant-condition"
                value={fiscalUnitForm.declarant_condition}
                onChange={(event) =>
                  updateFiscalUnitField(
                    "declarant_condition",
                    event.target.value as FiscalUnitForm["declarant_condition"]
                  )
                }
                disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              >
                <option value="pending">Pendiente</option>
                <option value="titular">Titular</option>
                <option value="cotitular">Cotitular</option>
                <option value="no_titular">No titular</option>
              </select>
            </label>

            <label htmlFor="fiscal-spouse-condition">
              Condicion del conyuge
              <select
                id="fiscal-spouse-condition"
                value={fiscalUnitForm.spouse_condition}
                onChange={(event) =>
                  updateFiscalUnitField("spouse_condition", event.target.value as FiscalUnitForm["spouse_condition"])
                }
                disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              >
                <option value="pending">Pendiente</option>
                <option value="sin_conyuge">Sin conyuge</option>
                <option value="titular">Titular</option>
                <option value="cotitular">Cotitular</option>
                <option value="no_titular">No titular</option>
              </select>
            </label>

            <label htmlFor="fiscal-link-type">
              Vinculacion fiscal
              <select
                id="fiscal-link-type"
                value={fiscalUnitForm.fiscal_link_type}
                onChange={(event) =>
                  updateFiscalUnitField("fiscal_link_type", event.target.value as FiscalUnitForm["fiscal_link_type"])
                }
                disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              >
                <option value="pending">Pendiente</option>
                <option value="sin_conyuge">Sin conyuge</option>
                <option value="gananciales">Gananciales</option>
                <option value="separacion_bienes">Separacion de bienes</option>
                <option value="pareja_hecho">Pareja de hecho</option>
                <option value="otro">Otro</option>
              </select>
            </label>
          </div>

          <label htmlFor="fiscal-notes">
            Notas de unidad fiscal
            <textarea
              id="fiscal-notes"
              value={fiscalUnitForm.notes}
              onChange={(event) => updateFiscalUnitField("notes", event.target.value)}
              disabled={fiscalUnitSubmitting || !canEditFiscalUnit}
              placeholder="Criterios de titularidad, decisiones declarativas o incidencias de vinculacion."
            />
          </label>

          <div className="client-expediente-actions">
            <button type="submit" disabled={fiscalUnitSubmitting || !canEditFiscalUnit}>
              {fiscalUnitSubmitting ? "Guardando unidad fiscal..." : "Guardar unidad fiscal"}
            </button>
          </div>
        </form>

        {fiscalUnitError ? <p className="badge danger" style={{ marginTop: "12px" }}>{fiscalUnitError}</p> : null}
        {fiscalUnitMessage ? (
          <p className="badge success" style={{ marginTop: "12px" }}>
            {fiscalUnitMessage}
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Expedientes por ejercicio</h2>
            <p className="muted">
              La ficha del cliente organiza el trabajo anual por ejercicio y modelo, con acceso directo a la fase
              operativa que toca resolver.
            </p>
          </div>
        </div>

        {expedientesByYear.length === 0 ? (
          <p className="muted">Este cliente todavia no tiene expedientes dados de alta.</p>
        ) : (
          <div className="client-year-grid">
            {expedientesByYear.map((group) => (
              <article key={group.fiscalYear} className="client-year-card">
                <div className="section-header">
                  <div>
                    <h3>Ejercicio {group.fiscalYear}</h3>
                    <p className="muted">
                      {group.expedientes.length} expediente(s) ·{" "}
                      {group.expedientes.reduce((sum, expediente) => sum + expediente.counts.pending_review, 0)} en
                      revision · {group.expedientes.reduce((sum, expediente) => sum + expediente.counts.exports, 0)}{" "}
                      exporte(s)
                    </p>
                  </div>
                </div>

                <div className="client-expediente-list">
                  {group.expedientes.map((expediente) => {
                    const nextStep = resolveExpedientePhase(expediente);

                    return (
                      <article key={expediente.id} className="client-expediente-card">
                        <div className="review-item-header">
                          <h3>{expediente.title}</h3>
                          <span className={badgeClass(expediente.status)}>{expediente.status}</span>
                        </div>

                        <p className="muted" style={{ margin: 0 }}>
                          {expediente.reference} · {expediente.model_type} · {formatDateTime(expediente.last_activity_at)}
                        </p>

                        <div className="stack">
                          <article className="stack-item">
                            <h3>Operativa</h3>
                            <p className="muted" style={{ margin: 0 }}>
                              {expediente.counts.documents} documento(s)
                              <br />
                              {expediente.counts.pending_review} en revision
                              <br />
                              {expediente.counts.exports} exportacion(es)
                            </p>
                          </article>
                          <article className="stack-item">
                            <h3>Siguiente paso</h3>
                            <p className="muted" style={{ margin: 0 }}>
                              {nextStep.label}
                              <br />
                              {nextStep.detail}
                            </p>
                          </article>
                        </div>

                        <div className="client-expediente-actions">
                          <Link href={`/expedientes/${expediente.reference}`} className="button-link secondary-link">
                            Abrir resumen
                          </Link>
                          <Link
                            href={`/expedientes/${expediente.reference}${
                              nextStep.phase === "resumen" ? "" : `?fase=${nextStep.phase}`
                            }`}
                            className="button-link"
                          >
                            {nextStep.label}
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="section-header">
          <div>
            <h2>Documentación y extracción</h2>
            <p className="muted">
              Relación directa cliente → expediente → documento → extracción, para entender qué está cargado, qué se está revisando y qué ya alimenta el canónico.
            </p>
          </div>
        </div>

        {payload.client_documents.length === 0 ? (
          <p className="muted">
            Este cliente todavía no tiene documentos cargados. Crea o abre un expediente y entra en la fase documental para iniciar la ingesta.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Expediente</th>
                  <th>Documento</th>
                  <th>Estado documental</th>
                  <th>Extracción</th>
                  <th>Registros</th>
                  <th>Siguiente paso</th>
                </tr>
              </thead>
              <tbody>
                {payload.client_documents.map((document) => {
                  const nextAction = documentActionForClient(document);

                  return (
                    <tr key={document.id}>
                      <td>
                        <Link href={`/expedientes/${document.expediente_reference}`}>
                          {document.expediente_reference}
                        </Link>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {document.expediente_model_type ?? "sin modelo"} · ejercicio{" "}
                          {document.expediente_fiscal_year ?? "sin ejercicio"}
                        </div>
                      </td>
                      <td>
                        <strong>{document.filename}</strong>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {document.source_type} · {formatDateTime(document.updated_at)}
                        </div>
                      </td>
                      <td>
                        <span className={badgeClass(document.processing_status)}>{document.processing_status}</span>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {document.manual_review_required ? "Revisión manual requerida" : "Sin revisión manual"}
                        </div>
                      </td>
                      <td>
                        <span className={badgeClass(document.latest_extraction?.review_status ?? "info")}>
                          {reviewStatusLabel(document.latest_extraction?.review_status ?? null)}
                        </span>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {document.latest_extraction
                            ? `Confianza ${Math.round(document.latest_extraction.confidence * 100)}%`
                            : "Documento sin extracción todavía"}
                        </div>
                      </td>
                      <td>
                        <div>{document.latest_extraction?.records_count ?? 0} registro(s)</div>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {document.latest_extraction
                            ? `Última extracción ${formatDateTime(document.latest_extraction.created_at)}`
                            : "Sin extracción"}
                        </div>
                      </td>
                      <td>
                        <Link href={nextAction.href}>{nextAction.label}</Link>
                        <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                          {nextAction.detail}
                        </div>
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
        <div className="section-header">
          <div>
            <h2>Portfolio del cliente · vista XLS 720</h2>
            <p className="muted">
              Hoja operativa por cliente para analizar todo el portfolio, con clases patrimoniales, bloque 720,
              titularidad, valor declarable y trazabilidad hacia expedientes y operaciones.
            </p>
          </div>
        </div>

        <p className="badge info" style={{ marginTop: "0", marginBottom: "16px" }}>
          Una fila representa un activo canónico del cliente. La tabla está pensada para lectura tipo hoja de cálculo
          y para revisar rápidamente qué aplica a `720`, qué falta cerrar y desde qué expediente se gobierna cada activo.
        </p>

        <div className="kpi-grid">
          <article className="kpi">
            <span>Total activos</span>
            <strong>{portfolioSummary.totalAssets}</strong>
          </article>
          <article className="kpi">
            <span>Activos 720</span>
            <strong>{portfolioSummary.foreignAssets}</strong>
          </article>
          <article className="kpi">
            <span>720 listos</span>
            <strong>{portfolioSummary.ready720Assets}</strong>
          </article>
          <article className="kpi">
            <span>Incidencias 720</span>
            <strong>{portfolioSummary.issue720Assets}</strong>
          </article>
          <article className="kpi">
            <span>Valor extranjero</span>
            <strong>{formatAmount(portfolioSummary.foreignValueTotal, "EUR")}</strong>
          </article>
        </div>

        <div className="client-portfolio-filters">
          <button
            type="button"
            className={portfolioFilter === "all" ? undefined : "secondary"}
            onClick={() => setPortfolioFilter("all")}
          >
            Todos los activos
          </button>
          <button
            type="button"
            className={portfolioFilter === "foreign" ? undefined : "secondary"}
            onClick={() => setPortfolioFilter("foreign")}
          >
            Solo 720
          </button>
          <button
            type="button"
            className={portfolioFilter === "issues" ? undefined : "secondary"}
            onClick={() => setPortfolioFilter("issues")}
          >
            Solo incidencias 720
          </button>
        </div>

        {Object.entries(portfolioSummary.blockTotals).length > 0 ? (
          <div className="client-portfolio-blocks">
            {Object.entries(portfolioSummary.blockTotals).map(([block, amount]) => (
              <span key={block} className="chip success">
                {block720Label(block as CanonicalAssetSummary["foreign_block"])} · {formatAmount(amount, "EUR")}
              </span>
            ))}
          </div>
        ) : null}

        <div className="asset-event-grid">
          <article className="stack-item">
            <h3>Hoja patrimonial</h3>
            {portfolioRows.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Todavia no hay activos patrimoniales derivados en el runtime del cliente.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Clase</th>
                      <th>Clave</th>
                      <th>Activo</th>
                      <th>Bloque 720</th>
                      <th>Valor y valoracion</th>
                      <th>Titularidad</th>
                      <th>Operaciones vinculadas</th>
                      <th>Expedientes vinculados</th>
                      <th>Ultimo evento</th>
                      <th>Incidencias 720</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePortfolioRows.map(({ asset, assetClass, applies720, issues, declarableValue, linkedExpedientes }) => (
                      <tr key={asset.asset_key}>
                        <td>
                          <strong>{assetClass.label}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.asset_type}
                          </div>
                        </td>
                        <td>
                          <div>{assetClass.key}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.asset_key}
                          </div>
                        </td>
                        <td>
                          <strong>{asset.label}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.isin ?? "sin ISIN"} · {asset.country ?? "sin país"}
                          </div>
                        </td>
                        <td>
                          <div>{block720Label(asset.foreign_block)}</div>
                          <div className="muted" style={{ fontSize: "0.75rem" }}>
                            {applies720 ? "Activo potencialmente declarable en 720" : "No aplica 720 con el canónico actual"}
                          </div>
                        </td>
                        <td>
                          <div>{formatAmount(declarableValue, asset.currencies[0] ?? "EUR")}</div>
                          <div className="muted" style={{ fontSize: "0.75rem" }}>
                            FE {formatAmount(asset.year_end_value, asset.currencies[0] ?? "EUR")} · Q4{" "}
                            {formatAmount(asset.q4_avg_balance, asset.currencies[0] ?? "EUR")} ·{" "}
                            {valuationMethodLabel(asset.valuation_method)}
                          </div>
                        </td>
                        <td>
                          <div>
                            {canonicalHolderRoleLabel(asset.holder_role)} ·{" "}
                            {typeof asset.ownership_pct === "number"
                              ? `${asset.ownership_pct.toLocaleString("es-ES", {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2
                                })}%`
                              : "sin %"}
                          </div>
                          <div className="muted" style={{ fontSize: "0.75rem" }}>
                            {asset.quantity_open === null ? "sin cantidad abierta" : `${asset.quantity_open} unidades`} ·{" "}
                            {asset.open_lots} lote(s) abiertos
                          </div>
                        </td>
                        <td>
                          <div>{asset.events_total} evento(s)</div>
                          <div className="muted" style={{ fontSize: "0.75rem" }}>
                            {operationLinkageSummary(asset)}
                          </div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {asset.pending_transmissions} venta(s) pendiente(s)
                          </div>
                        </td>
                        <td>
                          {linkedExpedientes.length > 0 ? (
                            <div className="client-portfolio-link-list">
                              {linkedExpedientes.map((expediente) => (
                                <Link key={expediente.reference} href={`/expedientes/${expediente.reference}?fase=canonico`}>
                                  {expediente.reference}
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <span className="muted">Sin expediente vinculado</span>
                          )}
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            ejercicios {asset.fiscal_years.join(", ") || "sin ejercicio"}
                          </div>
                        </td>
                        <td>
                          <div>{formatDateTime(asset.latest_event_date)}</div>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            fuente {asset.last_source ?? "sin fuente"}
                          </div>
                        </td>
                        <td>
                          {issues.length === 0 ? (
                            <span className="badge success">{applies720 ? "Listo para 720" : "Sin incidencia 720"}</span>
                          ) : (
                            <>
                              <span className="badge warning">{issues.length} incidencia(s)</span>
                              <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                                {issues.join(" · ")}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="stack-item">
            <h3>Registros fiscales recientes</h3>
            {payload.client_fiscal_events.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Todavia no hay eventos fiscales visibles para este cliente.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Activo</th>
                      <th>Evento</th>
                      <th>Expediente</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payload.client_fiscal_events.slice(0, 12).map((event) => (
                      <tr key={event.event_id}>
                        <td>{new Date(event.operation_date).toLocaleDateString("es-ES")}</td>
                        <td>
                          <strong>{event.asset_label}</strong>
                          <div className="muted" style={{ marginTop: "6px", fontSize: "0.75rem" }}>
                            {event.isin ?? "sin ISIN"}
                          </div>
                        </td>
                        <td>
                          <div>{event.event_kind}</div>
                          <div className="muted" style={{ fontSize: "0.75rem" }}>
                            {event.amount !== null ? `${event.amount} ${event.currency ?? "EUR"}` : event.operation_type}
                          </div>
                        </td>
                        <td>
                          {event.expediente_reference ? (
                            <Link href={`/expedientes/${event.expediente_reference}?fase=canonico`}>
                              {event.expediente_reference}
                            </Link>
                          ) : (
                            <span className="muted">sin expediente</span>
                          )}
                        </td>
                        <td>
                          <span className={badgeClass(event.status)}>{event.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="card" id="nuevo-expediente">
        <h2>Nuevo expediente</h2>
        <p className="muted">
          Crea expedientes de IRPF, Patrimonio o 720 ya vinculados al cliente, manteniendo el flujo
          cliente - expediente - fases.
        </p>
        {payload.current_user?.role === "solo_lectura" ? (
          <p className="badge warning" style={{ marginBottom: "12px" }}>
            El perfil solo lectura puede consultar la ficha, pero no crear expedientes.
          </p>
        ) : null}
        <form className="form" onSubmit={handleCreateExpediente}>
          <label htmlFor="expediente-model-type">Modelo</label>
          <select
            id="expediente-model-type"
            value={modelType}
            onChange={(event) => setModelType(event.target.value as "IRPF" | "IP" | "720")}
            disabled={submitting || !canCreateExpediente}
          >
            <option value="IRPF">IRPF</option>
            <option value="IP">Impuesto sobre el Patrimonio</option>
            <option value="720">Modelo 720</option>
          </select>

          <label htmlFor="expediente-fiscal-year">Ejercicio fiscal</label>
          <input
            id="expediente-fiscal-year"
            type="number"
            min={2013}
            max={2035}
            value={fiscalYear}
            onChange={(event) => setFiscalYear(event.target.value)}
            disabled={submitting || !canCreateExpediente}
          />

          <label htmlFor="expediente-reference">Referencia del expediente (opcional)</label>
          <input
            id="expediente-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Ej: fagu-irpf-2025"
            disabled={submitting || !canCreateExpediente}
          />

          <label htmlFor="expediente-title">Titulo visible (opcional)</label>
          <input
            id="expediente-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej: Expediente IRPF 2025 - FAGU"
            disabled={submitting || !canCreateExpediente}
          />

          <button type="submit" disabled={submitting || !payload.client.id || !canCreateExpediente}>
            {submitting ? "Creando expediente..." : "Crear expediente"}
          </button>
        </form>

        {createdReference ? (
          <p className="badge success" style={{ marginTop: "12px" }}>
            Expediente creado:&nbsp;
            <Link href={`/expedientes/${createdReference}`}>{createdReference}</Link>
          </p>
        ) : null}
      </section>
    </>
  );
}
