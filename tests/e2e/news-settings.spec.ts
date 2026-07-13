import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api.js";

// #990: local stateful mock for News Settings — proves the described-topic add/edit/remove
// round-trip through the real PATCH client wrapper (Task 1) and the extracted DescribeTopics
// component (Task 3). Deliberately not a shared tests/e2e/mock-*.ts helper (spec is explicit
// this stays local to this file). No live web-search/model/RSS/worker.

const NEWS_MODULE = {
  id: "news",
  name: "News",
  version: "0.1.0",
  lifecycle: "user-toggleable" as const,
  navigation: [{ id: "news", label: "News", path: "/news", icon: "newspaper", order: 34 }],
  settings: []
};

test.beforeEach(async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });

  await page.route("**/api/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: [NEWS_MODULE] })
    })
  );
  await page.route("**/api/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            ...NEWS_MODULE,
            required: false,
            supportsUserDisable: true,
            instanceDisabled: false,
            userDisabled: false,
            active: true
          }
        ]
      })
    })
  );

  await page.route("**/api/news/catalog", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sources: [
          {
            sourceKey: "bbc",
            label: "BBC News",
            homepageUrl: "https://www.bbc.com/news",
            defaultEnabled: true,
            topics: ["world"]
          }
        ],
        topics: [{ topicKey: "world", label: "World" }]
      })
    })
  );
  await page.route("**/api/news/prefs", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ prefs: [] })
    })
  );

  let customTopics: Array<{
    id: string;
    label: string;
    guidance: string | null;
    validationStatus: "approved" | "needs_revalidation" | "rejected";
    createdAt: string;
  }> = [];

  await page.route("**/api/news/personalization", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics,
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    })
  );

  await page.route("**/api/news/topics", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { label: string; guidance?: string };
    const topic = {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      label: body.label,
      guidance: body.guidance ?? null,
      validationStatus: "approved" as const,
      createdAt: "2026-07-12T00:00:00.000Z"
    };
    customTopics = [...customTopics, topic];
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ topic })
    });
  });

  await page.route("**/api/news/topics/*", (route) => {
    const method = route.request().method();
    const id = route.request().url().split("/").pop();
    if (method === "PATCH") {
      const body = route.request().postDataJSON() as { label?: string; guidance?: string };
      customTopics = customTopics.map((topic) =>
        topic.id === id
          ? {
              ...topic,
              label: body.label ?? topic.label,
              guidance: body.guidance ?? topic.guidance
            }
          : topic
      );
      const updated = customTopics.find((topic) => topic.id === id)!;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ topic: updated })
      });
    }
    if (method === "DELETE") {
      customTopics = customTopics.filter((topic) => topic.id !== id);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deleted: true })
      });
    }
    return route.continue();
  });

  await page.route("**/api/news/revalidation", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ queued: true })
    })
  );
});

test("described topics: empty state, create via Enter, edit, and remove", async ({ page }) => {
  await page.goto("/settings?section=modules&module=news");
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();
  await expect(page.getByText("Topics across the web")).toBeVisible();
  await expect(page.getByText("News still uses your selected publications.")).toBeVisible();

  // Create via Enter from the label input (no explicit button click).
  const labelInput = page.getByLabel("Topic in your own words");
  const guidanceInput = page.getByLabel("Optional guidance — what to include or leave out");
  await labelInput.fill("Watches");
  await guidanceInput.fill("not smartwatches");
  const [createRequest] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/news/topics") && r.method() === "POST"),
    labelInput.press("Enter")
  ]);
  expect(createRequest.postDataJSON()).toEqual({ label: "Watches", guidance: "not smartwatches" });
  await expect(page.getByRole("status")).toContainText("Topic added");
  await expect(page.getByText("Watches", { exact: true })).toBeVisible();
  await expect(page.getByText("not smartwatches", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const savedGuidance = page.getByText("not smartwatches", { exact: true });
  await expect(savedGuidance).toBeVisible();
  expect(
    await savedGuidance.evaluate((node) => ({
      overflow: getComputedStyle(node).overflow,
      whiteSpace: getComputedStyle(node).whiteSpace
    }))
  ).toEqual({ overflow: "visible", whiteSpace: "normal" });
  await expect(page.getByRole("button", { name: "Edit Watches" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Watches" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Edit loads the form and PATCHes on save.
  await page.getByRole("button", { name: "Edit Watches" }).click();
  await expect(labelInput).toHaveValue("Watches");
  await expect(guidanceInput).toHaveValue("not smartwatches");
  await guidanceInput.fill("mechanical only");
  const [updateRequest] = await Promise.all([
    page.waitForRequest((r) => /\/api\/news\/topics\/.+/.test(r.url()) && r.method() === "PATCH"),
    page.getByRole("button", { name: "Save changes" }).click()
  ]);
  expect(updateRequest.postDataJSON()).toMatchObject({ guidance: "mechanical only" });
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(page.getByText("mechanical only")).toBeVisible();

  // Remove returns to the honest empty state.
  const [deleteRequest] = await Promise.all([
    page.waitForRequest((r) => /\/api\/news\/topics\/.+/.test(r.url()) && r.method() === "DELETE"),
    page.getByRole("button", { name: "Remove Watches" }).click()
  ]);
  expect(deleteRequest.method()).toBe("DELETE");
  await expect(page.getByRole("status")).toContainText("Topic removed");
  await expect(page.getByText("News still uses your selected publications.")).toBeVisible();
});

test("topic success waits for the refreshed row before announcing completion", async ({ page }) => {
  let topicCreated = false;
  let releaseRefetch!: () => void;
  let markRefetchStarted!: () => void;
  const refetchGate = new Promise<void>((resolve) => {
    releaseRefetch = resolve;
  });
  const refetchStarted = new Promise<void>((resolve) => {
    markRefetchStarted = resolve;
  });

  await page.route("**/api/news/personalization", async (route) => {
    if (topicCreated) {
      markRefetchStarted();
      await refetchGate;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics: topicCreated
          ? [
              {
                id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                label: "Watches",
                guidance: "mechanical only",
                validationStatus: "approved",
                createdAt: "2026-07-12T00:00:00.000Z"
              }
            ]
          : [],
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    });
  });
  await page.route("**/api/news/topics", (route) => {
    topicCreated = true;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        topic: {
          id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
          label: "Watches",
          guidance: "mechanical only",
          validationStatus: "approved",
          createdAt: "2026-07-12T00:00:00.000Z"
        }
      })
    });
  });

  await page.goto("/settings?section=modules&module=news");
  const labelInput = page.getByLabel("Topic in your own words");
  await labelInput.fill("Watches");
  await page.getByLabel("Optional guidance — what to include or leave out").fill("mechanical only");
  await labelInput.press("Enter");
  await refetchStarted;
  await expect(page.getByRole("status")).toContainText("Checking topic…");
  await expect(page.getByText("Topic added", { exact: true })).toHaveCount(0);

  releaseRefetch();
  await expect(page.getByText("Watches", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Topic added");
});

test("cancel returns to add mode without writing, and validation failure keeps input", async ({
  page
}) => {
  await page.route("**/api/news/personalization", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics: [
          {
            id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            label: "Politics",
            guidance: null,
            validationStatus: "approved",
            createdAt: "2026-07-12T00:00:00.000Z"
          }
        ],
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    })
  );
  await page.route("**/api/news/topics", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ message: "Topic is not allowed" })
    });
  });

  await page.goto("/settings?section=modules&module=news");
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();

  // Cancel: edit loads the form, Cancel reverts without a write.
  await page.getByRole("button", { name: "Edit Politics" }).click();
  const labelInput = page.getByLabel("Topic in your own words");
  await expect(labelInput).toHaveValue("Politics");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(labelInput).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  // Validation failure: input is retained and the alert is actionable, not raw model output.
  await labelInput.fill("Banned topic");
  await labelInput.press("Enter");
  await expect(page.getByRole("alert")).toContainText("content policy");
  await expect(labelInput).toHaveValue("Banned topic");
});

test("retry validation queues owner-wide revalidation and surfaces queued/error feedback", async ({
  page
}) => {
  // Acceptance coverage only for the EXISTING shared retryRow/revalidateMutation — this test
  // adds no unit coverage and changes no shared code. It only proves, through the real
  // control, what the approved spec's acceptance checklist requires.
  await page.route("**/api/news/personalization", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        availability: {
          aiConfigured: true,
          webSearchConfigured: true,
          customSourceByUrlEnabled: true,
          customSourceByNameEnabled: true,
          freeformTopicsEnabled: true
        },
        customSources: [],
        customTopics: [
          {
            id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            label: "Elections",
            guidance: null,
            validationStatus: "needs_revalidation",
            createdAt: "2026-07-12T00:00:00.000Z"
          }
        ],
        sourceExclusions: [],
        snapshot: null,
        refresh: { state: "idle", updatedAt: null }
      })
    })
  );

  let revalidationCalls = 0;
  await page.route("**/api/news/revalidation", (route) => {
    revalidationCalls += 1;
    if (revalidationCalls === 1) {
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true })
      });
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "revalidation failed" })
    });
  });

  await page.goto("/settings?section=modules&module=news");
  await expect(page.getByRole("heading", { name: "News" })).toBeVisible();

  const retryButton = page.getByRole("button", { name: "Retry validation" });
  await expect(retryButton).toBeVisible();

  const [firstRequest] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/news/revalidation") && r.method() === "POST"),
    retryButton.click()
  ]);
  expect(firstRequest.method()).toBe("POST");
  await expect(page.getByRole("status")).toContainText(
    "Revalidation queued — statuses update after the next check."
  );

  await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/news/revalidation") && r.method() === "POST"),
    retryButton.click()
  ]);
  await expect(page.getByRole("alert")).toContainText("Could not queue revalidation. Try again.");
});
