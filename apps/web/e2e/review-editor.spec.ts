import { expect, test } from "@playwright/test";
import type { ParsedRecord, StructuredDocument } from "../lib/contracts";
import {
  buildReviewCorrectionPayload,
  collectRelevantStructuredPages,
  doesStructuredRowMatchRecord,
  inferReviewFieldKind,
  normalizeReviewFieldValue
} from "../lib/review-editor";

test.describe("review-editor helpers", () => {
  test("buildReviewCorrectionPayload conserva indices y campos editables", async () => {
    const records: ParsedRecord[] = [
      {
        record_type: "COMPRA",
        confidence: 0.83,
        source_spans: [{ page: 1, start: 10, end: 40, snippet: "Compra editable" }],
        fields: {
          description: "Compra editable",
          amount: 1500,
          quantity: 10,
          currency: "EUR"
        }
      }
    ];

    const payload = buildReviewCorrectionPayload(records);

    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({
      record_index: 0,
      record_type: "COMPRA",
      confidence: 0.83,
      fields: {
        description: "Compra editable",
        amount: 1500,
        quantity: 10,
        currency: "EUR"
      }
    });
  });

  test("normalizeReviewFieldValue tipa fechas, números y vacíos", async () => {
    expect(inferReviewFieldKind("operation_date", null)).toBe("date");
    expect(inferReviewFieldKind("amount", 10)).toBe("number");
    expect(normalizeReviewFieldValue("amount", "1750.5", 1500)).toBe(1750.5);
    expect(normalizeReviewFieldValue("quantity", "", 10)).toBeNull();
    expect(normalizeReviewFieldValue("operation_date", "2025-01-10", null)).toBe("2025-01-10");
  });

  test("structured pages y filas relevantes se detectan desde spans y contenido", async () => {
    const record: ParsedRecord = {
      record_type: "COMPRA",
      confidence: 0.83,
      source_spans: [{ page: 2, start: 0, end: 20, snippet: "Compra editable ES0000000001" }],
      fields: {
        description: "Compra editable",
        isin: "ES0000000001",
        amount: 1500
      }
    };

    const structuredDocument: StructuredDocument = {
      source_type: "CSV",
      backend: "csv",
      metadata: {},
      pages: [
        {
          page: 1,
          text: "Página 1",
          tables: []
        },
        {
          page: 2,
          text: "Compra editable ES0000000001",
          tables: [
            {
              table_id: "table-1",
              page: 2,
              source: "csv:sheet-1",
              header: ["Description", "ISIN", "Amount"],
              rows: [["Compra editable", "ES0000000001", "1500"]]
            }
          ]
        }
      ]
    };

    expect(collectRelevantStructuredPages(record, structuredDocument)).toEqual([2]);
    expect(
      doesStructuredRowMatchRecord(
        structuredDocument.pages[1].tables[0].rows[0],
        record
      )
    ).toBeTruthy();
  });
});
