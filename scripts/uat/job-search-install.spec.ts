// #1007 Stage 2 UAT proof: owner signup -> install job-search from the registry through the real
// Settings UI -> enable it -> confirm a real job-search route responds -> (Task 5) survive a
// container recreate. This is the end-to-end proof Ben asked for; no backend shortcuts.
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE_URL = process.env["UAT_BASE_URL"] ?? "http://localhost:1545";
const SHOT_DIR =
  "/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-coord-2026-06-30-rfa-fleet/58a78927-385c-4b1d-8fa0-94db20255d6f/scratchpad/devproof";
const OWNER_EMAIL = "uat-owner-1006@example.com";
const OWNER_PASSWORD = "uat-owner-password-1006";
const OWNER_NAME = "UAT Owner";

mkdirSync(SHOT_DIR, { recursive: true });

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: true });
}

async function signUpOwner(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.getByLabel("Name").fill(OWNER_NAME);
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await shot(page, "01-signup-filled");
  await page.getByRole("button", { name: "Create account" }).click();
  // The plan's waitForURL(/\/(onboarding|home|today)?/) matches immediately (optional group), so
  // it resolves before the app actually navigates post-signup. Wait for the auth panel to
  // disappear instead — that only happens once onAuthenticated() has fired and the shell mounted.
  await page.locator("section.auth-panel").waitFor({ state: "hidden", timeout: 15_000 });
  await shot(page, "02-post-signup");
}

async function skipOnboardingIfPresent(page: Page): Promise<void> {
  const skipAll = page.getByRole("button", { name: /skip/i });
  if (
    await skipAll
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
  ) {
    await skipAll.first().click();
    // No AI provider is connected in this UAT stack, so onboarding-wizard.tsx's #369 guard opens
    // a SkipConfirmDialog ("Skip setup without connecting a provider?") instead of skipping
    // directly. Confirm through it via "Skip anyway".
    const confirmButton = page.getByRole("button", { name: "Skip anyway" });
    if (await confirmButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmButton.click();
    }
    await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"), { timeout: 15_000 });
  }
}

async function installJobSearch(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/settings?section=instmods`);
  await page.waitForSelector("text=Available modules", { timeout: 15_000 });
  await shot(page, "03-instance-modules");

  const row = page.locator("li", { has: page.locator("code", { hasText: "job-search" }) });
  await row.scrollIntoViewIfNeeded();

  const installButton = row.getByRole("button", { name: /install/i });
  await installButton.click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Download" }).click();
  await shot(page, "04-download-confirmed");

  await row.getByText(/restart to apply/i).waitFor({ timeout: 30_000 });
  await shot(page, "05-pending-restart");
}

async function enableJobSearch(page: Page): Promise<void> {
  const row = page.locator("li", { has: page.locator("code", { hasText: "job-search" }) });
  const toggle = row.getByRole("switch");
  const alreadyEnabled = await toggle.isVisible({ timeout: 2_000 }).catch(() => false);
  if (!alreadyEnabled) {
    // Not yet installed/enabled-eligible: restart is required first (Task 5 handles that).
    return;
  }
  if (!(await toggle.isChecked())) {
    await toggle.click();
    await page.waitForTimeout(500);
  }
  await shot(page, "06-enabled");
}

async function assertJobSearchRouteResponds(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/m/job-search`);
  await page.waitForSelector('[data-module="job-search"]', { timeout: 15_000 });
  await page.getByRole("heading", { name: "Job Search" }).waitFor({ timeout: 15_000 });
  await shot(page, "07-job-search-route");
}

export async function run(): Promise<{ needsRestart: boolean }> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await signUpOwner(page);
    await skipOnboardingIfPresent(page);
    await installJobSearch(page);
    await enableJobSearch(page);

    const row = page.locator("li", { has: page.locator("code", { hasText: "job-search" }) });
    const toggle = row.getByRole("switch");
    const needsRestart = !(await toggle.isVisible({ timeout: 2_000 }).catch(() => false));
    return { needsRestart };
  } finally {
    await browser.close();
  }
}

// Post-restart resume: re-enable + assert the route, without re-doing signup/install.
export async function resumeAfterRestart(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL);
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    // The auth screen's segmented-control "Sign in" tab and the form's submit button both match
    // getByRole("button", { name: "Sign in" }) once bootstrap is done (two matches -> strict-mode
    // violation). Scope to the form's submit button specifically.
    await page.locator("form.auth-form").getByRole("button", { name: "Sign in" }).click();
    await page.locator("section.auth-panel").waitFor({ state: "hidden", timeout: 15_000 });

    await page.goto(`${BASE_URL}/settings?section=instmods`);
    await enableJobSearch(page);
    await assertJobSearchRouteResponds(page);
  } finally {
    await browser.close();
  }
}

const mode = process.argv[2] ?? "run";
if (mode === "resume") {
  resumeAfterRestart()
    .then(() => console.log("RESUME OK"))
    .catch((error) => {
      console.error("RESUME FAILED", error);
      process.exitCode = 1;
    });
} else {
  run()
    .then((result) => console.log(`RUN OK needsRestart=${result.needsRestart}`))
    .catch((error) => {
      console.error("RUN FAILED", error);
      process.exitCode = 1;
    });
}
