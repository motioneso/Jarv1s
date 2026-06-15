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
        endsAt: "2030-06-06T17:00:00.000Z",
        location: "War room"
      })
    ]
  });
  await registerMockCalendarEmailRoutes(page, state);

  // Park the calendar's Day view on the event's date so it lands in the grid.
  await page.addInitScript(() => {
    localStorage.setItem("jarvis.cal.view", "day");
    localStorage.setItem("jarvis.cal.cursor", "2030-06-06T16:00:00.000Z");
  });

  await signIn(page);
  await page.locator(".module-nav").getByRole("link", { name: "Calendar" }).click();

  // Event renders as a block in the time grid.
  await expect(page.getByRole("button", { name: /Daily standup/ })).toBeVisible();

  // Clicking the block opens the detail peek with the time and location.
  await page.getByRole("button", { name: /Daily standup/ }).click();
  const peek = page.getByRole("dialog", { name: "Event details" });
  await expect(peek).toBeVisible();
  await expect(peek.getByText("Daily standup")).toBeVisible();
  await expect(peek.getByText("War room")).toBeVisible();
  // The page is real data, not the retired coming-soon placeholder.
  await expect(page.getByText("Calendar is coming soon.")).toHaveCount(0);
});
