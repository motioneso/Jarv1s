import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createMockConnectorProviders, mockApi } from "./mock-api.js";
import {
  createMockCalendarEmailState,
  createMockCalendarEvent,
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
