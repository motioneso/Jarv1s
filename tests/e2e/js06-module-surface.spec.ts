// JS-06 (#935) — e2e over the REAL built job-search web bundle (not the inline #916 stub).
// beforeAll rebuilds dist/web/index.js so the spec always exercises current source; every
// scenario mocks REST only (frontend gate — no Postgres, safe alongside other agents).
import { execSync } from "node:child_process";

import { test, expect, type Page } from "@playwright/test";

import { mockApi } from "./mock-api.js";
import { mockExternalWebModuleFromDist, type DistModuleMockOptions } from "./mock-modules.js";

test.beforeAll(() => {
  // One-shot esbuild (<2s). Playwright's cwd is the repo root (config lives there).
  execSync("pnpm build:external:job-search", { stdio: "inherit" });
});

const monitorOne = {
  monitorId: "mon-1",
  adapterId: "greenhouse",
  enabled: true,
  timezone: "America/New_York",
  dueTime: "07:00"
};

const monitorTwo = {
  monitorId: "mon-2",
  adapterId: "lever",
  enabled: true,
  timezone: "America/New_York",
  dueTime: "08:30"
};

// monitor.get detail for any row — a shared fixture is fine because the mock keys by tool name
// only; both rows showing the same cursor timestamps doesn't matter to these assertions.
const monitorDetail = {
  status: "ok",
  cursor: { lastCheckedAt: "2026-07-10T11:00:00.000Z", lastSuccessAt: "2026-07-10T11:00:00.000Z" }
};

async function mountModule(
  page: Page,
  options?: DistModuleMockOptions & { themeActiveId?: string }
): Promise<void> {
  await mockApi(page, {
    authenticated: true,
    // Non-light captures must ALSO tell the API mock (mock-api.ts): the shell's active-theme
    // fetch overrides the localStorage boot seed, so seeding alone snaps back to light.
    themeActiveId: options?.themeActiveId,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });
  // AFTER mockApi — most-recently-registered route wins over its /api/* catch-all 404.
  await mockExternalWebModuleFromDist(page, options);
}

test.describe("JS-06 module surface (real bundle)", () => {
  test("renders real data: onboarding progress and a monitor row with wall-clock + zone", async ({
    page
  }) => {
    await mountModule(page, {
      invokeFixtures: {
        "job-search.monitor.list": { monitors: [monitorOne] },
        "job-search.monitor.get": monitorDetail
      }
    });
    await page.goto("/m/job-search");

    await expect(page.getByRole("heading", { name: "Job Search" })).toBeVisible();
    // Default onboarding fixture: step "profile" with the three resume steps done.
    await expect(page.getByRole("heading", { name: "3 of 6 steps complete" })).toBeVisible();
    // Monitor schedule is the configured wall-clock + IANA zone verbatim (Coordinator ruling:
    // no cross-timezone HH:MM arithmetic).
    await expect(page.getByText("greenhouse — daily at 07:00 · America/New_York")).toBeVisible();
  });

  test("#916 onboarding handoff: editable focused draft, never auto-submitted", async ({
    page
  }) => {
    await mountModule(page);
    // Registered after mockApi/module mocks so this route wins — flags any chat submit.
    let turnPosted = false;
    await page.route("**/api/chat/turn", async (route) => {
      turnPosted = true;
      await route.fulfill({ json: { userMessageId: "u1", assistantMessageId: "a1", reply: "hi" } });
    });

    await page.goto("/m/job-search");

    // Keyboard-activate the module's internal Onboarding tab (a11y: links work via Enter).
    const onboardingTab = page.getByRole("link", { name: "Onboarding" });
    await onboardingTab.focus();
    await onboardingTab.press("Enter");
    await expect(page.getByRole("heading", { name: "Set up your job search" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Onboarding" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    // Keyboard-activate the handoff. Only the onboarding screen is mounted now, so exactly one
    // "Continue with Jarvis" exists.
    const button = page.getByRole("button", { name: "Continue with Jarvis" });
    await button.press("Enter");

    // The composer holds the step draft ("profile" step) as an editable, focused value…
    const composer = page.getByRole("textbox", { name: "Message Jarvis" });
    await expect(composer).toHaveValue(
      "Let's build my job search profile: target titles, skills, locations, and preferences."
    );
    await expect(composer).toBeFocused();
    // …and nothing was sent on the user's behalf (#916 hard requirement).
    expect(turnPosted).toBe(false);
  });

  test("run-now: queued then already-queued, announced politely, no duplicate activation", async ({
    page
  }) => {
    await mountModule(page, {
      invokeFixtures: {
        "job-search.monitor.list": { monitors: [monitorOne, monitorTwo] },
        "job-search.monitor.get": monitorDetail
      }
      // runNowJobIds default ["job-1", null]: first submit queued, second hits the #965
      // dedupe contract (jobId:null) — mock-driven, valid ahead of the host emitting it.
    });
    await page.goto("/m/job-search");
    await page.getByRole("link", { name: "Monitors" }).click();

    const liveRegion = page.locator('[aria-live="polite"][role="status"]');
    const runButtons = page.getByRole("button", { name: "Run now" });
    await expect(runButtons).toHaveCount(2);

    // First monitor: fresh jobId → queued, announced, and the button locks (no re-submit).
    await runButtons.first().click();
    const queued = page.getByRole("button", { name: "Run queued" });
    await expect(queued).toBeVisible();
    await expect(queued).toBeDisabled();
    await expect(liveRegion).toHaveText("Run queued");

    // Second monitor: jobId:null → already queued, same announce + lock behavior.
    await page.getByRole("button", { name: "Run now" }).click();
    const alreadyQueued = page.getByRole("button", { name: "Already queued" });
    await expect(alreadyQueued).toBeVisible();
    await expect(alreadyQueued).toBeDisabled();
    await expect(liveRegion).toHaveText("Already queued");
  });

  test("disabled fails closed on every data route, with no assistant handoff anywhere", async ({
    page
  }) => {
    // 404 on every invoke = tool no longer declared = module disabled/uninstalled server-side;
    // a stale browser session must degrade to the actionless disabled state (spec).
    await mountModule(page, { invokeStatus: 404 });
    await page.goto("/m/job-search");

    const disabledHeading = page.getByRole("heading", { name: "Job Search is turned off" });
    await expect(disabledHeading.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Jarvis" })).toHaveCount(0);

    // Every data-fetching route shows the same fail-closed state. (Opportunities is a static
    // JS-08 shell with no data plane and no actions, so it's covered by the no-handoff check.)
    for (const tab of ["Onboarding", "Profile & resume", "Monitors"]) {
      await page.getByRole("link", { name: tab }).click();
      await expect(disabledHeading.first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue with Jarvis" })).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Opportunities" }).click();
    await expect(page.getByRole("button", { name: "Continue with Jarvis" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run now" })).toHaveCount(0);
  });
});

// Screenshot pass for the Coordinator/Ben design review — saved under test-results/ (gitignored
// CI artifact, never committed). Same viewport as the capture-screens harness.
test.describe("JS-06 screenshots (light/dark)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`overview/onboarding/monitors — ${theme}`, async ({ page }) => {
      if (theme === "dark") {
        // Same boot mechanism as capture-screens-dark: seed the persisted theme before app load.
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("jarvis.theme:v1", "dark");
          } catch {
            /* ignore */
          }
        });
      }
      await mountModule(page, {
        themeActiveId: theme,
        invokeFixtures: {
          "job-search.monitor.list": { monitors: [monitorOne, monitorTwo] },
          "job-search.monitor.get": monitorDetail
        }
      });

      await page.goto("/m/job-search");
      await expect(page.getByRole("heading", { name: "3 of 6 steps complete" })).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/overview-${theme}.png` });

      await page.getByRole("link", { name: "Onboarding" }).click();
      await expect(page.getByRole("heading", { name: "Set up your job search" })).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/onboarding-${theme}.png` });

      await page.getByRole("link", { name: "Monitors" }).click();
      await expect(page.getByRole("button", { name: "Run now" }).first()).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/monitors-${theme}.png` });
    });
  }
});
