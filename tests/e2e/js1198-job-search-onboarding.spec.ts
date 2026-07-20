// #1198 — mocked browser coverage over the guided onboarding flow (real built
// Job Search bundle). REST + SSE are the only mock seams; no database.
import { execSync } from "node:child_process";

import { test, expect, type Page, type Route } from "@playwright/test";

import { mockApi } from "./mock-api.js";
import { mockExternalWebModuleFromDist, type DistModuleMockOptions } from "./mock-modules.js";

test.beforeAll(() => {
  execSync("pnpm build:external:job-search", { stdio: "inherit" });
});

const resumeIntakeState = {
  step: "resume_intake",
  completed: {},
  gates: { resumeApproved: false, profileApproved: false, monitorEnabled: false }
};

const dealbreakersState = {
  step: "profile",
  completed: {
    resume_intake: true,
    resume_critique: true,
    resume_approval: true,
    titles: true,
    comp: true,
    workmode: true,
    locations: true
  },
  gates: { resumeApproved: true, profileApproved: false, monitorEnabled: false }
};

const sourcesScheduleState = {
  step: "sources_schedule",
  completed: {
    resume_intake: true,
    resume_critique: true,
    resume_approval: true,
    profile: true
  },
  gates: { resumeApproved: true, profileApproved: true, monitorEnabled: false }
};

const doneState = {
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

type ProfileFixture = {
  readonly status: string;
  readonly active: {
    readonly revisionId: string;
    readonly createdAt: string;
    readonly provenance: string;
    readonly fields: {
      readonly targetTitles: string[];
      readonly compensation: { readonly currency: string; readonly minimum: number };
      readonly remotePreference: string[];
      readonly locations: string[];
    };
  } | null;
  readonly draftRevisionIds: string[];
};

const emptyProfile: ProfileFixture = { status: "ok", active: null, draftRevisionIds: [] };

const dealbreakersProfile: ProfileFixture = {
  status: "ok",
  active: {
    revisionId: "profile-1",
    createdAt: "2026-07-10T12:00:00.000Z",
    provenance: "user",
    fields: {
      targetTitles: ["Staff Product Designer"],
      compensation: { currency: "USD", minimum: 195000 },
      remotePreference: ["remote"],
      locations: ["Remote — US"]
    }
  },
  draftRevisionIds: []
};

const resumeFixture = {
  status: "ok",
  revisionId: "resume-1",
  kind: "critique",
  createdAt: "2026-07-09T12:00:00.000Z",
  critiqueSummary: "Strong systems narrative.",
  evidence: [{ claimText: "Design system ownership" }],
  content: "PRIVATE RESUME BODY MUST NOT RENDER"
};

const sourcesFixture = {
  status: "ok",
  sources: [
    {
      adapterId: "greenhouse",
      displayName: "Greenhouse",
      enabled: true,
      configHint: "board token"
    },
    { adapterId: "lever", displayName: "Lever", enabled: true, configHint: "board token" },
    { adapterId: "ashby", displayName: "Ashby", enabled: true, configHint: "board token" },
    { adapterId: "workday", displayName: "Workday", enabled: false, configHint: "unsupported" }
  ]
};

function fixturesFor(
  onboarding: Record<string, unknown>,
  profile: ProfileFixture = emptyProfile
): Record<string, Record<string, unknown>> {
  return {
    "job-search.onboarding.get-state": onboarding,
    "job-search.profile.get": profile,
    "job-search.resume.get": resumeFixture,
    "job-search.sources.list": sourcesFixture,
    "job-search.monitor.list": { monitors: [] }
  };
}

async function mountJobSearch(
  page: Page,
  options?: DistModuleMockOptions & { seedCounter?: { count: number } }
): Promise<void> {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });
  if (options?.seedCounter) {
    const counter = options.seedCounter;
    await page.route("**/api/chat/module-onboarding", async (route) => {
      counter.count += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    });
  }
  await mockExternalWebModuleFromDist(page, options);
}

type CapturedTurn = {
  readonly text: string;
  readonly attachmentIds?: readonly string[];
  readonly controlContext?: unknown;
};

async function captureTurns(page: Page): Promise<CapturedTurn[]> {
  const turns: CapturedTurn[] = [];
  await page.route("**/api/chat/turn", async (route) => {
    const body = route.request().postDataJSON() as CapturedTurn;
    turns.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: "ok", userMessageId: "u-1", assistantMessageId: "a-1" })
    });
  });
  return turns;
}

async function mockAttachments(
  page: Page,
  opts?: { readonly failNext?: boolean }
): Promise<{ readonly uploads: { readonly name: string }[] }> {
  const uploads: { readonly name: string }[] = [];
  await page.route("**/api/chat/attachments", async (route: Route) => {
    if (opts?.failNext) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"boom"}'
      });
      return;
    }
    const name = decodeURIComponent(
      route.request().headers()["x-jarvis-file-name"] ?? "resume.pdf"
    );
    uploads.push({ name });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        attachment: { id: "attach-1", fileName: name, mimeType: "application/pdf", sizeBytes: 1000 }
      })
    });
  });
  return { uploads };
}

test.describe("JS-1198 guided onboarding (real bundle)", () => {
  test("non-done state renders onboarding with no section tabs, seeds onboarding", async ({
    page
  }) => {
    const seedCounter = { count: 0 };
    await mountJobSearch(page, {
      seedCounter,
      invokeFixtures: fixturesFor(resumeIntakeState)
    });
    await page.goto("/m/job-search");

    await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
    await expect(page.getByText("Let's start with your resume.")).toBeVisible();
    // apps/web mounts under React StrictMode (main.tsx) — the mount-once effect legitimately
    // double-invokes in dev, so seedOnboarding fires twice per real mount, not once.
    expect(seedCounter.count).toBeGreaterThanOrEqual(1);
  });

  test("invalid file type and oversized file never upload", async ({ page }) => {
    await mountJobSearch(page, { invokeFixtures: fixturesFor(resumeIntakeState) });
    const { uploads } = await mockAttachments(page);
    await page.goto("/m/job-search");

    const fileInput = page.locator(".jsm-dropzone input[type='file']");
    await fileInput.setInputFiles({
      name: "resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a resume")
    });
    await expect(page.getByText("I can only read PDF or DOCX resumes.")).toBeVisible();

    await fileInput.setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1)
    });
    await expect(page.getByText("That file's over 5 MB")).toBeVisible();

    expect(uploads).toHaveLength(0);
  });

  test("valid PDF upload sends attachment id, filename text, and control context", async ({
    page
  }) => {
    await mountJobSearch(page, { invokeFixtures: fixturesFor(resumeIntakeState) });
    await mockAttachments(page);
    const turns = await captureTurns(page);
    await page.goto("/m/job-search");

    await page.locator(".jsm-dropzone input[type='file']").setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4")
    });

    await expect
      .poll(() => turns)
      .toEqual([
        {
          text: "resume.pdf",
          attachmentIds: ["attach-1"],
          controlContext: { step: "resume_intake", action: "upload", fileName: "resume.pdf" }
        }
      ]);
  });

  test("upload failure re-arms upload and paste fallback sends manual resume text via turn", async ({
    page
  }) => {
    await mountJobSearch(page, { invokeFixtures: fixturesFor(resumeIntakeState) });
    await mockAttachments(page, { failNext: true });
    const turns = await captureTurns(page);
    await page.goto("/m/job-search");

    await page.locator(".jsm-dropzone input[type='file']").setInputFiles({
      name: "resume.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4")
    });
    await expect(page.getByText("I couldn't read that file")).toBeVisible();

    // Upload control must still be present (re-armed), not replaced by an error-only state.
    await expect(page.locator(".jsm-dropzone input[type='file']")).toBeAttached();

    await page.getByLabel("Paste resume text instead").fill("Ten years of platform engineering.");
    await page.getByRole("button", { name: "Use pasted resume" }).click();

    await expect
      .poll(() => turns)
      .toEqual([
        {
          text: "Ten years of platform engineering.",
          controlContext: { step: "resume_intake", action: "paste" }
        }
      ]);
  });

  test("every scripted question/control/copy appears in order up to dealbreakers", async ({
    page
  }) => {
    await mountJobSearch(page, {
      invokeFixtures: fixturesFor(dealbreakersState, dealbreakersProfile)
    });
    await page.goto("/m/job-search");

    const texts = [
      "I'll get your job search set up",
      "Let's start with your resume.",
      "Strong systems narrative.",
      "Good. From your resume, here are the titles",
      "What's your base comp floor?",
      "And how do you want to work?",
      "Where should I look?",
      "Last thing about the role itself"
    ];
    let previous = 0;
    for (const fragment of texts) {
      const locator = page.getByText(fragment, { exact: false }).first();
      await expect(locator).toBeVisible();
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.y ?? 0).toBeGreaterThanOrEqual(previous);
      previous = box?.y ?? previous;
    }
    await expect(page.getByRole("button", { name: "Set dealbreakers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "None of these" })).toBeVisible();
  });

  test("reload restores the first unanswered profile sub-step and buffered comp", async ({
    page
  }) => {
    await mountJobSearch(page, { invokeFixtures: fixturesFor(dealbreakersState, emptyProfile) });
    await captureTurns(page);
    await page.goto("/m/job-search");

    await page.getByRole("button", { name: "Track these titles" }).click();
    await page.getByRole("button", { name: "$195k" }).click();
    await page.getByRole("button", { name: "Set comp floor" }).click();
    await expect(page.getByText("And how do you want to work?")).toBeVisible();

    await page.reload();

    await expect(page.getByText("And how do you want to work?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Track these titles" })).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("jobsearch:onboarding:profile:user-1") ?? "{}")
      )
    ).toMatchObject({
      compensation: { currency: "USD", minimum: 195000 }
    });
  });

  test("denied profile approval retains Dealbreakers control and retry copy", async ({ page }) => {
    await mountJobSearch(page, {
      invokeFixtures: fixturesFor(dealbreakersState, dealbreakersProfile)
    });
    const turns = await captureTurns(page);

    const actionRequest = JSON.stringify({
      kind: "action_request",
      text: "Confirm dealbreakers",
      messageId: "msg-1",
      actionRequestId: "action-1",
      toolName: "job-search.profile.approve"
    });
    const actionResult = JSON.stringify({
      kind: "action_result",
      text: "That didn't go through — let's try that again.",
      actionRequestId: "action-1",
      outcome: "denied"
    });
    let conn = 0;
    let releaseWave2: () => void = () => {};
    const wave2 = new Promise<void>((resolve) => {
      releaseWave2 = resolve;
    });
    await page.route("**/api/chat/stream", async (route) => {
      conn += 1;
      if (conn === 1) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache" },
          body: `retry: 50\n\ndata: ${actionRequest}\n\n`
        });
        return;
      }
      if (conn === 2) {
        await wave2;
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache" },
          body: `data: ${actionResult}\n\n`
        });
        return;
      }
      // conn >= 3: leave pending, no further reconnect churn.
    });
    await page.goto("/m/job-search");
    // waitForRequest must be armed before the click: the mocked POST resolves fast enough
    // that click-then-wait can miss it entirely (request already finished by the time the
    // wait call registers its listener).
    await Promise.all([
      page.waitForRequest("**/api/chat/turn"),
      page.getByRole("button", { name: "None of these" }).click()
    ]);
    releaseWave2();

    // Denial text rides an action_result record, which the chat drawer always groups into a
    // collapsed "Behind the scenes" disclosure (apps/web/src/chat/message-row.tsx ActivityPeek)
    // rather than a standalone bubble — expand it before asserting visibility.
    await page.getByText("Behind the scenes").click();
    await expect(page.getByText("That didn't go through — let's try that again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set dealbreakers" })).toBeVisible();
    expect(turns).toHaveLength(1);
  });

  test("executed action_result advances the phase via re-bootstrap, not the SSE record alone", async ({
    page
  }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockExternalWebModuleFromDist(page, {
      invokeFixtures: fixturesFor(dealbreakersState, emptyProfile)
    });

    // Overrides mockExternalWebModuleFromDist's static invoke route (registered after it, so
    // Playwright matches this one first): onboarding.get-state flips to sources_schedule only
    // once `advanced` is set — i.e. only after the executed action_result's onAdvance callback
    // re-bootstraps, proving the phase never moves off the SSE record's outcome alone.
    let advanced = false;
    await page.route("**/api/ai/assistant-tools/*/invoke*", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const match = /\/assistant-tools\/([^/]+)\/invoke$/.exec(pathname);
      const tool = decodeURIComponent(match?.[1] ?? "");
      if (tool === "job-search.onboarding.get-state") {
        await route.fulfill({
          json: {
            invocation: {
              status: "succeeded",
              result: advanced ? sourcesScheduleState : dealbreakersState
            }
          }
        });
        return;
      }
      const fixtures = fixturesFor(dealbreakersState, emptyProfile);
      await route.fulfill({
        json: { invocation: { status: "succeeded", result: fixtures[tool] ?? {} } }
      });
    });

    const turns = await captureTurns(page);
    const actionRequest = JSON.stringify({
      kind: "action_request",
      text: "Confirm dealbreakers",
      messageId: "msg-1",
      actionRequestId: "action-1",
      toolName: "job-search.profile.approve"
    });
    const actionResult = JSON.stringify({
      kind: "action_result",
      text: "Dealbreakers saved.",
      actionRequestId: "action-1",
      outcome: "executed"
    });
    let conn = 0;
    let releaseWave2: () => void = () => {};
    const wave2 = new Promise<void>((resolve) => {
      releaseWave2 = resolve;
    });
    await page.route("**/api/chat/stream", async (route) => {
      conn += 1;
      if (conn === 1) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache" },
          body: `retry: 50\n\ndata: ${actionRequest}\n\n`
        });
        return;
      }
      if (conn === 2) {
        await wave2;
        advanced = true;
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: { "cache-control": "no-cache" },
          body: `data: ${actionResult}\n\n`
        });
        return;
      }
      // conn >= 3: leave pending, no further reconnect churn.
    });
    await page.addInitScript(() => {
      sessionStorage.setItem(
        "jobsearch:onboarding:profile:user-1",
        JSON.stringify({
          targetTitles: ["Staff Product Designer"],
          compensation: { currency: "USD", minimum: 195000 },
          remotePreference: ["Remote-first"],
          locations: ["Remote — US"]
        })
      );
    });

    await page.goto("/m/job-search");
    // waitForRequest must be armed before the click: the mocked POST resolves fast enough
    // that click-then-wait can miss it entirely (request already finished by the time the
    // wait call registers its listener).
    await Promise.all([
      page.waitForRequest("**/api/chat/turn"),
      page.getByRole("button", { name: "Set dealbreakers" }).click()
    ]);

    // Before the executed action_result arrives, the phase must NOT have advanced yet — the
    // dealbreakers control is still the active control (proves advance isn't SSE-record-driven).
    await expect(page.getByRole("button", { name: "Set dealbreakers" })).toBeVisible();

    releaseWave2();

    await expect(page.getByText("Workday")).toHaveCount(0); // sources_schedule control renders
    await expect(page.getByRole("button", { name: /Watch these \d boards/ })).toBeVisible();
    expect(
      await page.evaluate(() => sessionStorage.getItem("jobsearch:onboarding:profile:user-1"))
    ).toBeNull();
    expect(turns).toHaveLength(1);
  });

  test("boards require valid URL/token and create one combined turn with no Workday", async ({
    page
  }) => {
    await mountJobSearch(page, {
      invokeFixtures: fixturesFor(sourcesScheduleState, dealbreakersProfile)
    });
    const turns = await captureTurns(page);
    await page.goto("/m/job-search");

    await expect(page.getByText("Workday")).toHaveCount(0);
    const submit = page.getByRole("button", { name: /Watch these \d boards/ });
    await expect(submit).toBeDisabled();

    // All enabled sources default checked; `ready` requires every checked source to have a
    // valid query, so leaving Lever/Ashby checked with an empty config would keep the button
    // disabled even after Greenhouse is filled — uncheck them to isolate Greenhouse.
    await page.getByRole("checkbox", { name: "Lever board token" }).uncheck();
    await page.getByRole("checkbox", { name: "Ashby board token" }).uncheck();
    await page.getByLabel("Greenhouse board token or URL").fill("acme");
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect.poll(() => turns).toHaveLength(1);
    expect(turns[0]?.controlContext).toMatchObject({
      step: "sources_schedule",
      action: "schedule"
    });
  });

  test("done onboarding step renders the full module tabs directly", async ({ page }) => {
    // RootView (root.tsx) renders JobsOnboarding only while onboardingStep !== "done"; once
    // the backend reports "done" it renders the tabbed dashboard immediately — JobsOnboarding's
    // own internal "done"/Summary phase is unreachable through this route and is not under test
    // here (see relay escalation for this run).
    await mountJobSearch(page, { invokeFixtures: fixturesFor(doneState, dealbreakersProfile) });
    await page.goto("/m/job-search");

    await expect(page.getByRole("navigation", { name: "Job Search sections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Job Search" })).toBeVisible();
  });

  test("authored controls expose accessible roles/labels (no a11y violations proxy)", async ({
    page
  }) => {
    await mountJobSearch(page, {
      invokeFixtures: fixturesFor(dealbreakersState, dealbreakersProfile)
    });
    await page.goto("/m/job-search");

    await expect(page.getByRole("button", { name: "Set dealbreakers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "None of these" })).toBeVisible();
    for (const chip of ["On-site 5 days/week", "Below comp floor", "No equity"]) {
      await expect(page.getByRole("button", { name: chip })).toBeVisible();
    }
  });
});
