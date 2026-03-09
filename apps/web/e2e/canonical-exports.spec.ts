import { expect, test } from "@playwright/test";
import {
  buildModel100RuntimeFromCanonical,
  buildModel714RecordsFromCanonicalAssets,
  buildModel720RecordsFromCanonicalAssets
} from "../lib/canonical-exports";
import type { CanonicalAssetSummary, CanonicalFiscalEvent } from "../lib/fiscal-canonical";

test.describe("Export runtime canónico", () => {
  test("prioriza ganancia/perdida sobre transmision y mantiene estados manuales", async () => {
    const fiscalEvents: CanonicalFiscalEvent[] = [
      {
        canonical_id: "asset-buy",
        event_id: "op:buy-1",
        expediente_id: "exp-1",
        expediente_reference: "CLI-2025-IRPF",
        fiscal_year: 2025,
        model_type: "IRPF",
        asset_key: "US1234567890",
        asset_label: "Apple Inc.",
        isin: "US1234567890",
        event_kind: "adquisicion",
        operation_type: "COMPRA",
        operation_date: "2025-01-10",
        description: "Compra Apple",
        amount: 1000,
        currency: "EUR",
        quantity: 10,
        retention: null,
        realized_gain: null,
        source: "MANUAL",
        status: "MATCHED",
        notes: null
      },
      {
        canonical_id: "event-sell-op",
        event_id: "op:sell-1",
        expediente_id: "exp-1",
        expediente_reference: "CLI-2025-IRPF",
        fiscal_year: 2025,
        model_type: "IRPF",
        asset_key: "US1234567890",
        asset_label: "Apple Inc.",
        isin: "US1234567890",
        event_kind: "transmision",
        operation_type: "VENTA",
        operation_date: "2025-03-14",
        description: "Venta parser",
        amount: 1500,
        currency: "EUR",
        quantity: 5,
        retention: null,
        realized_gain: 120,
        source: "AUTO",
        status: "UNRESOLVED",
        notes: null
      },
      {
        canonical_id: "event-sell-gp",
        event_id: "gp:sell-1",
        expediente_id: "exp-1",
        expediente_reference: "CLI-2025-IRPF",
        fiscal_year: 2025,
        model_type: "IRPF",
        asset_key: "US1234567890",
        asset_label: "Apple Inc.",
        isin: "US1234567890",
        event_kind: "ganancia_perdida",
        operation_type: "VENTA",
        operation_date: "2025-03-14",
        description: "Venta ajustada por fiscalista",
        amount: 1500,
        currency: "EUR",
        quantity: 5,
        retention: null,
        realized_gain: -80,
        source: "MANUAL",
        status: "MATCHED",
        notes: "override manual"
      }
    ];

    const runtime = buildModel100RuntimeFromCanonical({ fiscalEvents });

    expect(runtime.trades).toEqual([
      expect.objectContaining({
        id: "op:buy-1",
        type: "BUY",
        isin: "US1234567890",
        quantity: 10
      }),
      expect.objectContaining({
        id: "gp:sell-1",
        type: "SELL",
        isin: "US1234567890",
        quantity: 5,
        gainLossEur: -80
      })
    ]);

    expect(runtime.saleRecords).toEqual([
      expect.objectContaining({
        source_operation_id: "sell-1",
        source_event_id: "gp:sell-1",
        description: "Venta ajustada por fiscalista",
        amount: 1500,
        quantity: 5,
        realized_gain: -80,
        status: "MATCHED"
      })
    ]);

    expect(runtime.unresolvedSales).toBe(0);
    expect(runtime.pendingCostBasisSales).toBe(0);
    expect(runtime.invalidSales).toBe(0);
  });

  test("deriva registros 714 y 720 desde activos canónicos", async () => {
    const assets: CanonicalAssetSummary[] = [
      {
        canonical_id: "asset-es",
        asset_key: "ES0000000001",
        isin: "ES0000000001",
        label: "Valor nacional",
        notes: null,
        currencies: ["EUR"],
        expedientes: ["CLI-2025-IP"],
        fiscal_years: [2025],
        events_total: 2,
        dividends: 0,
        interests: 0,
        acquisitions: 1,
        transmissions: 0,
        retentions: 0,
        gains_losses: 0,
        open_lots: 1,
        closed_lots: 0,
        quantity_open: 10,
        open_cost_basis: 1300,
        gross_amount_total: 1300,
        realized_gain_total: null,
        pending_transmissions: 0,
        latest_event_date: "2025-12-31",
        last_source: "MANUAL",
        asset_type: "security",
        holder_role: "titular",
        ownership_pct: 100,
        country: "ES",
        year_end_value: 1300,
        q4_avg_balance: null,
        valuation_method: "market_value",
        foreign_block: null
      },
      {
        canonical_id: "asset-us",
        asset_key: "US1234567890",
        isin: "US1234567890",
        label: "Valor extranjero",
        notes: "con 720",
        currencies: ["USD"],
        expedientes: ["CLI-2025-720"],
        fiscal_years: [2025],
        events_total: 3,
        dividends: 1,
        interests: 0,
        acquisitions: 1,
        transmissions: 0,
        retentions: 0,
        gains_losses: 0,
        open_lots: 1,
        closed_lots: 0,
        quantity_open: 7,
        open_cost_basis: 2100,
        gross_amount_total: 2100,
        realized_gain_total: null,
        pending_transmissions: 0,
        latest_event_date: "2025-12-31",
        last_source: "AUTO",
        asset_type: "security",
        holder_role: "titular",
        ownership_pct: 100,
        country: "US",
        year_end_value: 2100,
        q4_avg_balance: null,
        valuation_method: "market_value",
        foreign_block: "securities"
      }
    ];

    const model714Records = buildModel714RecordsFromCanonicalAssets({ assets });
    const model720Records = buildModel720RecordsFromCanonicalAssets({ assets });

    expect(model714Records).toHaveLength(2);
    expect(model714Records[0]).toMatchObject({
      isin: "ES0000000001",
      description: "Valor nacional · security · titular",
      amount: 1300,
      quantity: 10,
      operation_type: "POSICION"
    });

    expect(model720Records).toEqual([
      expect.objectContaining({
        isin: "US1234567890",
        description: "Valor extranjero · securities · US",
        amount: 2100,
        quantity: 7,
        operation_type: "POSICION"
      })
    ]);
  });
});
