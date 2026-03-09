import { expect, test, type Page } from "@playwright/test";
import { PROTOTYPE_SHARED_PASSWORD } from "../lib/prototype-test-users";

const runningWithLocalServer = !process.env.E2E_BASE_URL;
const hasLocalSupabaseConfig = Boolean(
  process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

const e2eLoginEmail = process.env.E2E_LOGIN_EMAIL ?? "demo@irpf-parser.dev";
const e2eLoginPassword = process.env.E2E_LOGIN_PASSWORD ?? PROTOTYPE_SHARED_PASSWORD;

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
  };
  documents: Array<{
    filename: string;
    processing_status: string;
    latest_extraction: {
      review_status: string;
    } | null;
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
    name: "Clientes asignados y expedientes en curso"
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
      { timeout: 25_000 }
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
  const response = await sessionJsonFetch<{
    client?: { id: string; reference: string; display_name: string; nif: string };
    error?: string;
  }>(page, "/api/clientes", {
    method: "POST",
    data: {
      reference: `pw-${suffix}`,
      display_name: `Playwright ${suffix}`,
      nif: `${suffix.replace(/\D/g, "").slice(-8).padStart(8, "0")}A`,
      email: `playwright+${suffix}@irpf-parser.dev`,
      contact_person: "QA Playwright"
    }
  });

  expect(response.ok, JSON.stringify(response.body)).toBeTruthy();
  expect(response.body.client).toBeTruthy();
  return response.body.client as { id: string; reference: string; display_name: string; nif: string };
}

async function createExpediente(
  page: Page,
  clientId: string,
  suffix: string,
  modelType: "IRPF" | "IP" | "720" = "IRPF"
) {
  const fiscalYear = new Date().getFullYear();
  const response = await sessionJsonFetch<{
    expediente?: {
      id: string;
      reference: string;
      client_id: string;
      fiscal_year: number;
      model_type: "IRPF" | "IP" | "720";
      title: string;
      status: string;
    };
    error?: string;
  }>(page, "/api/expedientes", {
    method: "POST",
    data: {
      client_id: clientId,
      fiscal_year: fiscalYear,
      model_type: modelType,
      reference: `pw-${suffix}-${modelType.toLowerCase()}-${fiscalYear}`
    }
  });

  expect(response.ok, JSON.stringify(response.body)).toBeTruthy();
  expect(response.body.expediente).toBeTruthy();
  return response.body.expediente as {
    id: string;
    reference: string;
    client_id: string;
    fiscal_year: number;
    model_type: "IRPF" | "IP" | "720";
    title: string;
    status: string;
  };
}

test.describe("Smoke de navegacion IRPF", () => {
  test("sidebar y rutas heredadas siguen siendo accesibles", async ({ page }) => {
    await ensureAuthenticated(page);
    const sidebar = page.getByRole("complementary", { name: "Navegación principal" });

    await expect(page.getByText("Mi cartera").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Clientes asignados y expedientes en curso" })
    ).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Mi cartera" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Clientes" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Bandeja de trabajo" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Modelos AEAT" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Configuración" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/clientes$/);
    await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();

    await sidebar.getByRole("link", { name: "Modelos AEAT" }).click();
    await expect(page).toHaveURL(/\/modelos$/);
    await expect(page.getByRole("heading", { name: "Mesa declarativa del despacho" })).toBeVisible();

    await page.goto("/expedientes/demo-irpf-2025");
    await expect(page.getByRole("heading", { name: "Expediente: demo-irpf-2025" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fases del expediente" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Estado del expediente" })).toBeVisible();

    await page.goto("/expedientes/demo-irpf-2025?fase=canonico");
    await expect(page.getByRole("heading", { name: "Activos patrimoniales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Eventos fiscales" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ganancias y pérdidas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lotes de adquisición" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Bandeja de trabajo" }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole("heading", { name: "Bandeja de trabajo" })).toBeVisible();

    await sidebar.getByRole("link", { name: "Configuración" }).click();
    await expect(page).toHaveURL(/\/configuracion$/);
    await expect(page.getByRole("heading", { name: "Configuración y accesos" })).toBeVisible();

    await page.goto("/clientes/lucia-navarro");
    await expect(page.getByRole("heading", { name: "Ficha de cliente" })).toBeVisible();
    await expect(page.getByText("Vista operativa del cliente")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unidad fiscal y vinculacion" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Expedientes por ejercicio" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unidad fiscal", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Activos patrimoniales" })).toBeVisible();

    await page.goto("/login");
    await expect(
      page
        .getByRole("heading", { name: "Acceso al despacho" })
        .or(page.getByRole("heading", { name: "Mi cartera" }))
        .or(page.getByRole("heading", { name: "Clientes asignados y expedientes en curso" }))
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
        invitePage.getByRole("heading", { name: "Clientes asignados y expedientes en curso" })
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

  test("admin estructura unidad fiscal del cliente", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const createdClient = await createClient(page, `fiscal-unit-${runId}`);

    await page.goto(`/clientes/${createdClient.reference}`);
    await expect(page.getByRole("heading", { name: "Unidad fiscal y vinculacion" })).toBeVisible();

    await page.getByLabel("Sujeto pasivo").fill(`Playwright Unit ${runId}`);
    await page.getByLabel("NIF del sujeto pasivo").fill(createdClient.nif);
    await page.getByLabel("Alcance declarativo").selectOption("joint");
    await page.getByLabel("Condicion del declarante").selectOption("titular");
    await page.getByLabel("Condicion del conyuge").selectOption("titular");
    await page.getByLabel("Conyuge").fill("Conyuge Playwright");
    await page.getByLabel("NIF del conyuge").fill("87654321B");
    await page.getByLabel("Vinculacion fiscal").selectOption("gananciales");
    await page.getByLabel("Notas de unidad fiscal").fill("Unidad fiscal de prueba");

    await page.getByRole("button", { name: "Guardar unidad fiscal" }).click();
    await expect(page.getByText("Unidad fiscal actualizada.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Sujeto pasivo")).toHaveValue(`Playwright Unit ${runId}`);
    await expect(page.getByLabel("Alcance declarativo")).toHaveValue("joint");
    await expect(page.getByLabel("Conyuge")).toHaveValue("Conyuge Playwright");
    await expect(page.getByLabel("Vinculacion fiscal")).toHaveValue("gananciales");
  });
});

test.describe("Ciclo critico IRPF", () => {
  test.skip(
    runningWithLocalServer && !hasLocalSupabaseConfig,
    "Este ciclo necesita Supabase configurado en local o ejecutar contra un entorno desplegado via E2E_BASE_URL."
  );

  test("ui upload -> intake con signed URLs", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const filename = `pw_ui_${runId}.pdf`;
    const tinyPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF");
    const createdClient = await createClient(page, `ui-${runId}`);
    const createdExpediente = await createExpediente(page, createdClient.id, `ui-${runId}`);

    await page.goto(`/expedientes/${createdExpediente.reference}?fase=documental`);
    await expect(page.getByRole("heading", { name: "Estado documental" })).toBeVisible();
    await expect(page.getByText("Expediente vinculado a")).toBeVisible();
    await expect(page.getByLabel("Cliente del expediente")).toHaveCount(0);
    await page.setInputFiles("#pdf-files", {
      name: filename,
      mimeType: "application/pdf",
      buffer: tinyPdf
    });

    await page.getByRole("button", { name: "Encolar 1 documento(s)" }).click();
    await expect(page.getByText("1 documento(s) encolado(s)")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("pre")).toContainText('"accepted": 1');
  });

  test("intake -> review approve -> export download", async ({ page }) => {
    await ensureAuthenticated(page);
    const runId = Date.now();
    const createdClient = await createClient(page, `cycle-${runId}`);
    const createdExpediente = await createExpediente(page, createdClient.id, `cycle-${runId}`);
    const expedienteRef = createdExpediente.reference;
    const filename = `pw_cycle_${runId}.pdf`;

    const intakeResponse = await sessionJsonFetch<{ accepted: number; document_id?: string; error?: string }>(
      page,
      "/api/documents/intake",
      {
        method: "POST",
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
    await expect(page.getByRole("heading", { name: "Bandeja de trabajo" })).toBeVisible();

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

    await page.goto(`/expedientes/${expedienteRef}?fase=modelos`);
    await expect(page.getByRole("heading", { name: `Expediente: ${expedienteRef}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Estado declarativo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Preparación AEAT" })).toBeVisible();

    await page.getByLabel("NIF del declarante").fill("12345678A");
    await page.getByRole("button", { name: "Validar y previsualizar" }).click();
    await expect(page.getByText("Validación correcta")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar fichero AEAT" }).click();
    const download = await downloadPromise;
    expect(download.url()).toContain(`/api/exports/${expedienteRef}/download`);
    expect(download.suggestedFilename()).toContain("MODELO_100_");
  });

  test("intake y export rechazan expedientes inexistentes", async ({ page }) => {
    await ensureAuthenticated(page);
    const missingExpediente = `pw-missing-${Date.now()}`;

    const intakeResponse = await sessionJsonFetch<{ error?: string }>(page, "/api/documents/intake", {
      method: "POST",
      data: {
        expediente_id: missingExpediente,
        documents: [
          {
            filename: "missing.pdf",
            source_type: "PDF",
            content_base64: "JVBERi0xLjQK"
          }
        ]
      }
    });

    expect(intakeResponse.ok).toBeFalsy();
    expect(intakeResponse.status).toBe(404);
    expect((intakeResponse.body as { error?: string }).error).toContain("no existe");

    const exportResponse = await sessionJsonFetch<{ error?: string }>(
      page,
      `/api/exports/${missingExpediente}?model=100`
    );

    expect(exportResponse.ok).toBeFalsy();
    expect(exportResponse.status).toBe(404);
    expect((exportResponse.body as { error?: string }).error).toContain("no existe");
  });
});
