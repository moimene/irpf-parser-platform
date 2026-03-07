import { expect, test } from "@playwright/test";
import { detectBlockedLossesFromFiscalRuntime, deriveFiscalRuntimeFromOperations } from "../lib/lots";
import { validateModel100 } from "../lib/rules/validation";

test.describe("Runtime de lotes IRPF", () => {
  test("deriva lotes FIFO abiertos y cerrados desde compras y ventas", async () => {
    const result = deriveFiscalRuntimeFromOperations({
      expedienteId: "expediente-fifo-demo",
      operations: [
        {
          id: "buy-1",
          expediente_id: "expediente-fifo-demo",
          operation_type: "COMPRA",
          operation_date: "2025-01-10",
          isin: "ES0000000001",
          description: "Compra inicial",
          quantity: 10,
          amount: 1000,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-01-10T09:00:00Z"
        },
        {
          id: "buy-2",
          expediente_id: "expediente-fifo-demo",
          operation_type: "COMPRA",
          operation_date: "2025-02-15",
          isin: "ES0000000001",
          description: "Segunda compra",
          quantity: 5,
          amount: 650,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-02-15T09:00:00Z"
        },
        {
          id: "sell-1",
          expediente_id: "expediente-fifo-demo",
          operation_type: "VENTA",
          operation_date: "2025-03-01",
          isin: "ES0000000001",
          description: "Venta parcial",
          quantity: 12,
          amount: 1800,
          currency: "EUR",
          realized_gain: 150,
          source: "MANUAL",
          manual_notes: "Aprobada en review",
          created_at: "2025-03-01T09:00:00Z"
        }
      ]
    });

    expect(result.issues).toEqual([]);
    expect(result.lots).toHaveLength(2);
    expect(result.allocations).toHaveLength(2);
    expect(result.saleSummaries).toHaveLength(1);

    expect(result.lots[0]).toMatchObject({
      acquisition_operation_id: "buy-1",
      isin: "ES0000000001",
      quantity_original: 10,
      quantity_open: 0,
      quantity_sold: 10,
      unit_cost: 100,
      total_cost: 1000,
      status: "CLOSED"
    });

    expect(result.lots[1]).toMatchObject({
      acquisition_operation_id: "buy-2",
      isin: "ES0000000001",
      quantity_original: 5,
      quantity_open: 3,
      quantity_sold: 2,
      unit_cost: 130,
      total_cost: 650,
      status: "OPEN"
    });

    expect(result.allocations[0]).toMatchObject({
      sale_operation_id: "sell-1",
      acquisition_operation_id: "buy-1",
      quantity: 10,
      sale_amount_allocated: 1500,
      total_cost: 1000,
      realized_gain: 500
    });

    expect(result.allocations[1]).toMatchObject({
      sale_operation_id: "sell-1",
      acquisition_operation_id: "buy-2",
      quantity: 2,
      sale_amount_allocated: 300,
      total_cost: 260,
      realized_gain: 40
    });

    expect(result.saleSummaries[0]).toMatchObject({
      sale_operation_id: "sell-1",
      quantity: 12,
      sale_amount: 1800,
      sale_amount_allocated: 1800,
      quantity_allocated: 12,
      missing_quantity: 0,
      cost_basis: 1260,
      realized_gain: 540,
      reported_realized_gain: 150,
      allocations_count: 2,
      status: "MATCHED"
    });
  });

  test("marca una venta como no resuelta si supera el stock FIFO disponible", async () => {
    const result = deriveFiscalRuntimeFromOperations({
      expedienteId: "expediente-fifo-unresolved",
      operations: [
        {
          id: "buy-1",
          expediente_id: "expediente-fifo-unresolved",
          operation_type: "COMPRA",
          operation_date: "2024-01-10",
          isin: "ES0000000001",
          description: "Compra inicial",
          amount: 1000,
          currency: "EUR",
          quantity: 10,
          realized_gain: null,
          source: "AUTO",
          created_at: "2024-01-10T10:00:00.000Z",
          manual_notes: null
        },
        {
          id: "sell-1",
          expediente_id: "expediente-fifo-unresolved",
          operation_type: "VENTA",
          operation_date: "2024-03-01",
          isin: "ES0000000001",
          description: "Venta excesiva",
          amount: 1800,
          currency: "EUR",
          quantity: 12,
          realized_gain: 300,
          source: "AUTO",
          created_at: "2024-03-01T10:00:00.000Z",
          manual_notes: null
        }
      ]
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "sell_without_available_lots",
        operation_id: "sell-1",
        isin: "ES0000000001",
        quantity: 2
      })
    ]);

    expect(result.saleSummaries[0]).toMatchObject({
      sale_operation_id: "sell-1",
      quantity: 12,
      quantity_allocated: 10,
      missing_quantity: 2,
      cost_basis: 1000,
      realized_gain: null,
      status: "UNRESOLVED"
    });
  });

  test("detecta pérdidas bloqueadas por recompra y las mantiene como warning trazable", async () => {
    const operations = [
      {
        id: "buy-1",
        expediente_id: "expediente-blocked-loss",
        operation_type: "COMPRA",
        operation_date: "2024-11-10",
        isin: "US0000000001",
        description: "Compra inicial",
        amount: 1000,
        currency: "EUR",
        quantity: 10,
        realized_gain: null,
        source: "AUTO" as const,
        manual_notes: null,
        created_at: "2024-11-10T09:00:00Z"
      },
      {
        id: "sell-1",
        expediente_id: "expediente-blocked-loss",
        operation_type: "VENTA",
        operation_date: "2025-02-10",
        isin: "US0000000001",
        description: "Venta con pérdida",
        amount: 800,
        currency: "EUR",
        quantity: 10,
        realized_gain: null,
        source: "MANUAL" as const,
        manual_notes: "Venta revisada",
        created_at: "2025-02-10T09:00:00Z"
      },
      {
        id: "buy-2",
        expediente_id: "expediente-blocked-loss",
        operation_type: "COMPRA",
        operation_date: "2025-03-01",
        isin: "US0000000001",
        description: "Recompra dentro de ventana",
        amount: 220,
        currency: "EUR",
        quantity: 2,
        realized_gain: null,
        source: "AUTO" as const,
        manual_notes: null,
        created_at: "2025-03-01T09:00:00Z"
      }
    ];

    const result = deriveFiscalRuntimeFromOperations({
      expedienteId: "expediente-blocked-loss",
      operations
    });

    const blockedLosses = detectBlockedLossesFromFiscalRuntime({
      operations,
      saleSummaries: result.saleSummaries
    });

    expect(result.saleSummaries[0]).toMatchObject({
      sale_operation_id: "sell-1",
      cost_basis: 1000,
      realized_gain: -200,
      status: "MATCHED"
    });

    expect(blockedLosses).toEqual([
      expect.objectContaining({
        sale_operation_id: "sell-1",
        blocked_by_buy_operation_id: "buy-2",
        isin: "US0000000001",
        sale_date: "2025-02-10",
        blocked_by_buy_date: "2025-03-01",
        window_months: 2,
        realized_loss: 200,
        sale_source: "MANUAL",
        blocked_by_buy_source: "AUTO"
      })
    ]);

    expect(result.blockedLosses).toEqual(blockedLosses);

    expect(
      validateModel100({
        trades: [
          {
            id: "buy-1",
            isin: "US0000000001",
            type: "BUY",
            tradeDate: "2024-11-10",
            quantity: 10,
            assetKind: "LISTED"
          },
          {
            id: "sell-1",
            isin: "US0000000001",
            type: "SELL",
            tradeDate: "2025-02-10",
            quantity: 10,
            gainLossEur: -200,
            assetKind: "LISTED"
          },
          {
            id: "buy-2",
            isin: "US0000000001",
            type: "BUY",
            tradeDate: "2025-03-01",
            quantity: 2,
            assetKind: "LISTED"
          }
        ],
        unresolvedSales: 0,
        pendingCostBasisSales: 0,
        invalidSales: 0
      })
    ).toMatchObject({
      validationState: "warnings",
      messages: [
        "1 perdida(s) bloqueada(s) por recompra detectada(s) en reglas 2/12 meses."
      ]
    });
  });

  test("aplica ajustes manuales de coste sobre una compra existente", async () => {
    const result = deriveFiscalRuntimeFromOperations({
      expedienteId: "expediente-cost-adjustment",
      operations: [
        {
          id: "buy-1",
          expediente_id: "expediente-cost-adjustment",
          operation_type: "COMPRA",
          operation_date: "2025-01-15",
          isin: "ES0000000002",
          description: "Compra a corregir",
          quantity: 10,
          amount: 1000,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-01-15T10:00:00Z"
        },
        {
          id: "sell-1",
          expediente_id: "expediente-cost-adjustment",
          operation_type: "VENTA",
          operation_date: "2025-03-20",
          isin: "ES0000000002",
          description: "Venta posterior",
          quantity: 10,
          amount: 1500,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-03-20T10:00:00Z"
        }
      ],
      adjustments: [
        {
          id: "adj-cost-1",
          expediente_id: "expediente-cost-adjustment",
          adjustment_type: "COST_BASIS",
          status: "ACTIVE",
          target_operation_id: "buy-1",
          operation_date: "2025-01-15",
          isin: "ES0000000002",
          description: "Compra corregida",
          quantity: 10,
          total_amount: 1200,
          currency: "EUR",
          notes: "Coste corregido por fiscalista",
          metadata: {
            target_snapshot: {
              operation_id: "buy-1",
              operation_type: "COMPRA",
              operation_date: "2025-01-15",
              isin: "ES0000000002",
              description: "Compra a corregir",
              quantity: 10,
              amount: 1000,
              currency: "EUR"
            }
          },
          created_by: "admin",
          updated_by: "admin",
          created_at: "2025-03-21T10:00:00Z",
          updated_at: "2025-03-21T10:00:00Z"
        }
      ]
    });

    expect(result.issues).toEqual([]);
    expect(result.lots[0]).toMatchObject({
      acquisition_operation_id: "buy-1",
      total_cost: 1200,
      unit_cost: 120
    });
    expect(result.saleSummaries[0]).toMatchObject({
      sale_operation_id: "sell-1",
      cost_basis: 1200,
      realized_gain: 300,
      status: "MATCHED"
    });
  });

  test("deriva herencias y transferencias de salida sin romper el runtime FIFO", async () => {
    const result = deriveFiscalRuntimeFromOperations({
      expedienteId: "expediente-manual-acquisitions",
      operations: [
        {
          id: "buy-1",
          expediente_id: "expediente-manual-acquisitions",
          operation_type: "COMPRA",
          operation_date: "2025-01-10",
          isin: "ES0000000003",
          description: "Compra inicial",
          quantity: 10,
          amount: 1000,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-01-10T10:00:00Z"
        },
        {
          id: "sell-1",
          expediente_id: "expediente-manual-acquisitions",
          operation_type: "VENTA",
          operation_date: "2025-05-01",
          isin: "ES0000000003",
          description: "Venta final",
          quantity: 4,
          amount: 520,
          currency: "EUR",
          realized_gain: null,
          source: "AUTO",
          manual_notes: null,
          created_at: "2025-05-01T10:00:00Z"
        }
      ],
      adjustments: [
        {
          id: "adj-inheritance-1",
          expediente_id: "expediente-manual-acquisitions",
          adjustment_type: "INHERITANCE",
          status: "ACTIVE",
          target_operation_id: null,
          operation_date: "2025-02-01",
          isin: "ES0000000003",
          description: "Herencia manual",
          quantity: 3,
          total_amount: 270,
          currency: "EUR",
          notes: "Alta por herencia",
          metadata: {},
          created_by: "admin",
          updated_by: "admin",
          created_at: "2025-02-01T09:00:00Z",
          updated_at: "2025-02-01T09:00:00Z"
        },
        {
          id: "adj-transfer-out-1",
          expediente_id: "expediente-manual-acquisitions",
          adjustment_type: "TRANSFER_OUT",
          status: "ACTIVE",
          target_operation_id: null,
          operation_date: "2025-03-01",
          isin: "ES0000000003",
          description: "Salida a otro custodio",
          quantity: 5,
          total_amount: null,
          currency: null,
          notes: "Transferencia externa",
          metadata: {},
          created_by: "admin",
          updated_by: "admin",
          created_at: "2025-03-01T09:00:00Z",
          updated_at: "2025-03-01T09:00:00Z"
        }
      ]
    });

    expect(result.issues).toEqual([]);
    expect(result.lots).toHaveLength(2);
    expect(result.lots[0]).toMatchObject({
      acquisition_operation_id: "buy-1",
      quantity_original: 10,
      quantity_open: 1,
      quantity_sold: 9
    });
    expect(result.lots[1]).toMatchObject({
      acquisition_operation_id: null,
      quantity_original: 3,
      quantity_open: 3,
      quantity_sold: 0
    });
    expect(result.saleSummaries[0]).toMatchObject({
      sale_operation_id: "sell-1",
      quantity: 4,
      cost_basis: 400,
      realized_gain: 120,
      status: "MATCHED"
    });
  });
});
