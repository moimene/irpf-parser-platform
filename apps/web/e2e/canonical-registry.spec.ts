import { expect, test } from "@playwright/test";
import { deriveCanonicalRegistryFromParsePayload } from "../lib/canonical-registry";

test.describe("canonical registry helpers", () => {
  test("deriva activos y eventos fiscales desde records transaccionales y patrimoniales", async () => {
    const derived = deriveCanonicalRegistryFromParsePayload({
      records: [
        {
          record_type: "CUENTA",
          fields: {
            entity_name: "JPMorgan",
            account_code: "CH9300762011623852957",
            bic: "CHASCHGX",
            country_code: "CH",
            location_key: "EX",
            valuation_1_eur: 15000,
            valuation_2_eur: 12000
          },
          confidence: 0.94,
          source_spans: []
        },
        {
          record_type: "DIVIDENDO",
          fields: {
            operation_date: "2025-01-15",
            isin: "US0378331005",
            description: "Apple dividend",
            amount: 123.45,
            retention: 18.52,
            currency: "USD",
            country_code: "US",
            location_key: "EX"
          },
          confidence: 0.93,
          source_spans: []
        },
        {
          record_type: "COMPRA",
          fields: {
            operation_date: "2025-02-10",
            asset_key: "I",
            isin: "IE00B4L5Y983",
            description: "Vanguard Global Stock",
            amount: 2000,
            quantity: 20,
            currency: "EUR",
            country_code: "IE",
            location_key: "EX"
          },
          confidence: 0.91,
          source_spans: []
        },
        {
          record_type: "BIEN_MUEBLE",
          fields: {
            description: "Concesion administrativa portuaria",
            movable_kind: "C",
            valuation_1_eur: 45000,
            country_code: "ES",
            location_key: "ES"
          },
          confidence: 0.88,
          source_spans: []
        }
      ]
    });

    expect(derived.assetRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asset_class: "ACCOUNT",
          asset_key: "C",
          country_code: "CH",
          location_key: "EX"
        }),
        expect.objectContaining({
          asset_class: "SECURITY",
          asset_key: "V",
          country_code: "US",
          location_key: "EX",
          security: expect.objectContaining({
            security_identifier: "US0378331005"
          })
        }),
        expect.objectContaining({
          asset_class: "COLLECTIVE_INVESTMENT",
          asset_key: "I",
          country_code: "IE",
          collective_investment: expect.objectContaining({
            security_identifier: "IE00B4L5Y983"
          })
        }),
        expect.objectContaining({
          asset_class: "MOVABLE_ASSET",
          asset_key: "M",
          movable: expect.objectContaining({
            movable_kind: "ADMINISTRATIVE_CONCESSION"
          })
        })
      ])
    );

    expect(derived.fiscalEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "DIVIDEND",
          capital_operation_key: "DIVIDENDO_ACCION",
          irpf_group: "RCM",
          irpf_subgroup: "DIVIDENDOS",
          event_date: "2025-01-15",
          gross_amount_eur: 123.45,
          withholding_amount_eur: 18.52
        }),
        expect.objectContaining({
          event_type: "ACQUISITION",
          capital_operation_key: "COMPRA_FONDO",
          irpf_group: "GYP",
          irpf_subgroup: "FONDOS",
          quantity: 20,
          unit_price_eur: 100
        })
      ])
    );

    expect(derived.fiscalEvents[0]?.asset_link_key).toBeTruthy();
  });
});
