import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalAssetRecord, CanonicalFiscalEvent, ParsedRecord } from "@/lib/contracts";
import { dbTables } from "@/lib/db-tables";

type JsonObject = Record<string, unknown>;
type CanonicalSource = "AUTO" | "MANUAL" | "IMPORTACION_EXCEL" | "RUNTIME";
type AssetClass = CanonicalAssetRecord["asset_class"];
type CapitalOperationKey = CanonicalFiscalEvent["capital_operation_key"];
type CapitalOperationGroup = CanonicalFiscalEvent["irpf_group"];
type MovableKind = NonNullable<NonNullable<CanonicalAssetRecord["movable"]>["movable_kind"]>;

const explicitAssetRecordTypes = new Set<ParsedRecord["record_type"]>([
  "CUENTA",
  "VALOR",
  "IIC",
  "SEGURO",
  "INMUEBLE",
  "BIEN_MUEBLE",
  "CUENTA_BANCARIA",
  "POSICION"
]);

const explicitFiscalEventRecordTypes = new Set<ParsedRecord["record_type"]>([
  "DIVIDENDO",
  "INTERES",
  "RENTA",
  "RETENCION",
  "COMPRA",
  "VENTA"
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(payload: unknown, key: string): string | null {
  if (!isObject(payload)) {
    return null;
  }

  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(payload: unknown, key: string): number | null {
  if (!isObject(payload)) {
    return null;
  }

  const value = payload[key];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(payload: unknown, key: string): boolean | null {
  if (!isObject(payload)) {
    return null;
  }

  const value = payload[key];
  return typeof value === "boolean" ? value : null;
}

function normalizeCountryCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() || "ES";
}

function normalizeLocationKey(
  locationKey: string | null | undefined,
  countryCode: string
): CanonicalAssetRecord["location_key"] {
  if (locationKey === "ES" || locationKey === "EX") {
    return locationKey;
  }

  return countryCode === "ES" ? "ES" : "EX";
}

function normalizeDate(value: string | null | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return new Date().toISOString().slice(0, 10);
}

function normalizeAssetLinkKey(candidate: string | null | undefined): string | null {
  return candidate?.trim() ? candidate.trim() : null;
}

function buildAssetLinkKey(asset: Partial<CanonicalAssetRecord>): string {
  const identifier =
    asset.security?.security_identifier ??
    asset.collective_investment?.security_identifier ??
    asset.account?.account_code ??
    asset.real_estate?.cadastral_reference ??
    asset.movable?.registry_reference ??
    asset.asset_description ??
    asset.entity_name ??
    "UNKNOWN";

  return [
    asset.asset_class ?? "UNKNOWN",
    asset.asset_key ?? "X",
    asset.asset_subkey ?? "0",
    normalizeCountryCode(asset.country_code),
    identifier.trim().toUpperCase()
  ].join("|");
}

function normalizeAssetClass(recordType: ParsedRecord["record_type"], fields: JsonObject): AssetClass | null {
  switch (recordType) {
    case "CUENTA":
    case "CUENTA_BANCARIA":
      return "ACCOUNT";
    case "VALOR":
      return "SECURITY";
    case "IIC":
      return "COLLECTIVE_INVESTMENT";
    case "SEGURO":
      return "INSURANCE";
    case "INMUEBLE":
      return "REAL_ESTATE";
    case "BIEN_MUEBLE":
      return "MOVABLE_ASSET";
    case "POSICION":
      if (readString(fields, "account_code") || readString(fields, "bic")) {
        return "ACCOUNT";
      }

      if (readString(fields, "real_estate_type_key") || readString(fields, "real_right_description")) {
        return "REAL_ESTATE";
      }

      if (readString(fields, "movable_kind")) {
        return "MOVABLE_ASSET";
      }

      if (readString(fields, "insurance_kind")) {
        return "INSURANCE";
      }

      if (readString(fields, "asset_key") === "I") {
        return "COLLECTIVE_INVESTMENT";
      }

      return "SECURITY";
    default:
      return null;
  }
}

function defaultAssetKey(assetClass: AssetClass): CanonicalAssetRecord["asset_key"] {
  switch (assetClass) {
    case "ACCOUNT":
      return "C";
    case "SECURITY":
      return "V";
    case "COLLECTIVE_INVESTMENT":
      return "I";
    case "INSURANCE":
      return "S";
    case "REAL_ESTATE":
      return "B";
    case "MOVABLE_ASSET":
      return "M";
  }
}

function defaultAssetSubkey(assetClass: AssetClass, fields: JsonObject): string {
  const explicit = readString(fields, "asset_subkey") ?? readString(fields, "subclave");
  if (explicit) {
    return explicit;
  }

  switch (assetClass) {
    case "ACCOUNT":
      return "5";
    case "SECURITY":
      return "1";
    case "COLLECTIVE_INVESTMENT":
      return "0";
    case "INSURANCE":
      return readString(fields, "insurance_kind")?.includes("ANNUITY") ? "2" : "1";
    case "REAL_ESTATE":
      return "1";
    case "MOVABLE_ASSET":
      return "1";
  }
}

function normalizeUppercaseValue(value: string | null | undefined): string | null {
  return value?.trim().toUpperCase() || null;
}

function normalizeMovableKind(rawValue: string | null | undefined): MovableKind {
  const normalized = normalizeUppercaseValue(rawValue)?.replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "A":
    case "ART":
    case "ARTWORK":
    case "OBJETOS_DE_ARTE":
      return "ART";
    case "J":
    case "JEWELRY":
    case "JOYAS":
      return "JEWELRY";
    case "V":
    case "VEHICLE":
    case "VEHICULO":
    case "VEHICULOS":
      return "VEHICLE";
    case "E":
    case "BOAT":
    case "EMBARCACION":
    case "EMBARCACIONES_Y_AERONAVES":
      return "BOAT";
    case "AIRCRAFT":
    case "AERONAVE":
      return "AIRCRAFT";
    case "COLLECTION":
    case "COLECCION":
      return "COLLECTION";
    case "C":
    case "ADMINISTRATIVE_CONCESSION":
    case "CONCESION_ADMINISTRATIVA":
      return "ADMINISTRATIVE_CONCESSION";
    case "N":
    case "CONTRACT_OPTION":
    case "OPCION_CONTRACTUAL":
      return "CONTRACT_OPTION";
    case "D":
    case "INTELLECTUAL_PROPERTY":
    case "DERECHO_PROPIEDAD_INTELECTUAL":
    case "DERECHO_PROPIEDAD_INDUSTRIAL":
      return "INTELLECTUAL_PROPERTY";
    case "R":
    case "REGISTERED_MOVABLE":
    case "MUEBLE_MATRICULADO":
      return "REGISTERED_MOVABLE";
    case "M":
    case "LOCATED_MOVABLE":
    case "MUEBLE_SITUADO":
      return "LOCATED_MOVABLE";
    case "GENERAL":
      return "GENERAL";
    default:
      return "OTHER";
  }
}

const capitalOperationCatalog: Record<
  NonNullable<CapitalOperationKey>,
  { irpfGroup: NonNullable<CapitalOperationGroup>; irpfSubgroup: string }
> = {
  DIVIDENDO_ACCION: { irpfGroup: "RCM", irpfSubgroup: "DIVIDENDOS" },
  DIVIDENDO_FONDO: { irpfGroup: "RCM", irpfSubgroup: "DIVIDENDOS" },
  INTERES_CUENTA: { irpfGroup: "RCM", irpfSubgroup: "INTERESES" },
  INTERES_BONO: { irpfGroup: "RCM", irpfSubgroup: "INTERESES" },
  CUPON_BONO: { irpfGroup: "RCM", irpfSubgroup: "INTERESES" },
  REND_SEGURO_VIDA: { irpfGroup: "RCM", irpfSubgroup: "SEGUROS" },
  RENTA_VITALICIA: { irpfGroup: "RCM", irpfSubgroup: "RENTAS" },
  COMPRA_VALOR: { irpfGroup: "GYP", irpfSubgroup: "ACCIONES" },
  VENTA_VALOR: { irpfGroup: "GYP", irpfSubgroup: "ACCIONES" },
  COMPRA_FONDO: { irpfGroup: "GYP", irpfSubgroup: "FONDOS" },
  VENTA_FONDO: { irpfGroup: "GYP", irpfSubgroup: "FONDOS" },
  ALQUILER_INMUEBLE: { irpfGroup: "RCM", irpfSubgroup: "INMUEBLES" },
  COMPRA_INMUEBLE: { irpfGroup: "GYP", irpfSubgroup: "INMUEBLES" },
  VENTA_INMUEBLE: { irpfGroup: "GYP", irpfSubgroup: "INMUEBLES" },
  COMPRA_BIEN_MUEBLE: { irpfGroup: "GYP", irpfSubgroup: "BIENES_MUEBLES" },
  VENTA_BIEN_MUEBLE: { irpfGroup: "GYP", irpfSubgroup: "BIENES_MUEBLES" },
  RETENCION_MANUAL: { irpfGroup: "RCM", irpfSubgroup: "RETENCIONES" },
  OTRO_MOVIMIENTO: { irpfGroup: "OTRO", irpfSubgroup: "OTRO" }
};

function inferAssetKeyForEvent(
  recordType: ParsedRecord["record_type"],
  linkedAsset: CanonicalAssetRecord | null,
  fields: JsonObject
): CanonicalAssetRecord["asset_key"] | null {
  const explicitAssetKey = readString(fields, "asset_key") as CanonicalAssetRecord["asset_key"] | null;
  if (explicitAssetKey) {
    return explicitAssetKey;
  }

  if (linkedAsset) {
    return linkedAsset.asset_key;
  }

  if (recordType === "INTERES" && (readString(fields, "account_code") || readString(fields, "bic"))) {
    return "C";
  }

  if (recordType === "RENTA") {
    if (readString(fields, "insurance_kind")) {
      return "S";
    }
    if (
      readString(fields, "real_estate_type_key") ||
      readString(fields, "clave_tipo_inmueble") ||
      readString(fields, "cadastral_reference")
    ) {
      return "B";
    }
    if (
      readString(fields, "movable_kind") ||
      readString(fields, "clave_tipo_bien_mueble") ||
      readString(fields, "clave_tipo_inmueble_mueble")
    ) {
      return "M";
    }
  }

  if (readString(fields, "isin") || readString(fields, "security_identifier")) {
    return "V";
  }

  return null;
}

function defaultCapitalOperationKey(
  eventType: CanonicalFiscalEvent["event_type"],
  assetKey: CanonicalAssetRecord["asset_key"] | null,
  fields: JsonObject
): NonNullable<CapitalOperationKey> {
  const explicitKey = readString(fields, "capital_operation_key") as CapitalOperationKey;
  if (explicitKey) {
    return explicitKey;
  }

  switch (eventType) {
    case "ACQUISITION":
      switch (assetKey) {
        case "I":
          return "COMPRA_FONDO";
        case "B":
          return "COMPRA_INMUEBLE";
        case "M":
          return "COMPRA_BIEN_MUEBLE";
        default:
          return "COMPRA_VALOR";
      }
    case "DISPOSAL":
      switch (assetKey) {
        case "I":
          return "VENTA_FONDO";
        case "B":
          return "VENTA_INMUEBLE";
        case "M":
          return "VENTA_BIEN_MUEBLE";
        default:
          return "VENTA_VALOR";
      }
    case "DIVIDEND":
      return assetKey === "I" ? "DIVIDENDO_FONDO" : "DIVIDENDO_ACCION";
    case "INTEREST":
      return readBoolean(fields, "is_coupon") || readString(fields, "coupon_type")
        ? "CUPON_BONO"
        : assetKey === "V"
          ? "INTERES_BONO"
          : "INTERES_CUENTA";
    case "RENT":
      if (assetKey === "S") {
        return readString(fields, "insurance_kind")?.includes("LIFE") ? "REND_SEGURO_VIDA" : "RENTA_VITALICIA";
      }
      return assetKey === "B" ? "ALQUILER_INMUEBLE" : "OTRO_MOVIMIENTO";
    case "WITHHOLDING":
      return "RETENCION_MANUAL";
    default:
      return "OTRO_MOVIMIENTO";
  }
}

function deriveOperationAmounts(
  eventType: CanonicalFiscalEvent["event_type"],
  fields: JsonObject
): Pick<
  CanonicalFiscalEvent,
  | "gross_amount_eur"
  | "net_amount_eur"
  | "withholding_amount_eur"
  | "proceeds_amount_eur"
  | "cost_basis_amount_eur"
  | "realized_result_eur"
  | "expense_amount_eur"
  | "gross_amount_original"
  | "fx_rate"
  | "unit_price_eur"
> {
  const amount =
    readNumber(fields, "gross_amount_eur") ??
    readNumber(fields, "amount");
  const retention =
    readNumber(fields, "withholding_amount_eur") ??
    readNumber(fields, "retention");
  const expenseAmount =
    readNumber(fields, "expense_amount_eur") ??
    readNumber(fields, "fees") ??
    readNumber(fields, "gastos");
  const quantity = readNumber(fields, "quantity");
  const proceedsAmount =
    readNumber(fields, "proceeds_amount_eur") ??
    (eventType === "DISPOSAL" ? amount : null);
  const unitPrice =
    readNumber(fields, "unit_price_eur") ??
    readNumber(fields, "price_unit_eur") ??
    readNumber(fields, "precio_unitario_eur") ??
    ((eventType === "ACQUISITION" || eventType === "DISPOSAL") &&
    quantity !== null &&
    quantity > 0 &&
    amount !== null
      ? amount / quantity
      : null);
  const grossAmount =
    eventType === "WITHHOLDING"
      ? null
      : amount;

  return {
    gross_amount_eur: grossAmount,
    net_amount_eur:
      grossAmount !== null
        ? grossAmount - (retention ?? 0) - (expenseAmount ?? 0)
        : null,
    withholding_amount_eur: eventType === "WITHHOLDING" ? amount : retention,
    proceeds_amount_eur: proceedsAmount,
    cost_basis_amount_eur: readNumber(fields, "cost_basis_amount_eur"),
    realized_result_eur:
      readNumber(fields, "realized_result_eur") ??
      readNumber(fields, "realized_gain"),
    expense_amount_eur: expenseAmount,
    gross_amount_original:
      readNumber(fields, "gross_amount_original") ??
      readNumber(fields, "amount_original"),
    fx_rate:
      readNumber(fields, "fx_rate") ??
      readNumber(fields, "tipo_cambio"),
    unit_price_eur: unitPrice
  };
}

function deriveImplicitAssetFromRecord(
  record: ParsedRecord | Record<string, unknown>
): CanonicalAssetRecord | null {
  const recordType = String((record as Record<string, unknown>).record_type ?? "") as ParsedRecord["record_type"];
  if (!explicitAssetRecordTypes.has(recordType)) {
    return null;
  }

  const fields = isObject((record as Record<string, unknown>).fields)
    ? ((record as Record<string, unknown>).fields as JsonObject)
    : {};
  const assetClass = normalizeAssetClass(recordType, fields);
  if (!assetClass) {
    return null;
  }

  const countryCode = normalizeCountryCode(
    readString(fields, "country_code") ?? readString(fields, "codigo_pais")
  );
  const locationKey = normalizeLocationKey(
    readString(fields, "location_key") ?? readString(fields, "clave_situacion"),
    countryCode
  );
  const assetKey = (readString(fields, "asset_key") as CanonicalAssetRecord["asset_key"] | null) ?? defaultAssetKey(assetClass);

  const next: CanonicalAssetRecord = {
    asset_class: assetClass,
    condition_key:
      (readString(fields, "condition_key") as CanonicalAssetRecord["condition_key"] | null) ?? "1",
    asset_key: assetKey,
    asset_subkey: defaultAssetSubkey(assetClass, fields),
    country_code: countryCode,
    location_key: locationKey,
    incorporation_date: normalizeDate(
      readString(fields, "incorporation_date") ??
        readString(fields, "operation_date") ??
        readString(fields, "event_date")
    ),
    origin_key: (readString(fields, "origin_key") as CanonicalAssetRecord["origin_key"] | null) ?? "A",
    valuation_1_eur:
      readNumber(fields, "valuation_1_eur") ??
      readNumber(fields, "amount") ??
      0,
    valuation_2_eur: readNumber(fields, "valuation_2_eur"),
    ownership_percentage: readNumber(fields, "ownership_percentage") ?? 100,
    entity_name: readString(fields, "entity_name"),
    asset_description:
      readString(fields, "asset_description") ??
      readString(fields, "description"),
    currency: readString(fields, "currency"),
    tax_territory_code:
      readString(fields, "tax_territory_code") ??
      readString(fields, "codigo_territorio") ??
      "ES-COMUN",
    ownership_type_description:
      readString(fields, "ownership_type_description") ??
      readString(fields, "tipo_titularidad"),
    extinction_date: normalizeAssetLinkKey(readString(fields, "extinction_date")),
    address: {
      street_line: readString(fields, "street_line") ?? readString(fields, "domicilio_via"),
      complement: readString(fields, "complement") ?? readString(fields, "domicilio_complemento"),
      city: readString(fields, "city") ?? readString(fields, "domicilio_poblacion"),
      region: readString(fields, "region") ?? readString(fields, "domicilio_region"),
      postal_code: readString(fields, "postal_code") ?? readString(fields, "domicilio_codigo_postal"),
      country_code: normalizeAssetLinkKey(readString(fields, "domicilio_pais"))
    },
    metadata: {
      source_record_type: recordType
    }
  };

  if (assetClass === "ACCOUNT") {
    next.account = {
      account_identification_key:
        (readString(fields, "account_identification_key") as "I" | "O" | null) ??
        (readString(fields, "clave_identif_cuenta") as "I" | "O" | null) ??
        "O",
      bic: readString(fields, "bic") ?? readString(fields, "codigo_bic"),
      account_code: readString(fields, "account_code") ?? readString(fields, "codigo_cuenta"),
      entity_tax_id: readString(fields, "entity_tax_id") ?? readString(fields, "nif_entidad_pais")
    };
  } else if (assetClass === "SECURITY") {
    next.security = {
      identification_key:
        (readString(fields, "identification_key") as "1" | "2" | null) ??
        (readString(fields, "clave_identificacion") as "1" | "2" | null) ??
        (readString(fields, "isin") ? "1" : "2"),
      security_identifier:
        readString(fields, "security_identifier") ??
        readString(fields, "identificacion_valores") ??
        readString(fields, "isin") ??
        readString(fields, "description"),
      entity_tax_id: readString(fields, "entity_tax_id") ?? readString(fields, "nif_entidad_pais"),
      representation_key:
        (readString(fields, "representation_key") as "A" | "B" | null) ??
        (readString(fields, "clave_representacion") as "A" | "B" | null) ??
        "A",
      units: readNumber(fields, "quantity") ?? readNumber(fields, "numero_valores"),
      listed: readBoolean(fields, "listed") ?? true,
      regulated: readBoolean(fields, "regulated") ?? true
    };
  } else if (assetClass === "COLLECTIVE_INVESTMENT") {
    next.collective_investment = {
      identification_key:
        (readString(fields, "identification_key") as "1" | "2" | null) ??
        (readString(fields, "clave_identificacion") as "1" | "2" | null) ??
        (readString(fields, "isin") ? "1" : "2"),
      security_identifier:
        readString(fields, "security_identifier") ??
        readString(fields, "identificacion_valores") ??
        readString(fields, "isin") ??
        readString(fields, "description"),
      entity_tax_id: readString(fields, "entity_tax_id") ?? readString(fields, "nif_entidad_pais"),
      representation_key:
        (readString(fields, "representation_key") as "A" | "B" | null) ??
        (readString(fields, "clave_representacion") as "A" | "B" | null) ??
        "A",
      units: readNumber(fields, "quantity") ?? readNumber(fields, "numero_valores"),
      listed: readBoolean(fields, "listed") ?? true,
      regulated: readBoolean(fields, "regulated") ?? true
    };
  } else if (assetClass === "INSURANCE") {
    next.insurance = {
      insurance_kind:
        (readString(fields, "insurance_kind") as CanonicalAssetRecord["insurance"] extends { insurance_kind?: infer T } ? T : never) ??
        "LIFE",
      entity_tax_id: readString(fields, "entity_tax_id") ?? readString(fields, "nif_entidad_pais")
    };
  } else if (assetClass === "REAL_ESTATE") {
    next.real_estate = {
      real_estate_type_key:
        (readString(fields, "real_estate_type_key") as "U" | "R" | null) ??
        (readString(fields, "clave_tipo_inmueble") as "U" | "R" | null) ??
        "U",
      real_right_description:
        readString(fields, "real_right_description") ??
        readString(fields, "tipo_derecho_real"),
      cadastral_reference:
        readString(fields, "cadastral_reference") ??
        readString(fields, "referencia_catastral")
    };
  } else if (assetClass === "MOVABLE_ASSET") {
    next.movable = {
      movable_kind: normalizeMovableKind(
        readString(fields, "movable_kind") ??
          readString(fields, "clave_tipo_bien_mueble") ??
          readString(fields, "clave_tipo_inmueble_mueble")
      ),
      registry_reference:
        readString(fields, "registry_reference") ??
        readString(fields, "referencia_registro"),
      valuation_method:
        readString(fields, "valuation_method") ??
        readString(fields, "metodo_valoracion")
    };
  }

  next.asset_link_key = normalizeAssetLinkKey(readString(fields, "asset_link_key")) ?? buildAssetLinkKey(next);
  return next;
}

function deriveImplicitAssetFromEventRecord(
  record: ParsedRecord | Record<string, unknown>
): CanonicalAssetRecord | null {
  const recordType = String((record as Record<string, unknown>).record_type ?? "") as ParsedRecord["record_type"];
  if (!explicitFiscalEventRecordTypes.has(recordType)) {
    return null;
  }

  const fields = isObject((record as Record<string, unknown>).fields)
    ? ((record as Record<string, unknown>).fields as JsonObject)
    : {};

  if (
    !readString(fields, "isin") &&
    !readString(fields, "security_identifier") &&
    !readString(fields, "account_code") &&
    !readString(fields, "description") &&
    !readString(fields, "insurance_kind") &&
    !readString(fields, "real_estate_type_key") &&
    !readString(fields, "clave_tipo_inmueble") &&
    !readString(fields, "movable_kind") &&
    !readString(fields, "clave_tipo_bien_mueble")
  ) {
    return null;
  }

  const countryCode = normalizeCountryCode(
    readString(fields, "country_code") ?? readString(fields, "codigo_pais")
  );
  const locationKey = normalizeLocationKey(
    readString(fields, "location_key") ?? readString(fields, "clave_situacion"),
    countryCode
  );
  const inferredAssetKey = inferAssetKeyForEvent(recordType, null, fields);
  let assetClass: AssetClass = "SECURITY";
  switch (inferredAssetKey) {
    case "C":
      assetClass = "ACCOUNT";
      break;
    case "I":
      assetClass = "COLLECTIVE_INVESTMENT";
      break;
    case "S":
      assetClass = "INSURANCE";
      break;
    case "B":
      assetClass = "REAL_ESTATE";
      break;
    case "M":
      assetClass = "MOVABLE_ASSET";
      break;
    default:
      assetClass = "SECURITY";
      break;
  }

  const asset: CanonicalAssetRecord = {
    asset_class: assetClass,
    condition_key: "1",
    asset_key: defaultAssetKey(assetClass),
    asset_subkey: defaultAssetSubkey(assetClass, fields),
    country_code: countryCode,
    location_key: locationKey,
    incorporation_date: normalizeDate(
      readString(fields, "incorporation_date") ?? readString(fields, "operation_date")
    ),
    origin_key: "A",
    valuation_1_eur: readNumber(fields, "amount") ?? 0,
    ownership_percentage: 100,
    entity_name: readString(fields, "entity_name"),
    asset_description: readString(fields, "description"),
    currency: readString(fields, "currency"),
    tax_territory_code: readString(fields, "tax_territory_code") ?? "ES-COMUN",
    metadata: {
      source_record_type: recordType,
      inferred_from_event: true
    }
  };

  if (assetClass === "ACCOUNT") {
    asset.account = {
      account_identification_key: "O",
      bic: readString(fields, "bic"),
      account_code: readString(fields, "account_code"),
      entity_tax_id: readString(fields, "entity_tax_id")
    };
  } else if (assetClass === "SECURITY") {
    asset.security = {
      identification_key: readString(fields, "isin") ? "1" : "2",
      security_identifier:
        readString(fields, "security_identifier") ??
        readString(fields, "isin") ??
        readString(fields, "description"),
      entity_tax_id: readString(fields, "entity_tax_id"),
      representation_key: "A",
      units: readNumber(fields, "quantity"),
      listed: true,
      regulated: true
    };
  } else if (assetClass === "COLLECTIVE_INVESTMENT") {
    asset.collective_investment = {
      identification_key: readString(fields, "isin") ? "1" : "2",
      security_identifier:
        readString(fields, "security_identifier") ??
        readString(fields, "isin") ??
        readString(fields, "description"),
      entity_tax_id: readString(fields, "entity_tax_id"),
      representation_key: "A",
      units: readNumber(fields, "quantity"),
      listed: null,
      regulated: readBoolean(fields, "regulated") ?? true
    };
  } else if (assetClass === "INSURANCE") {
    asset.insurance = {
      insurance_kind:
        (readString(fields, "insurance_kind") as CanonicalAssetRecord["insurance"] extends {
          insurance_kind?: infer T;
        }
          ? T
          : never) ?? "LIFE",
      entity_tax_id: readString(fields, "entity_tax_id")
    };
  } else if (assetClass === "REAL_ESTATE") {
    asset.real_estate = {
      real_estate_type_key:
        (readString(fields, "real_estate_type_key") as "U" | "R" | null) ??
        (readString(fields, "clave_tipo_inmueble") as "U" | "R" | null) ??
        "U",
      real_right_description:
        readString(fields, "real_right_description") ??
        readString(fields, "tipo_derecho_real"),
      cadastral_reference:
        readString(fields, "cadastral_reference") ??
        readString(fields, "referencia_catastral")
    };
  } else if (assetClass === "MOVABLE_ASSET") {
    asset.movable = {
      movable_kind: normalizeMovableKind(
        readString(fields, "movable_kind") ??
          readString(fields, "clave_tipo_bien_mueble") ??
          readString(fields, "clave_tipo_inmueble_mueble")
      ),
      registry_reference:
        readString(fields, "registry_reference") ??
        readString(fields, "referencia_registro"),
      valuation_method:
        readString(fields, "valuation_method") ??
        readString(fields, "metodo_valoracion")
    };
  }

  asset.asset_link_key = buildAssetLinkKey(asset);
  return asset;
}

function eventTypeFromRecordType(recordType: ParsedRecord["record_type"]): CanonicalFiscalEvent["event_type"] | null {
  switch (recordType) {
    case "COMPRA":
      return "ACQUISITION";
    case "VENTA":
      return "DISPOSAL";
    case "DIVIDENDO":
      return "DIVIDEND";
    case "INTERES":
      return "INTEREST";
    case "RENTA":
      return "RENT";
    case "RETENCION":
      return "WITHHOLDING";
    default:
      return null;
  }
}

function deriveFiscalEventFromRecord(
  record: ParsedRecord | Record<string, unknown>,
  linkedAsset: CanonicalAssetRecord | null
): CanonicalFiscalEvent | null {
  const recordType = String((record as Record<string, unknown>).record_type ?? "") as ParsedRecord["record_type"];
  const eventType = eventTypeFromRecordType(recordType);
  if (!eventType) {
    return null;
  }

  const fields = isObject((record as Record<string, unknown>).fields)
    ? ((record as Record<string, unknown>).fields as JsonObject)
    : {};
  const assetKey = inferAssetKeyForEvent(recordType, linkedAsset, fields);
  const capitalOperationKey = defaultCapitalOperationKey(eventType, assetKey, fields);
  const catalogEntry = capitalOperationCatalog[capitalOperationKey];
  const derivedAmounts = deriveOperationAmounts(eventType, fields);
  const currency = normalizeUppercaseValue(readString(fields, "currency"));
  const originalCurrency =
    normalizeUppercaseValue(readString(fields, "original_currency")) ??
    (derivedAmounts.gross_amount_original !== null && derivedAmounts.gross_amount_original !== undefined
      ? currency
      : null);

  return {
    asset_link_key: linkedAsset?.asset_link_key ?? null,
    event_type: eventType,
    event_date: normalizeDate(
      readString(fields, "event_date") ??
        readString(fields, "operation_date") ??
        readString(fields, "incorporation_date")
    ),
    capital_operation_key: capitalOperationKey,
    irpf_group: catalogEntry.irpfGroup,
    irpf_subgroup: catalogEntry.irpfSubgroup,
    quantity: readNumber(fields, "quantity"),
    gross_amount_eur: derivedAmounts.gross_amount_eur,
    net_amount_eur: derivedAmounts.net_amount_eur,
    withholding_amount_eur: derivedAmounts.withholding_amount_eur,
    proceeds_amount_eur: derivedAmounts.proceeds_amount_eur,
    cost_basis_amount_eur: derivedAmounts.cost_basis_amount_eur,
    realized_result_eur: derivedAmounts.realized_result_eur,
    currency,
    expense_amount_eur: derivedAmounts.expense_amount_eur,
    original_currency: originalCurrency,
    gross_amount_original: derivedAmounts.gross_amount_original,
    fx_rate: derivedAmounts.fx_rate,
    unit_price_eur: derivedAmounts.unit_price_eur,
    is_closing_operation: readBoolean(fields, "is_closing_operation") ?? readBoolean(fields, "es_operacion_cierre") ?? false,
    is_stock_dividend: readBoolean(fields, "is_stock_dividend") ?? readBoolean(fields, "es_dividendo_en_acciones") ?? false,
    irpf_box_code: readString(fields, "irpf_box_code") ?? readString(fields, "codigo_irpf_casilla"),
    notes: readString(fields, "description")
  };
}

function normalizeCanonicalAssetRecord(value: unknown): CanonicalAssetRecord | null {
  if (!isObject(value)) {
    return null;
  }

  const countryCode = normalizeCountryCode(
    readString(value, "country_code") ?? readString(value, "codigo_pais")
  );
  const assetClass = readString(value, "asset_class") as AssetClass | null;
  if (!assetClass) {
    return null;
  }

  const asset: CanonicalAssetRecord = {
    asset_link_key: normalizeAssetLinkKey(readString(value, "asset_link_key")),
    asset_class: assetClass,
    condition_key: (readString(value, "condition_key") as CanonicalAssetRecord["condition_key"] | null) ?? "1",
    asset_key:
      (readString(value, "asset_key") as CanonicalAssetRecord["asset_key"] | null) ?? defaultAssetKey(assetClass),
    asset_subkey: readString(value, "asset_subkey") ?? defaultAssetSubkey(assetClass, value),
    country_code: countryCode,
    location_key: normalizeLocationKey(readString(value, "location_key"), countryCode),
    incorporation_date: normalizeDate(readString(value, "incorporation_date")),
    origin_key: (readString(value, "origin_key") as CanonicalAssetRecord["origin_key"] | null) ?? "A",
    valuation_1_eur: readNumber(value, "valuation_1_eur") ?? 0,
    valuation_2_eur: readNumber(value, "valuation_2_eur"),
    ownership_percentage: readNumber(value, "ownership_percentage") ?? 100,
    currency: readString(value, "currency"),
    entity_name: readString(value, "entity_name"),
    asset_description: readString(value, "asset_description"),
    tax_territory_code: readString(value, "tax_territory_code") ?? "ES-COMUN",
    ownership_type_description: readString(value, "ownership_type_description"),
    extinction_date: readString(value, "extinction_date"),
    address: isObject(value.address)
      ? {
          street_line: readString(value.address, "street_line"),
          complement: readString(value.address, "complement"),
          city: readString(value.address, "city"),
          region: readString(value.address, "region"),
          postal_code: readString(value.address, "postal_code"),
          country_code: normalizeUppercaseValue(readString(value.address, "country_code"))
        }
      : null,
    account: isObject(value.account)
      ? {
          account_identification_key:
            (readString(value.account, "account_identification_key") as "I" | "O" | null) ?? null,
          bic: readString(value.account, "bic"),
          account_code: readString(value.account, "account_code"),
          entity_tax_id: readString(value.account, "entity_tax_id")
        }
      : null,
    security: isObject(value.security)
      ? {
          identification_key:
            (readString(value.security, "identification_key") as "1" | "2" | null) ?? null,
          security_identifier: readString(value.security, "security_identifier"),
          entity_tax_id: readString(value.security, "entity_tax_id"),
          representation_key:
            (readString(value.security, "representation_key") as "A" | "B" | null) ?? null,
          units: readNumber(value.security, "units"),
          listed: readBoolean(value.security, "listed"),
          regulated: readBoolean(value.security, "regulated")
        }
      : null,
    collective_investment: isObject(value.collective_investment)
      ? {
          identification_key:
            (readString(value.collective_investment, "identification_key") as "1" | "2" | null) ?? null,
          security_identifier: readString(value.collective_investment, "security_identifier"),
          entity_tax_id: readString(value.collective_investment, "entity_tax_id"),
          representation_key:
            (readString(value.collective_investment, "representation_key") as "A" | "B" | null) ?? null,
          units: readNumber(value.collective_investment, "units"),
          listed: readBoolean(value.collective_investment, "listed"),
          regulated: readBoolean(value.collective_investment, "regulated")
        }
      : null,
    insurance: isObject(value.insurance)
      ? {
          insurance_kind:
            (readString(value.insurance, "insurance_kind") as CanonicalAssetRecord["insurance"] extends {
              insurance_kind?: infer T;
            }
              ? T
              : never) ?? null,
          entity_tax_id: readString(value.insurance, "entity_tax_id")
        }
      : null,
    real_estate: isObject(value.real_estate)
      ? {
          real_estate_type_key:
            (readString(value.real_estate, "real_estate_type_key") as "U" | "R" | null) ?? null,
          real_right_description: readString(value.real_estate, "real_right_description"),
          cadastral_reference: readString(value.real_estate, "cadastral_reference")
        }
      : null,
    movable: isObject(value.movable)
      ? {
          movable_kind: normalizeMovableKind(readString(value.movable, "movable_kind")),
          registry_reference: readString(value.movable, "registry_reference"),
          valuation_method: readString(value.movable, "valuation_method")
        }
      : null,
    metadata: isObject(value.metadata) ? value.metadata : {}
  };

  asset.asset_link_key = asset.asset_link_key ?? buildAssetLinkKey(asset);
  return asset;
}

function normalizeCanonicalFiscalEvent(value: unknown): CanonicalFiscalEvent | null {
  if (!isObject(value)) {
    return null;
  }

  const eventType = readString(value, "event_type") as CanonicalFiscalEvent["event_type"] | null;
  if (!eventType) {
    return null;
  }

  const capitalOperationKey =
    (readString(value, "capital_operation_key") as CapitalOperationKey) ?? null;
  const catalogEntry = capitalOperationKey ? capitalOperationCatalog[capitalOperationKey] : null;

  return {
    asset_link_key: normalizeAssetLinkKey(readString(value, "asset_link_key")),
    event_type: eventType,
    event_date: normalizeDate(readString(value, "event_date")),
    asset_id: readString(value, "asset_id"),
    capital_operation_key: capitalOperationKey,
    irpf_group:
      (readString(value, "irpf_group") as CapitalOperationGroup | null) ??
      catalogEntry?.irpfGroup ??
      null,
    irpf_subgroup: readString(value, "irpf_subgroup") ?? catalogEntry?.irpfSubgroup ?? null,
    quantity: readNumber(value, "quantity"),
    gross_amount_eur: readNumber(value, "gross_amount_eur"),
    net_amount_eur: readNumber(value, "net_amount_eur"),
    withholding_amount_eur: readNumber(value, "withholding_amount_eur"),
    proceeds_amount_eur: readNumber(value, "proceeds_amount_eur"),
    cost_basis_amount_eur: readNumber(value, "cost_basis_amount_eur"),
    realized_result_eur: readNumber(value, "realized_result_eur"),
    currency: normalizeUppercaseValue(readString(value, "currency")),
    expense_amount_eur: readNumber(value, "expense_amount_eur"),
    original_currency: normalizeUppercaseValue(readString(value, "original_currency")),
    gross_amount_original: readNumber(value, "gross_amount_original"),
    fx_rate: readNumber(value, "fx_rate"),
    unit_price_eur: readNumber(value, "unit_price_eur"),
    is_closing_operation: readBoolean(value, "is_closing_operation") ?? false,
    is_stock_dividend: readBoolean(value, "is_stock_dividend") ?? false,
    irpf_box_code: readString(value, "irpf_box_code"),
    notes: readString(value, "notes")
  };
}

function eventDedupKey(event: CanonicalFiscalEvent): string {
  return [
    event.event_type,
    event.capital_operation_key ?? "",
    event.event_date,
    event.asset_link_key ?? "",
    event.quantity ?? "",
    event.gross_amount_eur ?? "",
    event.withholding_amount_eur ?? "",
    event.realized_result_eur ?? "",
    event.unit_price_eur ?? ""
  ].join("|");
}

export function deriveCanonicalRegistryFromParsePayload(input: {
  records: Array<ParsedRecord | Record<string, unknown>>;
  assetRecords?: unknown;
  fiscalEvents?: unknown;
}): {
  assetRecords: CanonicalAssetRecord[];
  fiscalEvents: CanonicalFiscalEvent[];
} {
  const assetsByKey = new Map<string, CanonicalAssetRecord>();

  if (Array.isArray(input.assetRecords)) {
    for (const item of input.assetRecords) {
      const asset = normalizeCanonicalAssetRecord(item);
      if (!asset) {
        continue;
      }

      const key = asset.asset_link_key ?? buildAssetLinkKey(asset);
      asset.asset_link_key = key;
      assetsByKey.set(key, asset);
    }
  }

  const derivedEvents: CanonicalFiscalEvent[] = [];
  const derivedEventKeys = new Set<string>();

  for (const record of input.records) {
    const explicitAsset = deriveImplicitAssetFromRecord(record) ?? deriveImplicitAssetFromEventRecord(record);
    if (explicitAsset) {
      const key = explicitAsset.asset_link_key ?? buildAssetLinkKey(explicitAsset);
      explicitAsset.asset_link_key = key;
      if (!assetsByKey.has(key)) {
        assetsByKey.set(key, explicitAsset);
      }
    }

    const event = deriveFiscalEventFromRecord(record, explicitAsset ?? null);
    if (event) {
      const key = eventDedupKey(event);
      if (!derivedEventKeys.has(key)) {
        derivedEventKeys.add(key);
        derivedEvents.push(event);
      }
    }
  }

  const fiscalEvents: CanonicalFiscalEvent[] = [];
  const seenEventKeys = new Set<string>();

  if (Array.isArray(input.fiscalEvents)) {
    for (const item of input.fiscalEvents) {
      const event = normalizeCanonicalFiscalEvent(item);
      if (!event) {
        continue;
      }

      const key = eventDedupKey(event);
      if (seenEventKeys.has(key)) {
        continue;
      }
      seenEventKeys.add(key);
      fiscalEvents.push(event);
    }
  }

  for (const event of derivedEvents) {
    const key = eventDedupKey(event);
    if (seenEventKeys.has(key)) {
      continue;
    }
    seenEventKeys.add(key);
    fiscalEvents.push(event);
  }

  return {
    assetRecords: Array.from(assetsByKey.values()),
    fiscalEvents
  };
}

function isMissingRelation(errorMessage: string | undefined): boolean {
  return Boolean(errorMessage && /does not exist|relation .* does not exist/i.test(errorMessage));
}

async function ensureDeclarationProfile(
  supabase: SupabaseClient,
  expedienteId: string
): Promise<string | null> {
  const existing = await supabase
    .from(dbTables.declarationProfiles)
    .select("id")
    .eq("expediente_id", expedienteId)
    .maybeSingle();

  if (existing.error) {
    if (isMissingRelation(existing.error.message)) {
      return null;
    }
    throw new Error(`No se pudo cargar declaration profile: ${existing.error.message}`);
  }

  if (existing.data?.id) {
    return existing.data.id as string;
  }

  const expedienteResult = await supabase
    .from(dbTables.expedientes)
    .select("id, client_id, fiscal_year, title")
    .eq("id", expedienteId)
    .single();

  if (expedienteResult.error || !expedienteResult.data) {
    throw new Error(
      `No se pudo cargar expediente para declaration profile: ${expedienteResult.error?.message ?? "desconocido"}`
    );
  }

  const expediente = expedienteResult.data as {
    id: string;
    client_id: string | null;
    fiscal_year: number;
    title: string;
  };

  let client: { nif: string | null; display_name: string | null } | null = null;
  if (expediente.client_id) {
    const clientResult = await supabase
      .from(dbTables.clients)
      .select("nif, display_name")
      .eq("id", expediente.client_id)
      .maybeSingle();

    if (clientResult.error && !isMissingRelation(clientResult.error.message)) {
      throw new Error(`No se pudo cargar cliente para declaration profile: ${clientResult.error.message}`);
    }

    client = (clientResult.data as { nif: string | null; display_name: string | null } | null) ?? null;
  }

  const profileId = crypto.randomUUID();
  const insertResult = await supabase.from(dbTables.declarationProfiles).insert({
    id: profileId,
    expediente_id: expediente.id,
    client_id: expediente.client_id,
    fiscal_year: expediente.fiscal_year,
    declarant_nif: client?.nif ?? "00000000T",
    declared_nif: client?.nif ?? "00000000T",
    declared_name: client?.display_name ?? expediente.title,
    residence_country_code: "ES",
    residence_territory_code: "ES-COMUN",
    default_asset_location_key: "ES"
  });

  if (insertResult.error) {
    throw new Error(`No se pudo crear declaration profile: ${insertResult.error.message}`);
  }

  return profileId;
}

export async function replaceDocumentCanonicalRegistry(
  supabase: SupabaseClient,
  input: {
    expedienteId: string;
    documentId: string;
    records: Array<ParsedRecord | Record<string, unknown>>;
    assetRecords?: unknown;
    fiscalEvents?: unknown;
    source: CanonicalSource;
    reviewedBy?: string | null;
    manualNotes?: string | null;
  }
): Promise<{
  canonicalAvailable: boolean;
  assetsSaved: number;
  fiscalEventsSaved: number;
}> {
  const declarationProfileId = await ensureDeclarationProfile(supabase, input.expedienteId);
  if (!declarationProfileId) {
    return {
      canonicalAvailable: false,
      assetsSaved: 0,
      fiscalEventsSaved: 0
    };
  }

  const canonical = deriveCanonicalRegistryFromParsePayload({
    records: input.records,
    assetRecords: input.assetRecords,
    fiscalEvents: input.fiscalEvents
  });

  const existingAssetsResult = await supabase
    .from(dbTables.assetRegistry)
    .select("id")
    .eq("expediente_id", input.expedienteId)
    .contains("metadata", { source_document_id: input.documentId });

  if (existingAssetsResult.error) {
    if (isMissingRelation(existingAssetsResult.error.message)) {
      return {
        canonicalAvailable: false,
        assetsSaved: 0,
        fiscalEventsSaved: 0
      };
    }

    throw new Error(`No se pudo localizar activos previos del documento: ${existingAssetsResult.error.message}`);
  }

  const existingAssetIds = ((existingAssetsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id);

  const deleteEventsResult = await supabase
    .from(dbTables.assetFiscalEvents)
    .delete()
    .eq("document_id", input.documentId);

  if (deleteEventsResult.error && !isMissingRelation(deleteEventsResult.error.message)) {
    throw new Error(`No se pudieron limpiar eventos fiscales previos: ${deleteEventsResult.error.message}`);
  }

  if (existingAssetIds.length > 0) {
    const deleteAssetsResult = await supabase
      .from(dbTables.assetRegistry)
      .delete()
      .in("id", existingAssetIds);

    if (deleteAssetsResult.error) {
      throw new Error(`No se pudieron limpiar activos previos: ${deleteAssetsResult.error.message}`);
    }
  }

  const assetsToInsert = canonical.assetRecords.map((asset) => {
    const assetId = crypto.randomUUID();
    return {
      id: assetId,
      asset,
      row: {
        id: assetId,
        expediente_id: input.expedienteId,
        declaration_profile_id: declarationProfileId,
        client_id: null,
        asset_class: asset.asset_class,
        clave_condicion: asset.condition_key,
        tipo_titularidad: asset.ownership_type_description ?? null,
        clave_tipo_bien: asset.asset_key,
        subclave: asset.asset_subkey,
        codigo_pais: asset.country_code,
        codigo_territorio: asset.tax_territory_code ?? "ES-COMUN",
        clave_situacion: asset.location_key,
        fecha_incorporacion: asset.incorporation_date,
        clave_origen: asset.origin_key,
        fecha_extincion: asset.extinction_date ?? null,
        valoracion_1_eur: asset.valuation_1_eur,
        valoracion_2_eur: asset.valuation_2_eur ?? null,
        porcentaje_participacion: asset.ownership_percentage,
        currency: asset.currency ?? null,
        denominacion_entidad: asset.entity_name ?? null,
        descripcion_activo: asset.asset_description ?? null,
        domicilio_via: asset.address?.street_line ?? null,
        domicilio_complemento: asset.address?.complement ?? null,
        domicilio_poblacion: asset.address?.city ?? null,
        domicilio_region: asset.address?.region ?? null,
        domicilio_codigo_postal: asset.address?.postal_code ?? null,
        domicilio_pais: asset.address?.country_code ?? null,
        created_by: input.reviewedBy ?? null,
        updated_by: input.reviewedBy ?? null,
        metadata: {
          ...(asset.metadata ?? {}),
          source_document_id: input.documentId,
          source_mode: input.source,
          asset_link_key: asset.asset_link_key ?? buildAssetLinkKey(asset),
          manual_notes: input.manualNotes ?? null
        }
      }
    };
  });

  if (assetsToInsert.length > 0) {
    const insertAssetsResult = await supabase
      .from(dbTables.assetRegistry)
      .insert(assetsToInsert.map((item) => item.row));

    if (insertAssetsResult.error) {
      throw new Error(`No se pudieron persistir activos canonicos: ${insertAssetsResult.error.message}`);
    }
  }

  const assetIdsByKey = new Map<string, string>();
  for (const item of assetsToInsert) {
    assetIdsByKey.set(
      (item.asset.asset_link_key ?? buildAssetLinkKey(item.asset)),
      item.id
    );
  }

  const accountRows = assetsToInsert.flatMap((item) => {
    if (!item.asset.account?.account_code) {
      return [];
    }

    return [
      {
        asset_id: item.id,
        clave_identif_cuenta: item.asset.account.account_identification_key ?? "O",
        codigo_bic: item.asset.account.bic ?? null,
        codigo_cuenta: item.asset.account.account_code,
        nif_entidad_pais: item.asset.account.entity_tax_id ?? null
      }
    ];
  });

  const securityRows = assetsToInsert.flatMap((item) => {
    if (!item.asset.security?.security_identifier) {
      return [];
    }

    return [
      {
        asset_id: item.id,
        clave_identificacion: item.asset.security.identification_key ?? "2",
        identificacion_valores: item.asset.security.security_identifier,
        nif_entidad_pais: item.asset.security.entity_tax_id ?? null,
        clave_representacion: item.asset.security.representation_key ?? "A",
        numero_valores: item.asset.security.units ?? 0,
        is_listed: item.asset.security.listed ?? true,
        is_regulated: item.asset.security.regulated ?? true
      }
    ];
  });

  const collectiveInvestmentRows = assetsToInsert.flatMap((item) => {
    if (!item.asset.collective_investment?.security_identifier) {
      return [];
    }

    return [
      {
        asset_id: item.id,
        clave_identificacion: item.asset.collective_investment.identification_key ?? "2",
        identificacion_valores: item.asset.collective_investment.security_identifier,
        nif_entidad_pais: item.asset.collective_investment.entity_tax_id ?? null,
        clave_representacion: item.asset.collective_investment.representation_key ?? "A",
        numero_valores: item.asset.collective_investment.units ?? 0,
        is_regulated: item.asset.collective_investment.regulated ?? true
      }
    ];
  });

  const insuranceRows = assetsToInsert.flatMap((item) => {
    if (!item.asset.insurance?.insurance_kind) {
      return [];
    }

    return [
      {
        asset_id: item.id,
        insurance_kind: item.asset.insurance.insurance_kind,
        nif_entidad_pais: item.asset.insurance.entity_tax_id ?? null
      }
    ];
  });

  const realEstateRows = assetsToInsert.flatMap((item) => {
    if (!item.asset.real_estate?.real_estate_type_key) {
      return [];
    }

    return [
      {
        asset_id: item.id,
        clave_tipo_inmueble: item.asset.real_estate.real_estate_type_key,
        referencia_catastral: item.asset.real_estate.cadastral_reference ?? null
      }
    ];
  });

  const movableRows = assetsToInsert.flatMap((item) => {
    if (!item.asset.movable?.movable_kind) {
      return [];
    }

    return [
      {
        asset_id: item.id,
        clave_tipo_bien_mueble: item.asset.movable.movable_kind,
        referencia_registro: item.asset.movable.registry_reference ?? null,
        metodo_valoracion: item.asset.movable.valuation_method ?? null
      }
    ];
  });

  const subtypeBatches: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [
    { table: dbTables.assetAccounts, rows: accountRows },
    { table: dbTables.assetSecurities, rows: securityRows },
    { table: dbTables.assetCollectiveInvestments, rows: collectiveInvestmentRows },
    { table: dbTables.assetInsurances, rows: insuranceRows },
    { table: dbTables.assetRealEstate, rows: realEstateRows },
    { table: dbTables.assetMovableGoods, rows: movableRows }
  ];

  for (const batch of subtypeBatches) {
    if (batch.rows.length === 0) {
      continue;
    }

    const result = await supabase.from(batch.table).insert(batch.rows);
    if (result.error) {
      throw new Error(`No se pudieron persistir detalles de ${batch.table}: ${result.error.message}`);
    }
  }

  const eventRows = canonical.fiscalEvents.map((event) => ({
    id: crypto.randomUUID(),
    expediente_id: input.expedienteId,
    asset_id: event.asset_link_key ? assetIdsByKey.get(event.asset_link_key) ?? null : null,
    document_id: input.documentId,
    event_type: event.event_type,
    event_date: event.event_date,
    capital_operation_key: event.capital_operation_key ?? null,
    irpf_group: event.irpf_group ?? null,
    irpf_subgroup: event.irpf_subgroup ?? null,
    quantity: event.quantity ?? null,
    gross_amount_eur: event.gross_amount_eur ?? null,
    net_amount_eur: event.net_amount_eur ?? null,
    withholding_amount_eur: event.withholding_amount_eur ?? null,
    proceeds_amount_eur: event.proceeds_amount_eur ?? null,
    cost_basis_amount_eur: event.cost_basis_amount_eur ?? null,
    realized_result_eur: event.realized_result_eur ?? null,
    currency: event.currency ?? null,
    expense_amount_eur: event.expense_amount_eur ?? null,
    original_currency: event.original_currency ?? null,
    gross_amount_original: event.gross_amount_original ?? null,
    fx_rate: event.fx_rate ?? null,
    unit_price_eur: event.unit_price_eur ?? null,
    is_closing_operation: event.is_closing_operation ?? false,
    is_stock_dividend: event.is_stock_dividend ?? false,
    irpf_box_code: event.irpf_box_code ?? null,
    source: input.source,
    origin_trace: {
      asset_link_key: event.asset_link_key ?? null,
      capital_operation_key: event.capital_operation_key ?? null,
      source_document_id: input.documentId,
      reviewed_by: input.reviewedBy ?? null
    },
    notes: event.notes ?? input.manualNotes ?? null
  }));

  if (eventRows.length > 0) {
    const insertEventsResult = await supabase.from(dbTables.assetFiscalEvents).insert(eventRows);
    if (insertEventsResult.error) {
      throw new Error(`No se pudieron persistir eventos fiscales canonicos: ${insertEventsResult.error.message}`);
    }
  }

  return {
    canonicalAvailable: true,
    assetsSaved: assetsToInsert.length,
    fiscalEventsSaved: eventRows.length
  };
}
