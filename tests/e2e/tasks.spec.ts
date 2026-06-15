import { expect, test } from "@playwright/test";

import { createMockConnectorProviders, createMockTask, mockApi } from "./mock-api.js";

const urgentTag = {
  id: "tag-urgent",
  ownerUserId: "user-1",
  listId: "list-1",
  name: "urgent",
  createdAt: null
};

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
      createMockTask("t-someday", "Learn cello", { priority: 1, tags: [urgentTag] })
    ]
  });
});

test("priority view groups tasks by priority level", async ({ page }) => {
  await page.goto("/tasks");
  // Default filter is "todo" so both tasks (status: "todo") should appear
  // List view is backed by the priority-grouped view model by default.
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByText("Critical")).toBeVisible();
  await expect(page.getByText("File taxes")).toBeVisible();
});

test("matrix toggle switches to matrix view", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("button", { name: "Matrix" }).click();
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

test("list filter can focus a single list", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: /All lists/ }).click();
  await page.getByRole("button", { name: /Personal/ }).click();

  await expect(page.getByRole("button", { name: "Personal", exact: true })).toBeVisible();
  await expect(page.getByText("File taxes")).toBeVisible();
});

test("tag filter narrows visible tasks and can be cleared", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByPlaceholder("Filter by tag…").click();
  await page.getByRole("button", { name: /urgent/ }).click();

  await expect(page.getByRole("button", { name: "Remove urgent" })).toBeVisible();
  await expect(page.getByText("File taxes")).toHaveCount(0);
  await expect(page.getByText("Learn cello")).toBeVisible();

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("File taxes")).toBeVisible();
});
