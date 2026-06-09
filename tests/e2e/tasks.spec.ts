import { expect, test } from "@playwright/test";

import { createMockConnectorProviders, createMockTask, mockApi } from "./mock-api.js";

test.beforeEach(async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [
      createMockTask("t-critical", "File taxes", {
        priority: 5,
        dueAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString()
      }),
      createMockTask("t-someday", "Learn cello", { priority: 1 })
    ]
  });
});

test("priority view groups tasks by priority level", async ({ page }) => {
  await page.goto("/tasks");
  // Default filter is "todo" so both tasks (status: "todo") should appear
  // Priority view is the default (preference mock returns "priority")
  await expect(page.getByRole("button", { name: "Priority" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  // "File taxes" is Critical (priority 5) — the group section has aria-label="Critical priority"
  await expect(page.getByRole("region", { name: "Critical priority" })).toBeVisible();
});

test("matrix toggle switches to matrix view", async ({ page }) => {
  await page.goto("/tasks");
  // Wait for initial priority view to settle
  await expect(page.getByRole("button", { name: "Priority" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "Matrix" }).click();
  // After clicking Matrix, the Matrix button should be pressed and the Eisenhower grid visible
  await expect(page.getByRole("button", { name: "Matrix" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByText("Do First")).toBeVisible();
});
