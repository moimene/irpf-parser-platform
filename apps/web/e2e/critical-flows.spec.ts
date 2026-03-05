import { expect, test } from "@playwright/test";

test("UI: intake + export flow", async ({ page }) => {
  await page.goto("/expedientes/demo-irpf-2025");

  await page.getByLabel("Lista de archivos (uno por línea)").fill([
    "PICTET 001 DIC 2025 FAGU.pdf",
    "GS 553-4 DIC 2025 FAGU.pdf",
    "Citi NY 862 DIC 2025 FAGU.pdf"
  ].join("\n"));

  await page.getByRole("button", { name: "Encolar 3 documento(s)" }).click();
  await expect(page.locator("pre").first()).toContainText('"accepted": 3');

  await page.getByRole("button", { name: "Generar fichero" }).click();
  await expect(page.locator("pre").last()).toContainText('"model": "100"');
  await expect(page.locator("pre").last()).toContainText('"artifact_path"');
});

test("API: intake batch 20 + parse.failed alert", async ({ request }) => {
  const documents = Array.from({ length: 20 }, (_, index) => ({
    filename: `batch_${index + 1}.pdf`,
    source_type: "PDF"
  }));

  const intakeResponse = await request.post("/api/documents/intake", {
    data: {
      expediente_id: "batch-exp-2025",
      uploaded_by: "qa.e2e",
      documents
    }
  });

  expect(intakeResponse.ok()).toBeTruthy();
  const intakeBody = await intakeResponse.json();
  expect(intakeBody.accepted).toBe(20);

  const failedEvent = await request.post("/api/webhooks/parse-event", {
    data: {
      event_type: "parse.failed",
      document_id: intakeBody.document_id,
      expediente_id: "batch-exp-2025",
      payload: {
        error: "parser timeout"
      }
    }
  });

  expect(failedEvent.ok()).toBeTruthy();

  const reviewResponse = await request.get("/api/review?expediente_id=batch-exp-2025");
  expect(reviewResponse.ok()).toBeTruthy();

  const reviewBody = await reviewResponse.json();
  expect(reviewBody.open_alerts.length).toBeGreaterThan(0);
});
