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

const onboardingDone = {
  step: "done",
  completed: {
    resume_intake: true,
    resume_critique: true,
    resume_approval: true,
    profile: true,
    sources_schedule: true,
    review_enable: true
  },
  gates: { resumeApproved: true, profileApproved: true, monitorEnabled: true }
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
  await mockExternalWebModuleFromDist(page, {
    ...options,
    invokeFixtures: {
      "job-search.onboarding.get-state": onboardingDone,
      ...options?.invokeFixtures
    }
  });
}

test.describe("JS-06 module surface (real bundle)", () => {
  test("renders the approved tab shell and a monitor row with wall-clock + zone", async ({
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
    for (const label of ["Overview", "Matches", "Monitors", "Profile"]) {
      await expect(page.getByRole("link", { name: label })).toBeVisible();
    }
    // Monitor schedule is the configured wall-clock + IANA zone verbatim (Coordinator ruling:
    // no cross-timezone HH:MM arithmetic).
    await expect(page.getByText("greenhouse — daily at 07:00 · America/New_York")).toBeVisible();
  });

  test("first-run state replaces every tab with the Lane E placeholder", async ({ page }) => {
    await mountModule(page, {
      invokeFixtures: {
        "job-search.onboarding.get-state": {
          step: "profile",
          completed: { resume_intake: true, resume_critique: true, resume_approval: true },
          gates: { resumeApproved: true, profileApproved: false, monitorEnabled: false }
        }
      }
    });

    await page.goto("/m/job-search");

    await expect(page.getByRole("heading", { name: "Setting up your job search" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
    for (const label of ["Overview", "Matches", "Monitors", "Profile"]) {
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    }
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

    const disabledHeading = page.getByRole("heading", { name: "Job Search is turned off" });
    for (const path of ["", "/matches", "/monitors", "/profile"]) {
      await page.goto(`/m/job-search${path}`);
      await expect(disabledHeading.first()).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Run now" })).toHaveCount(0);
    }
  });
});

// Screenshot pass for the Coordinator/Ben design review — saved under test-results/ (gitignored
// CI artifact, never committed). Same viewport as the capture-screens harness.
test.describe("JS-06 screenshots (light/dark)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`overview/monitors — ${theme}`, async ({ page }) => {
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
      await expect(page.getByRole("heading", { name: "Job Search" })).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/overview-${theme}.png` });

      await page.getByRole("link", { name: "Monitors" }).click();
      await expect(page.getByRole("button", { name: "Run now" }).first()).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/monitors-${theme}.png` });
    });
  }
});
