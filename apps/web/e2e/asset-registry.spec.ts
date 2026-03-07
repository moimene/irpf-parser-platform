import { expect, test } from "@playwright/test";
import {
  serializeCanonicalAssetRecord,
  serializeCanonicalFiscalEvent,
  serializeDeclarationProfile
} from "../lib/asset-registry";

test.describe("asset registry serializers", () => {
  test("normaliza perfil declarativo y valores por defecto", async () => {
    const profile = serializeDeclarationProfile({
      id: "profile-1",
      expediente_id: "exp-1",
      declarant_nif: "12345678z",
      declared_nif: "12345678z",
      declared_name: "  Moises Menendez  ",
      residence_country_code: null,
      residence_territory_code: null,
      default_asset_location_key: null
    });

    expect(profile.declarant_nif).toBe("12345678Z");
    expect(profile.declared_name).toBe("Moises Menendez");
    expect(profile.residence_country_code).toBe("ES");
    expect(profile.residence_territory_code).toBe("ES-COMUN");
    expect(profile.default_asset_location_key).toBe("ES");
  });

  test("serializa activos con flags de 714 y 720", async () => {
    const asset = serializeCanonicalAssetRecord({
      id: "asset-1",
      asset_class: "SECURITY",
      condition_key: "1",
      asset_key: "V",
      asset_subkey: "1",
      country_code: "us",
      tax_territory_code: "ES-COMUN",
      location_key: "EX",
      incorporation_date: "2025-01-10",
      origin_key: "A",
      valuation_1_eur: 12000.5,
      ownership_percentage: 100,
      entity_name: "Apple Inc.",
      security: {
        identification_key: "1",
        security_identifier: "us0378331005",
        representation_key: "A",
        units: 10
      }
    });

    expect(asset.country_code).toBe("US");
    expect(asset.display_name).toBe("Apple Inc.");
    expect(asset.supports_714).toBe(true);
    expect(asset.supports_720).toBe(true);
    expect(asset.is_foreign).toBe(true);
    expect(asset.security?.security_identifier).toBe("US0378331005");
    expect(asset.security?.units).toBe(10);
  });

  test("serializa eventos fiscales en importes numéricos", async () => {
    const event = serializeCanonicalFiscalEvent({
      id: "event-1",
      expediente_id: "exp-1",
      asset_id: "asset-1",
      document_id: "doc-1",
      event_type: "DIVIDEND",
      event_date: "2025-02-01",
      gross_amount_eur: 150.45,
      withholding_amount_eur: 22.57,
      currency: "usd",
      notes: "  dividendo trimestral  "
    });

    expect(event.asset_id).toBe("asset-1");
    expect(event.gross_amount_eur).toBe(150.45);
    expect(event.withholding_amount_eur).toBe(22.57);
    expect(event.currency).toBe("USD");
    expect(event.notes).toBe("dividendo trimestral");
  });
});
