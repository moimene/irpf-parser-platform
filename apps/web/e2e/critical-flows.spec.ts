import { expect, test } from "@playwright/test";

const runningWithLocalServer = !process.env.E2E_BASE_URL;
const hasLocalSupabaseConfig = Boolean(
  process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

test.describe("Ciclo crítico IRPF", () => {
  test.skip(
    runningWithLocalServer && !hasLocalSupabaseConfig,
    "Este ciclo necesita Supabase configurado en local o ejecutar contra un entorno desplegado via E2E_BASE_URL."
  );

  test("intake -> review -> export (playwright cycle)", async ({ page, request }) => {
    const runId = Date.now();
    const expedienteRef = `pw-cycle-${runId}`;
    const filename = `pw_cycle_${runId}.pdf`;

    const intakeResponse = await request.post("/api/documents/intake", {
      data: {
        expediente_id: expedienteRef,
        uploaded_by: "qa.playwright",
        documents: [
          {
            filename,
            source_type: "PDF",
            content_base64: "JVBERi0xLjQK"
          }
        ]
      }
    });

    const intakeBody = await intakeResponse.json();
    expect(intakeResponse.ok(), JSON.stringify(intakeBody)).toBeTruthy();
    expect(intakeBody.accepted).toBe(1);

    const documentId = intakeBody.document_id as string;

    const eventResponse = await request.post("/api/webhooks/parse-event", {
      data: {
        event_type: "manual.review.required",
        document_id: documentId,
        expediente_id: expedienteRef,
        payload: {
          source: "playwright"
        }
      }
    });

    const eventBody = await eventResponse.json();
    expect(eventResponse.ok(), JSON.stringify(eventBody)).toBeTruthy();

    await expect
      .poll(
        async () => {
          const reviewResponse = await request.get(`/api/review?expediente_id=${expedienteRef}`);
          if (!reviewResponse.ok()) return 0;
          const reviewBody = (await reviewResponse.json()) as {
            pending_documents: Array<{ filename: string }>;
          };
          return reviewBody.pending_documents.filter((item) => item.filename === filename).length;
        },
        { timeout: 25_000 }
      )
      .toBeGreaterThan(0);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Bandeja de Revisión Manual" })).toBeVisible();
    await expect(page.getByText(filename)).toBeVisible({ timeout: 25_000 });

    await page.goto(`/expedientes/${expedienteRef}`);
    await expect(page.getByRole("heading", { name: `Expediente: ${expedienteRef}` })).toBeVisible();
    await page.getByRole("button", { name: "Validar y previsualizar" }).click();
    await expect(page.getByText("Validación correcta")).toBeVisible();

    const dashboardResponse = await request.get("/api/dashboard");
    expect(dashboardResponse.ok()).toBeTruthy();
    const dashboard = (await dashboardResponse.json()) as {
      manualReview: number;
      exports: number;
    };
    expect(dashboard.manualReview).toBeGreaterThan(0);
    expect(dashboard.exports).toBeGreaterThan(0);
  });
});
