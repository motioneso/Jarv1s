import { expect, test } from "@playwright/test";

import {
  createMockConnectorAccount,
  createMockConnectorProviders,
  createMockNotification,
  createMockTask,
  mockApi
} from "./mock-api.js";

test("signs in and renders shell navigation", async ({ page }) => {
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/today/);
  await expect(page.locator(".module-nav").getByRole("link", { name: "Today" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Tasks" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat with Jarvis" })).toBeVisible();

  await page.getByRole("button", { name: /Owner User/ }).click();
  await expect(page.getByRole("button", { name: /Notifications/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Settings & permissions/ })).toBeVisible();
});

test("gates a protected route behind sign-in when unauthenticated", async ({ page }) => {
  // Navigating directly to a protected route while unauthenticated must land on
  // the sign-in gate, not leak the protected surface (#171).
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [createMockTask("task-1", "Owner-only secret task")]
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  // The protected shell navigation and any owner data must not be rendered.
  await expect(page.locator(".module-nav").getByRole("link", { name: "Tasks" })).toHaveCount(0);
  await expect(page.getByText("Owner-only secret task")).toHaveCount(0);
});

test("hides admin-only settings sections for a non-admin user", async ({ page }) => {
  // isInstanceAdmin:false must hide the Admin / Setup mode entirely (#171).
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Profile & account" })).toBeVisible();
  await expect(page.getByText("Member of this instance.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin / Setup" })).toHaveCount(0);
  await expect(page.getByText("People & access")).toHaveCount(0);
});

test("creates and updates tasks through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [createMockTask("task-1", "Existing secure task")]
  });

  await page.goto("/tasks");
  await expect(page.getByRole("region", { name: "Tasks" })).toBeVisible();

  await page.getByLabel("Task title").fill("Renew passport");
  await page.getByLabel("Task title").press("Enter");

  await expect(page.getByText("Renew passport")).toBeVisible();
});

test("lists and marks notifications read through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [
      createMockNotification("notification-1", "New secure notice"),
      createMockNotification("notification-2", "Workspace notice")
    ],
    tasks: []
  });

  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Unread\s*2/ })).toBeVisible();
  await expect(page.getByText("New secure notice")).toBeVisible();

  await page.getByLabel("Mark New secure notice read").click();
  await expect(page.getByRole("button", { name: /Unread\s*1/ })).toBeVisible();

  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByRole("button", { name: /Unread\s*0/ })).toBeVisible();
  await page.getByRole("button", { name: /Unread/ }).click();
  await expect(page.getByText("No notifications")).toBeVisible();
});

test("Calendar page renders its real empty data view", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    calendarEvents: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(page.getByText("No upcoming events")).toBeVisible();
  await expect(page.getByText("Calendar is coming soon.")).toHaveCount(0);
});

test("connector accounts panel shows existing accounts and supports revoke", async ({ page }) => {
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
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Connected accounts" }).click();
  await expect(page.getByRole("heading", { name: "Connected accounts" })).toBeVisible();

  await expect(page.getByText("Google Email")).toBeVisible();
  await expect(page.getByText(/gmail\.readonly/)).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).click();
  await page
    .getByRole("dialog", { name: "Revoke Google Email access?" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
});

test("configures AI providers and capability routing through settings REST calls", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    aiModels: [],
    aiProviders: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");
  await page.locator(".set2__adv").click();
  await page.getByRole("button", { name: "Assistant & AI" }).click();

  await expect(page.getByRole("heading", { name: "Assistant & AI" })).toBeVisible();
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("button", { name: "Anthropic" }).click();
  await expect(page.locator(".provcfg__name", { hasText: "Anthropic" })).toBeVisible();

  await page.getByLabel("Provider").selectOption("ai-provider-1");
  await page.getByLabel("Model id").fill("claude-smoke");
  await page.getByLabel("Display name").fill("Haiku Smoke");
  await page.getByLabel("tool-use").check();
  await page.getByRole("button", { name: "Add model" }).click();
  await expect(page.getByText("Haiku Smoke", { exact: true })).toBeVisible();
  await expect(page.getByText("Haiku Smoke via Anthropic")).toBeVisible();
  await expect(page.getByText("tasks.updateStatus")).toBeVisible();

  await page.getByRole("button", { name: "Disable" }).first().click();
  await expect(page.getByText("disabled")).toBeVisible();

  await page.getByRole("button", { name: "Remove provider" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Shared Jarvis assistant")).toBeVisible();
});

test("serves PWA metadata", async ({ page }) => {
  const response = await page.request.get("/manifest.webmanifest");
  const manifest = (await response.json()) as { readonly name?: string };

  expect(response.ok()).toBe(true);
  expect(manifest.name).toBe("Jarv1s");
});

test.describe("Chat drawer — Approve/Deny card", () => {
  test("renders Approve/Deny card and resolves on Approve", async ({ page }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: createMockConnectorProviders(),
      notifications: [],
      tasks: []
    });

    // Override the stream to return an action_request event.
    // Must be registered before page.goto because the stream connects at app load.
    const actionRequestEvent = JSON.stringify({
      kind: "action_request",
      text: "Approve or deny: Write the value 'test'",
      actionRequestId: "ar_test_1",
      toolName: "example.write",
      summary: "Write the value 'test'"
    });
    let streamServed = false;
    await page.route("**/api/chat/stream", async (route) => {
      if (streamServed) {
        return;
      }
      streamServed = true;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: `data: ${actionRequestEvent}\n\n`
      });
    });

    // Mock the resolve endpoint, capturing the request so we can assert the
    // decision was actually transmitted — not merely that the card flipped to
    // "Resolved." (a card could resolve optimistically without sending) (#171).
    let resolveUrl: string | undefined;
    let resolveBody: unknown;
    await page.route("**/api/chat/action-requests/*/resolve", (route) => {
      const request = route.request();
      resolveUrl = request.url();
      resolveBody = request.postDataJSON();
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Chat with Jarvis" }).click();

    // Wait for the Approve/Deny card to appear
    await expect(page.locator(".action-request-card")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".action-request-tool")).toContainText("example.write");
    await expect(page.locator(".action-request-summary")).toContainText("Write the value 'test'");

    // Approve
    await page.locator(".action-request-card").getByRole("button", { name: "Approve" }).click();

    // Card should show Resolved.
    await expect(page.locator(".action-request-card")).toContainText("Resolved.");

    // Assert the approval decision and the path's action-request id actually went over the wire.
    expect(resolveBody).toEqual({ status: "confirmed" });
    expect(resolveUrl).toContain("/api/chat/action-requests/ar_test_1/resolve");
  });

  test("Deny resolves the card", async ({ page }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: createMockConnectorProviders(),
      notifications: [],
      tasks: []
    });

    const actionRequestEvent = JSON.stringify({
      kind: "action_request",
      text: "Approve or deny: Write 'y'",
      actionRequestId: "ar_test_2",
      toolName: "example.write",
      summary: "Write 'y'"
    });
    let streamServed = false;
    await page.route("**/api/chat/stream", async (route) => {
      if (streamServed) {
        return;
      }
      streamServed = true;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: `data: ${actionRequestEvent}\n\n`
      });
    });

    let resolveUrl: string | undefined;
    let resolveBody: unknown;
    await page.route("**/api/chat/action-requests/*/resolve", (route) => {
      const request = route.request();
      resolveUrl = request.url();
      resolveBody = request.postDataJSON();
      return route.fulfill({ status: 204, body: "" });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Chat with Jarvis" }).click();

    await expect(page.locator(".action-request-card")).toBeVisible({ timeout: 3000 });
    await page.locator(".action-request-card").getByRole("button", { name: "Deny" }).click();
    await expect(page.locator(".action-request-card")).toContainText("Resolved.");

    // Assert the rejection decision and the path's action-request id actually went over the wire.
    expect(resolveBody).toEqual({ status: "rejected" });
    expect(resolveUrl).toContain("/api/chat/action-requests/ar_test_2/resolve");
  });
});
