import { z } from "zod";
import type { CanonicalAssetRecord, CanonicalFiscalEvent, DeclarationProfile } from "@/lib/asset-registry";

const assetKeyValues = ["C", "V", "I", "S", "B", "M"] as const;
const conditionValues = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const originValues = ["A", "M", "C"] as const;
const locationValues = ["ES", "EX"] as const;
const identificationValues = ["1", "2"] as const;
const representationValues = ["A", "B"] as const;
const realEstateTypeValues = ["U", "R"] as const;
const insuranceKindValues = ["LIFE", "DISABILITY", "TEMPORARY_ANNUITY", "LIFETIME_ANNUITY"] as const;
const movableKindValues = [
  "GENERAL",
  "ART",
  "JEWELRY",
  "VEHICLE",
  "BOAT",
  "AIRCRAFT",
  "COLLECTION",
  "ADMINISTRATIVE_CONCESSION",
  "CONTRACT_OPTION",
  "INTELLECTUAL_PROPERTY",
  "REGISTERED_MOVABLE",
  "LOCATED_MOVABLE",
  "OTHER"
] as const;
const capitalOperationValues = [
  "DIVIDENDO_ACCION",
  "DIVIDENDO_FONDO",
  "INTERES_CUENTA",
  "INTERES_BONO",
  "CUPON_BONO",
  "REND_SEGURO_VIDA",
  "RENTA_VITALICIA",
  "COMPRA_VALOR",
  "VENTA_VALOR",
  "COMPRA_FONDO",
  "VENTA_FONDO",
  "ALQUILER_INMUEBLE",
  "COMPRA_INMUEBLE",
  "VENTA_INMUEBLE",
  "COMPRA_BIEN_MUEBLE",
  "VENTA_BIEN_MUEBLE",
  "RETENCION_MANUAL",
  "OTRO_MOVIMIENTO"
] as const;

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
);

const optionalUppercaseCode = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim().toUpperCase();
    return trimmed === "" ? undefined : trimmed;
  },
  z.string().optional()
);

const optionalDate = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
);

const optionalPositiveNumber = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  z.coerce.number().positive().optional()
);

const optionalNonnegativeNumber = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  z.coerce.number().nonnegative().optional()
);

const optionalSignedNumber = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  z.coerce.number().optional()
);

function assetClassFromKey(
  assetKey: typeof assetKeyValues[number]
): CanonicalAssetRecord["asset_class"] {
  switch (assetKey) {
    case "C":
      return "ACCOUNT";
    case "V":
      return "SECURITY";
    case "I":
      return "COLLECTIVE_INVESTMENT";
    case "S":
      return "INSURANCE";
    case "B":
      return "REAL_ESTATE";
    case "M":
      return "MOVABLE_ASSET";
  }
}

export const declarationProfileInputSchema = z.object({
  declarant_nif: z.string().min(3),
  declared_nif: z.string().min(3),
  legal_representative_nif: optionalString.nullable().optional(),
  declared_name: z.string().min(2),
  contact_name: optionalString.nullable().optional(),
  contact_phone: optionalString.nullable().optional(),
  residence_country_code: z.string().length(2),
  residence_territory_code: z.string().min(2),
  default_asset_location_key: z.enum(locationValues)
});

const assetAddressSchema = z
  .object({
    street_line: optionalString.nullable().optional(),
    complement: optionalString.nullable().optional(),
    city: optionalString.nullable().optional(),
    region: optionalString.nullable().optional(),
    postal_code: optionalString.nullable().optional(),
    country_code: optionalUppercaseCode.nullable().optional()
  })
  .optional()
  .nullable();

export const canonicalAssetInputSchema = z
  .object({
    asset_key: z.enum(assetKeyValues),
    asset_subkey: z.string().min(1),
    condition_key: z.enum(conditionValues),
    ownership_type_description: optionalString.nullable().optional(),
    country_code: z.string().length(2),
    tax_territory_code: z.string().min(2),
    location_key: z.enum(locationValues),
    incorporation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    origin_key: z.enum(originValues),
    extinction_date: optionalDate.nullable().optional(),
    valuation_1_eur: z.coerce.number().nonnegative(),
    valuation_2_eur: optionalNonnegativeNumber.nullable().optional(),
    ownership_percentage: z.coerce.number().min(0).max(100),
    currency: optionalUppercaseCode.nullable().optional(),
    entity_name: optionalString.nullable().optional(),
    asset_description: optionalString.nullable().optional(),
    address: assetAddressSchema,
    account: z
      .object({
        account_identification_key: z.enum(["I", "O"]).optional().nullable(),
        bic: optionalUppercaseCode.nullable().optional(),
        account_code: optionalString.nullable().optional(),
        entity_tax_id: optionalString.nullable().optional()
      })
      .optional()
      .nullable(),
    security: z
      .object({
        identification_key: z.enum(identificationValues).optional().nullable(),
        security_identifier: optionalUppercaseCode.nullable().optional(),
        entity_tax_id: optionalString.nullable().optional(),
        representation_key: z.enum(representationValues).optional().nullable(),
        units: optionalPositiveNumber.nullable().optional(),
        listed: z.boolean().optional().nullable(),
        regulated: z.boolean().optional().nullable()
      })
      .optional()
      .nullable(),
    collective_investment: z
      .object({
        identification_key: z.enum(identificationValues).optional().nullable(),
        security_identifier: optionalUppercaseCode.nullable().optional(),
        entity_tax_id: optionalString.nullable().optional(),
        representation_key: z.enum(representationValues).optional().nullable(),
        units: optionalPositiveNumber.nullable().optional(),
        listed: z.boolean().optional().nullable(),
        regulated: z.boolean().optional().nullable()
      })
      .optional()
      .nullable(),
    insurance: z
      .object({
        insurance_kind: z.enum(insuranceKindValues).optional().nullable(),
        entity_tax_id: optionalString.nullable().optional()
      })
      .optional()
      .nullable(),
    real_estate: z
      .object({
        real_estate_type_key: z.enum(realEstateTypeValues).optional().nullable(),
        real_right_description: optionalString.nullable().optional(),
        cadastral_reference: optionalString.nullable().optional()
      })
      .optional()
      .nullable(),
    movable: z
      .object({
        movable_kind: z.enum(movableKindValues).optional().nullable(),
        registry_reference: optionalString.nullable().optional(),
        valuation_method: optionalString.nullable().optional()
      })
      .optional()
      .nullable(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((payload, ctx) => {
    if (payload.condition_key === "8" && !payload.ownership_type_description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ownership_type_description"],
        message: "La condición 8 requiere tipo de titularidad real."
      });
    }

    if (payload.location_key === "ES" && payload.country_code.toUpperCase() !== "ES") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["country_code"],
        message: "Los activos situados en España deben informar país ES."
      });
    }

    if (payload.location_key === "EX" && payload.country_code.toUpperCase() === "ES") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["country_code"],
        message: "Los activos situados en el extranjero no pueden informar país ES."
      });
    }

    if (payload.origin_key === "C" && !payload.extinction_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extinction_date"],
        message: "La extinción del bien requiere fecha de extinción."
      });
    }

    if (payload.origin_key !== "C" && payload.extinction_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extinction_date"],
        message: "Solo debes informar fecha de extinción cuando el origen sea C."
      });
    }

    if (payload.asset_key === "I" && payload.asset_subkey !== "0") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["asset_subkey"],
        message: "Las IIC deben informar subclave 0."
      });
    }

    if (payload.asset_key === "C" && !payload.account?.account_code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["account", "account_code"],
        message: "La cuenta requiere IBAN o código de cuenta."
      });
    }

    if (payload.asset_key === "V" && !payload.security?.security_identifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["security", "security_identifier"],
        message: "El valor requiere ISIN o identificador."
      });
    }

    if (payload.asset_key === "I" && !payload.collective_investment?.security_identifier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collective_investment", "security_identifier"],
        message: "La IIC requiere ISIN o identificador."
      });
    }

    if (payload.asset_key === "S" && !payload.insurance?.insurance_kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insurance", "insurance_kind"],
        message: "El seguro o renta requiere tipología."
      });
    }

    if (payload.asset_key === "B" && !payload.real_estate?.real_estate_type_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["real_estate", "real_estate_type_key"],
        message: "El inmueble requiere clave U/R."
      });
    }

    if (payload.asset_key === "M" && !payload.movable?.movable_kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["movable", "movable_kind"],
        message: "El bien mueble requiere tipología específica."
      });
    }
  })
  .transform((payload) => ({
    ...payload,
    asset_class: assetClassFromKey(payload.asset_key)
  }));

export const canonicalFiscalEventInputSchema = z
  .object({
    asset_id: z.string().uuid().optional().nullable(),
    document_id: z.string().uuid().optional().nullable(),
    capital_operation_key: z.enum(capitalOperationValues),
    event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantity: optionalPositiveNumber.nullable().optional(),
    gross_amount_eur: optionalNonnegativeNumber.nullable().optional(),
    net_amount_eur: optionalNonnegativeNumber.nullable().optional(),
    withholding_amount_eur: optionalNonnegativeNumber.nullable().optional(),
    proceeds_amount_eur: optionalNonnegativeNumber.nullable().optional(),
    cost_basis_amount_eur: optionalNonnegativeNumber.nullable().optional(),
    realized_result_eur: optionalSignedNumber.nullable().optional(),
    currency: optionalUppercaseCode.nullable().optional(),
    expense_amount_eur: optionalNonnegativeNumber.nullable().optional(),
    original_currency: optionalUppercaseCode.nullable().optional(),
    gross_amount_original: optionalNonnegativeNumber.nullable().optional(),
    fx_rate: optionalPositiveNumber.nullable().optional(),
    unit_price_eur: optionalPositiveNumber.nullable().optional(),
    is_closing_operation: z.boolean().optional().nullable(),
    is_stock_dividend: z.boolean().optional().nullable(),
    irpf_box_code: optionalString.nullable().optional(),
    notes: optionalString.nullable().optional()
  })
  .superRefine((payload, ctx) => {
    const needsQuantityAndPrice = payload.capital_operation_key.startsWith("COMPRA_") || payload.capital_operation_key.startsWith("VENTA_");
    if (needsQuantityAndPrice && (!payload.quantity || !payload.unit_price_eur)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "La operación requiere quantity y unit_price_eur positivos."
      });
    }

    const requiresPositiveGross = [
      "DIVIDENDO_ACCION",
      "DIVIDENDO_FONDO",
      "INTERES_CUENTA",
      "INTERES_BONO",
      "CUPON_BONO",
      "REND_SEGURO_VIDA",
      "RENTA_VITALICIA",
      "ALQUILER_INMUEBLE"
    ].includes(payload.capital_operation_key);

    if (requiresPositiveGross && (!payload.gross_amount_eur || payload.gross_amount_eur <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gross_amount_eur"],
        message: "La operación requiere importe bruto positivo."
      });
    }

    const hasOriginalBlock =
      payload.original_currency !== undefined ||
      payload.gross_amount_original !== undefined ||
      payload.fx_rate !== undefined;
    if (
      hasOriginalBlock &&
      (!payload.original_currency || payload.gross_amount_original === undefined || payload.fx_rate === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["original_currency"],
        message: "La divisa original exige también importe original y tipo de cambio."
      });
    }
  });

export type DeclarationProfileInput = z.infer<typeof declarationProfileInputSchema> & DeclarationProfile;
export type CanonicalAssetInput = z.infer<typeof canonicalAssetInputSchema> & CanonicalAssetRecord;
export type CanonicalFiscalEventInput = z.infer<typeof canonicalFiscalEventInputSchema> & CanonicalFiscalEvent;

