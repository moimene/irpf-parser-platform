import { expect, test } from "@playwright/test";
import {
  buildCanonicalReviewDrafts,
  getAssetClassForAssetKey,
  getEventTypeForCapitalOperation
} from "../lib/canonical-registry-manual";
import {
  canonicalAssetInputSchema,
  canonicalFiscalEventInputSchema
} from "../lib/canonical-registry-schemas";

test.describe("canonical registry workspace helpers", () => {
  test("deriva clases y eventos desde claves AEAT", async () => {
    expect(getAssetClassForAssetKey("C")).toBe("ACCOUNT");
    expect(getAssetClassForAssetKey("M")).toBe("MOVABLE_ASSET");
    expect(getEventTypeForCapitalOperation("DIVIDENDO_ACCION")).toBe("DIVIDEND");
    expect(getEventTypeForCapitalOperation("VENTA_FONDO")).toBe("DISPOSAL");
    expect(getEventTypeForCapitalOperation("RETENCION_MANUAL")).toBe("WITHHOLDING");
  });

  test("valida reglas clave de activos y eventos manuales", async () => {
    const invalidAsset = canonicalAssetInputSchema.safeParse({
      asset_key: "V",
      asset_subkey: "1",
      condition_key: "1",
      country_code: "ES",
      tax_territory_code: "ES-COMUN",
      location_key: "EX",
      incorporation_date: "2025-01-10",
      origin_key: "A",
      valuation_1_eur: 15000,
      ownership_percentage: 100,
      security: {
        identification_key: "1",
        security_identifier: "US0378331005",
        representation_key: "A",
        units: 10
      }
    });

    expect(invalidAsset.success).toBe(false);

    const validAsset = canonicalAssetInputSchema.safeParse({
      asset_key: "I",
      asset_subkey: "0",
      condition_key: "1",
      country_code: "IE",
      tax_territory_code: "ES-COMUN",
      location_key: "EX",
      incorporation_date: "2025-01-10",
      origin_key: "A",
      valuation_1_eur: 24000,
      ownership_percentage: 100,
      collective_investment: {
        identification_key: "1",
        security_identifier: "IE00B4L5Y983",
        representation_key: "A",
        units: 42.5,
        regulated: true
      }
    });

    expect(validAsset.success).toBe(true);
    expect(validAsset.success && validAsset.data.asset_class).toBe("COLLECTIVE_INVESTMENT");

    const invalidEvent = canonicalFiscalEventInputSchema.safeParse({
      capital_operation_key: "COMPRA_VALOR",
      event_date: "2025-03-01",
      gross_amount_eur: 1500,
      currency: "EUR"
    });

    expect(invalidEvent.success).toBe(false);

    const validEvent = canonicalFiscalEventInputSchema.safeParse({
      capital_operation_key: "DIVIDENDO_ACCION",
      event_date: "2025-03-01",
      gross_amount_eur: 145.22,
      withholding_amount_eur: 21.78,
      currency: "USD"
    });

    expect(validEvent.success).toBe(true);
  });

  test("convierte extracciones pendientes en borradores editables", async () => {
    const drafts = buildCanonicalReviewDrafts([
      {
        id: "ext-1",
        document_id: "doc-1",
        filename: "modelo720-2016.xls",
        review_status: "pending",
        created_at: "2026-03-07T12:00:00.000Z",
        normalized_payload: {
          records: [
            {
              record_type: "CUENTA",
              fields: {
                entity_name: "Swissquote",
                account_code: "CH5604835012345678009",
                bic: "SWQOCHZZ",
                country_code: "CH",
                location_key: "EX",
                valuation_1_eur: 12500
              },
              confidence: 0.92,
              source_spans: []
            },
            {
              record_type: "DIVIDENDO",
              fields: {
                operation_date: "2025-02-14",
                isin: "US0378331005",
                description: "Apple dividend",
                amount: 145.22,
                retention: 21.78,
                currency: "USD",
                country_code: "US",
                location_key: "EX"
              },
              confidence: 0.91,
              source_spans: []
            }
          ]
        }
      }
    ]);

    expect(drafts.assetDrafts).toHaveLength(2);
    expect(drafts.assetDrafts[0]?.filename).toBe("modelo720-2016.xls");
    expect(drafts.assetDrafts[0]?.asset.asset_key).toBe("C");
    expect(drafts.assetDrafts[1]?.asset.asset_key).toBe("V");
    expect(drafts.fiscalEventDrafts).toHaveLength(1);
    expect(drafts.fiscalEventDrafts[0]?.event.capital_operation_key).toBe("DIVIDENDO_ACCION");
    expect(drafts.fiscalEventDrafts[0]?.label).toContain("DIVIDENDO_ACCION");
  });
});
