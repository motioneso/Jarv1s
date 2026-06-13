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

test("assigning a tag from the detail page renders a chip", async ({ page }) => {
  await page.goto("/tasks/t-critical");
  // The Tags panel exposes an "Add tag" select seeded from the list's tags.
  await expect(page.getByText("No tags assigned.")).toBeVisible();
  await page.getByLabel("Add tag").selectOption({ label: "urgent" });
  await page.getByRole("button", { name: "Assign tag" }).click();
  // The assigned tag renders as a removable chip with a "Remove tag urgent" control.
  await expect(page.getByRole("button", { name: "Remove tag urgent" })).toBeVisible();
});

test("renaming a list in the sidebar renders the new name", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "Rename list Personal" })).toBeVisible();
  await page.getByRole("button", { name: "Rename list Personal" }).click();
  const input = page.getByLabel("Rename list Personal");
  await input.fill("Work");
  await page.getByRole("button", { name: "Save list name" }).click();
  await expect(page.getByRole("button", { name: "Work", exact: true })).toBeVisible();
});

test("deleting a tag in the sidebar removes it", async ({ page }) => {
  await page.goto("/tasks");
  // Select the list so the sidebar Tags section renders.
  await page.getByRole("button", { name: "Personal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete tag urgent" })).toBeVisible();
  await page.getByRole("button", { name: "Delete tag urgent" }).click();
  await expect(page.getByRole("button", { name: "Delete tag urgent" })).toHaveCount(0);
});
