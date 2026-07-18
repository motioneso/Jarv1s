import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { buildUatComposeArgs, restartUatStack } from "../provisioner.js";
import { UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD } from "../seed/admin.js";

export const uatLevel = { level: "admin+data", without: [] } as const;

// FIN-02 (#1147) Task 12 — end-to-end proof of the Finance transaction feed on a REAL
// activated external module (grounded decision D7 in
// docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md): no mock module
// registry, no fake-hash seeding of app.external_modules. The package is docker-cp'd into
// the instance's modules directory, discovered by the fail-closed reconcile on restart
// (packages/module-registry/src/external/reconcile.ts — cp alone lands "discovered",
// NEVER enabled), then enabled through the real admin UI, which is where the trusted
// hashes are recorded. A second restart makes the module worker register its pg-boss
// queues, so the recategorize step at the end exercises the categorize-apply queue for
// real (D3/D4: web writes go through the queue run route only).
//
// SECRET HYGIENE (binding, spec §security): this test never talks to Plaid and no
// credential of any kind exists in the stack — the seed chunk (tests/uat/seed/chunks/
// finance.ts) writes only module-KV data rows; `finance.plaid-tokens` is never seeded.
//
// Real nav only past the initial load (#999/#1026): apps/web/src/app.tsx gates external
// module routes per-user and fails closed to /tasks, so reaching the feed via the nav
// link (not a goto) is itself part of the assertion. page.reload() is allowed — it is
// exactly what proves the recategorize persisted (reload discards the feed's optimistic
// category override, so the value can only come from the worker's KV write).
test("Finance feed works end-to-end on a docker-cp activated module", async ({ page }) => {
  // Two real container restarts + a pg-boss-driven recategorize poll — well past the
  // 60s config default.
  test.setTimeout(420_000);

  const projectName = process.env.JARVIS_UAT_PROJECT_NAME;
  const baseURL = process.env.JARVIS_UAT_BASE_URL;
  if (!projectName || !baseURL) {
    throw new Error("JARVIS_UAT_PROJECT_NAME / JARVIS_UAT_BASE_URL must be set by run-uat.ts");
  }

  // --- D7 activation, host side -------------------------------------------------------
  // Build the module package fresh, then copy it into the running container's modules
  // dir (JARVIS_MODULES_DIR=/data/modules in infra/docker-compose.prod.yml; the dest dir
  // doesn't exist yet, so docker cp lands the whole package as /data/modules/finance).
  // buildUatComposeArgs carries the -p/-f pair; the compose interpolation env vars were
  // exported into process.env by provisionForUat and are inherited here (the same
  // mechanism restartUatStack already relies on).
  execFileSync("pnpm", ["build:external:finance"], { stdio: "inherit" });
  execFileSync(
    "docker",
    buildUatComposeArgs(projectName, [
      "cp",
      "external-modules/finance",
      "jarv1s:/data/modules/finance"
    ]),
    { stdio: "inherit" }
  );

  // Restart #1: reconcile runs at boot and discovers the package. Fail-closed means it
  // is now visible to the admin but INACTIVE until explicitly enabled below.
  await restartUatStack(projectName, baseURL);

  // --- Sign in ------------------------------------------------------------------------
  await page.goto(baseURL);
  await page.getByLabel("Email").fill(UAT_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(UAT_ADMIN_PASSWORD);
  // Scoped to the form: the auth-mode segmented control has its own "Sign in" tab button
  // with the same accessible name as the submit button (apps/web/src/auth/auth-screen.tsx).
  await page.locator("form.auth-form").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".jds-usermenu__trigger")).toBeVisible();

  const openInstanceModules = async () => {
    await page.locator(".jds-usermenu__trigger").click();
    await page.getByRole("button", { name: "Settings & permissions" }).click();
    await page.getByRole("button", { name: "Admin / Setup" }).click();
    await page.getByRole("button", { name: "Instance modules" }).click();
  };

  // --- Enable through the real admin UI ------------------------------------------------
  // settings-instance-modules-pane.tsx renders discovered packages in the "External
  // modules" group with a Switch whose aria-label is `Enable ${module.name}` — this
  // click is the D7 acceptance point where setExternalModuleEnabled records the real
  // package hashes.
  await openInstanceModules();
  await expect(page.getByRole("heading", { name: "Instance modules" })).toBeVisible();
  const enableSwitch = page.getByRole("checkbox", { name: "Enable Finance", exact: true });
  await expect(enableSwitch).not.toBeChecked();
  // The switch input itself is visually hidden (components-core.css) — the wrapping
  // <label.jds-switch> is the clickable surface (same idiom as tests/e2e/settings-modules.spec.ts).
  await page.locator("label.jds-switch", { has: enableSwitch }).click();
  await expect(enableSwitch).toBeChecked();

  // Restart #2: the module worker only registers its pg-boss queues at boot, and the
  // recategorize step below needs the finance.categorize-apply queue live.
  await restartUatStack(projectName, baseURL);
  await page.reload();

  // --- Reach the feed via real nav -----------------------------------------------------
  // The manifest contributes nav entry "Finance" → route /m/finance/* (app.tsx
  // externalModuleRoutes). Rendering here proves reconcile re-verified the recorded
  // hashes after the restart (drift would have auto-disabled the module).
  await page.locator('nav[aria-label="Modules"]').getByRole("link", { name: "Finance" }).click();
  await expect(page.locator('[aria-label="Transaction feed"]')).toBeVisible({ timeout: 30_000 });

  // Account pills + total, scoped to the pills strip — the account filter buttons lower
  // down repeat the same "name ··mask" text.
  const pills = page.locator('[aria-label="Connected accounts"]');
  await expect(pills.getByText("Everyday Checking ··4321")).toBeVisible();
  await expect(pills.getByText("Rainy Day Savings ··8765")).toBeVisible();
  // 254_317 + 1_200_000 seeded cents, both USD.
  await expect(pills.getByText("Total $14,543.17")).toBeVisible();
  await expect(pills.getByText("Connected")).toHaveCount(2);

  // Seeded current-month transactions render across both accounts.
  await expect(page.getByText("BLUE BOTTLE COFFEE OAK", { exact: true })).toBeVisible();
  await expect(page.getByText("GREEN HILLS MARKET #204", { exact: true })).toBeVisible();
  await expect(page.getByText("OAKWOOD PROPERTY MGMT", { exact: true })).toBeVisible();
  await expect(page.getByText("INTEREST PAYMENT", { exact: true })).toBeVisible();
  // The plaid-map categorization from the seed survives the full read path.
  await expect(
    page.getByRole("combobox", { name: "Category for GREEN HILLS MARKET #204", exact: true })
  ).toHaveValue("groceries");

  // --- Month navigation ----------------------------------------------------------------
  // The previous month is deliberately unseeded (seed chunk doc comment) to prove the
  // authored empty state, and coming back restores the rows.
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.getByText(/No transactions in /)).toBeVisible();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(page.getByText("BLUE BOTTLE COFFEE OAK", { exact: true })).toBeVisible();

  // --- Search --------------------------------------------------------------------------
  const searchInput = page.getByRole("searchbox", { name: "Search transactions", exact: true });
  await searchInput.fill("blue bottle");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("BLUE BOTTLE COFFEE OAK", { exact: true })).toBeVisible();
  await expect(page.getByText("GREEN HILLS MARKET #204", { exact: true })).toBeHidden();
  await searchInput.fill("");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("GREEN HILLS MARKET #204", { exact: true })).toBeVisible();

  // --- Recategorize through the real queue ---------------------------------------------
  // Selecting a category enqueues finance.categorize-apply (metadata-only params, D6)
  // via the queue run route. The UI flips optimistically, so a bare toHaveValue right
  // after the select proves nothing — instead reload (dropping the optimistic override)
  // and poll until the WORKER's KV write is what the feed renders.
  await page
    .getByRole("combobox", { name: "Category for BLUE BOTTLE COFFEE OAK", exact: true })
    .selectOption({ label: "Dining & coffee" });
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Category for BLUE BOTTLE COFFEE OAK", exact: true })
    ).toHaveValue("dining", { timeout: 5_000 });
  }).toPass({ timeout: 120_000, intervals: [5_000] });
});
