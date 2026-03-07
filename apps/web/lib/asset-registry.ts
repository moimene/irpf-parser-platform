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
  | "OTHER";

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
  expediente_id?: string;
  asset_id?: string | null;
  document_id?: string | null;
  event_type: CanonicalFiscalEventType;
  event_date: string;
  quantity?: number | null;
  gross_amount_eur?: number | null;
  net_amount_eur?: number | null;
  withholding_amount_eur?: number | null;
  proceeds_amount_eur?: number | null;
  cost_basis_amount_eur?: number | null;
  realized_result_eur?: number | null;
  currency?: string | null;
  source?: "AUTO" | "MANUAL" | "IMPORTACION_EXCEL" | "RUNTIME";
  origin_trace?: Record<string, unknown>;
  notes?: string | null;
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
