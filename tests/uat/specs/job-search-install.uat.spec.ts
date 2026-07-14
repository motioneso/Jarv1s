import { expect, test } from "@playwright/test";
import { restartUatStack } from "../provisioner.js";
import { UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD } from "../seed/admin.js";

export const uatLevel = { level: "admin+data", without: ["job-search"] } as const;

// #1026/#1000/#999: happy-path proof that Job Search installs end-to-end against a real,
// prod-shaped instance (no mocked API calls — playwright.uat.config.ts has no webServer/mocks).
// Real nav only, no page.goto beyond the one unavoidable initial load: apps/web/src/app.tsx gates
// every route behind a 401 check (myModulesEnabled()), so a goto("/settings") shortcut would
// silently skip that fail-closed check instead of exercising it.
test("installing Job Search from Settings reaches installed-enabled after a real restart", async ({
  page
}) => {
  const projectName = process.env.JARVIS_UAT_PROJECT_NAME;
  const baseURL = process.env.JARVIS_UAT_BASE_URL;
  if (!projectName || !baseURL) {
    throw new Error("JARVIS_UAT_PROJECT_NAME / JARVIS_UAT_BASE_URL must be set by run-uat.ts");
  }

  await page.goto(baseURL);

  await page.getByLabel("Email").fill(UAT_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(UAT_ADMIN_PASSWORD);
  // Scoped to the form: the auth-mode segmented control has its own "Sign in" tab button
  // with the same accessible name as the submit button (apps/web/src/auth/auth-screen.tsx).
  await page.locator("form.auth-form").getByRole("button", { name: "Sign in" }).click();

  // Proves login landed on the authenticated shell — RailUserMenu only renders once logged in.
  await expect(page.locator(".jds-usermenu__trigger")).toBeVisible();

  const openInstanceModules = async () => {
    await page.locator(".jds-usermenu__trigger").click();
    await page.getByRole("button", { name: "Settings & permissions" }).click();
    await page.getByRole("button", { name: "Admin / Setup" }).click();
    await page.getByRole("button", { name: "Instance modules" }).click();
  };

  await openInstanceModules();
  await expect(page.getByRole("heading", { name: "Instance modules" })).toBeVisible();
  await expect(page.getByText("Available modules")).toBeVisible();

  const registry = page.locator('[aria-label="Module registry"]');
  const jobSearchRow = registry.locator("li", { hasText: "Job Search" });
  await expect(jobSearchRow.getByText("Not installed")).toBeVisible();

  await jobSearchRow.getByRole("button", { name: "Install" }).click();
  const installDialog = page.getByRole("dialog", { name: "Install Job Search?" });
  await expect(installDialog).toBeVisible();
  await installDialog.getByRole("button", { name: "Download" }).click();

  await expect(jobSearchRow.getByText("Downloaded — restart to apply")).toBeVisible({
    timeout: 30_000
  });

  // The real acceptance point (#999): install -> restart -> reconcile must land on
  // installed-enabled after an actual container restart, not just after the download step.
  await restartUatStack(projectName, baseURL);
  await page.reload();

  await openInstanceModules();
  const jobSearchRowAfterRestart = page
    .locator('[aria-label="Module registry"]')
    .locator("li", { hasText: "Job Search" });
  await expect(jobSearchRowAfterRestart.getByText("Installed")).toBeVisible({ timeout: 30_000 });

  // No click here: scripts/module-reconcile.ts's phase-5 staged-acceptance sets
  // `status = 'enabled'` unconditionally when a staged download is accepted on restart —
  // a registry install has no separate manual-enable step, so "installed-enabled" (this
  // test's own name) means the switch already reads checked once "Installed" is visible.
  const enableSwitch = jobSearchRowAfterRestart.getByRole("checkbox", {
    name: /enable job search/i
  });
  await expect(enableSwitch).toBeChecked();
});
