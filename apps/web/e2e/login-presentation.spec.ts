import { expect, test } from "@playwright/test";
import { PROTOTYPE_SHARED_PASSWORD } from "../lib/prototype-test-users";

test("Login muestra usuarios fijos de presentacion y carga credenciales", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Acceso al despacho" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usuarios de test" })).toBeVisible();

  await expect(page.getByText("demo@irpf-parser.dev")).toBeVisible();
  await expect(page.getByText("senior@irpf-parser.dev")).toBeVisible();
  await expect(page.getByText(`Password común: ${PROTOTYPE_SHARED_PASSWORD}`)).toBeVisible();

  const seniorCard = page.locator(".login-tester-card").filter({ hasText: "Fiscalista Senior" });
  await seniorCard.getByRole("button", { name: "Usar este acceso" }).click();

  await expect(page.getByLabel("Email")).toHaveValue("senior@irpf-parser.dev");
  await expect(page.getByLabel("Contraseña")).toHaveValue(PROTOTYPE_SHARED_PASSWORD);
  await expect(page.getByRole("button", { name: "Credenciales cargadas" })).toBeVisible();
});
