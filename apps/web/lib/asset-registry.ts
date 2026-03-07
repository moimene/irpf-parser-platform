export type AssetSituationKey = "ES" | "EX";

export type TaxTerritoryCode =
  | "ES-COMUN"
  | "ES-BI"
  | "ES-GI"
  | "ES-VI"
  | "ES-NA";

export type DeclarantConditionKey = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type AssetTypeKey = "C" | "V" | "I" | "S" | "B" | "M";
export type AssetOriginKey = "A" | "M" | "C";
export type SecurityIdentificationKey = "1" | "2";
export type SecurityRepresentationKey = "A" | "B";
export type RealEstateTypeKey = "U" | "R";

export type CanonicalAssetClass =
  | "ACCOUNT"
  | "SECURITY"
  | "COLLECTIVE_INVESTMENT"
  | "INSURANCE"
  | "REAL_ESTATE"
  | "MOVABLE_ASSET";

export type MovableAssetKind =
  | "GENERAL"
  | "ART"
  | "JEWELRY"
  | "VEHICLE"
  | "BOAT"
  | "AIRCRAFT"
  | "COLLECTION"
  | "ADMINISTRATIVE_CONCESSION"
  | "CONTRACT_OPTION"
  | "INTELLECTUAL_PROPERTY"
  | "REGISTERED_MOVABLE"
  | "LOCATED_MOVABLE"
  | "OTHER";

export type CapitalOperationGroup = "RCM" | "GYP" | "OTRO";

export type CapitalOperationKey =
  | "DIVIDENDO_ACCION"
  | "DIVIDENDO_FONDO"
  | "INTERES_CUENTA"
  | "INTERES_BONO"
  | "CUPON_BONO"
  | "REND_SEGURO_VIDA"
  | "RENTA_VITALICIA"
  | "COMPRA_VALOR"
  | "VENTA_VALOR"
  | "COMPRA_FONDO"
  | "VENTA_FONDO"
  | "ALQUILER_INMUEBLE"
  | "COMPRA_INMUEBLE"
  | "VENTA_INMUEBLE"
  | "COMPRA_BIEN_MUEBLE"
  | "VENTA_BIEN_MUEBLE"
  | "RETENCION_MANUAL"
  | "OTRO_MOVIMIENTO";

export type CanonicalFiscalEventType =
  | "ACQUISITION"
  | "DISPOSAL"
  | "INTEREST"
  | "DIVIDEND"
  | "RENT"
  | "WITHHOLDING"
  | "GAIN"
  | "LOSS"
  | "ADJUSTMENT";

export interface AssetAddress {
  street_line?: string | null;
  complement?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
}

export interface DeclarationProfile {
  expediente_id?: string;
  client_id?: string | null;
  fiscal_year?: number | null;
  declarant_nif: string;
  declared_nif?: string | null;
  legal_representative_nif?: string | null;
  declared_name: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  residence_country_code?: string | null;
  residence_territory_code?: TaxTerritoryCode | string | null;
  default_asset_location_key?: AssetSituationKey | null;
}

export interface DeclarationProfileRecord extends DeclarationProfile {
  id: string;
}

export interface CanonicalAssetAccountDetails {
  account_identification_key?: "I" | "O" | null;
  bic?: string | null;
  account_code?: string | null;
  entity_tax_id?: string | null;
}

export interface CanonicalAssetSecurityDetails {
  identification_key?: SecurityIdentificationKey | null;
  security_identifier?: string | null;
  entity_tax_id?: string | null;
  representation_key?: SecurityRepresentationKey | null;
  units?: number | null;
  listed?: boolean | null;
  regulated?: boolean | null;
}

export interface CanonicalAssetInsuranceDetails {
  insurance_kind?: "LIFE" | "DISABILITY" | "TEMPORARY_ANNUITY" | "LIFETIME_ANNUITY" | null;
  entity_tax_id?: string | null;
}

export interface CanonicalAssetRealEstateDetails {
  real_estate_type_key?: RealEstateTypeKey | null;
  real_right_description?: string | null;
  cadastral_reference?: string | null;
}

export interface CanonicalAssetMovableDetails {
  movable_kind?: MovableAssetKind | null;
  registry_reference?: string | null;
  valuation_method?: string | null;
}

export interface CanonicalAssetRecord {
  id?: string;
  asset_link_key?: string | null;
  expediente_id?: string;
  declaration_profile_id?: string | null;
  client_id?: string | null;
  asset_class: CanonicalAssetClass;
  condition_key: DeclarantConditionKey;
  ownership_type_description?: string | null;
  asset_key: AssetTypeKey;
  asset_subkey: string;
  country_code: string;
  tax_territory_code?: TaxTerritoryCode | string | null;
  location_key: AssetSituationKey;
  incorporation_date: string;
  origin_key: AssetOriginKey;
  extinction_date?: string | null;
  valuation_1_eur: number;
  valuation_2_eur?: number | null;
  ownership_percentage: number;
  currency?: string | null;
  entity_name?: string | null;
  asset_description?: string | null;
  address?: AssetAddress | null;
  account?: CanonicalAssetAccountDetails | null;
  security?: CanonicalAssetSecurityDetails | null;
  collective_investment?: CanonicalAssetSecurityDetails | null;
  insurance?: CanonicalAssetInsuranceDetails | null;
  real_estate?: CanonicalAssetRealEstateDetails | null;
  movable?: CanonicalAssetMovableDetails | null;
  metadata?: Record<string, unknown>;
}

export interface CanonicalFiscalEvent {
  id?: string;
  asset_link_key?: string | null;
  expediente_id?: string;
  asset_id?: string | null;
  document_id?: string | null;
  event_type: CanonicalFiscalEventType;
  event_date: string;
  capital_operation_key?: CapitalOperationKey | null;
  irpf_group?: CapitalOperationGroup | null;
  irpf_subgroup?: string | null;
  quantity?: number | null;
  gross_amount_eur?: number | null;
  net_amount_eur?: number | null;
  withholding_amount_eur?: number | null;
  proceeds_amount_eur?: number | null;
  cost_basis_amount_eur?: number | null;
  realized_result_eur?: number | null;
  currency?: string | null;
  expense_amount_eur?: number | null;
  original_currency?: string | null;
  gross_amount_original?: number | null;
  fx_rate?: number | null;
  unit_price_eur?: number | null;
  is_closing_operation?: boolean | null;
  is_stock_dividend?: boolean | null;
  irpf_box_code?: string | null;
  source?: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL" | "RUNTIME";
  origin_trace?: Record<string, unknown>;
  notes?: string | null;
}

export interface CanonicalAssetResponse extends CanonicalAssetRecord {
  id: string;
  display_name: string;
  supports_714: boolean;
  supports_720: boolean;
  is_foreign: boolean;
}

export interface CanonicalFiscalEventResponse extends CanonicalFiscalEvent {
  id: string;
  asset_id: string | null;
  document_id: string | null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeUppercaseText(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function isForeignAssetRecord(
  asset: Pick<CanonicalAssetRecord, "location_key" | "country_code">
): boolean {
  return asset.location_key === "EX" && asset.country_code !== "ES";
}

export function supportsModel720(asset: Pick<CanonicalAssetRecord, "asset_key" | "location_key">): boolean {
  return asset.location_key === "EX" && asset.asset_key !== "M";
}

export function supportsModel714(asset: Pick<CanonicalAssetRecord, "asset_class">): boolean {
  return Boolean(asset.asset_class);
}

export function getAssetDisplayName(asset: CanonicalAssetRecord): string {
  return (
    asset.asset_description ??
    asset.entity_name ??
    asset.security?.security_identifier ??
    asset.account?.account_code ??
    asset.real_estate?.cadastral_reference ??
    asset.movable?.registry_reference ??
    "ACTIVO SIN DESCRIPCION"
  );
}

export function serializeDeclarationProfile(
  profile: DeclarationProfileRecord
): DeclarationProfileRecord {
  return {
    id: profile.id,
    expediente_id: profile.expediente_id,
    client_id: profile.client_id ?? null,
    fiscal_year: profile.fiscal_year ?? null,
    declarant_nif: normalizeUppercaseText(profile.declarant_nif) ?? "00000000T",
    declared_nif: normalizeUppercaseText(profile.declared_nif) ?? normalizeUppercaseText(profile.declarant_nif) ?? "00000000T",
    legal_representative_nif: normalizeUppercaseText(profile.legal_representative_nif),
    declared_name: normalizeNullableText(profile.declared_name) ?? "DECLARANTE SIN NOMBRE",
    contact_name: normalizeNullableText(profile.contact_name),
    contact_phone: normalizeNullableText(profile.contact_phone),
    residence_country_code: normalizeUppercaseText(profile.residence_country_code) ?? "ES",
    residence_territory_code: normalizeNullableText(profile.residence_territory_code) ?? "ES-COMUN",
    default_asset_location_key: (profile.default_asset_location_key ?? "ES") as AssetSituationKey
  };
}

export function serializeCanonicalAssetRecord(
  asset: CanonicalAssetRecord & { id: string }
): CanonicalAssetResponse {
  const normalized: CanonicalAssetRecord = {
    ...asset,
    declaration_profile_id: asset.declaration_profile_id ?? null,
    client_id: asset.client_id ?? null,
    asset_link_key: normalizeNullableText(asset.asset_link_key),
    ownership_type_description: normalizeNullableText(asset.ownership_type_description),
    country_code: normalizeUppercaseText(asset.country_code) ?? "ES",
    tax_territory_code: normalizeNullableText(asset.tax_territory_code) ?? "ES-COMUN",
    location_key: (asset.location_key ?? "ES") as AssetSituationKey,
    extinction_date: normalizeNullableText(asset.extinction_date),
    valuation_1_eur: toNullableNumber(asset.valuation_1_eur) ?? 0,
    valuation_2_eur: toNullableNumber(asset.valuation_2_eur),
    ownership_percentage: toNullableNumber(asset.ownership_percentage) ?? 100,
    currency: normalizeUppercaseText(asset.currency),
    entity_name: normalizeNullableText(asset.entity_name),
    asset_description: normalizeNullableText(asset.asset_description),
    address: asset.address
      ? {
          street_line: normalizeNullableText(asset.address.street_line),
          complement: normalizeNullableText(asset.address.complement),
          city: normalizeNullableText(asset.address.city),
          region: normalizeNullableText(asset.address.region),
          postal_code: normalizeNullableText(asset.address.postal_code),
          country_code: normalizeUppercaseText(asset.address.country_code)
        }
      : null,
    account: asset.account
      ? {
          account_identification_key: asset.account.account_identification_key ?? null,
          bic: normalizeUppercaseText(asset.account.bic),
          account_code: normalizeNullableText(asset.account.account_code),
          entity_tax_id: normalizeNullableText(asset.account.entity_tax_id)
        }
      : null,
    security: asset.security
      ? {
          identification_key: asset.security.identification_key ?? null,
          security_identifier: normalizeUppercaseText(asset.security.security_identifier),
          entity_tax_id: normalizeNullableText(asset.security.entity_tax_id),
          representation_key: asset.security.representation_key ?? null,
          units: toNullableNumber(asset.security.units),
          listed: asset.security.listed ?? null,
          regulated: asset.security.regulated ?? null
        }
      : null,
    collective_investment: asset.collective_investment
      ? {
          identification_key: asset.collective_investment.identification_key ?? null,
          security_identifier: normalizeUppercaseText(asset.collective_investment.security_identifier),
          entity_tax_id: normalizeNullableText(asset.collective_investment.entity_tax_id),
          representation_key: asset.collective_investment.representation_key ?? null,
          units: toNullableNumber(asset.collective_investment.units),
          listed: asset.collective_investment.listed ?? null,
          regulated: asset.collective_investment.regulated ?? null
        }
      : null,
    insurance: asset.insurance
      ? {
          insurance_kind: asset.insurance.insurance_kind ?? null,
          entity_tax_id: normalizeNullableText(asset.insurance.entity_tax_id)
        }
      : null,
    real_estate: asset.real_estate
      ? {
          real_estate_type_key: asset.real_estate.real_estate_type_key ?? null,
          real_right_description: normalizeNullableText(asset.real_estate.real_right_description),
          cadastral_reference: normalizeNullableText(asset.real_estate.cadastral_reference)
        }
      : null,
    movable: asset.movable
      ? {
          movable_kind: asset.movable.movable_kind ?? null,
          registry_reference: normalizeNullableText(asset.movable.registry_reference),
          valuation_method: normalizeNullableText(asset.movable.valuation_method)
        }
      : null,
    metadata: asset.metadata ?? {}
  };

  return {
    id: asset.id,
    ...normalized,
    display_name: getAssetDisplayName(normalized),
    supports_714: supportsModel714(normalized),
    supports_720: supportsModel720(normalized),
    is_foreign: isForeignAssetRecord(normalized)
  };
}

export function serializeCanonicalFiscalEvent(
  event: CanonicalFiscalEvent & { id: string }
): CanonicalFiscalEventResponse {
  return {
    id: event.id,
    asset_id: event.asset_id ?? null,
    document_id: event.document_id ?? null,
    asset_link_key: normalizeNullableText(event.asset_link_key),
    expediente_id: event.expediente_id,
    event_type: event.event_type,
    event_date: event.event_date,
    capital_operation_key: normalizeNullableText(event.capital_operation_key) as CapitalOperationKey | null,
    irpf_group: normalizeNullableText(event.irpf_group) as CapitalOperationGroup | null,
    irpf_subgroup: normalizeNullableText(event.irpf_subgroup),
    quantity: toNullableNumber(event.quantity),
    gross_amount_eur: toNullableNumber(event.gross_amount_eur),
    net_amount_eur: toNullableNumber(event.net_amount_eur),
    withholding_amount_eur: toNullableNumber(event.withholding_amount_eur),
    proceeds_amount_eur: toNullableNumber(event.proceeds_amount_eur),
    cost_basis_amount_eur: toNullableNumber(event.cost_basis_amount_eur),
    realized_result_eur: toNullableNumber(event.realized_result_eur),
    currency: normalizeUppercaseText(event.currency),
    expense_amount_eur: toNullableNumber(event.expense_amount_eur),
    original_currency: normalizeUppercaseText(event.original_currency),
    gross_amount_original: toNullableNumber(event.gross_amount_original),
    fx_rate: toNullableNumber(event.fx_rate),
    unit_price_eur: toNullableNumber(event.unit_price_eur),
    is_closing_operation: event.is_closing_operation ?? false,
    is_stock_dividend: event.is_stock_dividend ?? false,
    irpf_box_code: normalizeNullableText(event.irpf_box_code),
    source: event.source ?? "AUTO",
    origin_trace: event.origin_trace ?? {},
    notes: normalizeNullableText(event.notes)
  };
}
