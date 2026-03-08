import { expect, test } from "@playwright/test";
import type { CanonicalAssetResponse, CanonicalFiscalEventResponse } from "../lib/asset-registry";
import { buildModel100Runtime, projectRuntimeOperationsFromCanonicalFiscalEvents } from "../lib/model100-runtime";

function buildSecurityAsset(overrides?: Partial<CanonicalAssetResponse>): CanonicalAssetResponse {
  return {
    id: "asset-security-1",
    expediente_id: "expediente-model100-canonical",
    declaration_profile_id: null,
    client_id: null,
    asset_link_key: "SECURITY|V|1|US|US1234567890",
    asset_class: "SECURITY",
    condition_key: "1",
    ownership_type_description: null,
    asset_key: "V",
    asset_subkey: "1",
    country_code: "US",
    tax_territory_code: "ES-COMUN",
    location_key: "EX",
    incorporation_date: "2025-01-10",
    origin_key: "A",
    extinction_date: null,
    valuation_1_eur: 1000,
    valuation_2_eur: null,
    ownership_percentage: 100,
    currency: "EUR",
    entity_name: "Acme Corp",
    asset_description: "Acme Corp",
    address: null,
    account: null,
    security: {
      identification_key: "1",
      security_identifier: "US1234567890",
      entity_tax_id: null,
      representation_key: "A",
      units: 10,
      listed: true,
      regulated: true
    },
    collective_investment: null,
    insurance: null,
    real_estate: null,
    movable: null,
    metadata: {},
    display_name: "Acme Corp",
    supports_714: true,
    supports_720: true,
    is_foreign: true,
    ...overrides
  };
}

function buildFiscalEvent(overrides?: Partial<CanonicalFiscalEventResponse>): CanonicalFiscalEventResponse {
  return {
    id: "event-1",
    expediente_id: "expediente-model100-canonical",
    asset_id: "asset-security-1",
    document_id: null,
    asset_link_key: "SECURITY|V|1|US|US1234567890",
    event_type: "ACQUISITION",
    event_date: "2025-01-10",
    capital_operation_key: "COMPRA_VALOR",
    irpf_group: "GYP",
    irpf_subgroup: "ACCIONES",
    quantity: 10,
    gross_amount_eur: 1000,
    net_amount_eur: 1000,
    withholding_amount_eur: null,
    proceeds_amount_eur: null,
    cost_basis_amount_eur: null,
    realized_result_eur: null,
    currency: "EUR",
    expense_amount_eur: null,
    original_currency: null,
    gross_amount_original: null,
    fx_rate: null,
    unit_price_eur: 100,
    is_closing_operation: false,
    is_stock_dividend: false,
    irpf_box_code: null,
    source: "MANUAL",
    origin_trace: {},
    notes: "Evento canónico",
    ...overrides
  };
}

test.describe("Modelo 100 runtime canónico", () => {
  test("proyecta compras y ventas canónicas y excluye eventos no FIFO", async () => {
    const asset = buildSecurityAsset();
    const projection = projectRuntimeOperationsFromCanonicalFiscalEvents({
      expedienteId: "expediente-model100-canonical",
      assets: [asset],
      fiscalEvents: [
        buildFiscalEvent(),
        buildFiscalEvent({
          id: "event-2",
          event_type: "DISPOSAL",
          event_date: "2025-03-10",
          capital_operation_key: "VENTA_VALOR",
          quantity: 5,
          gross_amount_eur: 650,
          proceeds_amount_eur: 650,
          realized_result_eur: 150,
          unit_price_eur: 130
        }),
        buildFiscalEvent({
          id: "event-3",
          event_type: "DIVIDEND",
          capital_operation_key: "DIVIDENDO_ACCION",
          quantity: null,
          gross_amount_eur: 25,
          unit_price_eur: null
        })
      ]
    });

    expect(projection.operations).toHaveLength(2);
    expect(projection.operations).toEqual([
      expect.objectContaining({
        id: "event-1",
        operation_type: "COMPRA",
        isin: "US1234567890",
        amount: 1000,
        quantity: 10,
        source: "MANUAL"
      }),
      expect.objectContaining({
        id: "event-2",
        operation_type: "VENTA",
        isin: "US1234567890",
        amount: 650,
        quantity: 5,
        realized_gain: 150,
        source: "MANUAL"
      })
    ]);
  });

  test("cierra una venta canónica con coste explícito aunque no existan compras legacy", async () => {
    const runtime = buildModel100Runtime({
      expedienteId: "expediente-model100-canonical",
      canonicalRegistry: {
        available: true,
        assets: [buildSecurityAsset()],
        fiscalEvents: [
          buildFiscalEvent({
            id: "sale-explicit",
            event_type: "DISPOSAL",
            event_date: "2025-03-10",
            capital_operation_key: "VENTA_VALOR",
            quantity: 5,
            gross_amount_eur: 650,
            proceeds_amount_eur: 650,
            cost_basis_amount_eur: 500,
            realized_result_eur: 150,
            unit_price_eur: 130
          })
        ]
      },
      legacyOperations: [],
      adjustments: []
    });

    expect(runtime.source).toBe("irpf_asset_fiscal_events");
    expect(runtime.saleSummaries).toHaveLength(1);
    expect(runtime.saleSummaries[0]).toMatchObject({
      sale_operation_id: "sale-explicit",
      isin: "US1234567890",
      quantity: 5,
      sale_amount: 650,
      sale_amount_allocated: 650,
      quantity_allocated: 5,
      missing_quantity: 0,
      cost_basis: 500,
      realized_gain: 150,
      status: "MATCHED"
    });
    expect(runtime.issues).toEqual([]);
  });

  test("hace fallback a operaciones legacy si el registro canónico no aporta compras o ventas FIFO", async () => {
    const runtime = buildModel100Runtime({
      expedienteId: "expediente-model100-fallback",
      canonicalRegistry: {
        available: true,
        assets: [buildSecurityAsset({ expediente_id: "expediente-model100-fallback" })],
        fiscalEvents: [
          buildFiscalEvent({
            id: "dividend-only",
            expediente_id: "expediente-model100-fallback",
            event_type: "DIVIDEND",
            capital_operation_key: "DIVIDENDO_ACCION",
            quantity: null,
            gross_amount_eur: 25,
            unit_price_eur: null
          })
        ]
      },
      legacyOperations: [
        {
          id: "legacy-buy",
          expediente_id: "expediente-model100-fallback",
          operation_type: "COMPRA",
          operation_date: "2025-01-10",
          isin: "US1234567890",
          description: "Compra legacy",
          quantity: 5,
          amount: 500,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-01-10T09:00:00Z"
        },
        {
          id: "legacy-sell",
          expediente_id: "expediente-model100-fallback",
          operation_type: "VENTA",
          operation_date: "2025-03-10",
          isin: "US1234567890",
          description: "Venta legacy",
          quantity: 5,
          amount: 650,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-03-10T09:00:00Z"
        }
      ],
      adjustments: []
    });

    expect(runtime.source).toBe("irpf_operations");
    expect(runtime.saleSummaries[0]).toMatchObject({
      sale_operation_id: "legacy-sell",
      cost_basis: 500,
      realized_gain: 150,
      status: "MATCHED"
    });
  });
});
