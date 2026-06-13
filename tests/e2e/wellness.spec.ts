import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api.js";

test.beforeEach(async ({ page }) => {
  // Reuse the repo's central auth/me/notifications mocks so /wellness renders past the auth gate.
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });

  // Override /api/modules so the Wellness nav entry exists (registered after mockApi → wins).
  await page.route("**/api/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            id: "wellness",
            name: "Wellness",
            version: "0.1.0",
            lifecycle: "user-toggleable",
            navigation: [
              {
                id: "wellness",
                label: "Wellness",
                path: "/wellness",
                icon: "heart-pulse",
                order: 40
              }
            ],
            settings: []
          }
        ]
      })
    })
  );

  // The shell also fetches /api/me/modules for active flags — keep wellness visible (active).
  await page.route("**/api/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            id: "wellness",
            name: "Wellness",
            version: "0.1.0",
            lifecycle: "user-toggleable",
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

  await page.route("**/api/wellness/medications**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          medication: {
            id: "m-new",
            ownerUserId: "user-1",
            name: "New Med",
            dosage: null,
            form: null,
            frequencyType: "once_daily",
            timesPerDay: null,
            intervalHours: null,
            weekdays: null,
            scheduleTimes: ["08:00"],
            cycleDaysOn: null,
            cycleDaysOff: null,
            cycleAnchorDate: null,
            active: true,
            notes: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ medications: [] })
    });
  });

  // The schedule fetch backs MedicationsView; keep it empty so the view renders the form.
  await page.route("**/api/wellness/medications/schedule**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ date: "2026-06-13", slots: [] })
    })
  );

  await page.route("**/api/wellness/checkins**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          checkin: {
            id: "c1",
            ownerUserId: "user-1",
            checkedInAt: new Date().toISOString(),
            feelingCore: "joyful",
            feelingSecondary: null,
            feelingTertiary: null,
            wheelVersion: "willcox-1982",
            sensations: [],
            intensity: null,
            energy: null,
            note: null,
            identifiedVia: "wheel",
            createdAt: new Date().toISOString()
          }
        })
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkins: [] })
    });
  });
});

test("wellness page renders and a check-in can be saved", async ({ page }) => {
  await page.goto("/wellness");
  await expect(page.getByRole("heading", { name: "Wellness" })).toBeVisible();

  await page.getByRole("button", { name: "Log how you feel" }).click();
  // The picker is a plain <select> (basic UI) — choose the core feeling by value.
  await page.getByLabel("Core feeling").selectOption("joyful");

  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/wellness/checkins") && r.method() === "POST"),
    page.getByRole("button", { name: "Save", exact: true }).click()
  ]);
  expect(request.method()).toBe("POST");
});

test("medication form sends correct payload for every_n_hours (was a guaranteed 400)", async ({
  page
}) => {
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Medications" }).click();

  await page.getByLabel("Medication name").fill("Antibiotic");
  await page.getByLabel("Frequency").selectOption("every_n_hours");
  await page.getByLabel("Interval hours").fill("8");

  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes("/api/wellness/medications") && r.method() === "POST"
    ),
    page.getByRole("button", { name: "Add" }).click()
  ]);
  const body = request.postDataJSON() as Record<string, unknown>;
  expect(body.frequencyType).toBe("every_n_hours");
  expect(body.intervalHours).toBe(8);
  // every_n_hours must NOT send schedule_times (the DB has no requirement; route uses interval).
  expect(body.scheduleTimes).toBeNull();
});

test("medication form sends weekdays for specific_weekdays", async ({ page }) => {
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Medications" }).click();

  await page.getByLabel("Medication name").fill("Weekly Pill");
  await page.getByLabel("Frequency").selectOption("specific_weekdays");
  await page.getByRole("checkbox", { name: "Mon" }).check();
  await page.getByRole("checkbox", { name: "Wed" }).check();

  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes("/api/wellness/medications") && r.method() === "POST"
    ),
    page.getByRole("button", { name: "Add" }).click()
  ]);
  const body = request.postDataJSON() as Record<string, unknown>;
  expect(body.frequencyType).toBe("specific_weekdays");
  expect(body.weekdays).toEqual([1, 3]);
});

test("medication form sends cycle fields for cyclical", async ({ page }) => {
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Medications" }).click();

  await page.getByLabel("Medication name").fill("Birth Control");
  await page.getByLabel("Frequency").selectOption("cyclical");
  await page.getByLabel("Cycle anchor date").fill("2026-06-15");
  await page.getByLabel("Cycle days on").fill("21");
  await page.getByLabel("Cycle days off").fill("7");

  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes("/api/wellness/medications") && r.method() === "POST"
    ),
    page.getByRole("button", { name: "Add" }).click()
  ]);
  const body = request.postDataJSON() as Record<string, unknown>;
  expect(body.frequencyType).toBe("cyclical");
  expect(body.cycleAnchorDate).toBe("2026-06-15");
  expect(body.cycleDaysOn).toBe(21);
  expect(body.cycleDaysOff).toBe(7);
});

test("medication form omits scheduling fields for as_needed (PRN)", async ({ page }) => {
  await page.goto("/wellness");
  await page.getByRole("button", { name: "Medications" }).click();

  await page.getByLabel("Medication name").fill("Painkiller");
  await page.getByLabel("Frequency").selectOption("as_needed");

  const [request] = await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes("/api/wellness/medications") && r.method() === "POST"
    ),
    page.getByRole("button", { name: "Add" }).click()
  ]);
  const body = request.postDataJSON() as Record<string, unknown>;
  expect(body.frequencyType).toBe("as_needed");
  // PRN must carry NO scheduling/cycle fields (DB CHECK rejects them otherwise).
  expect(body.scheduleTimes).toBeNull();
  expect(body.timesPerDay).toBeNull();
  expect(body.intervalHours).toBeNull();
  expect(body.weekdays).toBeNull();
  expect(body.cycleAnchorDate).toBeNull();
});

test("wellness nav is hidden when the actor has disabled the module", async ({ page }) => {
  // Override /api/me/modules so wellness is reported inactive for this actor.
  await page.route("**/api/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modules: [
          {
            id: "wellness",
            name: "Wellness",
            version: "0.1.0",
            lifecycle: "user-toggleable",
            required: false,
            supportsUserDisable: true,
            instanceDisabled: false,
            userDisabled: true,
            active: false
          }
        ]
      })
    })
  );

  await page.goto("/wellness");
  await expect(page.locator(".module-nav").getByRole("link", { name: "Wellness" })).toHaveCount(0);

  // Deep-linking the disabled health-data route must NOT render the wellness UI: the SPA
  // route is gated on the actor's module state and redirects to /tasks once it resolves.
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Wellness" })).toHaveCount(0);
});

test("wellness route fails closed when the module-state request errors", async ({ page }) => {
  // If /api/me/modules cannot be read we cannot prove the actor is enabled, so the gate must
  // fail closed for a health-data module: redirect, never mount the wellness UI (Codex review).
  await page.route("**/api/me/modules", (route) => route.fulfill({ status: 500, body: "boom" }));

  await page.goto("/wellness");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Wellness" })).toHaveCount(0);
});

test("wellness route fails closed when the module is absent from the state response", async ({
  page
}) => {
  // A 200 that omits wellness (backend skew / partial response) is NOT proof of enablement:
  // affirmative enablement is required, so the gate denies and never mounts the UI (Codex R3).
  await page.route("**/api/me/modules", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ modules: [] })
    })
  );

  await page.goto("/wellness");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "Wellness" })).toHaveCount(0);
});
