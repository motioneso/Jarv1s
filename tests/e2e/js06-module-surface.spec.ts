// #1197 — mocked browser coverage over the REAL built Job Search bundle.
// REST is the only mock seam; no database or shared e2e helper changes.
import { execSync } from "node:child_process";

import { test, expect, type Page } from "@playwright/test";

import { mockApi } from "./mock-api.js";
import { mockExternalWebModuleFromDist, type DistModuleMockOptions } from "./mock-modules.js";

test.beforeAll(() => {
  execSync("pnpm build:external:job-search", { stdio: "inherit" });
});

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

const monitorDetail = {
  status: "ok",
  query: "Product Design · Remote US",
  cursor: {
    lastCheckedAt: "2026-07-10T11:00:00.000Z",
    lastSuccessAt: "2026-07-10T11:00:00.000Z"
  }
};

const sources = {
  status: "ok",
  sources: [
    { adapterId: "greenhouse", displayName: "Greenhouse", enabled: true, status: "allowed" },
    { adapterId: "lever", displayName: "Lever", enabled: true, status: "allowed" },
    { adapterId: "ashby", displayName: "Ashby", enabled: true, status: "allowed" }
  ]
};

const matches = {
  status: "ok",
  view: "new",
  total: 2,
  opportunities: [
    {
      identityHash: "hash-aaa",
      status: "new",
      title: "Platform Engineer",
      company: "Nimbus Labs",
      location: "Remote · US",
      workMode: "remote",
      source: "greenhouse",
      publishedAt: "2026-07-09T08:00:00.000Z",
      freshness: "fresh",
      fitBand: "strong",
      confidence: "high",
      topEvidence: "Six years of platform work match the posting.",
      topGap: "Kubernetes depth is not yet confirmed."
    },
    {
      identityHash: "hash-bbb",
      status: "new",
      title: "Design Engineer",
      company: "Northstar",
      source: "lever",
      firstSeenAt: "2026-07-10T08:00:00.000Z",
      freshness: "fresh",
      evaluationPending: true
    }
  ]
};

const matchDetail = {
  status: "ok",
  opportunity: {
    identityHash: "hash-aaa",
    status: "new",
    firstSeenAt: "2026-07-10T07:00:00.000Z",
    freshness: "fresh",
    posting: {
      title: "Platform Engineer",
      company: "Nimbus Labs",
      location: "Remote · US",
      url: "https://boards.example.com/jobs/123",
      workMode: "remote",
      employmentType: "full-time",
      compensation: "$210k–$255k",
      description: "Own the platform experience and extend the design system."
    },
    evaluation: {
      fitBand: "strong",
      recommendation: "apply",
      postingConfidence: "high",
      overallConfidence: "medium",
      summary: "Strong platform and systems match.",
      evidence: [
        {
          requirement: "Systems ownership",
          evidence: "Built and shipped a cross-product design system",
          source: "resume"
        }
      ],
      blockers: [],
      gaps: ["Kubernetes depth is not yet confirmed"],
      unknowns: ["Team size"],
      preferenceMatches: ["Remote-first"],
      preferenceConflicts: [],
      outdated: false,
      inputs: {
        opportunityContentHash: "content-1",
        profileRevisionId: "profile-1",
        resumeRevisionId: "resume-1"
      }
    }
  }
};

const profile = {
  status: "ok",
  active: {
    revisionId: "profile-1",
    createdAt: "2026-07-10T12:00:00.000Z",
    provenance: "user",
    fields: {
      targetTitles: ["Staff Product Designer", "Design Engineer"],
      seniority: "Staff / Principal",
      compensation: { currency: "USD", minimum: 195000 },
      locations: ["Remote — US", "San Francisco, CA"],
      remotePreference: ["remote", "hybrid"],
      dealbreakers: ["On-site 5 days/week", "No equity"]
    }
  },
  draftRevisionIds: []
};

const resume = {
  status: "ok",
  revisionId: "resume-12345678",
  kind: "critique",
  createdAt: "2026-07-09T12:00:00.000Z",
  critiqueSummary: "Strong systems narrative; three metrics still need a source.",
  evidence: [{ claimText: "Design system ownership" }],
  content: "PRIVATE RESUME BODY MUST NOT RENDER"
};

const defaultFixtures = {
  "job-search.onboarding.get-state": onboardingDone,
  "job-search.monitor.list": { status: "ok", monitors: [monitorOne, monitorTwo] },
  "job-search.monitor.get": monitorDetail,
  "job-search.sources.list": sources,
  "job-search.opportunities.list": matches,
  "job-search.opportunities.get": matchDetail,
  "job-search.profile.get": profile,
  "job-search.resume.get": resume
};

async function mountModule(
  page: Page,
  options?: DistModuleMockOptions & { themeActiveId?: string }
): Promise<void> {
  await mockApi(page, {
    authenticated: true,
    themeActiveId: options?.themeActiveId,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });
  await mockExternalWebModuleFromDist(page, {
    ...options,
    invokeFixtures: {
      ...defaultFixtures,
      ...options?.invokeFixtures
    }
  });
}

test.describe("JS-06 Park Press screens (real bundle)", () => {
  test("Overview renders readiness, checkpoints, monitor health, and final tabs", async ({
    page
  }) => {
    await mountModule(page);
    await page.goto("/m/job-search");

    await expect(page.getByRole("heading", { name: "Job Search" })).toBeVisible();
    for (const label of ["Overview", "Matches", "Monitors", "Profile"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Almost ready to go" })).toBeVisible();
    await expect(page.getByText("Setup checkpoints")).toBeVisible();
    await expect(page.getByText("Monitor health")).toBeVisible();
    await expect(page.getByText("daily at 07:00 · America/New_York")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review new matches" })).toHaveAttribute(
      "href",
      "/m/job-search/matches"
    );
  });

  test("Matches renders scored cards, safe detail, and assistant-confirmed decisions", async ({
    page
  }) => {
    await mountModule(page);
    await page.goto("/m/job-search/matches");

    await expect(page.getByRole("heading", { name: "2 new" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Match buckets" })).toBeVisible();
    await expect(page.getByText("Strong fit").first()).toBeVisible();
    await page.getByRole("link", { name: "Platform Engineer" }).click();

    await expect(page).toHaveURL(/\/m\/job-search\/matches\/new\/hash-aaa$/);
    await expect(page.getByRole("heading", { name: "Platform Engineer" })).toBeVisible();
    await expect(page.getByText("Jarvis evaluation")).toBeVisible();
    await expect(page.getByText("Strong platform and systems match.")).toBeVisible();
    await expect(page.getByRole("link", { name: "View original posting" })).toHaveAttribute(
      "href",
      "https://boards.example.com/jobs/123"
    );

    await page.getByRole("button", { name: "Save" }).click();
    const composer = page.getByRole("textbox", { name: "Message Jarvis" });
    await expect(composer).toHaveValue(
      "Please help me save job opportunity hash-aaa and confirm the decision."
    );
    await expect(composer).toBeFocused();
  });

  test("Monitors renders only registry-backed boards and announces run-now outcomes", async ({
    page
  }) => {
    await mountModule(page);
    await page.goto("/m/job-search/monitors");

    await expect(page.getByRole("heading", { name: "Monitors" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Greenhouse" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lever" })).toBeVisible();
    await expect(page.getByText("Workday")).toHaveCount(0);
    await expect(page.getByText("Product Design · Remote US").first()).toBeVisible();

    const liveRegion = page.locator('[aria-live="polite"][role="status"]');
    const runButtons = page.getByRole("button", { name: "Run now" });
    await expect(runButtons).toHaveCount(2);
    await runButtons.first().click();
    await expect(page.getByRole("button", { name: "Run queued" })).toBeDisabled();
    await expect(liveRegion).toHaveText("Run queued");
    await page.getByRole("button", { name: "Run now" }).click();
    await expect(page.getByRole("button", { name: "Already queued" })).toBeDisabled();
    await expect(liveRegion).toHaveText("Already queued");
  });

  test("Profile renders approved metadata and routes edits to Jarvis without resume content", async ({
    page
  }) => {
    await mountModule(page);
    await page.goto("/m/job-search/profile");

    await expect(page.getByRole("heading", { name: "Profile & resume" })).toBeVisible();
    await expect(page.getByText("Staff Product Designer")).toBeVisible();
    await expect(page.getByText("USD 195,000")).toBeVisible();
    await expect(page.getByText("On-site 5 days/week")).toBeVisible();
    await expect(page.getByText("PRIVATE RESUME BODY MUST NOT RENDER")).toHaveCount(0);

    await page.getByRole("button", { name: "Update with Jarvis" }).click();
    const composer = page.getByRole("textbox", { name: "Message Jarvis" });
    await expect(composer).toHaveValue(
      "Let's update my job search profile. Show me the proposed revision before approval."
    );
    await expect(composer).toBeFocused();
  });

  test("first-run state still replaces every tab with the Lane E placeholder", async ({ page }) => {
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

    await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set dealbreakers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "None of these" })).toBeVisible();
  });

  test("retired opportunities paths no longer alias to Matches", async ({ page }) => {
    await mountModule(page);
    await page.goto("/m/job-search/opportunities/new/hash-aaa");

    await expect(page.getByRole("heading", { name: "Almost ready to go" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Match buckets" })).toHaveCount(0);
    await expect(page.locator('a[href*="/opportunities"]')).toHaveCount(0);
  });

  test("disabled fails closed on every final data route", async ({ page }) => {
    await mountModule(page, { invokeStatus: 404 });
    const disabled = page.getByRole("heading", { name: "Job Search is turned off" });
    for (const path of ["", "/matches", "/monitors", "/profile"]) {
      await page.goto(`/m/job-search${path}`);
      await expect(disabled.first()).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
    }
  });
});

test.describe("JS-06 screen screenshots (light/dark)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const theme of ["light", "dark"] as const) {
    test(`all four screens — ${theme}`, async ({ page }) => {
      if (theme === "dark") {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("jarvis.theme:v1", "dark");
          } catch {
            // Storage can be unavailable in hardened browser contexts.
          }
        });
      }
      await mountModule(page, { themeActiveId: theme });

      await page.goto("/m/job-search");
      await expect(page.getByRole("heading", { name: "Almost ready to go" })).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/overview-${theme}.png` });

      await page.goto("/m/job-search/matches");
      await expect(page.getByRole("heading", { name: "2 new" })).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/matches-${theme}.png` });

      await page.goto("/m/job-search/monitors");
      await expect(page.getByRole("button", { name: "Run now" }).first()).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/monitors-${theme}.png` });

      await page.goto("/m/job-search/profile");
      await expect(page.getByRole("heading", { name: "Profile & resume" })).toBeVisible();
      await page.screenshot({ path: `test-results/js06-screens/profile-${theme}.png` });
    });
  }
});
