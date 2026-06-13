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

  await page.route("**/api/wellness/medications**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ medications: [] })
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
});
