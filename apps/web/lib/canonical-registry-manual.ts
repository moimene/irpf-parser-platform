import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAssetDisplayName,
  serializeCanonicalAssetRecord,
  serializeCanonicalFiscalEvent,
  serializeDeclarationProfile,
  type AssetTypeKey,
  type CanonicalAssetClass,
  type CanonicalAssetRecord,
  type CanonicalAssetResponse,
  type CanonicalFiscalEvent,
  type CanonicalFiscalEventResponse,
  type CapitalOperationKey,
  type DeclarationProfile,
  type DeclarationProfileRecord
} from "@/lib/asset-registry";
import { deriveCanonicalRegistryFromParsePayload, ensureDeclarationProfile } from "@/lib/canonical-registry";
import { loadCanonicalRegistrySnapshot } from "@/lib/asset-registry-store";
import { dbTables } from "@/lib/db-tables";

type JsonObject = Record<string, unknown>;

type CatalogOption = {
  code: string;
  description: string;
};

type SubkeyCatalogOption = CatalogOption & {
  asset_key: AssetTypeKey;
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
  asset_key: AssetTypeKey | null;
  requires_quantity_price: boolean;
  requires_positive_gross: boolean;
};

type ReviewExtractionDraftRow = {
  id: string;
  document_id: string;
  filename: string;
  review_status: string;
  created_at: string;
  normalized_payload: JsonObject | null;
};

export type CanonicalAssetDraft = {
  draft_id: string;
  extraction_id: string;
  document_id: string;
  filename: string;
  review_status: string;
  created_at: string;
  label: string;
  asset: CanonicalAssetRecord;
};

export type CanonicalFiscalEventDraft = {
  draft_id: string;
  extraction_id: string;
  document_id: string;
  filename: string;
  review_status: string;
  created_at: string;
  label: string;
  event: CanonicalFiscalEvent;
};

export type CanonicalRegistryCatalogs = {
  countries: CatalogOption[];
  situations: CatalogOption[];
  tax_territories: TaxTerritoryCatalogOption[];
  conditions: CatalogOption[];
  asset_types: CatalogOption[];
  subkeys: SubkeyCatalogOption[];
  origins: CatalogOption[];
  identification_keys: CatalogOption[];
  representation_keys: CatalogOption[];
  real_estate_types: CatalogOption[];
  real_rights: RealRightCatalogOption[];
  movable_kinds: CatalogOption[];
  capital_operations: CapitalOperationCatalogOption[];
};

type DeclarationProfileRow = {
  id: string;
  expediente_id: string;
  client_id: string | null;
  fiscal_year: number | null;
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

type AssetRegistryCurrentRow = {
  id: string;
  asset_class: CanonicalAssetClass;
  clave_tipo_bien: AssetTypeKey;
  created_by: string | null;
  metadata: JsonObject | null;
};

type AssetSubtypeRow = {
  asset_id: string;
};

type RealRightRow = {
  id: number;
  descripcion: string;
};

type AssetLookupRow = {
  id: string;
  expediente_id: string;
  clave_tipo_bien: AssetTypeKey;
  metadata: JsonObject | null;
};

const assetClassByKey: Record<AssetTypeKey, CanonicalAssetClass> = {
  C: "ACCOUNT",
  V: "SECURITY",
  I: "COLLECTIVE_INVESTMENT",
  S: "INSURANCE",
  B: "REAL_ESTATE",
  M: "MOVABLE_ASSET"
};

const eventTypeByCapitalOperation: Record<CapitalOperationKey, CanonicalFiscalEvent["event_type"]> = {
  DIVIDENDO_ACCION: "DIVIDEND",
  DIVIDENDO_FONDO: "DIVIDEND",
  INTERES_CUENTA: "INTEREST",
  INTERES_BONO: "INTEREST",
  CUPON_BONO: "INTEREST",
  REND_SEGURO_VIDA: "RENT",
  RENTA_VITALICIA: "RENT",
  COMPRA_VALOR: "ACQUISITION",
  VENTA_VALOR: "DISPOSAL",
  COMPRA_FONDO: "ACQUISITION",
  VENTA_FONDO: "DISPOSAL",
  ALQUILER_INMUEBLE: "RENT",
  COMPRA_INMUEBLE: "ACQUISITION",
  VENTA_INMUEBLE: "DISPOSAL",
  COMPRA_BIEN_MUEBLE: "ACQUISITION",
  VENTA_BIEN_MUEBLE: "DISPOSAL",
  RETENCION_MANUAL: "WITHHOLDING",
  OTRO_MOVIMIENTO: "ADJUSTMENT"
};

function isMissingRelation(errorMessage: string | undefined): boolean {
  return Boolean(errorMessage && /does not exist|relation .* does not exist/i.test(errorMessage));
}

function toNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toUppercaseNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

function buildManualAssetLinkKey(assetId: string, assetKey: AssetTypeKey): string {
  return `MANUAL|${assetKey}|${assetId}`;
}

function buildDraftEventLabel(event: CanonicalFiscalEvent): string {
  const amount =
    event.gross_amount_eur ??
    event.net_amount_eur ??
    event.proceeds_amount_eur ??
    event.realized_result_eur ??
    null;
  const amountLabel = amount === null ? "sin importe" : `${amount.toFixed(2)} ${event.currency ?? "EUR"}`;
  return `${event.event_date} · ${event.capital_operation_key ?? event.event_type} · ${amountLabel}`;
}

function withDraftIdAsset(asset: CanonicalAssetRecord, draftId: string): CanonicalAssetRecord {
  const normalized = serializeCanonicalAssetRecord({
    id: draftId,
    ...asset,
    asset_class: asset.asset_class,
    asset_key: asset.asset_key,
    asset_link_key: asset.asset_link_key ?? draftId
  });

  return {
    asset_link_key: normalized.asset_link_key,
    asset_class: normalized.asset_class,
    condition_key: normalized.condition_key,
    ownership_type_description: normalized.ownership_type_description,
    asset_key: normalized.asset_key,
    asset_subkey: normalized.asset_subkey,
    country_code: normalized.country_code,
    tax_territory_code: normalized.tax_territory_code,
    location_key: normalized.location_key,
    incorporation_date: normalized.incorporation_date,
    origin_key: normalized.origin_key,
    extinction_date: normalized.extinction_date,
    valuation_1_eur: normalized.valuation_1_eur,
    valuation_2_eur: normalized.valuation_2_eur,
    ownership_percentage: normalized.ownership_percentage,
    currency: normalized.currency,
    entity_name: normalized.entity_name,
    asset_description: normalized.asset_description,
    address: normalized.address,
    account: normalized.account,
    security: normalized.security,
    collective_investment: normalized.collective_investment,
    insurance: normalized.insurance,
    real_estate: normalized.real_estate,
    movable: normalized.movable,
    metadata: normalized.metadata
  };
}

function withDraftIdEvent(event: CanonicalFiscalEvent, draftId: string): CanonicalFiscalEvent {
  const normalized = serializeCanonicalFiscalEvent({
    id: draftId,
    expediente_id: "draft-expediente",
    asset_id: event.asset_id ?? null,
    document_id: null,
    source: event.source ?? "AUTO",
    origin_trace: event.origin_trace ?? {},
    ...event
  });

  return {
    asset_link_key: normalized.asset_link_key,
    event_type: normalized.event_type,
    event_date: normalized.event_date,
    asset_id: normalized.asset_id,
    capital_operation_key: normalized.capital_operation_key,
    irpf_group: normalized.irpf_group,
    irpf_subgroup: normalized.irpf_subgroup,
    quantity: normalized.quantity,
    gross_amount_eur: normalized.gross_amount_eur,
    net_amount_eur: normalized.net_amount_eur,
    withholding_amount_eur: normalized.withholding_amount_eur,
    proceeds_amount_eur: normalized.proceeds_amount_eur,
    cost_basis_amount_eur: normalized.cost_basis_amount_eur,
    realized_result_eur: normalized.realized_result_eur,
    currency: normalized.currency,
    expense_amount_eur: normalized.expense_amount_eur,
    original_currency: normalized.original_currency,
    gross_amount_original: normalized.gross_amount_original,
    fx_rate: normalized.fx_rate,
    unit_price_eur: normalized.unit_price_eur,
    is_closing_operation: normalized.is_closing_operation,
    is_stock_dividend: normalized.is_stock_dividend,
    irpf_box_code: normalized.irpf_box_code,
    source: normalized.source,
    origin_trace: normalized.origin_trace,
    notes: normalized.notes
  };
}

export function getAssetClassForAssetKey(assetKey: AssetTypeKey): CanonicalAssetClass {
  return assetClassByKey[assetKey];
}

export function getEventTypeForCapitalOperation(
  capitalOperationKey: CapitalOperationKey
): CanonicalFiscalEvent["event_type"] {
  return eventTypeByCapitalOperation[capitalOperationKey];
}

export function buildCanonicalReviewDrafts(
  extractions: ReviewExtractionDraftRow[]
): {
  assetDrafts: CanonicalAssetDraft[];
  fiscalEventDrafts: CanonicalFiscalEventDraft[];
} {
  const assetDrafts: CanonicalAssetDraft[] = [];
  const fiscalEventDrafts: CanonicalFiscalEventDraft[] = [];

  for (const extraction of extractions) {
    const normalizedPayload = extraction.normalized_payload ?? {};
    const canonical = deriveCanonicalRegistryFromParsePayload({
      records: Array.isArray(normalizedPayload.records) ? normalizedPayload.records : [],
      assetRecords: normalizedPayload.asset_records,
      fiscalEvents: normalizedPayload.fiscal_events
    });

    canonical.assetRecords.forEach((asset, index) => {
      const draftId = `${extraction.id}:asset:${index}`;
      const normalizedAsset = withDraftIdAsset(asset, draftId);
      assetDrafts.push({
        draft_id: draftId,
        extraction_id: extraction.id,
        document_id: extraction.document_id,
        filename: extraction.filename,
        review_status: extraction.review_status,
        created_at: extraction.created_at,
        label: getAssetDisplayName(normalizedAsset),
        asset: normalizedAsset
      });
    });

    canonical.fiscalEvents.forEach((event, index) => {
      const draftId = `${extraction.id}:event:${index}`;
      const normalizedEvent = withDraftIdEvent(event, draftId);
      fiscalEventDrafts.push({
        draft_id: draftId,
        extraction_id: extraction.id,
        document_id: extraction.document_id,
        filename: extraction.filename,
        review_status: extraction.review_status,
        created_at: extraction.created_at,
        label: buildDraftEventLabel(normalizedEvent),
        event: normalizedEvent
      });
    });
  }

  return { assetDrafts, fiscalEventDrafts };
}

export async function loadCanonicalCatalogs(
  supabase: SupabaseClient
): Promise<CanonicalRegistryCatalogs | null> {
  const [
    countriesResult,
    situationsResult,
    taxTerritoriesResult,
    conditionsResult,
    assetTypesResult,
    subkeysResult,
    originsResult,
    identificationKeysResult,
    representationKeysResult,
    realEstateTypesResult,
    realRightsResult,
    movableKindsResult,
    capitalOperationsResult
  ] = await Promise.all([
    supabase.from(dbTables.countriesCatalog).select("codigo_pais, nombre").order("codigo_pais"),
    supabase.from(dbTables.assetSituationsCatalog).select("clave_situacion, descripcion").order("clave_situacion"),
    supabase
      .from(dbTables.taxTerritoriesCatalog)
      .select("codigo_territorio, descripcion, codigo_pais")
      .order("codigo_territorio"),
    supabase.from(dbTables.declarantConditionsCatalog).select("clave_condicion, descripcion").order("clave_condicion"),
    supabase.from(dbTables.assetTypesCatalog).select("clave_tipo_bien, descripcion").order("clave_tipo_bien"),
    supabase
      .from(dbTables.assetSubkeysCatalog)
      .select("clave_tipo_bien, subclave, descripcion")
      .order("clave_tipo_bien")
      .order("subclave"),
    supabase.from(dbTables.assetOriginsCatalog).select("clave_origen, descripcion").order("clave_origen"),
    supabase
      .from(dbTables.identificationKeysCatalog)
      .select("clave_identificacion, descripcion")
      .order("clave_identificacion"),
    supabase
      .from(dbTables.representationKeysCatalog)
      .select("clave_representacion, descripcion")
      .order("clave_representacion"),
    supabase.from(dbTables.realEstateTypesCatalog).select("clave_tipo_inmueble, descripcion").order("clave_tipo_inmueble"),
    supabase.from(dbTables.realRightsCatalog).select("id, descripcion").order("descripcion"),
    supabase.from(dbTables.movableGoodsCatalog).select("clave_tipo_bien_mueble, descripcion").order("descripcion"),
    supabase
      .from(dbTables.capitalOperationTypes)
      .select(
        "codigo_tipo_operacion, descripcion, grupo_irpf, subgrupo_irpf, clave_tipo_bien, requires_quantity_price, requires_positive_gross"
      )
      .order("grupo_irpf")
      .order("codigo_tipo_operacion")
  ]);

  const missing = [
    countriesResult.error,
    situationsResult.error,
    taxTerritoriesResult.error,
    conditionsResult.error,
    assetTypesResult.error,
    subkeysResult.error,
    originsResult.error,
    identificationKeysResult.error,
    representationKeysResult.error,
    realEstateTypesResult.error,
    realRightsResult.error,
    movableKindsResult.error,
    capitalOperationsResult.error
  ].find((error) => isMissingRelation(error?.message));

  if (missing) {
    return null;
  }

  const firstError = [
    countriesResult.error,
    situationsResult.error,
    taxTerritoriesResult.error,
    conditionsResult.error,
    assetTypesResult.error,
    subkeysResult.error,
    originsResult.error,
    identificationKeysResult.error,
    representationKeysResult.error,
    realEstateTypesResult.error,
    realRightsResult.error,
    movableKindsResult.error,
    capitalOperationsResult.error
  ].find(Boolean);

  if (firstError) {
    throw firstError;
  }

  return {
    countries: ((countriesResult.data ?? []) as Array<{ codigo_pais: string; nombre: string }>).map((row) => ({
      code: row.codigo_pais,
      description: row.nombre
    })),
    situations: ((situationsResult.data ?? []) as Array<{ clave_situacion: string; descripcion: string }>).map((row) => ({
      code: row.clave_situacion,
      description: row.descripcion
    })),
    tax_territories: ((taxTerritoriesResult.data ?? []) as Array<{
      codigo_territorio: string;
      descripcion: string;
      codigo_pais: string;
    }>).map((row) => ({
      code: row.codigo_territorio,
      description: row.descripcion,
      country_code: row.codigo_pais
    })),
    conditions: ((conditionsResult.data ?? []) as Array<{ clave_condicion: string; descripcion: string }>).map((row) => ({
      code: row.clave_condicion,
      description: row.descripcion
    })),
    asset_types: ((assetTypesResult.data ?? []) as Array<{ clave_tipo_bien: string; descripcion: string }>).map((row) => ({
      code: row.clave_tipo_bien,
      description: row.descripcion
    })),
    subkeys: ((subkeysResult.data ?? []) as Array<{
      clave_tipo_bien: string;
      subclave: string;
      descripcion: string;
    }>).map((row) => ({
      asset_key: row.clave_tipo_bien as AssetTypeKey,
      code: row.subclave,
      description: row.descripcion
    })),
    origins: ((originsResult.data ?? []) as Array<{ clave_origen: string; descripcion: string }>).map((row) => ({
      code: row.clave_origen,
      description: row.descripcion
    })),
    identification_keys: ((identificationKeysResult.data ?? []) as Array<{
      clave_identificacion: string;
      descripcion: string;
    }>).map((row) => ({
      code: row.clave_identificacion,
      description: row.descripcion
    })),
    representation_keys: ((representationKeysResult.data ?? []) as Array<{
      clave_representacion: string;
      descripcion: string;
    }>).map((row) => ({
      code: row.clave_representacion,
      description: row.descripcion
    })),
    real_estate_types: ((realEstateTypesResult.data ?? []) as Array<{
      clave_tipo_inmueble: string;
      descripcion: string;
    }>).map((row) => ({
      code: row.clave_tipo_inmueble,
      description: row.descripcion
    })),
    real_rights: ((realRightsResult.data ?? []) as RealRightRow[]).map((row) => ({
      id: row.id,
      description: row.descripcion
    })),
    movable_kinds: ((movableKindsResult.data ?? []) as Array<{
      clave_tipo_bien_mueble: string;
      descripcion: string;
    }>).map((row) => ({
      code: row.clave_tipo_bien_mueble,
      description: row.descripcion
    })),
    capital_operations: ((capitalOperationsResult.data ?? []) as Array<{
      codigo_tipo_operacion: string;
      descripcion: string;
      grupo_irpf: "RCM" | "GYP" | "OTRO";
      subgrupo_irpf: string;
      clave_tipo_bien: AssetTypeKey | null;
      requires_quantity_price: boolean;
      requires_positive_gross: boolean;
    }>).map((row) => ({
      code: row.codigo_tipo_operacion,
      description: row.descripcion,
      irpf_group: row.grupo_irpf,
      irpf_subgroup: row.subgrupo_irpf,
      asset_key: row.clave_tipo_bien,
      requires_quantity_price: row.requires_quantity_price,
      requires_positive_gross: row.requires_positive_gross
    }))
  };
}

export async function loadCanonicalReviewDrafts(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<{
  assetDrafts: CanonicalAssetDraft[];
  fiscalEventDrafts: CanonicalFiscalEventDraft[];
}> {
  const documentsResult = await supabase
    .from(dbTables.documents)
    .select("id, filename")
    .eq("expediente_id", expedienteId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (documentsResult.error) {
    throw new Error(`No se pudieron cargar documentos del expediente: ${documentsResult.error.message}`);
  }

  const documents = (documentsResult.data ?? []) as Array<{ id: string; filename: string }>;
  if (documents.length === 0) {
    return { assetDrafts: [], fiscalEventDrafts: [] };
  }

  const extractionResult = await supabase
    .from(dbTables.extractions)
    .select("id, document_id, review_status, created_at, normalized_payload")
    .in("document_id", documents.map((row) => row.id))
    .neq("review_status", "validated")
    .order("created_at", { ascending: false })
    .limit(20);

  if (extractionResult.error) {
    throw new Error(`No se pudieron cargar borradores de review: ${extractionResult.error.message}`);
  }

  const filenameByDocument = new Map(documents.map((document) => [document.id, document.filename]));
  const extractionRows = ((extractionResult.data ?? []) as Array<{
    id: string;
    document_id: string;
    review_status: string;
    created_at: string;
    normalized_payload: JsonObject | null;
  }>)
    .filter((row) => row.normalized_payload)
    .map((row) => ({
      ...row,
      filename: filenameByDocument.get(row.document_id) ?? "documento"
    }));

  return buildCanonicalReviewDrafts(extractionRows);
}

export async function upsertDeclarationProfile(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    actor: string | null;
    profile: DeclarationProfile;
  }
): Promise<{
  before: DeclarationProfileRecord | null;
  after: DeclarationProfileRecord;
}> {
  const profileId = await ensureDeclarationProfile(supabase, input.expedienteId);
  if (!profileId) {
    throw new Error("El schema canónico no está disponible en este entorno.");
  }

  const currentResult = await supabase
    .from(dbTables.declarationProfiles)
    .select(
      "id, expediente_id, client_id, fiscal_year, declarant_nif, declared_nif, legal_representative_nif, declared_name, contact_name, contact_phone, residence_country_code, residence_territory_code, default_asset_location_key"
    )
    .eq("id", profileId)
    .single();

  if (currentResult.error || !currentResult.data) {
    throw new Error(`No se pudo cargar el perfil declarativo actual: ${currentResult.error?.message ?? "desconocido"}`);
  }

  const before = serializeDeclarationProfile(currentResult.data as DeclarationProfileRow);
  const merged = serializeDeclarationProfile({
    ...before,
    ...input.profile,
    id: profileId,
    expediente_id: input.expedienteId,
    client_id: before.client_id,
    fiscal_year: before.fiscal_year
  });

  const updateResult = await supabase
    .from(dbTables.declarationProfiles)
    .update({
      declarant_nif: merged.declarant_nif,
      declared_nif: merged.declared_nif,
      legal_representative_nif: merged.legal_representative_nif,
      declared_name: merged.declared_name,
      contact_name: merged.contact_name,
      contact_phone: merged.contact_phone,
      residence_country_code: merged.residence_country_code,
      residence_territory_code: merged.residence_territory_code,
      default_asset_location_key: merged.default_asset_location_key
    })
    .eq("id", profileId);

  if (updateResult.error) {
    throw new Error(`No se pudo actualizar el perfil declarativo: ${updateResult.error.message}`);
  }

  return {
    before,
    after: merged
  };
}

async function ensureRealRightId(
  supabase: SupabaseClient,
  description: string | null | undefined
): Promise<number | null> {
  const normalizedDescription = toNullableString(description);
  if (!normalizedDescription) {
    return null;
  }

  const existingResult = await supabase
    .from(dbTables.realRightsCatalog)
    .select("id, descripcion")
    .ilike("descripcion", normalizedDescription)
    .maybeSingle();

  if (existingResult.error) {
    throw new Error(`No se pudo resolver el tipo de derecho real: ${existingResult.error.message}`);
  }

  if (existingResult.data?.id) {
    return Number(existingResult.data.id);
  }

  const insertResult = await supabase
    .from(dbTables.realRightsCatalog)
    .insert({ descripcion: normalizedDescription })
    .select("id, descripcion")
    .single();

  if (insertResult.error || !insertResult.data) {
    throw new Error(`No se pudo crear el tipo de derecho real: ${insertResult.error?.message ?? "desconocido"}`);
  }

  return Number((insertResult.data as RealRightRow).id);
}

async function clearAssetSubtypeRows(supabase: SupabaseClient, assetId: string) {
  const tables = [
    dbTables.assetAccounts,
    dbTables.assetSecurities,
    dbTables.assetCollectiveInvestments,
    dbTables.assetInsurances,
    dbTables.assetRealEstate,
    dbTables.assetMovableGoods
  ];

  const results = await Promise.all(
    tables.map((table) => supabase.from(table).delete().eq("asset_id", assetId))
  );

  const firstError = results.find((result) => result.error)?.error;
  if (firstError) {
    throw new Error(`No se pudieron limpiar los detalles del activo: ${firstError.message}`);
  }
}

async function insertAssetSubtypeRow(
  supabase: SupabaseClient,
  assetId: string,
  asset: CanonicalAssetResponse
) {
  if (asset.asset_key === "C" && asset.account?.account_code) {
    const result = await supabase.from(dbTables.assetAccounts).insert({
      asset_id: assetId,
      clave_identif_cuenta: asset.account.account_identification_key ?? "O",
      codigo_bic: asset.account.bic ?? null,
      codigo_cuenta: asset.account.account_code,
      nif_entidad_pais: asset.account.entity_tax_id ?? null
    });

    if (result.error) {
      throw new Error(`No se pudo guardar el detalle bancario: ${result.error.message}`);
    }
    return;
  }

  if (asset.asset_key === "V" && asset.security?.security_identifier) {
    const result = await supabase.from(dbTables.assetSecurities).insert({
      asset_id: assetId,
      clave_identificacion: asset.security.identification_key ?? "2",
      identificacion_valores: asset.security.security_identifier,
      nif_entidad_pais: asset.security.entity_tax_id ?? null,
      clave_representacion: asset.security.representation_key ?? "A",
      numero_valores: asset.security.units ?? 0,
      is_listed: asset.security.listed ?? true,
      is_regulated: asset.security.regulated ?? true
    });

    if (result.error) {
      throw new Error(`No se pudo guardar el detalle del valor: ${result.error.message}`);
    }
    return;
  }

  if (asset.asset_key === "I" && asset.collective_investment?.security_identifier) {
    const result = await supabase.from(dbTables.assetCollectiveInvestments).insert({
      asset_id: assetId,
      clave_identificacion: asset.collective_investment.identification_key ?? "2",
      identificacion_valores: asset.collective_investment.security_identifier,
      nif_entidad_pais: asset.collective_investment.entity_tax_id ?? null,
      clave_representacion: asset.collective_investment.representation_key ?? "A",
      numero_valores: asset.collective_investment.units ?? 0,
      is_regulated: asset.collective_investment.regulated ?? true
    });

    if (result.error) {
      throw new Error(`No se pudo guardar el detalle de la IIC: ${result.error.message}`);
    }
    return;
  }

  if (asset.asset_key === "S" && asset.insurance?.insurance_kind) {
    const result = await supabase.from(dbTables.assetInsurances).insert({
      asset_id: assetId,
      insurance_kind: asset.insurance.insurance_kind,
      nif_entidad_pais: asset.insurance.entity_tax_id ?? null
    });

    if (result.error) {
      throw new Error(`No se pudo guardar el detalle del seguro: ${result.error.message}`);
    }
    return;
  }

  if (asset.asset_key === "B" && asset.real_estate?.real_estate_type_key) {
    const realRightId = await ensureRealRightId(supabase, asset.real_estate.real_right_description);
    const result = await supabase.from(dbTables.assetRealEstate).insert({
      asset_id: assetId,
      tipo_derecho_real_id: realRightId,
      clave_tipo_inmueble: asset.real_estate.real_estate_type_key,
      referencia_catastral: asset.real_estate.cadastral_reference ?? null
    });

    if (result.error) {
      throw new Error(`No se pudo guardar el detalle del inmueble: ${result.error.message}`);
    }
    return;
  }

  if (asset.asset_key === "M" && asset.movable?.movable_kind) {
    const result = await supabase.from(dbTables.assetMovableGoods).insert({
      asset_id: assetId,
      clave_tipo_bien_mueble: asset.movable.movable_kind,
      referencia_registro: asset.movable.registry_reference ?? null,
      metodo_valoracion: asset.movable.valuation_method ?? null
    });

    if (result.error) {
      throw new Error(`No se pudo guardar el detalle del bien mueble: ${result.error.message}`);
    }
  }
}

async function countLinkedFiscalEvents(
  supabase: SupabaseClient,
  expedienteId: string,
  assetId: string
): Promise<number> {
  const result = await supabase
    .from(dbTables.assetFiscalEvents)
    .select("id")
    .eq("expediente_id", expedienteId)
    .eq("asset_id", assetId)
    .limit(1);

  if (result.error) {
    throw new Error(`No se pudo comprobar si el activo tiene eventos vinculados: ${result.error.message}`);
  }

  return result.data?.length ?? 0;
}

export async function upsertCanonicalAsset(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    actor: string | null;
    assetId?: string;
    asset: CanonicalAssetRecord;
  }
): Promise<{
  before: CanonicalAssetResponse | null;
  after: CanonicalAssetResponse;
}> {
  const declarationProfileId = await ensureDeclarationProfile(supabase, input.expedienteId);
  if (!declarationProfileId) {
    throw new Error("El schema canónico no está disponible en este entorno.");
  }

  const assetId = input.assetId ?? crypto.randomUUID();
  const currentResult = input.assetId
    ? await supabase
        .from(dbTables.assetRegistry)
        .select("id, asset_class, clave_tipo_bien, created_by, metadata")
        .eq("id", input.assetId)
        .eq("expediente_id", input.expedienteId)
        .maybeSingle()
    : { data: null, error: null };

  if (currentResult.error) {
    throw new Error(`No se pudo cargar el activo actual: ${currentResult.error.message}`);
  }

  const current = (currentResult.data as AssetRegistryCurrentRow | null) ?? null;

  if (current && (current.asset_class !== input.asset.asset_class || current.clave_tipo_bien !== input.asset.asset_key)) {
    const linkedEvents = await countLinkedFiscalEvents(supabase, input.expedienteId, assetId);
    if (linkedEvents > 0) {
      throw new Error(
        "No puedes reclasificar el tipo de activo mientras existan eventos fiscales vinculados. Actualiza o elimina antes esos eventos."
      );
    }
  }

  const normalized = serializeCanonicalAssetRecord({
    id: assetId,
    ...input.asset,
    expediente_id: input.expedienteId,
    declaration_profile_id: declarationProfileId,
    asset_link_key:
      input.asset.asset_link_key ??
      (current?.metadata && typeof current.metadata.asset_link_key === "string"
        ? (current.metadata.asset_link_key as string)
        : buildManualAssetLinkKey(assetId, input.asset.asset_key))
  });

  const beforeSnapshot = current
    ? (await loadCanonicalRegistrySnapshot(supabase, input.expedienteId)).assets.find((asset) => asset.id === assetId) ?? null
    : null;

  const row = {
    id: assetId,
    expediente_id: input.expedienteId,
    declaration_profile_id: declarationProfileId,
    client_id: normalized.client_id ?? null,
    asset_class: normalized.asset_class,
    clave_condicion: normalized.condition_key,
    tipo_titularidad: normalized.ownership_type_description ?? null,
    clave_tipo_bien: normalized.asset_key,
    subclave: normalized.asset_subkey,
    codigo_pais: normalized.country_code,
    codigo_territorio: normalized.tax_territory_code ?? "ES-COMUN",
    clave_situacion: normalized.location_key,
    fecha_incorporacion: normalized.incorporation_date,
    clave_origen: normalized.origin_key,
    fecha_extincion: normalized.extinction_date ?? null,
    valoracion_1_eur: normalized.valuation_1_eur,
    valoracion_2_eur: normalized.valuation_2_eur ?? null,
    porcentaje_participacion: normalized.ownership_percentage,
    currency: normalized.currency ?? null,
    denominacion_entidad: normalized.entity_name ?? null,
    descripcion_activo: normalized.asset_description ?? null,
    domicilio_via: normalized.address?.street_line ?? null,
    domicilio_complemento: normalized.address?.complement ?? null,
    domicilio_poblacion: normalized.address?.city ?? null,
    domicilio_region: normalized.address?.region ?? null,
    domicilio_codigo_postal: normalized.address?.postal_code ?? null,
    domicilio_pais: normalized.address?.country_code ?? null,
    metadata: {
      ...(current?.metadata ?? {}),
      ...(normalized.metadata ?? {}),
      asset_link_key: normalized.asset_link_key,
      source_mode: "MANUAL",
      manual_workspace: true
    },
    created_by: current?.created_by ?? input.actor,
    updated_by: input.actor
  };

  if (current) {
    const updateResult = await supabase
      .from(dbTables.assetRegistry)
      .update(row)
      .eq("id", assetId)
      .eq("expediente_id", input.expedienteId);

    if (updateResult.error) {
      throw new Error(`No se pudo actualizar el activo canónico: ${updateResult.error.message}`);
    }
  } else {
    const insertResult = await supabase.from(dbTables.assetRegistry).insert(row);
    if (insertResult.error) {
      throw new Error(`No se pudo crear el activo canónico: ${insertResult.error.message}`);
    }
  }

  await clearAssetSubtypeRows(supabase, assetId);
  await insertAssetSubtypeRow(supabase, assetId, normalized);

  return {
    before: beforeSnapshot,
    after: normalized
  };
}

export async function deleteCanonicalAsset(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    assetId: string;
  }
): Promise<CanonicalAssetResponse> {
  const snapshot = await loadCanonicalRegistrySnapshot(supabase, input.expedienteId);
  const existing = snapshot.assets.find((asset) => asset.id === input.assetId);
  if (!existing) {
    throw new Error("Activo canónico no encontrado.");
  }

  const linkedEvents = await countLinkedFiscalEvents(supabase, input.expedienteId, input.assetId);
  if (linkedEvents > 0) {
    throw new Error("No puedes eliminar un activo con eventos fiscales vinculados. Elimina primero esos eventos.");
  }

  const deleteResult = await supabase
    .from(dbTables.assetRegistry)
    .delete()
    .eq("id", input.assetId)
    .eq("expediente_id", input.expedienteId);

  if (deleteResult.error) {
    throw new Error(`No se pudo eliminar el activo canónico: ${deleteResult.error.message}`);
  }

  return existing;
}

async function loadEventAssetLookup(
  supabase: SupabaseClient,
  expedienteId: string,
  assetId: string | null | undefined
): Promise<AssetLookupRow | null> {
  if (!assetId) {
    return null;
  }

  const result = await supabase
    .from(dbTables.assetRegistry)
    .select("id, expediente_id, clave_tipo_bien, metadata")
    .eq("id", assetId)
    .eq("expediente_id", expedienteId)
    .maybeSingle();

  if (result.error) {
    throw new Error(`No se pudo cargar el activo vinculado al evento: ${result.error.message}`);
  }

  return (result.data as AssetLookupRow | null) ?? null;
}

export async function upsertCanonicalFiscalEvent(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    actor: string | null;
    eventId?: string;
    event: CanonicalFiscalEvent;
  }
): Promise<{
  before: CanonicalFiscalEventResponse | null;
  after: CanonicalFiscalEventResponse;
}> {
  const eventId = input.eventId ?? crypto.randomUUID();
  const linkedAsset = await loadEventAssetLookup(supabase, input.expedienteId, input.event.asset_id);
  const eventType =
    input.event.capital_operation_key
      ? getEventTypeForCapitalOperation(input.event.capital_operation_key)
      : input.event.event_type;

  const currentSnapshot = await loadCanonicalRegistrySnapshot(supabase, input.expedienteId);
  const before = currentSnapshot.fiscalEvents.find((event) => event.id === eventId) ?? null;

  const normalized = serializeCanonicalFiscalEvent({
    id: eventId,
    expediente_id: input.expedienteId,
    document_id: input.event.document_id ?? null,
    source: input.event.source ?? "MANUAL",
    origin_trace: {
      ...(input.event.origin_trace ?? {}),
      asset_link_key:
        linkedAsset?.metadata && typeof linkedAsset.metadata.asset_link_key === "string"
          ? (linkedAsset.metadata.asset_link_key as string)
          : null,
      source_mode: "MANUAL",
      manual_workspace: true,
      updated_by: input.actor
    },
    ...input.event,
    asset_id: linkedAsset?.id ?? null,
    event_type: eventType,
    asset_link_key:
      linkedAsset?.metadata && typeof linkedAsset.metadata.asset_link_key === "string"
        ? (linkedAsset.metadata.asset_link_key as string)
        : input.event.asset_link_key ?? null
  });

  const row = {
    id: eventId,
    expediente_id: input.expedienteId,
    asset_id: normalized.asset_id ?? null,
    document_id: normalized.document_id ?? null,
    event_type: normalized.event_type,
    event_date: normalized.event_date,
    capital_operation_key: normalized.capital_operation_key ?? null,
    irpf_group: normalized.irpf_group ?? null,
    irpf_subgroup: normalized.irpf_subgroup ?? null,
    quantity: normalized.quantity ?? null,
    gross_amount_eur: normalized.gross_amount_eur ?? null,
    net_amount_eur: normalized.net_amount_eur ?? null,
    withholding_amount_eur: normalized.withholding_amount_eur ?? null,
    proceeds_amount_eur: normalized.proceeds_amount_eur ?? null,
    cost_basis_amount_eur: normalized.cost_basis_amount_eur ?? null,
    realized_result_eur: normalized.realized_result_eur ?? null,
    currency: normalized.currency ?? null,
    expense_amount_eur: normalized.expense_amount_eur ?? null,
    original_currency: normalized.original_currency ?? null,
    gross_amount_original: normalized.gross_amount_original ?? null,
    fx_rate: normalized.fx_rate ?? null,
    unit_price_eur: normalized.unit_price_eur ?? null,
    is_closing_operation: normalized.is_closing_operation ?? false,
    is_stock_dividend: normalized.is_stock_dividend ?? false,
    irpf_box_code: normalized.irpf_box_code ?? null,
    source: "MANUAL" as const,
    origin_trace: normalized.origin_trace ?? {},
    notes: normalized.notes ?? null
  };

  if (before) {
    const updateResult = await supabase
      .from(dbTables.assetFiscalEvents)
      .update(row)
      .eq("id", eventId)
      .eq("expediente_id", input.expedienteId);

    if (updateResult.error) {
      throw new Error(`No se pudo actualizar el evento fiscal: ${updateResult.error.message}`);
    }
  } else {
    const insertResult = await supabase.from(dbTables.assetFiscalEvents).insert(row);
    if (insertResult.error) {
      throw new Error(`No se pudo crear el evento fiscal: ${insertResult.error.message}`);
    }
  }

  return {
    before,
    after: normalized
  };
}

export async function deleteCanonicalFiscalEvent(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    eventId: string;
  }
): Promise<CanonicalFiscalEventResponse> {
  const snapshot = await loadCanonicalRegistrySnapshot(supabase, input.expedienteId);
  const existing = snapshot.fiscalEvents.find((event) => event.id === input.eventId);
  if (!existing) {
    throw new Error("Evento fiscal no encontrado.");
  }

  const deleteResult = await supabase
    .from(dbTables.assetFiscalEvents)
    .delete()
    .eq("id", input.eventId)
    .eq("expediente_id", input.expedienteId);

  if (deleteResult.error) {
    throw new Error(`No se pudo eliminar el evento fiscal: ${deleteResult.error.message}`);
  }

  return existing;
}

