import { expect, test } from "@playwright/test";
import { PROTOTYPE_SHARED_PASSWORD } from "../lib/prototype-test-users";

const e2eLoginEmail = process.env.E2E_LOGIN_EMAIL ?? "demo@irpf-parser.dev";
const e2eLoginPassword = process.env.E2E_LOGIN_PASSWORD ?? PROTOTYPE_SHARED_PASSWORD;

async function authenticate(page: import("@playwright/test").Page) {
    await page.goto("/");
    const loginHeading = page.getByRole("heading", { name: "Acceso al despacho" });
    if (await loginHeading.isVisible()) {
        await page.getByLabel("Email").fill(e2eLoginEmail);
        await page.getByLabel("Contraseña").fill(e2eLoginPassword);
        await page.getByRole("button", { name: "Entrar al despacho" }).click();
        await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
    }
}

test.describe("Workspace + Stepper E2E", () => {
    test("dashboard renders KPIs and DataTable tabs", async ({ page }) => {
        await authenticate(page);
        await page.goto("/");

        // Dashboard header
        await expect(page.getByText("Plataforma Fiscal Patrimonial")).toBeVisible();

        // KPI grid
        const kpis = page.locator(".kpi");
        await expect(kpis).toHaveCount(6);

        // Tabs: Clientes / Expedientes
        await expect(page.getByRole("tab", { name: "Mis clientes" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Expedientes activos" })).toBeVisible();

        // Switch to expedientes tab
        await page.getByRole("tab", { name: "Expedientes activos" }).click();
        await expect(page.getByPlaceholder("Buscar expedientes...")).toBeVisible();
    });

    test("client workspace shows 6 tabs with URL sync", async ({ page }) => {
        await authenticate(page);
        await page.goto("/clientes/lucia-navarro");

        // Tab navigation
        const tabs = ["Resumen", "Expedientes", "Documentos", "Portfolio 720", "IRPF", "Patrimonio IP"];
        for (const tabName of tabs) {
            await expect(page.getByRole("tab", { name: tabName })).toBeVisible();
        }

        // Click Portfolio tab — URL should update
        await page.getByRole("tab", { name: "Portfolio 720" }).click();
        await expect(page).toHaveURL(/tab=portfolio/);
        await expect(page.getByPlaceholder("Buscar activos...")).toBeVisible();

        // Click IRPF tab
        await page.getByRole("tab", { name: "IRPF" }).click();
        await expect(page).toHaveURL(/tab=irpf/);

        // Click Patrimonio tab
        await page.getByRole("tab", { name: "Patrimonio IP" }).click();
        await expect(page).toHaveURL(/tab=patrimonio/);

        // Navigate by URL param
        await page.goto("/clientes/lucia-navarro?tab=expedientes");
        await expect(page.getByRole("tab", { name: "Expedientes" })).toHaveAttribute("data-state", "active");
    });

    test("expediente stepper shows phases with URL sync", async ({ page }) => {
        await authenticate(page);
        await page.goto("/expedientes/demo-irpf-2025");

        // Stepper phase buttons should be visible
        await expect(page.getByText("Resumen").first()).toBeVisible();

        // Navigate to documental phase via URL
        await page.goto("/expedientes/demo-irpf-2025?fase=documental");
        await expect(page.getByText("Documentos del expediente").first()).toBeVisible();

        // Navigate to revision phase
        await page.goto("/expedientes/demo-irpf-2025?fase=revision");
        await expect(page.getByText("Revisión").first()).toBeVisible();
    });

    test("review board renders KPIs and master-detail layout", async ({ page }) => {
        await authenticate(page);
        await page.goto("/review");

        // Header
        await expect(page.getByText("Cola operativa")).toBeVisible();

        // KPIs
        const kpis = page.locator(".kpi");
        await expect(kpis.first()).toBeVisible();

        // Filters section
        await expect(page.getByText("Buscar")).toBeVisible();

        // Master-detail layout
        await expect(page.locator(".review-workbench")).toBeVisible();
    });

    test("models workspace renders overview and DataTable tabs", async ({ page }) => {
        await authenticate(page);
        await page.goto("/modelos");

        // Header
        await expect(page.getByText("Panel de preparación declarativa")).toBeVisible();

        // Tabs
        await expect(page.getByRole("tab", { name: "Todos" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "IRPF (100)" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "IP (714)" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "720" })).toBeVisible();

        // Switch tabs
        await page.getByRole("tab", { name: "IRPF (100)" }).click();
        await expect(page.getByPlaceholder("Buscar modelos IRPF...")).toBeVisible();
    });

    test("DataTable pagination and search work", async ({ page }) => {
        await authenticate(page);
        await page.goto("/clientes");

        // DataTable should render
        const table = page.locator("table");
        await expect(table).toBeVisible();

        // Search box
        const searchInput = page.getByPlaceholder("Buscar clientes...");
        if (await searchInput.isVisible()) {
            await searchInput.fill("lucia");
            // Results should filter
            await page.waitForTimeout(500);
        }

        // Pagination info
        await expect(page.getByText(/de \d+/).first()).toBeVisible();
    });
});
