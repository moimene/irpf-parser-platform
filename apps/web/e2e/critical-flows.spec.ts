import { expect, test, type Page } from "@playwright/test";

const runningWithLocalServer = !process.env.E2E_BASE_URL;
const hasLocalSupabaseConfig = Boolean(
  process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

const e2eLoginEmail = process.env.E2E_LOGIN_EMAIL ?? "demo@irpf-parser.dev";
const e2eLoginPassword = process.env.E2E_LOGIN_PASSWORD ?? "Demo2025!";

type ReviewPayload = {
  pending_documents: Array<{ filename: string }>;
};

type ReviewActionPayload = {
  review_status?: string;
  message?: string;
  error?: string;
};

type ExpedientePayload = {
  counts: {
    completed: number;
    exports: number;
    adjustments_active?: number;
  };
  documents: Array<{
    filename: string;
    processing_status: string;
    latest_extraction: {
      review_status: string;
    } | null;
  }>;
  operations?: Array<{
    operation_type: string;
    operation_date: string;
    description: string | null;
    amount: number | null;
    quantity: number | null;
    source: string;
  }>;
  lots?: Array<{
    isin: string;
    quantity_original: number;
  }>;
};

type ClientPayload = {
  clients: Array<{
    id: string;
    reference: string;
    display_name: string;
    nif: string;
    status: "active" | "inactive" | "archived";
  }>;
};

type SessionPayload = {
  auth_mode: "supabase" | "demo";
  current_user: {
    id: string;
    reference: string;
    display_name: string;
    email: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  available_users?: Array<{
    id: string;
    reference: string;
  }>;
};

type AccessPayload = {
  current_user: {
    id: string;
    reference: string;
    display_name: string;
    email: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
  };
  users: Array<{
    id: string;
    reference: string;
    display_name: string;
    email: string;
    role: "admin" | "fiscal_senior" | "fiscal_junior" | "solo_lectura";
    status: "active" | "inactive";
    auth: {
      auth_user_id: string | null;
      onboarding_state: "no_auth_user" | "pending_onboarding" | "ready_no_login" | "active";
    };
  }>;
  clients: Array<{
    id: string;
    reference: string;
    display_name: string;
    status: "active" | "inactive" | "archived";
  }>;
  assignments: Array<{
    id: string;
    assignment_role: "owner" | "manager" | "support" | "viewer";
    user: {
      id: string;
    };
    client: {
      id: string;
    };
  }>;
};

type AccessUserCreatePayload = {
  user?: {
    id: string;
    email: string;
  };
  access_link?: {
    requested_mode: "onboarding" | "recovery";
    delivery: "invite" | "recovery";
    url: string;
  } | null;
  error?: string;
};

type SessionFetchResult<T> = {
  ok: boolean;
  status: number;
  body: T;
};

async function sessionJsonFetch<T>(
  page: Page,
  pathname: string,
  init?: {
    method?: string;
    data?: unknown;
    headers?: Record<string, string>;
  }
): Promise<SessionFetchResult<T>> {
  const result = await page.evaluate(
    async ({ pathname, init }) => {
      const headers = new Headers(init?.headers ?? {});
      let body: string | undefined;

      if (init?.data !== undefined) {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(init.data);
      }

      const response = await fetch(pathname, {
        method: init?.method ?? "GET",
        headers,
        body,
        credentials: "same-origin"
      });

      const text = await response.text();
      let payload: unknown = null;

      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        body: payload
      };
    },
    { pathname, init }
  );

  return result as SessionFetchResult<T>;
}

async function ensureAuthenticated(page: Page) {
  const loginHeading = page.getByRole("heading", { name: "Acceso al despacho" });
  const dashboardHeading = page.getByRole("heading", {
    name: "Extractor-Parseador Fiscal IRPF / IP / 720"
  });

  await page.goto("/");
  await expect(loginHeading.or(dashboardHeading)).toBeVisible();

  if (!(await loginHeading.isVisible())) {
    await expect(dashboardHeading).toBeVisible();
    return;
  }

  await page.getByLabel("Email").fill(e2eLoginEmail);
  await page.getByLabel("Contraseña").fill(e2eLoginPassword);
  await page.getByRole("button", { name: "Entrar al despacho" }).click();

  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
  await expect(dashboardHeading).toBeVisible({ timeout: 15_000 });
}

async function waitForDocumentInExpediente(
  page: Page,
  expedienteRef: string,
  filename: string
) {
  await expect
    .poll(
      async () => {
        const expedienteResponse = await sessionJsonFetch<ExpedientePayload | { error?: string }>(
          page,
          `/api/expedientes/${expedienteRef}`
        );

        if (!expedienteResponse.ok) return false;

        const expedienteBody = expedienteResponse.body as ExpedientePayload;
        return expedienteBody.documents.some((item) => item.filename === filename);
      },
      { timeout: 25_000 }
    )
    .toBeTruthy();
}

async function waitForPendingReviewDocument(
  page: Page,
  expedienteRef: string,
  filename: string,
  expectedCount: number
) {
  await expect
    .poll(
      async () => {
        const reviewResponse = await sessionJsonFetch<ReviewPayload | { error?: string }>(
          page,
          `/api/review?expediente_id=${expedienteRef}`
        );

        if (!reviewResponse.ok) return -1;

        const reviewBody = reviewResponse.body as ReviewPayload;
        return reviewBody.pending_documents.filter((item) => item.filename === filename).length;
      },
      { timeout: 40_000 }
    )
    .toBe(expectedCount);
}

async function waitForExtraction(
  page: Page,
  documentId: string
) {
  await expect
    .poll(
      async () => {
        const extractionResponse = await sessionJsonFetch<{ extraction_id?: string } | { error?: string }>(
          page,
          `/api/extractions?document_id=${documentId}`
        );

        if (!extractionResponse.ok) return null;

        const extractionBody = extractionResponse.body as { extraction_id?: string };
        return extractionBody.extraction_id ?? null;
      },
      { timeout: 25_000 }
    )
    .not.toBeNull();
}

async function createClient(
  page: Page,
  suffix: string
) {
  const normalizedSuffix = suffix.replace(/[^a-zA-Z0-9]/g, "").slice(-12) || "pwclient";
  const response = await sessionJsonFetch<{
    client?: { id: string; reference: string; display_name: string; nif: string };
    error?: string;
  }>(page, "/api/clientes", {
    method: "POST",
    data: {
      reference: `pw-${suffix}`,
      display_name: `Playwright ${suffix}`,
      nif: `PW${normalizedSuffix}`,
      email: `playwright+${normalizedSuffix}@irpf-parser.dev`,
      contact_person: "QA Playwright"
    }
  });

  expect(response.ok, JSON.stringify(response.body)).toBeTruthy();
  expect(response.body.client).toBeTruthy();
  return response.body.client as { id: string; reference: string; display_name: string; nif: string };
}

async function listClients(page: Page) {
  const response = await sessionJsonFetch<ClientPayload | { error?: string }>(page, "/api/clientes");
  expect(response.ok, JSON.stringify(response.body)).toBeTruthy();
  return (response.body as ClientPayload).clients;
}

async function createExpediente(
  page: Page,
  input: {
    clientId: string;
    reference: string;
    fiscalYear: number;
    modelType: "IRPF" | "IP" | "720";
  }
) {
  const response = await sessionJsonFetch<{
    expediente?: { id: string; reference: string };
    error?: string;
  }>(page, "/api/expedientes", {
    method: "POST",
    data: {
      client_id: input.clientId,
      reference: input.reference,
      fiscal_year: input.fiscalYear,
      model_type: input.modelType
    }
  });

  expect(response.ok, JSON.stringify(response.body)).toBeTruthy();
  expect(response.body.expediente?.reference).toBe(input.reference);
  return response.body.expediente as { id: string; reference: string };
}

test.describe("Smoke de navegacion IRPF", () => {
  test("sidebar y rutas heredadas siguen siendo accesibles", async ({ page }) => {
    await ensureAuthenticated(page);
    const sidebar = page.getByRole("complementary", { name: "Navegación principal" });

    await expect(
      page.getByRole("heading", { name: "Extractor-Parseador Fiscal IRPF / IP / 720" })
    ).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Dashboard operativo" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Clientes" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Expediente demo" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Revisión manual" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Configuración" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/clientes$/);
    await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();

    await sidebar.getByRole("link", { name: "Expediente demo" }).click();
    await expect(page).toHaveURL(/\/expedientes\/demo-irpf-2025$/);
    await expect(page.getByRole("heading", { name: "Expediente: demo-irpf-2025" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Estado del expediente" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ganancias y pérdidas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operaciones fiscales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lotes de adquisición" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Revisión manual" }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole("heading", { name: "Bandeja de Revisión Manual" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Configuración" }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
    await expect(page.getByRole("heading", { name: "Configuración y accesos" })).toBeVisible();

    await page.goto("/clientes/fagu");
    await expect(page.getByRole("heading", { name: "Ficha de cliente" })).toBeVisible();
    await expect(page.getByText("Vista operativa del cliente")).toBeVisible();

    await page.goto("/login");
    await expect(
      page
        .getByRole("heading", { name: "Acceso al despacho" })
        .or(page.getByRole("heading", { name: "Extractor-Parseador Fiscal IRPF / IP / 720" }))
    ).toBeVisible();
  });
});

test.describe("Auth y acceso despacho", () => {
  test.skip(
    runningWithLocalServer && !hasLocalSupabaseConfig,
    "Este ciclo necesita Supabase configurado en local o ejecutar contra un entorno desplegado via E2E_BASE_URL."
  );

  test("session y administracion resuelven perfiles persistentes modernos", async ({ page }) => {
    await ensureAuthenticated(page);

    const sessionResponse = await sessionJsonFetch<SessionPayload | { error?: string }>(
      page,
      "/api/session"
    );
    expect(sessionResponse.ok, JSON.stringify(sessionResponse.body)).toBeTruthy();

    const sessionBody = sessionResponse.body as SessionPayload;
    expect(sessionBody.auth_mode).toBe("supabase");
    expect(sessionBody.current_user.email.toLowerCase()).toBe(e2eLoginEmail.toLowerCase());
    expect(sessionBody.available_users).toBeUndefined();

    test.skip(
      sessionBody.current_user.role !== "admin",
      "La comprobación de administración necesita un usuario con rol admin."
    );

    const accessResponse = await sessionJsonFetch<AccessPayload | { error?: string }>(page, "/api/access");
    expect(accessResponse.ok, JSON.stringify(accessResponse.body)).toBeTruthy();

    const accessBody = accessResponse.body as AccessPayload;
    expect(accessBody.current_user.id).toBe(sessionBody.current_user.id);
    expect(accessBody.users.some((user) => user.id === sessionBody.current_user.id)).toBeTruthy();

    const userIds = new Set(accessBody.users.map((user) => user.id));
    const clientIds = new Set(accessBody.clients.map((client) => client.id));

    for (const assignment of accessBody.assignments) {
      expect(userIds.has(assignment.user.id)).toBeTruthy();
      expect(clientIds.has(assignment.client.id)).toBeTruthy();
    }
  });

  test("admin invita usuario y completa onboarding seguro", async ({ page, browser }) => {
    await ensureAuthenticated(page);

    const sessionResponse = await sessionJsonFetch<SessionPayload | { error?: string }>(
      page,
      "/api/session"
    );
    expect(sessionResponse.ok, JSON.stringify(sessionResponse.body)).toBeTruthy();

    const sessionBody = sessionResponse.body as SessionPayload;
    test.skip(
      sessionBody.current_user.role !== "admin",
      "La invitación segura necesita un usuario con rol admin."
    );

    const runId = Date.now();
    const invitedEmail = `playwright+invite-${runId}@irpf-parser.dev`;
    const invitedPassword = `Invite${runId}!`;

    const createUserResponse = await sessionJsonFetch<AccessUserCreatePayload>(page, "/api/access/users", {
      method: "POST",
      data: {
        display_name: `Invitado ${runId}`,
        reference: `pw-invite-${runId}`,
        email: invitedEmail,
        role: "fiscal_junior",
        status: "active"
      }
    });

    expect(createUserResponse.ok, JSON.stringify(createUserResponse.body)).toBeTruthy();
    const createUserBody = createUserResponse.body;
    expect(createUserBody.user?.id).toBeTruthy();
    expect(createUserBody.access_link?.requested_mode).toBe("onboarding");
    expect(createUserBody.access_link?.url).toContain("/auth/v1/verify");

    await expect
      .poll(async () => {
        const accessResponse = await sessionJsonFetch<AccessPayload | { error?: string }>(
          page,
          "/api/access"
        );
        if (!accessResponse.ok) {
          return null;
        }

        const accessBody = accessResponse.body as AccessPayload;
        return (
          accessBody.users.find((user) => user.email.toLowerCase() === invitedEmail.toLowerCase())?.auth
            .onboarding_state ?? null
        );
      })
      .toBe("pending_onboarding");

    const inviteContext = await browser.newContext();
    try {
      const invitePage = await inviteContext.newPage();
      await invitePage.goto(createUserBody.access_link!.url);

      await expect(
        invitePage.getByRole("heading", { name: "Onboarding seguro del despacho" })
      ).toBeVisible({ timeout: 30_000 });

      await invitePage.getByLabel("Nueva contraseña").fill(invitedPassword);
      await invitePage.getByLabel("Repite la contraseña").fill(invitedPassword);
      await invitePage.getByRole("button", { name: "Activar acceso seguro" }).click();

      await expect(
        invitePage.getByRole("heading", {
          name: "Extractor-Parseador Fiscal IRPF / IP / 720"
        })
      ).toBeVisible({ timeout: 30_000 });

      const invitedSessionResponse = await sessionJsonFetch<SessionPayload | { error?: string }>(
        invitePage,
        "/api/session"
      );
      expect(invitedSessionResponse.ok, JSON.stringify(invitedSessionResponse.body)).toBeTruthy();

      const invitedSessionBody = invitedSessionResponse.body as SessionPayload;
      expect(invitedSessionBody.current_user.email.toLowerCase()).toBe(invitedEmail.toLowerCase());
      expect(invitedSessionBody.current_user.reference).toBe(`pw-invite-${runId}`);
    } finally {
      await inviteContext.close().catch(() => null);
    }
  });
});

test.describe("Ciclo critico IRPF", () => {
  test.setTimeout(90_000);

  test.skip(
    runningWithLocalServer && !hasLocalSupabaseConfig,
    "Este ciclo necesita Supabase configurado en local o ejecutar contra un entorno desplegado via E2E_BASE_URL."
  );

  test("ui upload -> intake con signed URLs", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const expedienteRef = `pw-ui-${runId}`;
    const filename = `pw_ui_${runId}.pdf`;
    const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF");
    const createdClient = await createClient(page, `ui-${runId}`);

    await page.goto(`/expedientes/${expedienteRef}`);
    await expect(page.getByLabel("Cliente del expediente")).toBeVisible();
    await page.getByLabel("Cliente del expediente").selectOption(createdClient.id);
    await page.setInputFiles("#pdf-files", {
      name: filename,
      mimeType: "application/pdf",
      buffer: tinyPdf
    });

    await page.getByRole("button", { name: "Encolar 1 documento(s)" }).click();
    await expect(page.getByText("1 documento(s) encolado(s)")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("pre")).toContainText('"accepted": 1');
  });

  test("panel de ajustes crea una herencia manual y recalcula el expediente", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const expedienteRef = `pw-adjust-${runId}`;
    const createdClient = await createClient(page, `adjust-${runId}`);
    await createExpediente(page, {
      clientId: createdClient.id,
      reference: expedienteRef,
      fiscalYear: 2025,
      modelType: "IRPF"
    });

    await page.goto(`/expedientes/${expedienteRef}`);
    await expect(page.getByRole("heading", { name: "Ajustes fiscales manuales" })).toBeVisible();

    await page.getByLabel("Tipo de ajuste").selectOption("INHERITANCE");
    await page.getByLabel("Fecha efectiva").fill("2025-02-01");
    await page.getByLabel("ISIN").fill("ES0000000999");
    await page.getByLabel("Descripción").fill("Herencia Playwright");
    await page.getByLabel(/Cantidad/).fill("3");
    await page.getByLabel(/Coste total/).fill("270");
    await page.getByLabel("Divisa").fill("EUR");
    await page.getByLabel("Notas internas").fill("Alta manual por herencia en test");
    await page.getByRole("button", { name: "Guardar ajuste" }).click();

    await expect
      .poll(async () => {
        const expedienteResponse = await sessionJsonFetch<ExpedientePayload | { error?: string }>(
          page,
          `/api/expedientes/${expedienteRef}`
        );

        if (!expedienteResponse.ok) {
          return null;
        }

        const expedienteBody = expedienteResponse.body as ExpedientePayload;
        const lotExists =
          expedienteBody.lots?.some(
            (lot) => lot.isin === "ES0000000999" && Number(lot.quantity_original) === 3
          ) ?? false;

        return {
          adjustments: expedienteBody.counts.adjustments_active ?? 0,
          lotExists
        };
      }, { timeout: 20_000 })
      .toEqual({
        adjustments: 1,
        lotExists: true
      });
  });

  test("intake -> review approve -> export download", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const expedienteRef = `pw-cycle-${runId}`;
    const filename = `pw_cycle_${runId}.pdf`;
    const clients = await listClients(page);
    expect(clients.length).toBeGreaterThan(0);

    const intakeResponse = await sessionJsonFetch<{ accepted: number; document_id?: string; error?: string }>(
      page,
      "/api/documents/intake",
      {
        method: "POST",
        data: {
          expediente_id: expedienteRef,
          client_id: clients[0].id,
          uploaded_by: "qa.playwright",
          documents: [
            {
              filename,
              source_type: "PDF",
              content_base64: "JVBERi0xLjQK"
            }
          ]
        }
      }
    );

    const intakeBody = intakeResponse.body;
    expect(intakeResponse.ok, JSON.stringify(intakeBody)).toBeTruthy();
    expect(intakeBody.accepted).toBe(1);

    const documentId = intakeBody.document_id as string;

    await waitForDocumentInExpediente(page, expedienteRef, filename);
    await waitForExtraction(page, documentId);

    const eventResponse = await sessionJsonFetch<{ ok?: boolean; error?: string }>(
      page,
      "/api/webhooks/parse-event",
      {
        method: "POST",
        data: {
          event_type: "manual.review.required",
          document_id: documentId,
          expediente_id: expedienteRef,
          payload: {
            source: "playwright-review"
          }
        }
      }
    );

    const eventBody = eventResponse.body;
    expect(eventResponse.ok, JSON.stringify(eventBody)).toBeTruthy();
    await waitForPendingReviewDocument(page, expedienteRef, filename, 1);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Bandeja de Revisión Manual" })).toBeVisible();

    const extractionResponse = await sessionJsonFetch<{ extraction_id?: string; error?: string }>(
      page,
      `/api/extractions?document_id=${documentId}`
    );
    const extractionBody = extractionResponse.body;
    expect(extractionResponse.ok, JSON.stringify(extractionBody)).toBeTruthy();
    expect(extractionBody.extraction_id).toBeTruthy();

    const reviewResponse = await sessionJsonFetch<ReviewActionPayload>(
      page,
      `/api/review/${extractionBody.extraction_id}`,
      {
        method: "PATCH",
        data: {
          action: "approve",
          reviewer: "qa.playwright"
        }
      }
    );
    const reviewBody = reviewResponse.body;
    expect(reviewResponse.ok, JSON.stringify(reviewBody)).toBeTruthy();
    expect(reviewBody.review_status).toBe("validated");

    await page.goto(`/expedientes/${expedienteRef}`);
    await expect(page.getByRole("heading", { name: `Expediente: ${expedienteRef}` })).toBeVisible();
    await expect(page.locator("tr", { hasText: filename }).first()).toBeVisible();

    await page.getByLabel("NIF del declarante").fill("12345678A");
    await page.getByRole("button", { name: "Validar y previsualizar" }).click();
    await expect(page.getByText("Validación correcta")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar fichero AEAT" }).click();
    const download = await downloadPromise;
    expect(download.url()).toContain(`/api/exports/${expedienteRef}/download`);
    expect(download.suggestedFilename()).toContain("MODELO_100_");
  });

  test("review editable corrige registros sobre structured_document antes de aprobar", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const expedienteRef = `pw-review-edit-${runId}`;
    const filename = `pw_review_${runId}.csv`;
    const createdClient = await createClient(page, `review-${runId}`);
    await createExpediente(page, {
      clientId: createdClient.id,
      reference: expedienteRef,
      fiscalYear: 2025,
      modelType: "IRPF"
    });

    const csvPayload = [
      "Action,Description,ISIN,Amount,Currency,Quantity,Date",
      `Buy,Compra editable ${runId},ES0000000001,1500,EUR,10,2024-05-01`
    ].join("\n");

    const intakeResponse = await sessionJsonFetch<{ accepted: number; document_id?: string; error?: string }>(
      page,
      "/api/documents/intake",
      {
        method: "POST",
        data: {
          expediente_id: expedienteRef,
          client_id: createdClient.id,
          uploaded_by: "qa.playwright",
          documents: [
            {
              filename,
              source_type: "CSV",
              content_base64: Buffer.from(csvPayload).toString("base64")
            }
          ]
        }
      }
    );

    const intakeBody = intakeResponse.body;
    expect(intakeResponse.ok, JSON.stringify(intakeBody)).toBeTruthy();
    expect(intakeBody.accepted).toBe(1);

    await waitForDocumentInExpediente(page, expedienteRef, filename);
    await waitForPendingReviewDocument(page, expedienteRef, filename, 1);

    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Bandeja de Revisión Manual" })).toBeVisible();

    await page.getByRole("button", { name: new RegExp(filename) }).click();
    await expect(page.getByRole("heading", { name: filename })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Documento estructurado" })).toBeVisible();
    await expect(page.getByText(`Compra editable ${runId}`)).toBeVisible();
    await expect(page.getByText("tabla csv-1 · fila 1")).toBeVisible();

    await page.getByLabel("Descripción").fill(`Compra corregida ${runId}`);
    await page.getByLabel("Importe").fill("1750.5");
    await page.getByLabel("Cantidad").fill("12");
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page.getByText("Borrador de correcciones guardado. Documento sigue en revisión.")).toBeVisible();

    await page.getByRole("button", { name: "Aprobar y persistir" }).click();
    await expect(page.getByText(/Aprobado\./)).toBeVisible();

    await expect
      .poll(
        async () => {
          const expedienteResponse = await sessionJsonFetch<ExpedientePayload | { error?: string }>(
            page,
            `/api/expedientes/${expedienteRef}`
          );

          if (!expedienteResponse.ok) {
            return null;
          }

          const expedienteBody = expedienteResponse.body as ExpedientePayload;
          const document = expedienteBody.documents.find((item) => item.filename === filename);
          const operation = expedienteBody.operations?.find(
            (item) => item.description === `Compra corregida ${runId}`
          );

          if (!document || !operation) {
            return null;
          }

          return {
            processing_status: document.processing_status,
            review_status: document.latest_extraction?.review_status ?? null,
            amount: operation.amount,
            quantity: operation.quantity
          };
        },
        { timeout: 25_000 }
      )
      .toEqual({
        processing_status: "completed",
        review_status: "validated",
        amount: 1750.5,
        quantity: 12
      });
  });
});
