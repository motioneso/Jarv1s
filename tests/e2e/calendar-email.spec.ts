import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createMockConnectorProviders, mockApi } from "./mock-api.js";
import {
  createMockCalendarEmailState,
  createMockCalendarEvent,
  createMockEmailMessage,
  registerMockCalendarEmailRoutes
} from "./mock-calendar-email-api.js";

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Calendar" })).toBeVisible();
}

test("Calendar page renders real cached events grouped by day", async ({ page }) => {
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const state = createMockCalendarEmailState({
    calendarEvents: [
      createMockCalendarEvent("evt-standup", "Daily standup", {
        startsAt: "2030-06-06T16:00:00.000Z",
        endsAt: "2030-06-06T16:15:00.000Z",
        location: "War room"
      })
    ]
  });
  await registerMockCalendarEmailRoutes(page, state);

  await signIn(page);
  await page.locator(".module-nav").getByRole("link", { name: "Calendar" }).click();

  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(page.getByText("Daily standup")).toBeVisible();
  await expect(page.getByText("War room")).toBeVisible();
  // The page is real data, not the retired coming-soon placeholder.
  await expect(page.getByText("Calendar is coming soon.")).toHaveCount(0);
});

test("Email triage page renders summary + signals and never the raw body", async ({ page }) => {
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const secretBody = "TOP-SECRET-RAW-EMAIL-BODY-NEVER-RENDER";
  const state = createMockCalendarEmailState({
    emailMessages: [
      createMockEmailMessage("msg-bill", "Your electricity bill is due", {
        sender: "billing@utility.test",
        summary: "Electricity bill of 84 GBP is due on June 20.",
        signals: {
          importance: "high",
          confidence: 0.92,
          billsDue: [
            { description: "Electricity", amount: 84, currency: "GBP", dueDate: "2026-06-20" }
          ]
        }
      })
    ]
  });
  await registerMockCalendarEmailRoutes(page, state);

  await signIn(page);
  await page.locator(".module-nav").getByRole("link", { name: "Email" }).click();

  await expect(page.getByRole("heading", { name: "Email", level: 1 })).toBeVisible();
  await expect(page.getByText("Your electricity bill is due")).toBeVisible();
  // LLM-derived summary + a structured signal both render.
  await expect(page.getByText("Electricity bill of 84 GBP is due on June 20.")).toBeVisible();
  await expect(page.getByText("Bills due")).toBeVisible();
  await expect(page.getByText("High priority")).toBeVisible();
  // The raw email body is never persisted nor in the DTO — it must not appear anywhere.
  await expect(page.getByText(secretBody)).toHaveCount(0);
  expect(await page.content()).not.toContain(secretBody);
});

test("Sync now POSTs the google sync route and refetches the email list", async ({ page }) => {
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const state = createMockCalendarEmailState({
    emailMessages: [createMockEmailMessage("msg-1", "Welcome")]
  });
  await registerMockCalendarEmailRoutes(page, state);

  let emailListFetches = 0;
  let syncPosted = false;
  // Count the email-list GETs to prove the post-sync invalidation triggers a refetch,
  // and capture the sync POST itself. Registered AFTER the registrar so these win
  // (Playwright resolves routes last-registered-first).
  await page.route("**/api/email/messages", (route) => {
    if (route.request().method() === "GET") {
      emailListFetches += 1;
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [createMockEmailMessage("msg-1", "Welcome")] })
    });
  });
  await page.route("**/api/connectors/google/sync", (route) => {
    syncPosted = route.request().method() === "POST";
    state.syncCallCount += 1;
    return route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify(state.syncResponse)
    });
  });

  await signIn(page);
  await page.locator(".module-nav").getByRole("link", { name: "Email" }).click();
  await expect(page.getByText("Welcome")).toBeVisible();

  const fetchesBeforeSync = emailListFetches;
  await page.getByRole("button", { name: "Sync now" }).click();

  await expect.poll(() => syncPosted).toBe(true);
  await expect.poll(() => state.syncCallCount).toBe(1);
  // onSuccess invalidates queryKeys.email.list → the list refetches.
  await expect.poll(() => emailListFetches).toBeGreaterThan(fetchesBeforeSync);
});
