import { expect, test } from "@playwright/test";
import { deriveLotsFromOperations } from "../lib/lots";

test.describe("Runtime de lotes IRPF", () => {
  test("deriva lotes FIFO abiertos y cerrados desde compras y ventas", async () => {
    const result = deriveLotsFromOperations({
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
  });
});
