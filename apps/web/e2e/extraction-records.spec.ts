import { expect, test } from "@playwright/test";
import { applyCorrectedFieldsToRecords } from "../lib/extraction-records";
import { buildOperationsFromRecords, toAeatRecord } from "../lib/operations";

test.describe("Normalizacion de extracciones", () => {
  test("aplica corrected_fields sobre los records aprobados antes de persistir operaciones", async () => {
    const correctedRecords = applyCorrectedFieldsToRecords(
      [
        {
          record_type: "VENTA",
          fields: {
            operation_date: "2024-03-10",
            isin: "US0000000001",
            description: "Venta original",
            amount: 1000,
            quantity: 5
          },
          confidence: 0.72,
          source_spans: [
            {
              page: 1,
              start: 10,
              end: 40,
              snippet: "Venta original",
              structured_ref: {
                kind: "table_row",
                table_id: "csv-1",
                row_index: 0,
                line_index: null,
                column_indices: [0, 1, 2]
              }
            }
          ]
        },
        {
          record_type: "DIVIDENDO",
          fields: {
            operation_date: "2024-03-11",
            isin: "US0000000001",
            description: "Dividendo original",
            amount: 25
          },
          confidence: 0.91,
          source_spans: [{ page: 1, start: 41, end: 70, snippet: "Dividendo original" }]
        }
      ],
      {
        records: [
          {
            record_index: 0,
            fields: {
              amount: 975,
              quantity: 4.5,
              realized_gain: 120
            },
            confidence: 0.95
          },
          {
            record_index: 1,
            amount: 30,
            currency: "USD"
          }
        ]
      }
    );

    expect(correctedRecords).toMatchObject([
      {
        record_type: "VENTA",
        fields: {
          operation_date: "2024-03-10",
          isin: "US0000000001",
          description: "Venta original",
          amount: 975,
          quantity: 4.5,
          realized_gain: 120
        },
        confidence: 0.95,
        source_spans: [
          {
            structured_ref: {
              kind: "table_row",
              table_id: "csv-1",
              row_index: 0
            }
          }
        ]
      },
      {
        record_type: "DIVIDENDO",
        fields: {
          operation_date: "2024-03-11",
          isin: "US0000000001",
          description: "Dividendo original",
          amount: 30,
          currency: "USD"
        },
        confidence: 0.91
      }
    ]);
  });

  test("no inventa realized_gain para ventas sin ganancia fiscal informada", async () => {
    const [operation] = buildOperationsFromRecords({
      records: [
        {
          record_type: "VENTA",
          fields: {
            operation_date: "2024-05-01",
            isin: "US0000000002",
            description: "Venta sin cierre fiscal",
            amount: 1500,
            currency: "EUR",
            quantity: 10
          },
          confidence: 0.88,
          source_spans: []
        }
      ],
      expedienteId: "expediente-test",
      documentId: "documento-test",
      source: "AUTO"
    });

    expect(operation).toMatchObject({
      operation_type: "VENTA",
      amount: 1500,
      realized_gain: null
    });

    expect(
      toAeatRecord({
        operation_type: operation.operation_type,
        operation_date: operation.operation_date,
        isin: operation.isin,
        quantity: operation.quantity,
        realized_gain: operation.realized_gain,
        description: operation.description,
        amount: operation.amount,
        currency: operation.currency,
        retention: operation.retention,
        origin_trace: operation.origin_trace,
        manual_notes: operation.manual_notes
      })
    ).toMatchObject({
      operation_type: "VENTA",
      amount: 1500,
      realized_gain: null
    });
  });
});
