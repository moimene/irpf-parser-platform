import { expect, test } from "@playwright/test";
import { deriveFiscalRuntimeFromOperations } from "../lib/lots";

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
});
