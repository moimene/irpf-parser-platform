"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CanonicalAssetRecord,
  CanonicalAssetResponse,
  CanonicalFiscalEvent,
  CanonicalFiscalEventResponse,
  DeclarationProfileRecord
} from "@/lib/asset-registry";

type CatalogOption = {
  code: string;
  description: string;
};

type TaxTerritoryCatalogOption = CatalogOption & {
  country_code: string;
};

type RealRightCatalogOption = {
  id: number;
  description: string;
};

type CapitalOperationCatalogOption = CatalogOption & {
  irpf_group: "RCM" | "GYP" | "OTRO";
  irpf_subgroup: string;
  asset_key: CanonicalAssetRecord["asset_key"] | null;
  requires_quantity_price: boolean;
  requires_positive_gross: boolean;
};

type CanonicalAssetDraft = {
  draft_id: string;
  extraction_id: string;
  document_id: string;
  filename: string;
  review_status: string;
  created_at: string;
  label: string;
  asset: CanonicalAssetRecord;
};

type CanonicalFiscalEventDraft = {
  draft_id: string;
  extraction_id: string;
  document_id: string;
  filename: string;
  review_status: string;
  created_at: string;
  label: string;
  event: CanonicalFiscalEvent;
};

type WorkspacePayload = {
  available: boolean;
  declaration_profile: DeclarationProfileRecord | null;
  assets: CanonicalAssetResponse[];
  fiscal_events: CanonicalFiscalEventResponse[];
  catalogs: {
    countries: CatalogOption[];
    situations: CatalogOption[];
    tax_territories: TaxTerritoryCatalogOption[];
    conditions: CatalogOption[];
    asset_types: CatalogOption[];
    subkeys: Array<CatalogOption & { asset_key: CanonicalAssetRecord["asset_key"] }>;
    origins: CatalogOption[];
    identification_keys: CatalogOption[];
    representation_keys: CatalogOption[];
    real_estate_types: CatalogOption[];
    real_rights: RealRightCatalogOption[];
    movable_kinds: CatalogOption[];
    capital_operations: CapitalOperationCatalogOption[];
  } | null;
  draft_assets: CanonicalAssetDraft[];
  draft_fiscal_events: CanonicalFiscalEventDraft[];
};

type ProfileFormState = {
  declarant_nif: string;
  declared_nif: string;
  legal_representative_nif: string;
  declared_name: string;
  contact_name: string;
  contact_phone: string;
  residence_country_code: string;
  residence_territory_code: string;
  default_asset_location_key: "ES" | "EX";
};

type AssetFormState = {
  asset_key: CanonicalAssetRecord["asset_key"];
  asset_subkey: string;
  condition_key: CanonicalAssetRecord["condition_key"];
  ownership_type_description: string;
  country_code: string;
  tax_territory_code: string;
  location_key: CanonicalAssetRecord["location_key"];
  incorporation_date: string;
  origin_key: CanonicalAssetRecord["origin_key"];
  extinction_date: string;
  valuation_1_eur: string;
  valuation_2_eur: string;
  ownership_percentage: string;
  currency: string;
  entity_name: string;
  asset_description: string;
  street_line: string;
  complement: string;
  city: string;
  region: string;
  postal_code: string;
  address_country_code: string;
  account_identification_key: "I" | "O";
  bic: string;
  account_code: string;
  account_entity_tax_id: string;
  security_identification_key: "1" | "2";
  security_identifier: string;
  security_entity_tax_id: string;
  representation_key: "A" | "B";
  security_units: string;
  listed: boolean;
  regulated: boolean;
  insurance_kind: "LIFE" | "DISABILITY" | "TEMPORARY_ANNUITY" | "LIFETIME_ANNUITY";
  insurance_entity_tax_id: string;
  real_estate_type_key: "U" | "R";
  real_right_description: string;
  cadastral_reference: string;
  movable_kind: string;
  registry_reference: string;
  valuation_method: string;
};

type EventFormState = {
  asset_id: string;
  capital_operation_key: string;
  event_date: string;
  quantity: string;
  gross_amount_eur: string;
  net_amount_eur: string;
  withholding_amount_eur: string;
  proceeds_amount_eur: string;
  cost_basis_amount_eur: string;
  realized_result_eur: string;
  currency: string;
  expense_amount_eur: string;
  original_currency: string;
  gross_amount_original: string;
  fx_rate: string;
  unit_price_eur: string;
  is_closing_operation: boolean;
  is_stock_dividend: boolean;
  irpf_box_code: string;
  notes: string;
};

const emptyPayload: WorkspacePayload = {
  available: false,
  declaration_profile: null,
  assets: [],
  fiscal_events: [],
  catalogs: null,
  draft_assets: [],
  draft_fiscal_events: []
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultProfileForm(): ProfileFormState {
  return {
    declarant_nif: "",
    declared_nif: "",
    legal_representative_nif: "",
    declared_name: "",
    contact_name: "",
    contact_phone: "",
    residence_country_code: "ES",
    residence_territory_code: "ES-COMUN",
    default_asset_location_key: "ES"
  };
}

function defaultAssetForm(): AssetFormState {
  return {
    asset_key: "C",
    asset_subkey: "5",
    condition_key: "1",
    ownership_type_description: "",
    country_code: "ES",
    tax_territory_code: "ES-COMUN",
    location_key: "ES",
    incorporation_date: today(),
    origin_key: "A",
    extinction_date: "",
    valuation_1_eur: "",
    valuation_2_eur: "",
    ownership_percentage: "100",
    currency: "EUR",
    entity_name: "",
    asset_description: "",
    street_line: "",
    complement: "",
    city: "",
    region: "",
    postal_code: "",
    address_country_code: "",
    account_identification_key: "I",
    bic: "",
    account_code: "",
    account_entity_tax_id: "",
    security_identification_key: "1",
    security_identifier: "",
    security_entity_tax_id: "",
    representation_key: "A",
    security_units: "",
    listed: true,
    regulated: true,
    insurance_kind: "LIFE",
    insurance_entity_tax_id: "",
    real_estate_type_key: "U",
    real_right_description: "",
    cadastral_reference: "",
    movable_kind: "GENERAL",
    registry_reference: "",
    valuation_method: ""
  };
}

function defaultEventForm(): EventFormState {
  return {
    asset_id: "",
    capital_operation_key: "DIVIDENDO_ACCION",
    event_date: today(),
    quantity: "",
    gross_amount_eur: "",
    net_amount_eur: "",
    withholding_amount_eur: "",
    proceeds_amount_eur: "",
    cost_basis_amount_eur: "",
    realized_result_eur: "",
    currency: "EUR",
    expense_amount_eur: "",
    original_currency: "",
    gross_amount_original: "",
    fx_rate: "",
    unit_price_eur: "",
    is_closing_operation: false,
    is_stock_dividend: false,
    irpf_box_code: "",
    notes: ""
  };
}

function toNumericInput(value: number | null | undefined, digits = 8): string {
  if (value === null || value === undefined) {
    return "";
  }

  return Number(value).toFixed(digits).replace(/\.?0+$/, "");
}

function toNullableNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("es-ES");
}

function profileFormFromProfile(profile: DeclarationProfileRecord | null): ProfileFormState {
  if (!profile) {
    return defaultProfileForm();
  }

  return {
    declarant_nif: profile.declarant_nif,
    declared_nif: profile.declared_nif ?? profile.declarant_nif,
    legal_representative_nif: profile.legal_representative_nif ?? "",
    declared_name: profile.declared_name,
    contact_name: profile.contact_name ?? "",
    contact_phone: profile.contact_phone ?? "",
    residence_country_code: profile.residence_country_code ?? "ES",
    residence_territory_code: profile.residence_territory_code ?? "ES-COMUN",
    default_asset_location_key: profile.default_asset_location_key ?? "ES"
  };
}

function assetFormFromAsset(asset: CanonicalAssetRecord): AssetFormState {
  const next = defaultAssetForm();
  next.asset_key = asset.asset_key;
  next.asset_subkey = asset.asset_subkey;
  next.condition_key = asset.condition_key;
  next.ownership_type_description = asset.ownership_type_description ?? "";
  next.country_code = asset.country_code;
  next.tax_territory_code = asset.tax_territory_code ?? "ES-COMUN";
  next.location_key = asset.location_key;
  next.incorporation_date = asset.incorporation_date;
  next.origin_key = asset.origin_key;
  next.extinction_date = asset.extinction_date ?? "";
  next.valuation_1_eur = toNumericInput(asset.valuation_1_eur, 2);
  next.valuation_2_eur = toNumericInput(asset.valuation_2_eur ?? null, 2);
  next.ownership_percentage = toNumericInput(asset.ownership_percentage, 2);
  next.currency = asset.currency ?? "EUR";
  next.entity_name = asset.entity_name ?? "";
  next.asset_description = asset.asset_description ?? "";
  next.street_line = asset.address?.street_line ?? "";
  next.complement = asset.address?.complement ?? "";
  next.city = asset.address?.city ?? "";
  next.region = asset.address?.region ?? "";
  next.postal_code = asset.address?.postal_code ?? "";
  next.address_country_code = asset.address?.country_code ?? "";
  next.account_identification_key = asset.account?.account_identification_key ?? "I";
  next.bic = asset.account?.bic ?? "";
  next.account_code = asset.account?.account_code ?? "";
  next.account_entity_tax_id = asset.account?.entity_tax_id ?? "";
  next.security_identification_key =
    asset.security?.identification_key ??
    asset.collective_investment?.identification_key ??
    "1";
  next.security_identifier =
    asset.security?.security_identifier ??
    asset.collective_investment?.security_identifier ??
    "";
  next.security_entity_tax_id =
    asset.security?.entity_tax_id ??
    asset.collective_investment?.entity_tax_id ??
    "";
  next.representation_key =
    asset.security?.representation_key ??
    asset.collective_investment?.representation_key ??
    "A";
  next.security_units = toNumericInput(
    asset.security?.units ?? asset.collective_investment?.units ?? null
  );
  next.listed = asset.security?.listed ?? asset.collective_investment?.listed ?? true;
  next.regulated = asset.security?.regulated ?? asset.collective_investment?.regulated ?? true;
  next.insurance_kind = asset.insurance?.insurance_kind ?? "LIFE";
  next.insurance_entity_tax_id = asset.insurance?.entity_tax_id ?? "";
  next.real_estate_type_key = asset.real_estate?.real_estate_type_key ?? "U";
  next.real_right_description = asset.real_estate?.real_right_description ?? "";
  next.cadastral_reference = asset.real_estate?.cadastral_reference ?? "";
  next.movable_kind = asset.movable?.movable_kind ?? "GENERAL";
  next.registry_reference = asset.movable?.registry_reference ?? "";
  next.valuation_method = asset.movable?.valuation_method ?? "";
  return next;
}

function eventFormFromEvent(event: CanonicalFiscalEvent): EventFormState {
  return {
    asset_id: event.asset_id ?? "",
    capital_operation_key: event.capital_operation_key ?? "OTRO_MOVIMIENTO",
    event_date: event.event_date,
    quantity: toNumericInput(event.quantity ?? null),
    gross_amount_eur: toNumericInput(event.gross_amount_eur ?? null, 2),
    net_amount_eur: toNumericInput(event.net_amount_eur ?? null, 2),
    withholding_amount_eur: toNumericInput(event.withholding_amount_eur ?? null, 2),
    proceeds_amount_eur: toNumericInput(event.proceeds_amount_eur ?? null, 2),
    cost_basis_amount_eur: toNumericInput(event.cost_basis_amount_eur ?? null, 2),
    realized_result_eur: toNumericInput(event.realized_result_eur ?? null, 2),
    currency: event.currency ?? "EUR",
    expense_amount_eur: toNumericInput(event.expense_amount_eur ?? null, 2),
    original_currency: event.original_currency ?? "",
    gross_amount_original: toNumericInput(event.gross_amount_original ?? null, 2),
    fx_rate: toNumericInput(event.fx_rate ?? null, 8),
    unit_price_eur: toNumericInput(event.unit_price_eur ?? null, 8),
    is_closing_operation: event.is_closing_operation ?? false,
    is_stock_dividend: event.is_stock_dividend ?? false,
    irpf_box_code: event.irpf_box_code ?? "",
    notes: event.notes ?? ""
  };
}

function assetPayloadFromForm(form: AssetFormState): CanonicalAssetRecord {
  return {
    asset_class:
      form.asset_key === "C"
        ? "ACCOUNT"
        : form.asset_key === "V"
          ? "SECURITY"
          : form.asset_key === "I"
            ? "COLLECTIVE_INVESTMENT"
            : form.asset_key === "S"
              ? "INSURANCE"
              : form.asset_key === "B"
                ? "REAL_ESTATE"
                : "MOVABLE_ASSET",
    asset_key: form.asset_key,
    asset_subkey: form.asset_subkey,
    condition_key: form.condition_key,
    ownership_type_description: form.ownership_type_description || null,
    country_code: form.country_code,
    tax_territory_code: form.tax_territory_code,
    location_key: form.location_key,
    incorporation_date: form.incorporation_date,
    origin_key: form.origin_key,
    extinction_date: form.extinction_date || null,
    valuation_1_eur: toNullableNumber(form.valuation_1_eur) ?? 0,
    valuation_2_eur: toNullableNumber(form.valuation_2_eur),
    ownership_percentage: toNullableNumber(form.ownership_percentage) ?? 100,
    currency: form.currency || null,
    entity_name: form.entity_name || null,
    asset_description: form.asset_description || null,
    address: {
      street_line: form.street_line || null,
      complement: form.complement || null,
      city: form.city || null,
      region: form.region || null,
      postal_code: form.postal_code || null,
      country_code: form.address_country_code || null
    },
    account:
      form.asset_key === "C"
        ? {
            account_identification_key: form.account_identification_key,
            bic: form.bic || null,
            account_code: form.account_code || null,
            entity_tax_id: form.account_entity_tax_id || null
          }
        : null,
    security:
      form.asset_key === "V"
        ? {
            identification_key: form.security_identification_key,
            security_identifier: form.security_identifier || null,
            entity_tax_id: form.security_entity_tax_id || null,
            representation_key: form.representation_key,
            units: toNullableNumber(form.security_units),
            listed: form.listed,
            regulated: form.regulated
          }
        : null,
    collective_investment:
      form.asset_key === "I"
        ? {
            identification_key: form.security_identification_key,
            security_identifier: form.security_identifier || null,
            entity_tax_id: form.security_entity_tax_id || null,
            representation_key: form.representation_key,
            units: toNullableNumber(form.security_units),
            listed: null,
            regulated: form.regulated
          }
        : null,
    insurance:
      form.asset_key === "S"
        ? {
            insurance_kind: form.insurance_kind,
            entity_tax_id: form.insurance_entity_tax_id || null
          }
        : null,
    real_estate:
      form.asset_key === "B"
        ? {
            real_estate_type_key: form.real_estate_type_key,
            real_right_description: form.real_right_description || null,
            cadastral_reference: form.cadastral_reference || null
          }
        : null,
    movable:
      form.asset_key === "M"
        ? {
            movable_kind: (form.movable_kind || "GENERAL") as CanonicalAssetRecord["movable"] extends {
              movable_kind?: infer T;
            }
              ? T
              : never,
            registry_reference: form.registry_reference || null,
            valuation_method: form.valuation_method || null
          }
        : null
  };
}

function eventPayloadFromForm(form: EventFormState): CanonicalFiscalEvent {
  return {
    asset_id: form.asset_id || null,
    capital_operation_key: form.capital_operation_key as CanonicalFiscalEvent["capital_operation_key"],
    event_type: "ADJUSTMENT",
    event_date: form.event_date,
    quantity: toNullableNumber(form.quantity),
    gross_amount_eur: toNullableNumber(form.gross_amount_eur),
    net_amount_eur: toNullableNumber(form.net_amount_eur),
    withholding_amount_eur: toNullableNumber(form.withholding_amount_eur),
    proceeds_amount_eur: toNullableNumber(form.proceeds_amount_eur),
    cost_basis_amount_eur: toNullableNumber(form.cost_basis_amount_eur),
    realized_result_eur: toNullableNumber(form.realized_result_eur),
    currency: form.currency || null,
    expense_amount_eur: toNullableNumber(form.expense_amount_eur),
    original_currency: form.original_currency || null,
    gross_amount_original: toNullableNumber(form.gross_amount_original),
    fx_rate: toNullableNumber(form.fx_rate),
    unit_price_eur: toNullableNumber(form.unit_price_eur),
    is_closing_operation: form.is_closing_operation,
    is_stock_dividend: form.is_stock_dividend,
    irpf_box_code: form.irpf_box_code || null,
    notes: form.notes || null
  };
}

function assetBadge(assetKey: CanonicalAssetRecord["asset_key"]): string {
  if (assetKey === "C") return "badge success";
  if (assetKey === "B" || assetKey === "M") return "badge warning";
  return "badge";
}

function operationBadge(group: string | null): string {
  if (group === "RCM") return "badge success";
  if (group === "GYP") return "badge warning";
  return "badge";
}

export function CanonicalRegistryWorkspace({ expedienteId }: { expedienteId: string }) {
  const initializedRef = useRef(false);
  const [payload, setPayload] = useState<WorkspacePayload>(emptyPayload);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(defaultProfileForm);
  const [assetForm, setAssetForm] = useState<AssetFormState>(defaultAssetForm);
  const [eventForm, setEventForm] = useState<EventFormState>(defaultEventForm);
  const [assetEditingId, setAssetEditingId] = useState<string | null>(null);
  const [eventEditingId, setEventEditingId] = useState<string | null>(null);
  const [selectedAssetDraftId, setSelectedAssetDraftId] = useState("");
  const [selectedEventDraftId, setSelectedEventDraftId] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAsset, setSavingAsset] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const subkeyOptions = useMemo(
    () => payload.catalogs?.subkeys.filter((option) => option.asset_key === assetForm.asset_key) ?? [],
    [payload.catalogs?.subkeys, assetForm.asset_key]
  );

  const selectedOperation = useMemo(
    () =>
      payload.catalogs?.capital_operations.find(
        (option) => option.code === eventForm.capital_operation_key
      ) ?? null,
    [payload.catalogs?.capital_operations, eventForm.capital_operation_key]
  );

  const compatibleAssets = useMemo(() => {
    if (!selectedOperation?.asset_key) {
      return payload.assets;
    }

    return payload.assets.filter((asset) => asset.asset_key === selectedOperation.asset_key);
  }, [payload.assets, selectedOperation]);

  const load = useCallback(async (preserveForms = true) => {
    const response = await fetch(`/api/expedientes/${expedienteId}/canonical`, {
      cache: "no-store"
    });
    const body = (await response.json()) as WorkspacePayload | { error: string };
    if (!response.ok) {
      setError((body as { error: string }).error ?? "No se pudo cargar el registro canónico");
      return;
    }

    const nextPayload = body as WorkspacePayload;
    setPayload(nextPayload);
    setError(null);

    if (!initializedRef.current || !preserveForms) {
      setProfileForm(profileFormFromProfile(nextPayload.declaration_profile));
      initializedRef.current = true;
    }
  }, [expedienteId]);

  useEffect(() => {
    void load(false);

    const refreshListener = () => void load(true);
    window.addEventListener("expediente:refresh", refreshListener);
    return () => window.removeEventListener("expediente:refresh", refreshListener);
  }, [load]);

  useEffect(() => {
    if (!subkeyOptions.some((option) => option.code === assetForm.asset_subkey)) {
      setAssetForm((current) => ({
        ...current,
        asset_subkey: subkeyOptions[0]?.code ?? current.asset_subkey
      }));
    }
  }, [assetForm.asset_key, assetForm.asset_subkey, subkeyOptions]);

  useEffect(() => {
    if (assetForm.location_key === "ES" && assetForm.country_code !== "ES") {
      setAssetForm((current) => ({ ...current, country_code: "ES" }));
    }
  }, [assetForm.location_key, assetForm.country_code]);

  useEffect(() => {
    if (selectedOperation?.asset_key && eventForm.asset_id) {
      const asset = payload.assets.find((candidate) => candidate.id === eventForm.asset_id);
      if (asset && asset.asset_key !== selectedOperation.asset_key) {
        setEventForm((current) => ({ ...current, asset_id: "" }));
      }
    }
  }, [eventForm.asset_id, payload.assets, selectedOperation]);

  const selectedAssetDraft = payload.draft_assets.find((draft) => draft.draft_id === selectedAssetDraftId) ?? null;
  const selectedEventDraft =
    payload.draft_fiscal_events.find((draft) => draft.draft_id === selectedEventDraftId) ?? null;

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingProfile(true);
    setError(null);

    try {
      const response = await fetch(`/api/expedientes/${expedienteId}/canonical`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profileForm)
      });
      const body = (await response.json()) as { error?: string; declaration_profile?: DeclarationProfileRecord };
      if (!response.ok) {
        setError(body.error ?? "No se pudo guardar el perfil declarativo");
        return;
      }

      setProfileForm(profileFormFromProfile(body.declaration_profile ?? null));
      await load(true);
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar el perfil declarativo");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleSaveAsset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingAsset(true);
    setError(null);

    try {
      const response = await fetch(
        assetEditingId
          ? `/api/expedientes/${expedienteId}/assets/${assetEditingId}`
          : `/api/expedientes/${expedienteId}/assets`,
        {
          method: assetEditingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(assetPayloadFromForm(assetForm))
        }
      );

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No se pudo guardar el activo");
        return;
      }

      setAssetEditingId(null);
      setAssetForm(defaultAssetForm());
      setSelectedAssetDraftId("");
      await load(true);
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar el activo");
    } finally {
      setSavingAsset(false);
    }
  }

  async function handleDeleteAsset(assetId: string) {
    setDeletingId(assetId);
    setError(null);

    try {
      const response = await fetch(`/api/expedientes/${expedienteId}/assets/${assetId}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "No se pudo eliminar el activo");
        return;
      }

      if (assetEditingId === assetId) {
        setAssetEditingId(null);
        setAssetForm(defaultAssetForm());
      }
      await load(true);
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el activo");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingEvent(true);
    setError(null);

    try {
      const response = await fetch(
        eventEditingId
          ? `/api/expedientes/${expedienteId}/fiscal-events/${eventEditingId}`
          : `/api/expedientes/${expedienteId}/fiscal-events`,
        {
          method: eventEditingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(eventPayloadFromForm(eventForm))
        }
      );

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "No se pudo guardar el evento fiscal");
        return;
      }

      setEventEditingId(null);
      setEventForm(defaultEventForm());
      setSelectedEventDraftId("");
      await load(true);
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo guardar el evento fiscal");
    } finally {
      setSavingEvent(false);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    setDeletingId(eventId);
    setError(null);

    try {
      const response = await fetch(`/api/expedientes/${expedienteId}/fiscal-events/${eventId}`, {
        method: "DELETE"
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "No se pudo eliminar el evento fiscal");
        return;
      }

      if (eventEditingId === eventId) {
        setEventEditingId(null);
        setEventForm(defaultEventForm());
      }
      await load(true);
      window.dispatchEvent(new Event("expediente:refresh"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el evento fiscal");
    } finally {
      setDeletingId(null);
    }
  }

  function applyAssetDraft() {
    if (!selectedAssetDraft) {
      return;
    }

    setAssetEditingId(null);
    setAssetForm(assetFormFromAsset(selectedAssetDraft.asset));
  }

  function applyEventDraft() {
    if (!selectedEventDraft) {
      return;
    }

    setEventEditingId(null);
    setEventForm(eventFormFromEvent(selectedEventDraft.event));
  }

  return (
    <section className="card">
      <div className="workspace-header">
        <div>
          <h2>Registro canónico editable</h2>
          <p className="muted">
            Aquí viven el perfil declarativo, los activos clasificados por capítulos 720/IP y los eventos fiscales
            manuales de renta. La revisión puede precargarse como borrador y desde aquí sale la base exportable.
          </p>
        </div>
        <div className="workspace-summary-chips">
          <span className="chip">Activos {payload.assets.length}</span>
          <span className="chip">Eventos {payload.fiscal_events.length}</span>
          <span className="chip">Borradores {payload.draft_assets.length + payload.draft_fiscal_events.length}</span>
        </div>
      </div>

      {error ? (
        <p className="badge danger" style={{ marginTop: "12px" }}>
          {error}
        </p>
      ) : null}

      {!payload.available || !payload.catalogs ? (
        <p className="muted">
          El schema canónico todavía no está disponible en este entorno. Cuando lo esté, aquí se activará la edición
          manual completa de 714, 720 e integración de rentas.
        </p>
      ) : (
        <div className="canonical-workspace">
          <div className="canonical-grid">
            <article className="workspace-panel">
              <h3>Perfil declarativo</h3>
              <form className="form canonical-form-grid" onSubmit={handleSaveProfile}>
                <label htmlFor="declared-name">Nombre del declarante</label>
                <input
                  id="declared-name"
                  value={profileForm.declared_name}
                  onChange={(event) => setProfileForm((current) => ({ ...current, declared_name: event.target.value }))}
                />

                <label htmlFor="declarant-nif">NIF declarante</label>
                <input
                  id="declarant-nif"
                  value={profileForm.declarant_nif}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, declarant_nif: event.target.value.toUpperCase() }))
                  }
                />

                <label htmlFor="declared-nif">NIF declarado</label>
                <input
                  id="declared-nif"
                  value={profileForm.declared_nif}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, declared_nif: event.target.value.toUpperCase() }))
                  }
                />

                <label htmlFor="legal-nif">Representante legal</label>
                <input
                  id="legal-nif"
                  value={profileForm.legal_representative_nif}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      legal_representative_nif: event.target.value.toUpperCase()
                    }))
                  }
                />

                <label htmlFor="contact-name">Contacto</label>
                <input
                  id="contact-name"
                  value={profileForm.contact_name}
                  onChange={(event) => setProfileForm((current) => ({ ...current, contact_name: event.target.value }))}
                />

                <label htmlFor="contact-phone">Teléfono</label>
                <input
                  id="contact-phone"
                  value={profileForm.contact_phone}
                  onChange={(event) => setProfileForm((current) => ({ ...current, contact_phone: event.target.value }))}
                />

                <label htmlFor="profile-country">País de residencia</label>
                <select
                  id="profile-country"
                  value={profileForm.residence_country_code}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, residence_country_code: event.target.value }))
                  }
                >
                  {payload.catalogs.countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.code} · {country.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="profile-territory">Territorio</label>
                <select
                  id="profile-territory"
                  value={profileForm.residence_territory_code}
                  onChange={(event) =>
                    setProfileForm((current) => ({ ...current, residence_territory_code: event.target.value }))
                  }
                >
                  {payload.catalogs.tax_territories.map((territory) => (
                    <option key={territory.code} value={territory.code}>
                      {territory.code} · {territory.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="default-location">Situación por defecto</label>
                <select
                  id="default-location"
                  value={profileForm.default_asset_location_key}
                  onChange={(event) =>
                    setProfileForm((current) => ({
                      ...current,
                      default_asset_location_key: event.target.value as "ES" | "EX"
                    }))
                  }
                >
                  {payload.catalogs.situations.map((situation) => (
                    <option key={situation.code} value={situation.code}>
                      {situation.code} · {situation.description}
                    </option>
                  ))}
                </select>

                <div className="workspace-actions-row">
                  <button type="submit" disabled={savingProfile}>
                    {savingProfile ? "Guardando..." : "Guardar perfil"}
                  </button>
                </div>
              </form>
            </article>

            <article className="workspace-panel">
              <h3>Borradores de review</h3>
              <p className="muted">
                Usa las detecciones pendientes como punto de partida y termina aquí la clasificación o la edición.
              </p>
              <label htmlFor="draft-asset">Borrador de activo</label>
              <select
                id="draft-asset"
                value={selectedAssetDraftId}
                onChange={(event) => setSelectedAssetDraftId(event.target.value)}
              >
                <option value="">Selecciona un borrador</option>
                {payload.draft_assets.map((draft) => (
                  <option key={draft.draft_id} value={draft.draft_id}>
                    {draft.filename} · {draft.label}
                  </option>
                ))}
              </select>
              <div className="workspace-actions-row">
                <button type="button" className="secondary" onClick={applyAssetDraft} disabled={!selectedAssetDraft}>
                  Precargar activo
                </button>
              </div>
              {selectedAssetDraft ? (
                <div className="workspace-note">
                  <strong>{selectedAssetDraft.filename}</strong>
                  <br />
                  <span className="muted">
                    {selectedAssetDraft.review_status} · {formatDateTime(selectedAssetDraft.created_at)}
                  </span>
                </div>
              ) : null}

              <label htmlFor="draft-event" style={{ marginTop: "14px" }}>
                Borrador de evento fiscal
              </label>
              <select
                id="draft-event"
                value={selectedEventDraftId}
                onChange={(event) => setSelectedEventDraftId(event.target.value)}
              >
                <option value="">Selecciona un borrador</option>
                {payload.draft_fiscal_events.map((draft) => (
                  <option key={draft.draft_id} value={draft.draft_id}>
                    {draft.filename} · {draft.label}
                  </option>
                ))}
              </select>
              <div className="workspace-actions-row">
                <button type="button" className="secondary" onClick={applyEventDraft} disabled={!selectedEventDraft}>
                  Precargar evento
                </button>
              </div>
              {selectedEventDraft ? (
                <div className="workspace-note">
                  <strong>{selectedEventDraft.filename}</strong>
                  <br />
                  <span className="muted">
                    {selectedEventDraft.review_status} · {formatDateTime(selectedEventDraft.created_at)}
                  </span>
                </div>
              ) : null}
            </article>
          </div>

          <div className="canonical-grid">
            <article className="workspace-panel">
              <div className="workspace-header-inline">
                <h3>{assetEditingId ? "Editar activo" : "Nuevo activo"}</h3>
                {assetEditingId ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setAssetEditingId(null);
                      setAssetForm(defaultAssetForm());
                    }}
                  >
                    Cancelar edición
                  </button>
                ) : null}
              </div>
              <form className="form canonical-form-grid" onSubmit={handleSaveAsset}>
                <label htmlFor="asset-key">Capítulo / tipo de bien</label>
                <select
                  id="asset-key"
                  value={assetForm.asset_key}
                  onChange={(event) =>
                    setAssetForm((current) => ({
                      ...current,
                      asset_key: event.target.value as CanonicalAssetRecord["asset_key"]
                    }))
                  }
                >
                  {payload.catalogs.asset_types.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="asset-subkey">Subclave</label>
                <select
                  id="asset-subkey"
                  value={assetForm.asset_subkey}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, asset_subkey: event.target.value }))
                  }
                >
                  {subkeyOptions.map((option) => (
                    <option key={`${option.asset_key}:${option.code}`} value={option.code}>
                      {option.code} · {option.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="condition-key">Condición declarante</label>
                <select
                  id="condition-key"
                  value={assetForm.condition_key}
                  onChange={(event) =>
                    setAssetForm((current) => ({
                      ...current,
                      condition_key: event.target.value as CanonicalAssetRecord["condition_key"]
                    }))
                  }
                >
                  {payload.catalogs.conditions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.description}
                    </option>
                  ))}
                </select>

                {assetForm.condition_key === "8" ? (
                  <>
                    <label htmlFor="ownership-type">Tipo de titularidad real</label>
                    <input
                      id="ownership-type"
                      value={assetForm.ownership_type_description}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          ownership_type_description: event.target.value
                        }))
                      }
                    />
                  </>
                ) : null}

                <label htmlFor="location-key">Situación</label>
                <select
                  id="location-key"
                  value={assetForm.location_key}
                  onChange={(event) =>
                    setAssetForm((current) => ({
                      ...current,
                      location_key: event.target.value as CanonicalAssetRecord["location_key"]
                    }))
                  }
                >
                  {payload.catalogs.situations.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="country-code">País</label>
                <select
                  id="country-code"
                  value={assetForm.country_code}
                  onChange={(event) => setAssetForm((current) => ({ ...current, country_code: event.target.value }))}
                >
                  {assetForm.location_key === "EX" ? <option value="">Selecciona país</option> : null}
                  {payload.catalogs.countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.code} · {country.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="tax-territory">Territorio fiscal</label>
                <select
                  id="tax-territory"
                  value={assetForm.tax_territory_code}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, tax_territory_code: event.target.value }))
                  }
                >
                  {payload.catalogs.tax_territories.map((territory) => (
                    <option key={territory.code} value={territory.code}>
                      {territory.code} · {territory.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="incorporation-date">Fecha incorporación</label>
                <input
                  id="incorporation-date"
                  type="date"
                  value={assetForm.incorporation_date}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, incorporation_date: event.target.value }))
                  }
                />

                <label htmlFor="origin-key">Origen</label>
                <select
                  id="origin-key"
                  value={assetForm.origin_key}
                  onChange={(event) =>
                    setAssetForm((current) => ({
                      ...current,
                      origin_key: event.target.value as CanonicalAssetRecord["origin_key"]
                    }))
                  }
                >
                  {payload.catalogs.origins.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.description}
                    </option>
                  ))}
                </select>

                {assetForm.origin_key === "C" ? (
                  <>
                    <label htmlFor="extinction-date">Fecha extinción</label>
                    <input
                      id="extinction-date"
                      type="date"
                      value={assetForm.extinction_date}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, extinction_date: event.target.value }))
                      }
                    />
                  </>
                ) : null}

                <label htmlFor="valuation1">Valoración 1 EUR</label>
                <input
                  id="valuation1"
                  type="number"
                  step="0.01"
                  value={assetForm.valuation_1_eur}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, valuation_1_eur: event.target.value }))
                  }
                />

                <label htmlFor="valuation2">Valoración 2 EUR</label>
                <input
                  id="valuation2"
                  type="number"
                  step="0.01"
                  value={assetForm.valuation_2_eur}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, valuation_2_eur: event.target.value }))
                  }
                />

                <label htmlFor="ownership-pct">% participación</label>
                <input
                  id="ownership-pct"
                  type="number"
                  step="0.01"
                  value={assetForm.ownership_percentage}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, ownership_percentage: event.target.value }))
                  }
                />

                <label htmlFor="asset-currency">Divisa</label>
                <input
                  id="asset-currency"
                  value={assetForm.currency}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                  }
                  maxLength={6}
                />

                <label htmlFor="entity-name">Entidad / emisor</label>
                <input
                  id="entity-name"
                  value={assetForm.entity_name}
                  onChange={(event) => setAssetForm((current) => ({ ...current, entity_name: event.target.value }))}
                />

                <label htmlFor="asset-description">Descripción visible</label>
                <input
                  id="asset-description"
                  value={assetForm.asset_description}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, asset_description: event.target.value }))
                  }
                />

                <label htmlFor="street-line">Domicilio / vía</label>
                <input
                  id="street-line"
                  value={assetForm.street_line}
                  onChange={(event) => setAssetForm((current) => ({ ...current, street_line: event.target.value }))}
                />

                <label htmlFor="complement">Complemento</label>
                <input
                  id="complement"
                  value={assetForm.complement}
                  onChange={(event) => setAssetForm((current) => ({ ...current, complement: event.target.value }))}
                />

                <label htmlFor="city">Población</label>
                <input
                  id="city"
                  value={assetForm.city}
                  onChange={(event) => setAssetForm((current) => ({ ...current, city: event.target.value }))}
                />

                <label htmlFor="region">Región / provincia</label>
                <input
                  id="region"
                  value={assetForm.region}
                  onChange={(event) => setAssetForm((current) => ({ ...current, region: event.target.value }))}
                />

                <label htmlFor="postal-code">Código postal</label>
                <input
                  id="postal-code"
                  value={assetForm.postal_code}
                  onChange={(event) => setAssetForm((current) => ({ ...current, postal_code: event.target.value }))}
                />

                <label htmlFor="address-country">País domicilio</label>
                <select
                  id="address-country"
                  value={assetForm.address_country_code}
                  onChange={(event) =>
                    setAssetForm((current) => ({ ...current, address_country_code: event.target.value }))
                  }
                >
                  <option value="">Sin país</option>
                  {payload.catalogs.countries.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.code} · {country.description}
                    </option>
                  ))}
                </select>

                {assetForm.asset_key === "C" ? (
                  <>
                    <label htmlFor="account-id-key">Identificación cuenta</label>
                    <select
                      id="account-id-key"
                      value={assetForm.account_identification_key}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          account_identification_key: event.target.value as "I" | "O"
                        }))
                      }
                    >
                      <option value="I">I · IBAN</option>
                      <option value="O">O · Otra</option>
                    </select>

                    <label htmlFor="account-bic">BIC</label>
                    <input
                      id="account-bic"
                      value={assetForm.bic}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, bic: event.target.value.toUpperCase() }))
                      }
                    />

                    <label htmlFor="account-code">Cuenta / IBAN</label>
                    <input
                      id="account-code"
                      value={assetForm.account_code}
                      onChange={(event) => setAssetForm((current) => ({ ...current, account_code: event.target.value }))}
                    />

                    <label htmlFor="account-tax-id">NIF entidad país</label>
                    <input
                      id="account-tax-id"
                      value={assetForm.account_entity_tax_id}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, account_entity_tax_id: event.target.value }))
                      }
                    />
                  </>
                ) : null}

                {assetForm.asset_key === "V" || assetForm.asset_key === "I" ? (
                  <>
                    <label htmlFor="security-id-key">Clave identificación</label>
                    <select
                      id="security-id-key"
                      value={assetForm.security_identification_key}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          security_identification_key: event.target.value as "1" | "2"
                        }))
                      }
                    >
                      {payload.catalogs.identification_keys.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.code} · {option.description}
                        </option>
                      ))}
                    </select>

                    <label htmlFor="security-identifier">ISIN / identificador</label>
                    <input
                      id="security-identifier"
                      value={assetForm.security_identifier}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          security_identifier: event.target.value.toUpperCase()
                        }))
                      }
                    />

                    <label htmlFor="representation-key">Representación</label>
                    <select
                      id="representation-key"
                      value={assetForm.representation_key}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          representation_key: event.target.value as "A" | "B"
                        }))
                      }
                    >
                      {payload.catalogs.representation_keys.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.code} · {option.description}
                        </option>
                      ))}
                    </select>

                    <label htmlFor="security-units">Número de títulos</label>
                    <input
                      id="security-units"
                      type="number"
                      step="0.0001"
                      value={assetForm.security_units}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, security_units: event.target.value }))
                      }
                    />

                    <label htmlFor="security-tax-id">NIF entidad país</label>
                    <input
                      id="security-tax-id"
                      value={assetForm.security_entity_tax_id}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, security_entity_tax_id: event.target.value }))
                      }
                    />

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={assetForm.listed}
                        onChange={(event) =>
                          setAssetForm((current) => ({ ...current, listed: event.target.checked }))
                        }
                      />
                      Valor cotizado
                    </label>

                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={assetForm.regulated}
                        onChange={(event) =>
                          setAssetForm((current) => ({ ...current, regulated: event.target.checked }))
                        }
                      />
                      Mercado / IIC regulada
                    </label>
                  </>
                ) : null}

                {assetForm.asset_key === "S" ? (
                  <>
                    <label htmlFor="insurance-kind">Tipo de seguro / renta</label>
                    <select
                      id="insurance-kind"
                      value={assetForm.insurance_kind}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          insurance_kind: event.target.value as AssetFormState["insurance_kind"]
                        }))
                      }
                    >
                      <option value="LIFE">Seguro de vida</option>
                      <option value="DISABILITY">Seguro de invalidez</option>
                      <option value="TEMPORARY_ANNUITY">Renta temporal</option>
                      <option value="LIFETIME_ANNUITY">Renta vitalicia</option>
                    </select>

                    <label htmlFor="insurance-tax-id">NIF entidad país</label>
                    <input
                      id="insurance-tax-id"
                      value={assetForm.insurance_entity_tax_id}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, insurance_entity_tax_id: event.target.value }))
                      }
                    />
                  </>
                ) : null}

                {assetForm.asset_key === "B" ? (
                  <>
                    <label htmlFor="real-estate-type">Tipo inmueble</label>
                    <select
                      id="real-estate-type"
                      value={assetForm.real_estate_type_key}
                      onChange={(event) =>
                        setAssetForm((current) => ({
                          ...current,
                          real_estate_type_key: event.target.value as "U" | "R"
                        }))
                      }
                    >
                      {payload.catalogs.real_estate_types.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.code} · {option.description}
                        </option>
                      ))}
                    </select>

                    <label htmlFor="real-right">Derecho real</label>
                    <input
                      id="real-right"
                      list="real-right-options"
                      value={assetForm.real_right_description}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, real_right_description: event.target.value }))
                      }
                    />
                    <datalist id="real-right-options">
                      {payload.catalogs.real_rights.map((option) => (
                        <option key={option.id} value={option.description} />
                      ))}
                    </datalist>

                    <label htmlFor="cadastral-reference">Referencia catastral</label>
                    <input
                      id="cadastral-reference"
                      value={assetForm.cadastral_reference}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, cadastral_reference: event.target.value }))
                      }
                    />
                  </>
                ) : null}

                {assetForm.asset_key === "M" ? (
                  <>
                    <label htmlFor="movable-kind">Tipo bien mueble</label>
                    <select
                      id="movable-kind"
                      value={assetForm.movable_kind}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, movable_kind: event.target.value }))
                      }
                    >
                      {payload.catalogs.movable_kinds.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.description}
                        </option>
                      ))}
                    </select>

                    <label htmlFor="registry-reference">Referencia registro</label>
                    <input
                      id="registry-reference"
                      value={assetForm.registry_reference}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, registry_reference: event.target.value }))
                      }
                    />

                    <label htmlFor="valuation-method">Método valoración</label>
                    <input
                      id="valuation-method"
                      value={assetForm.valuation_method}
                      onChange={(event) =>
                        setAssetForm((current) => ({ ...current, valuation_method: event.target.value }))
                      }
                    />
                  </>
                ) : null}

                <div className="workspace-actions-row">
                  <button type="submit" disabled={savingAsset}>
                    {savingAsset ? "Guardando..." : assetEditingId ? "Actualizar activo" : "Crear activo"}
                  </button>
                </div>
              </form>
            </article>

            <article className="workspace-panel">
              <h3>Activos registrados</h3>
              {payload.assets.length === 0 ? (
                <p className="muted">
                  Aún no hay activos persistidos. Puedes empezar desde cero o precargar un borrador de review.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Activo</th>
                        <th>Clave</th>
                        <th>Situación</th>
                        <th>Valoración</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.assets.map((asset) => (
                        <tr key={asset.id}>
                          <td>
                            <strong>{asset.display_name}</strong>
                            <br />
                            <span className="muted">
                              {asset.entity_name ?? asset.asset_description ?? "-"}
                            </span>
                          </td>
                          <td>
                            <span className={assetBadge(asset.asset_key)}>
                              {asset.asset_key}-{asset.asset_subkey}
                            </span>
                            <div className="muted" style={{ marginTop: "6px" }}>
                              {asset.country_code} · {asset.tax_territory_code ?? "ES-COMUN"}
                            </div>
                          </td>
                          <td>
                            {asset.location_key}
                            <div className="muted" style={{ marginTop: "6px" }}>
                              {asset.supports_720 ? "Exportable 720" : "No 720"}
                            </div>
                          </td>
                          <td>{formatCurrency(asset.valuation_1_eur, asset.currency ?? null)}</td>
                          <td>
                            <div className="table-actions">
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => {
                                  setAssetEditingId(asset.id);
                                  setAssetForm(assetFormFromAsset(asset));
                                }}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteAsset(asset.id)}
                                disabled={deletingId === asset.id}
                              >
                                {deletingId === asset.id ? "Borrando..." : "Eliminar"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </div>

          <div className="canonical-grid">
            <article className="workspace-panel">
              <div className="workspace-header-inline">
                <h3>{eventEditingId ? "Editar evento fiscal" : "Nuevo evento fiscal"}</h3>
                {eventEditingId ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEventEditingId(null);
                      setEventForm(defaultEventForm());
                    }}
                  >
                    Cancelar edición
                  </button>
                ) : null}
              </div>
              <form className="form canonical-form-grid" onSubmit={handleSaveEvent}>
                <label htmlFor="capital-operation">Operación capital</label>
                <select
                  id="capital-operation"
                  value={eventForm.capital_operation_key}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, capital_operation_key: event.target.value }))
                  }
                >
                  {payload.catalogs.capital_operations.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.irpf_group} · {option.code} · {option.description}
                    </option>
                  ))}
                </select>

                <label htmlFor="event-asset">Activo vinculado</label>
                <select
                  id="event-asset"
                  value={eventForm.asset_id}
                  onChange={(event) => setEventForm((current) => ({ ...current, asset_id: event.target.value }))}
                >
                  <option value="">Sin activo vinculado</option>
                  {compatibleAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.display_name} · {asset.asset_key}
                    </option>
                  ))}
                </select>

                <label htmlFor="event-date">Fecha operación</label>
                <input
                  id="event-date"
                  type="date"
                  value={eventForm.event_date}
                  onChange={(event) => setEventForm((current) => ({ ...current, event_date: event.target.value }))}
                />

                <label htmlFor="event-currency">Divisa</label>
                <input
                  id="event-currency"
                  value={eventForm.currency}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                  }
                  maxLength={6}
                />

                <label htmlFor="event-quantity">Cantidad</label>
                <input
                  id="event-quantity"
                  type="number"
                  step="0.000001"
                  value={eventForm.quantity}
                  onChange={(event) => setEventForm((current) => ({ ...current, quantity: event.target.value }))}
                />

                <label htmlFor="event-unit-price">Precio unitario EUR</label>
                <input
                  id="event-unit-price"
                  type="number"
                  step="0.00000001"
                  value={eventForm.unit_price_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, unit_price_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-gross">Importe bruto EUR</label>
                <input
                  id="event-gross"
                  type="number"
                  step="0.01"
                  value={eventForm.gross_amount_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, gross_amount_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-net">Importe neto EUR</label>
                <input
                  id="event-net"
                  type="number"
                  step="0.01"
                  value={eventForm.net_amount_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, net_amount_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-withholding">Retención EUR</label>
                <input
                  id="event-withholding"
                  type="number"
                  step="0.01"
                  value={eventForm.withholding_amount_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, withholding_amount_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-expense">Gastos EUR</label>
                <input
                  id="event-expense"
                  type="number"
                  step="0.01"
                  value={eventForm.expense_amount_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, expense_amount_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-proceeds">Proceeds EUR</label>
                <input
                  id="event-proceeds"
                  type="number"
                  step="0.01"
                  value={eventForm.proceeds_amount_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, proceeds_amount_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-cost-basis">Coste fiscal EUR</label>
                <input
                  id="event-cost-basis"
                  type="number"
                  step="0.01"
                  value={eventForm.cost_basis_amount_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, cost_basis_amount_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-result">Resultado EUR</label>
                <input
                  id="event-result"
                  type="number"
                  step="0.01"
                  value={eventForm.realized_result_eur}
                  onChange={(event) =>
                    setEventForm((current) => ({ ...current, realized_result_eur: event.target.value }))
                  }
                />

                <label htmlFor="event-original-currency">Divisa original</label>
                <input
                  id="event-original-currency"
                  value={eventForm.original_currency}
                  onChange={(event) =>
                    setEventForm((current) => ({
                      ...current,
                      original_currency: event.target.value.toUpperCase()
                    }))
                  }
                  maxLength={6}
                />

                <label htmlFor="event-original-gross">Importe original</label>
                <input
                  id="event-original-gross"
                  type="number"
                  step="0.01"
                  value={eventForm.gross_amount_original}
                  onChange={(event) =>
                    setEventForm((current) => ({
                      ...current,
                      gross_amount_original: event.target.value
                    }))
                  }
                />

                <label htmlFor="event-fx-rate">Tipo cambio</label>
                <input
                  id="event-fx-rate"
                  type="number"
                  step="0.00000001"
                  value={eventForm.fx_rate}
                  onChange={(event) => setEventForm((current) => ({ ...current, fx_rate: event.target.value }))}
                />

                <label htmlFor="event-box">Casilla IRPF</label>
                <input
                  id="event-box"
                  value={eventForm.irpf_box_code}
                  onChange={(event) => setEventForm((current) => ({ ...current, irpf_box_code: event.target.value }))}
                />

                <label htmlFor="event-notes">Notas</label>
                <textarea
                  id="event-notes"
                  value={eventForm.notes}
                  onChange={(event) => setEventForm((current) => ({ ...current, notes: event.target.value }))}
                />

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={eventForm.is_closing_operation}
                    onChange={(event) =>
                      setEventForm((current) => ({
                        ...current,
                        is_closing_operation: event.target.checked
                      }))
                    }
                  />
                  Operación de cierre
                </label>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={eventForm.is_stock_dividend}
                    onChange={(event) =>
                      setEventForm((current) => ({
                        ...current,
                        is_stock_dividend: event.target.checked
                      }))
                    }
                  />
                  Dividendo en acciones
                </label>

                {selectedOperation ? (
                  <p className="workspace-note">
                    <strong>{selectedOperation.irpf_group}</strong> · {selectedOperation.irpf_subgroup}
                    <br />
                    <span className="muted">
                      {selectedOperation.requires_quantity_price
                        ? "Requiere cantidad y precio unitario."
                        : selectedOperation.requires_positive_gross
                          ? "Requiere importe bruto positivo."
                          : "Puedes completar solo los importes relevantes."}
                    </span>
                  </p>
                ) : null}

                <div className="workspace-actions-row">
                  <button type="submit" disabled={savingEvent}>
                    {savingEvent ? "Guardando..." : eventEditingId ? "Actualizar evento" : "Crear evento"}
                  </button>
                </div>
              </form>
            </article>

            <article className="workspace-panel">
              <h3>Eventos fiscales</h3>
              {payload.fiscal_events.length === 0 ? (
                <p className="muted">
                  Todavía no hay dividendos, intereses, rentas o transmisiones persistidas en el registro canónico.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Operación</th>
                        <th>Importes</th>
                        <th>Activo</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.fiscal_events.map((event) => {
                        const linkedAsset =
                          payload.assets.find((asset) => asset.id === event.asset_id)?.display_name ?? "Sin activo";

                        return (
                          <tr key={event.id}>
                            <td>{event.event_date}</td>
                            <td>
                              <span className={operationBadge(event.irpf_group ?? null)}>
                                {event.capital_operation_key ?? event.event_type}
                              </span>
                              <div className="muted" style={{ marginTop: "6px" }}>
                                {event.irpf_group ?? "OTRO"} · {event.irpf_subgroup ?? "-"}
                              </div>
                            </td>
                            <td>
                              <strong>
                                {formatCurrency(
                                  event.net_amount_eur ??
                                    event.gross_amount_eur ??
                                    event.proceeds_amount_eur ??
                                    event.realized_result_eur ??
                                    null,
                                  event.currency ?? null
                                )}
                              </strong>
                              <div className="muted" style={{ marginTop: "6px" }}>
                                qty {formatNumber(event.quantity ?? null)} · ret{" "}
                                {formatCurrency(event.withholding_amount_eur ?? null, event.currency ?? null)}
                              </div>
                            </td>
                            <td>{linkedAsset}</td>
                            <td>
                              <div className="table-actions">
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => {
                                    setEventEditingId(event.id);
                                    setEventForm(eventFormFromEvent(event));
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteEvent(event.id)}
                                  disabled={deletingId === event.id}
                                >
                                  {deletingId === event.id ? "Borrando..." : "Eliminar"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </div>
        </div>
      )}
    </section>
  );
}
