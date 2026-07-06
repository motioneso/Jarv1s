/**
 * One-off DESIGN-REVIEW screenshot capture. NOT part of the regular suite — run explicitly:
 *   pnpm --filter @jarv1s/web exec playwright test tests/e2e/capture-screens.spec.ts
 * Dumps full-page PNGs of every major surface into ~/jarvis-design-review/screens/
 * so design-review agents can ground "AI-interface tells" findings on rendered pixels + code.
 */
import { test, type Page } from "@playwright/test";

import {
  createMockConnectorAccount,
  createMockConnectorProviders,
  createMockNotification,
  createMockTask,
  mockApi
} from "./mock-api.js";
import { createMockAiModel, createMockAiProvider } from "./mock-ai-api.js";
import { defaultOnboardingStatus } from "./mock-onboarding-api.js";
import { registerMockSportsRoutes, sportsOverviewFixture } from "./mock-sports-api.js";

// Output dir is gitignored (under test-results/) and overridable via SCREENS_DIR.
const OUT = process.env.SCREENS_DIR ?? "test-results/design-screens";

const richTasks = [
  createMockTask("task-1", "Renew passport before the Lisbon trip", {
    priority: 1,
    dueAt: "2026-07-01T00:00:00.000Z"
  }),
  createMockTask("task-2", "Review Q3 wellness rollout plan"),
  createMockTask("task-3", "Reply to landlord about lease renewal"),
  createMockTask("task-4", "Book dentist appointment", { status: "done" }),
  createMockTask("task-5", "Draft birthday message for Mom", { priority: 3 })
];

const richNotifications = [
  createMockNotification("n-1", "Your morning briefing is ready"),
  createMockNotification("n-2", "Calendar sync completed — 3 events added"),
  createMockNotification("n-3", "Lease renewal task is due tomorrow")
];

async function baseState(page: Page, overrides = {}) {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [
      createMockConnectorAccount("connector-1", {
        providerId: "google-email",
        providerDisplayName: "Google Email",
        scopes: ["gmail.readonly"],
        status: "active"
      }),
      createMockConnectorAccount("connector-2", {
        providerId: "google-calendar",
        providerDisplayName: "Google Calendar",
        scopes: ["calendar.readonly"],
        status: "active"
      })
    ],
    connectorProviders: createMockConnectorProviders(),
    notifications: richNotifications,
    tasks: richTasks,
    aiProviders: [
      createMockAiProvider("prov-1", { providerKind: "anthropic", displayName: "Anthropic" })
    ],
    aiModels: [
      createMockAiModel("model-1", {
        providerConfigId: "prov-1",
        providerKind: "anthropic",
        providerDisplayName: "Anthropic",
        providerModelId: "claude-opus-4-8",
        displayName: "Opus 4.8"
      })
    ],
    ...overrides
  });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450); // let fonts/animations settle
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test.use({ viewport: { width: 1440, height: 900 } });

// On-demand design-regression harness — skipped in the normal suite/CI. Run with:
//   pnpm capture:screens   (sets CAPTURE=1)
test.beforeEach(() => {
  test.skip(
    process.env.CAPTURE !== "1",
    "Design screenshot-capture harness — run on demand via `pnpm capture:screens`."
  );
});

test("capture: sign-in", async ({ page }) => {
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });
  await page.goto("/");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await shot(page, "01-signin");
});

test("capture: onboarding wizard", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus({ state: "pending" })
  });
  await page.goto("/");
  await page.waitForTimeout(800);
  await shot(page, "02-onboarding");
});

test("capture: today + chat drawer", async ({ page }) => {
  await baseState(page);
  await page.goto("/today");
  await page.waitForTimeout(600);
  await shot(page, "03-today");

  // user menu open
  const userMenu = page.getByRole("button", { name: /Owner User/ });
  if (await userMenu.count()) {
    await userMenu.click();
    await shot(page, "04-today-usermenu");
    await page.keyboard.press("Escape");
  }

  // chat drawer
  const chat = page.getByRole("button", { name: "Chat with Jarvis" });
  if (await chat.count()) {
    await chat.click();
    await page.waitForTimeout(600);
    await shot(page, "05-chat-drawer");
  }
});

test("capture: tasks", async ({ page }) => {
  await baseState(page);
  await page.goto("/tasks");
  await page.waitForTimeout(600);
  await shot(page, "06-tasks-list");

  // try a matrix/eisenhower toggle if present
  const matrix = page.getByRole("button", { name: /Matrix|Priority|Eisenhower/i });
  if (await matrix.count()) {
    await matrix.first().click();
    await page.waitForTimeout(500);
    await shot(page, "07-tasks-matrix");
  }

  // open first task detail
  await page.goto("/tasks");
  await page.waitForTimeout(400);
  const firstTask = page.getByText("Renew passport before the Lisbon trip");
  if (await firstTask.count()) {
    await firstTask.first().click();
    await page.waitForTimeout(500);
    await shot(page, "08-task-detail");
  }
});

test("capture: calendar", async ({ page }) => {
  await baseState(page);
  await page.goto("/calendar");
  await page.waitForTimeout(600);
  await shot(page, "09-calendar");
});

test("capture: notifications", async ({ page }) => {
  await baseState(page);
  await page.goto("/notifications");
  await page.waitForTimeout(500);
  await shot(page, "10-notifications");
});

test("capture: settings (profile, connected accounts, AI)", async ({ page }) => {
  await baseState(page);
  await page.goto("/settings");
  await page.waitForTimeout(500);
  await shot(page, "11-settings-profile");

  const connected = page.getByRole("button", { name: "Connected accounts" });
  if (await connected.count()) {
    await connected.click();
    await page.waitForTimeout(400);
    await shot(page, "12-settings-connected");
  }

  const admin = page.getByRole("button", { name: "Admin / Setup" });
  if (await admin.count()) {
    await admin.click();
    await page.waitForTimeout(300);
    const ai = page.getByRole("button", { name: "Assistant & AI" });
    if (await ai.count()) {
      await ai.click();
      await page.waitForTimeout(500);
      await shot(page, "13-settings-ai");
    }
    const people = page.getByRole("button", { name: /People & access/ });
    if (await people.count()) {
      await people.click();
      await page.waitForTimeout(400);
      await shot(page, "14-settings-people");
    }
  }
});

test("capture: wellness", async ({ page }) => {
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
  await page.goto("/wellness");
  await page.waitForTimeout(700);
  await shot(page, "15-wellness");

  const checkin = page.getByRole("button", { name: "Start check-in" });
  if (await checkin.count()) {
    await checkin.click();
    await page.waitForTimeout(500);
    await shot(page, "16-wellness-checkin");
  }
});

test("capture: mobile today", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await baseState(page);
  await page.goto("/today");
  await page.waitForTimeout(600);
  await shot(page, "17-mobile-today");
});

// Broadsheet skin verification (#829 Task 5): ticker hairlines + overflow fade, edge-to-edge
// hero, hairline grid with followed-game field highlight — see docs/superpowers/specs for §5/§6.
test("capture: sports", async ({ page }) => {
  await baseState(page);
  await registerMockSportsRoutes(page);
  await page.goto("/sports");
  await page.waitForTimeout(600);
  await shot(page, "18-sports");
});

test("capture: sports mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await baseState(page);
  await registerMockSportsRoutes(page);
  await page.goto("/sports");
  await page.waitForTimeout(600);
  await shot(page, "19-sports-mobile");
});

// Reduced-motion pass: skeleton (delayed response) then the settled hero, both captured with
// prefers-reduced-motion: reduce emulated so the live dot / skeleton shimmer must be static.
test("capture: sports reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await baseState(page);
  await registerMockSportsRoutes(page); // sports module gate + overview route
  // Override the overview route again (most-recently-registered wins) with a delayed response
  // so the initial screenshot lands on the skeleton, not the settled hero.
  await page.route("**/api/sports/overview", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sportsOverviewFixture)
    });
  });
  await page.goto("/sports");
  await page.waitForTimeout(300);
  await shot(page, "20-sports-reduced-motion-skeleton");
  await page.waitForTimeout(1600);
  await shot(page, "21-sports-reduced-motion");
});
