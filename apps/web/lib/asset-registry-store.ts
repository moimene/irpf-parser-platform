import type { SupabaseClient } from "@supabase/supabase-js";
import {
  serializeCanonicalAssetRecord,
  serializeCanonicalFiscalEvent,
  serializeDeclarationProfile,
  type CanonicalAssetRecord,
  type CanonicalAssetResponse,
  type CanonicalFiscalEvent,
  type CanonicalFiscalEventResponse,
  type DeclarationProfileRecord
} from "@/lib/asset-registry";
import { dbTables } from "@/lib/db-tables";

type JsonObject = Record<string, unknown>;

type DeclarationProfileRow = {
  id: string;
  expediente_id: string;
  client_id: string | null;
  fiscal_year: number;
  declarant_nif: string;
  declared_nif: string;
  legal_representative_nif: string | null;
  declared_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  residence_country_code: string;
  residence_territory_code: string;
  default_asset_location_key: "ES" | "EX";
};

type AssetRegistryRow = {
  id: string;
  expediente_id: string;
  declaration_profile_id: string | null;
  client_id: string | null;
  asset_class: CanonicalAssetRecord["asset_class"];
  clave_condicion: CanonicalAssetRecord["condition_key"];
  tipo_titularidad: string | null;
  clave_tipo_bien: CanonicalAssetRecord["asset_key"];
  subclave: string;
  codigo_pais: string;
  codigo_territorio: string;
  clave_situacion: CanonicalAssetRecord["location_key"];
  fecha_incorporacion: string;
  clave_origen: CanonicalAssetRecord["origin_key"];
  fecha_extincion: string | null;
  valoracion_1_eur: number | string | null;
  valoracion_2_eur: number | string | null;
  porcentaje_participacion: number | string | null;
  currency: string | null;
  denominacion_entidad: string | null;
  descripcion_activo: string | null;
  domicilio_via: string | null;
  domicilio_complemento: string | null;
  domicilio_poblacion: string | null;
  domicilio_region: string | null;
  domicilio_codigo_postal: string | null;
  domicilio_pais: string | null;
  metadata: JsonObject | null;
};

type AssetAccountRow = {
  asset_id: string;
  clave_identif_cuenta: "I" | "O";
  codigo_bic: string | null;
  codigo_cuenta: string;
  nif_entidad_pais: string | null;
};

type AssetSecurityRow = {
  asset_id: string;
  clave_identificacion: "1" | "2";
  identificacion_valores: string;
  nif_entidad_pais: string | null;
  clave_representacion: "A" | "B";
  numero_valores: number | string | null;
  is_listed?: boolean | null;
  is_regulated?: boolean | null;
};

type AssetInsuranceRow = {
  asset_id: string;
  insurance_kind: "LIFE" | "DISABILITY" | "TEMPORARY_ANNUITY" | "LIFETIME_ANNUITY";
  nif_entidad_pais: string | null;
};

type AssetRealEstateRow = {
  asset_id: string;
  tipo_derecho_real_id: number | null;
  clave_tipo_inmueble: "U" | "R";
  referencia_catastral: string | null;
};

type RealRightRow = {
  id: number;
  descripcion: string;
};

type AssetMovableRow = {
  asset_id: string;
  clave_tipo_bien_mueble:
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
  referencia_registro: string | null;
  metodo_valoracion: string | null;
};

type FiscalEventRow = {
  id: string;
  expediente_id: string;
  asset_id: string | null;
  document_id: string | null;
  event_type: CanonicalFiscalEvent["event_type"];
  event_date: string;
  capital_operation_key: string | null;
  irpf_group: string | null;
  irpf_subgroup: string | null;
  quantity: number | string | null;
  gross_amount_eur: number | string | null;
  net_amount_eur: number | string | null;
  withholding_amount_eur: number | string | null;
  proceeds_amount_eur: number | string | null;
  cost_basis_amount_eur: number | string | null;
  realized_result_eur: number | string | null;
  currency: string | null;
  expense_amount_eur: number | string | null;
  original_currency: string | null;
  gross_amount_original: number | string | null;
  fx_rate: number | string | null;
  unit_price_eur: number | string | null;
  is_closing_operation: boolean | null;
  is_stock_dividend: boolean | null;
  irpf_box_code: string | null;
  source: CanonicalFiscalEvent["source"];
  origin_trace: JsonObject | null;
  notes: string | null;
};

type CanonicalRegistrySnapshot = {
  available: boolean;
  declarationProfile: DeclarationProfileRecord | null;
  assets: CanonicalAssetResponse[];
  fiscalEvents: CanonicalFiscalEventResponse[];
};

function isMissingRelation(errorMessage: string | undefined): boolean {
  return Boolean(errorMessage && /does not exist|relation .* does not exist/i.test(errorMessage));
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

export async function loadCanonicalRegistrySnapshot(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<CanonicalRegistrySnapshot> {
  const [declarationProfileResult, assetsResult, fiscalEventsResult] = await Promise.all([
    supabase
      .from(dbTables.declarationProfiles)
      .select(
        "id, expediente_id, client_id, fiscal_year, declarant_nif, declared_nif, legal_representative_nif, declared_name, contact_name, contact_phone, residence_country_code, residence_territory_code, default_asset_location_key"
      )
      .eq("expediente_id", expedienteId)
      .maybeSingle(),
    supabase
      .from(dbTables.assetRegistry)
      .select(
        "id, expediente_id, declaration_profile_id, client_id, asset_class, clave_condicion, tipo_titularidad, clave_tipo_bien, subclave, codigo_pais, codigo_territorio, clave_situacion, fecha_incorporacion, clave_origen, fecha_extincion, valoracion_1_eur, valoracion_2_eur, porcentaje_participacion, currency, denominacion_entidad, descripcion_activo, domicilio_via, domicilio_complemento, domicilio_poblacion, domicilio_region, domicilio_codigo_postal, domicilio_pais, metadata"
      )
      .eq("expediente_id", expedienteId)
      .order("fecha_incorporacion", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from(dbTables.assetFiscalEvents)
      .select(
        "id, expediente_id, asset_id, document_id, event_type, event_date, capital_operation_key, irpf_group, irpf_subgroup, quantity, gross_amount_eur, net_amount_eur, withholding_amount_eur, proceeds_amount_eur, cost_basis_amount_eur, realized_result_eur, currency, expense_amount_eur, original_currency, gross_amount_original, fx_rate, unit_price_eur, is_closing_operation, is_stock_dividend, irpf_box_code, source, origin_trace, notes"
      )
      .eq("expediente_id", expedienteId)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false })
  ]);

  const firstMissingRelation = [
    declarationProfileResult.error,
    assetsResult.error,
    fiscalEventsResult.error
  ].find((error) => isMissingRelation(error?.message));

  if (firstMissingRelation) {
    return {
      available: false,
      declarationProfile: null,
      assets: [],
      fiscalEvents: []
    };
  }

  const firstError = [
    declarationProfileResult.error,
    assetsResult.error,
    fiscalEventsResult.error
  ].find(Boolean);

  if (firstError) {
    throw firstError;
  }

  const declarationProfile = declarationProfileResult.data
    ? serializeDeclarationProfile({
        ...(declarationProfileResult.data as DeclarationProfileRow)
      })
    : null;

  const assetRows = (assetsResult.data ?? []) as AssetRegistryRow[];
  const assetIds = assetRows.map((row) => row.id);

  const [
    accountsResult,
    securitiesResult,
    collectiveInvestmentsResult,
    insurancesResult,
    realEstateResult,
    movableGoodsResult
  ] = assetIds.length === 0
    ? [
        { data: [] as AssetAccountRow[], error: null },
        { data: [] as AssetSecurityRow[], error: null },
        { data: [] as AssetSecurityRow[], error: null },
        { data: [] as AssetInsuranceRow[], error: null },
        { data: [] as AssetRealEstateRow[], error: null },
        { data: [] as AssetMovableRow[], error: null }
      ]
    : await Promise.all([
        supabase
          .from(dbTables.assetAccounts)
          .select("asset_id, clave_identif_cuenta, codigo_bic, codigo_cuenta, nif_entidad_pais")
          .in("asset_id", assetIds),
        supabase
          .from(dbTables.assetSecurities)
          .select(
            "asset_id, clave_identificacion, identificacion_valores, nif_entidad_pais, clave_representacion, numero_valores, is_listed, is_regulated"
          )
          .in("asset_id", assetIds),
        supabase
          .from(dbTables.assetCollectiveInvestments)
          .select(
            "asset_id, clave_identificacion, identificacion_valores, nif_entidad_pais, clave_representacion, numero_valores, is_regulated"
          )
          .in("asset_id", assetIds),
        supabase
          .from(dbTables.assetInsurances)
          .select("asset_id, insurance_kind, nif_entidad_pais")
          .in("asset_id", assetIds),
        supabase
          .from(dbTables.assetRealEstate)
          .select("asset_id, tipo_derecho_real_id, clave_tipo_inmueble, referencia_catastral")
          .in("asset_id", assetIds),
        supabase
          .from(dbTables.assetMovableGoods)
          .select("asset_id, clave_tipo_bien_mueble, referencia_registro, metodo_valoracion")
          .in("asset_id", assetIds)
      ]);

  const subtypeError = [
    accountsResult.error,
    securitiesResult.error,
    collectiveInvestmentsResult.error,
    insurancesResult.error,
    realEstateResult.error,
    movableGoodsResult.error
  ].find(Boolean);

  if (subtypeError) {
    throw subtypeError;
  }

  const realEstateRows = (realEstateResult.data ?? []) as AssetRealEstateRow[];
  const realRightIds = [...new Set(realEstateRows.map((row) => row.tipo_derecho_real_id).filter((value): value is number => Number.isInteger(value)))];
  const realRightsResult =
    realRightIds.length === 0
      ? { data: [] as RealRightRow[], error: null }
      : await supabase
          .from("irpf_cat_tipo_derecho_real")
          .select("id, descripcion")
          .in("id", realRightIds);

  if (realRightsResult.error && !isMissingRelation(realRightsResult.error.message)) {
    throw realRightsResult.error;
  }

  const accountsByAsset = new Map<string, AssetAccountRow>(
    ((accountsResult.data ?? []) as AssetAccountRow[]).map((row) => [row.asset_id, row])
  );
  const securitiesByAsset = new Map<string, AssetSecurityRow>(
    ((securitiesResult.data ?? []) as AssetSecurityRow[]).map((row) => [row.asset_id, row])
  );
  const collectiveInvestmentsByAsset = new Map<string, AssetSecurityRow>(
    ((collectiveInvestmentsResult.data ?? []) as AssetSecurityRow[]).map((row) => [row.asset_id, row])
  );
  const insurancesByAsset = new Map<string, AssetInsuranceRow>(
    ((insurancesResult.data ?? []) as AssetInsuranceRow[]).map((row) => [row.asset_id, row])
  );
  const realEstateByAsset = new Map<string, AssetRealEstateRow>(realEstateRows.map((row) => [row.asset_id, row]));
  const movableGoodsByAsset = new Map<string, AssetMovableRow>(
    ((movableGoodsResult.data ?? []) as AssetMovableRow[]).map((row) => [row.asset_id, row])
  );
  const realRightsById = new Map<number, string>(
    ((realRightsResult.data ?? []) as RealRightRow[]).map((row) => [row.id, row.descripcion])
  );

  const assets = assetRows.map((row) =>
    serializeCanonicalAssetRecord({
      id: row.id,
      asset_link_key:
        row.metadata && typeof row.metadata.asset_link_key === "string"
          ? (row.metadata.asset_link_key as string)
          : null,
      expediente_id: row.expediente_id,
      declaration_profile_id: row.declaration_profile_id,
      client_id: row.client_id,
      asset_class: row.asset_class,
      condition_key: row.clave_condicion,
      ownership_type_description: row.tipo_titularidad,
      asset_key: row.clave_tipo_bien,
      asset_subkey: row.subclave,
      country_code: row.codigo_pais,
      tax_territory_code: row.codigo_territorio,
      location_key: row.clave_situacion,
      incorporation_date: row.fecha_incorporacion,
      origin_key: row.clave_origen,
      extinction_date: row.fecha_extincion,
      valuation_1_eur: toNullableNumber(row.valoracion_1_eur) ?? 0,
      valuation_2_eur: toNullableNumber(row.valoracion_2_eur),
      ownership_percentage: toNullableNumber(row.porcentaje_participacion) ?? 100,
      currency: row.currency,
      entity_name: row.denominacion_entidad,
      asset_description: row.descripcion_activo,
      address: {
        street_line: row.domicilio_via,
        complement: row.domicilio_complemento,
        city: row.domicilio_poblacion,
        region: row.domicilio_region,
        postal_code: row.domicilio_codigo_postal,
        country_code: row.domicilio_pais
      },
      account: accountsByAsset.has(row.id)
        ? {
            account_identification_key: accountsByAsset.get(row.id)?.clave_identif_cuenta ?? null,
            bic: accountsByAsset.get(row.id)?.codigo_bic ?? null,
            account_code: accountsByAsset.get(row.id)?.codigo_cuenta ?? null,
            entity_tax_id: accountsByAsset.get(row.id)?.nif_entidad_pais ?? null
          }
        : null,
      security: securitiesByAsset.has(row.id)
        ? {
            identification_key: securitiesByAsset.get(row.id)?.clave_identificacion ?? null,
            security_identifier: securitiesByAsset.get(row.id)?.identificacion_valores ?? null,
            entity_tax_id: securitiesByAsset.get(row.id)?.nif_entidad_pais ?? null,
            representation_key: securitiesByAsset.get(row.id)?.clave_representacion ?? null,
            units: toNullableNumber(securitiesByAsset.get(row.id)?.numero_valores),
            listed: securitiesByAsset.get(row.id)?.is_listed ?? null,
            regulated: securitiesByAsset.get(row.id)?.is_regulated ?? null
          }
        : null,
      collective_investment: collectiveInvestmentsByAsset.has(row.id)
        ? {
            identification_key: collectiveInvestmentsByAsset.get(row.id)?.clave_identificacion ?? null,
            security_identifier: collectiveInvestmentsByAsset.get(row.id)?.identificacion_valores ?? null,
            entity_tax_id: collectiveInvestmentsByAsset.get(row.id)?.nif_entidad_pais ?? null,
            representation_key: collectiveInvestmentsByAsset.get(row.id)?.clave_representacion ?? null,
            units: toNullableNumber(collectiveInvestmentsByAsset.get(row.id)?.numero_valores),
            listed: null,
            regulated: collectiveInvestmentsByAsset.get(row.id)?.is_regulated ?? null
          }
        : null,
      insurance: insurancesByAsset.has(row.id)
        ? {
            insurance_kind: insurancesByAsset.get(row.id)?.insurance_kind ?? null,
            entity_tax_id: insurancesByAsset.get(row.id)?.nif_entidad_pais ?? null
          }
        : null,
      real_estate: realEstateByAsset.has(row.id)
        ? {
            real_estate_type_key: realEstateByAsset.get(row.id)?.clave_tipo_inmueble ?? null,
            real_right_description:
              realEstateByAsset.get(row.id)?.tipo_derecho_real_id
                ? (realRightsById.get(realEstateByAsset.get(row.id)!.tipo_derecho_real_id as number) ?? null)
                : null,
            cadastral_reference: realEstateByAsset.get(row.id)?.referencia_catastral ?? null
          }
        : null,
      movable: movableGoodsByAsset.has(row.id)
        ? {
            movable_kind: movableGoodsByAsset.get(row.id)?.clave_tipo_bien_mueble ?? null,
            registry_reference: movableGoodsByAsset.get(row.id)?.referencia_registro ?? null,
            valuation_method: movableGoodsByAsset.get(row.id)?.metodo_valoracion ?? null
          }
        : null,
      metadata: row.metadata ?? {}
    })
  );

  const fiscalEvents = ((fiscalEventsResult.data ?? []) as FiscalEventRow[]).map((row) =>
    serializeCanonicalFiscalEvent({
      id: row.id,
      expediente_id: row.expediente_id,
      asset_id: row.asset_id,
      document_id: row.document_id,
      asset_link_key:
        row.origin_trace && typeof row.origin_trace.asset_link_key === "string"
          ? (row.origin_trace.asset_link_key as string)
          : null,
      event_type: row.event_type,
      event_date: row.event_date,
      capital_operation_key: row.capital_operation_key as CanonicalFiscalEvent["capital_operation_key"],
      irpf_group: row.irpf_group as CanonicalFiscalEvent["irpf_group"],
      irpf_subgroup: row.irpf_subgroup,
      quantity: toNullableNumber(row.quantity),
      gross_amount_eur: toNullableNumber(row.gross_amount_eur),
      net_amount_eur: toNullableNumber(row.net_amount_eur),
      withholding_amount_eur: toNullableNumber(row.withholding_amount_eur),
      proceeds_amount_eur: toNullableNumber(row.proceeds_amount_eur),
      cost_basis_amount_eur: toNullableNumber(row.cost_basis_amount_eur),
      realized_result_eur: toNullableNumber(row.realized_result_eur),
      currency: row.currency,
      expense_amount_eur: toNullableNumber(row.expense_amount_eur),
      original_currency: row.original_currency,
      gross_amount_original: toNullableNumber(row.gross_amount_original),
      fx_rate: toNullableNumber(row.fx_rate),
      unit_price_eur: toNullableNumber(row.unit_price_eur),
      is_closing_operation: row.is_closing_operation,
      is_stock_dividend: row.is_stock_dividend,
      irpf_box_code: row.irpf_box_code,
      source: row.source,
      origin_trace: row.origin_trace ?? {},
      notes: row.notes
    })
  );

  return {
    available: true,
    declarationProfile,
    assets,
    fiscalEvents
  };
}
