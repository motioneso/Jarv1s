/**
 * One-off DARK-MODE screenshot capture for the a11y/contrast design pass.
 * Seeds localStorage jarvis.theme:v1=dark before app load so the shell boots dark.
 *   npx playwright test capture-screens-dark --workers=1
 * Dumps into /home/ben/jarvis-design-review/screens-dark/
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

// Output dir is gitignored (under test-results/) and overridable via SCREENS_DIR.
const OUT = process.env.SCREENS_DIR ?? "test-results/design-screens-dark";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  // On-demand design-regression harness — skipped in the normal suite/CI.
  // Run with: pnpm capture:screens (sets CAPTURE=1).
  test.skip(
    process.env.CAPTURE !== "1",
    "Design screenshot-capture harness — run on demand via `pnpm capture:screens`."
  );
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("jarvis.theme:v1", "dark");
    } catch {
      /* ignore */
    }
  });
});

const tasks = [
  createMockTask("task-1", "Renew passport before the Lisbon trip", {
    priority: 1,
    dueAt: "2026-07-01T00:00:00.000Z"
  }),
  createMockTask("task-2", "Review Q3 wellness rollout plan"),
  createMockTask("task-3", "Reply to landlord about lease renewal"),
  createMockTask("task-4", "Book dentist appointment", { status: "done" })
];

async function baseState(page: Page) {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [
      createMockConnectorAccount("connector-1", {
        providerId: "google-email",
        providerDisplayName: "Google Email",
        scopes: ["gmail.readonly"],
        status: "active"
      })
    ],
    connectorProviders: createMockConnectorProviders(),
    notifications: [
      createMockNotification("n-1", "Your morning briefing is ready"),
      createMockNotification("n-2", "Lease renewal task is due tomorrow")
    ],
    tasks,
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
    ]
  });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test("dark: sign-in", async ({ page }) => {
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

test("dark: onboarding", async ({ page }) => {
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

test("dark: today + chat", async ({ page }) => {
  await baseState(page);
  await page.goto("/today");
  await page.waitForTimeout(600);
  await shot(page, "03-today");
  const chat = page.getByRole("button", { name: "Chat with Jarvis" });
  if (await chat.count()) {
    await chat.click();
    await page.waitForTimeout(600);
    await shot(page, "04-chat-drawer");
  }
});

test("dark: tasks", async ({ page }) => {
  await baseState(page);
  await page.goto("/tasks");
  await page.waitForTimeout(600);
  await shot(page, "05-tasks-list");
});

test("dark: calendar", async ({ page }) => {
  await baseState(page);
  await page.goto("/calendar");
  await page.waitForTimeout(600);
  await shot(page, "06-calendar");
});

test("dark: notifications", async ({ page }) => {
  await baseState(page);
  await page.goto("/notifications");
  await page.waitForTimeout(500);
  await shot(page, "07-notifications");
});

test("dark: settings + AI", async ({ page }) => {
  await baseState(page);
  await page.goto("/settings");
  await page.waitForTimeout(500);
  await shot(page, "08-settings-profile");
  const admin = page.getByRole("button", { name: "Admin / Setup" });
  if (await admin.count()) {
    await admin.click();
    await page.waitForTimeout(300);
    const ai = page.getByRole("button", { name: "Assistant & AI" });
    if (await ai.count()) {
      await ai.click();
      await page.waitForTimeout(500);
      await shot(page, "09-settings-ai");
    }
  }
});

test("dark: wellness", async ({ page }) => {
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
  await shot(page, "10-wellness");
});
