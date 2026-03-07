import { expect, test } from "@playwright/test";
import { inferDocumentSourceType, mimeTypeForDocumentSourceType } from "../lib/document-source";

test.describe("Clasificacion de documentos de ingesta", () => {
  test("detecta el source_type por extension o content-type", async () => {
    expect(inferDocumentSourceType("broker.pdf", "application/pdf")).toBe("PDF");
    expect(inferDocumentSourceType("statement.csv", "text/csv")).toBe("CSV");
    expect(
      inferDocumentSourceType(
        "positions.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe("XLSX");
    expect(
      inferDocumentSourceType(
        "carta.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      )
    ).toBe("DOCX");
    expect(inferDocumentSourceType("scan.jpeg", "image/jpeg")).toBe("IMAGE");
  });

  test("resuelve el mime_type por source_type para intake", async () => {
    expect(mimeTypeForDocumentSourceType("PDF")).toBe("application/pdf");
    expect(mimeTypeForDocumentSourceType("CSV")).toBe("text/csv");
    expect(mimeTypeForDocumentSourceType("XLSX")).toContain("spreadsheetml");
    expect(mimeTypeForDocumentSourceType("DOCX")).toContain("wordprocessingml.document");
    expect(mimeTypeForDocumentSourceType("IMAGE")).toBe("image/*");
  });
});
