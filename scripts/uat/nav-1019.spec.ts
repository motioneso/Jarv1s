// #1019 dev-UAT proof: owner signup -> install job-search from the registry through the real
// Settings UI (mirrors job-search-install.spec.ts, #1007) -> restart to activate -> reach the
// module via the sidebar "Modules" nav section (NOT by typing /m/job-search directly — the
// whole point of #1019 is that a downloaded external module now appears in navigation).
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE_URL = process.env["UAT_BASE_URL"] ?? "http://localhost:47102";
const SHOT_DIR =
  "/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-coord-2026-06-30-rfa-fleet/58a78927-385c-4b1d-8fa0-94db20255d6f/scratchpad/devproof";
const OWNER_EMAIL = "uat-owner-1019@example.com";
const OWNER_PASSWORD = "uat-owner-password-1019";
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

/** The dedicated external-module nav section rendered by app-route-metadata's MODULES_SECTION. */
function modulesNavSection(page: Page) {
  return page.locator(".nav-group", {
    has: page.locator(".nav-group__label", { hasText: "Modules" })
  });
}

async function navigateToJobSearchViaNav(page: Page): Promise<void> {
  const section = modulesNavSection(page);
  await section.waitFor({ timeout: 15_000 });
  await shot(page, "06-modules-nav-section");

  const jobSearchLink = section.getByRole("link", { name: "Job Search" });
  await jobSearchLink.waitFor({ timeout: 5_000 });
  await jobSearchLink.click();

  await page.waitForSelector('[data-module="job-search"]', { timeout: 15_000 });
  await page.getByRole("heading", { name: "Job Search" }).waitFor({ timeout: 15_000 });
  await shot(page, "07-job-search-via-nav");
}

export async function run(): Promise<{ needsRestart: boolean }> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await signUpOwner(page);
    await skipOnboardingIfPresent(page);
    await installJobSearch(page);

    // Discovery is captured once at api boot (#996/#860) — a fresh download is on disk but
    // not yet in the active-modules resolver until the api process restarts. The row's own
    // "restart to apply" text (asserted in installJobSearch) is the ground truth for this.
    const row = page.locator("li", { has: page.locator("code", { hasText: "job-search" }) });
    const needsRestart = await row
      .getByText(/restart to apply/i)
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    return { needsRestart };
  } finally {
    await browser.close();
  }
}

// Post-restart resume: sign back in, then reach job-search through the sidebar nav (not a
// direct page.goto) and confirm the page renders.
export async function resumeAfterRestart(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(BASE_URL);
    await page.getByLabel("Email").fill(OWNER_EMAIL);
    await page.getByLabel("Password").fill(OWNER_PASSWORD);
    await page.locator("form.auth-form").getByRole("button", { name: "Sign in" }).click();
    await page.locator("section.auth-panel").waitFor({ state: "hidden", timeout: 15_000 });

    await navigateToJobSearchViaNav(page);
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
