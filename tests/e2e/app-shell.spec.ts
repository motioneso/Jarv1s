import { expect, test } from "@playwright/test";

import {
  createMockBriefingDefinition,
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

  await expect(page.locator(".module-nav").getByRole("link", { name: "Tasks" })).toBeVisible();
  await expect(
    page.locator(".module-nav").getByRole("link", { name: "Notifications" })
  ).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Email" })).toBeVisible();
  // Chat is a drawer toggle (button), not a route link.
  await expect(page.locator(".module-nav").getByRole("button", { name: "Chat" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Briefings" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Settings" })).toBeVisible();
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
  await expect(page.locator(".module-nav").getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByText("Owner-only secret task")).toHaveCount(0);
});

test("hides admin-only settings sections for a non-admin user", async ({ page }) => {
  // isInstanceAdmin:false must hide admin surfaces (Auth Providers, Admin Users)
  // and the API rejects the admin fetch with 403 (#171).
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
  // Role reads "User", not "Instance admin".
  await expect(page.locator("dd", { hasText: /^User$/ })).toBeVisible();
  // Admin-only panels are absent.
  await expect(page.getByRole("heading", { name: "Auth Providers" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Users" })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();

  await page.getByLabel("Task title").fill("Renew passport");
  await page.getByRole("button", { name: "Add", exact: true }).click();

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
  await expect(page.getByLabel("Notifications, 2 unread")).toBeVisible();
  await expect(page.getByText("New secure notice")).toBeVisible();

  await page.getByLabel("Mark New secure notice read").click();
  await expect(page.getByLabel("Notifications, 1 unread")).toBeVisible();

  await page.getByRole("button", { name: "Mark all read" }).click();
  await page.getByRole("button", { name: /Unread/ }).click();
  await expect(page.getByText("No notifications")).toBeVisible();
});

test("Calendar and Email pages render their real (empty) data views", async ({ page }) => {
  // The retired coming-soon placeholders were replaced by real React-Query pages
  // in Phase 3 connector-sync (H2/H3). With no cached data the pages show their
  // empty states, not the old "coming soon" copy. Full data rendering is covered
  // by tests/e2e/calendar-email.spec.ts.
  await mockApi(page, {
    authenticated: true,
    calendarEvents: [],
    emailMessages: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", level: 1 })).toBeVisible();
  await expect(page.getByText("No upcoming events")).toBeVisible();
  await expect(page.getByText("Calendar is coming soon.")).toHaveCount(0);

  await page.locator(".module-nav").getByRole("link", { name: "Email" }).click();
  await expect(page.getByRole("heading", { name: "Email", level: 1 })).toBeVisible();
  await expect(page.getByText("No email messages")).toBeVisible();
  await expect(page.getByText("Email is coming soon.")).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "Connector Providers" })).toBeVisible();

  const connectorAccounts = page.getByRole("region", { name: "Connector Accounts" });

  await expect(connectorAccounts.getByText("Google Email")).toBeVisible();

  await connectorAccounts.getByRole("button", { name: "Mark error" }).click();
  await expect(connectorAccounts.getByText(/error - gmail\.readonly/)).toBeVisible();

  await connectorAccounts.getByRole("button", { name: "Revoke" }).click();
  await expect(connectorAccounts.getByText("Revoked", { exact: true })).toBeVisible();
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

  const aiProviders = page.getByRole("region", { name: "AI Providers" });
  const aiModels = page.getByRole("region", { name: "AI Models" });
  const aiRouting = page.getByRole("region", { name: "Capability Routing" });

  await expect(aiProviders).toBeVisible();
  await aiProviders.getByLabel("Provider").selectOption("anthropic");
  await aiProviders.getByLabel("Display name").fill("Anthropic Smoke");
  await aiProviders.getByLabel("Credential JSON").fill('{"apiKey":"secret"}');
  await aiProviders.getByRole("button", { name: "Add AI provider" }).click();
  await expect(aiProviders.getByText("Anthropic Smoke")).toBeVisible();

  await aiModels.getByLabel("Provider").selectOption("ai-provider-1");
  await aiModels.getByLabel("Model id").fill("claude-smoke");
  await aiModels.getByLabel("Display name").fill("Haiku Smoke");
  await aiModels.getByLabel("tool-use").check();
  await aiModels.getByRole("button", { name: "Add model" }).click();
  await expect(aiModels.getByText("Haiku Smoke")).toBeVisible();
  await expect(aiRouting.getByText("Haiku Smoke via Anthropic Smoke")).toBeVisible();
  await expect(aiRouting.getByText("tasks.updateStatus")).toBeVisible();

  await aiProviders.getByRole("button", { name: "Deactivate" }).click();
  await expect(aiProviders.getByText(/anthropic - disabled/)).toBeVisible();

  await aiProviders.getByRole("button", { name: "Revoke" }).click();
  await expect(aiProviders.getByText("Revoked", { exact: true })).toBeVisible();
});

test("creates and runs briefings through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    briefingDefinitions: [createMockBriefingDefinition("briefing-existing", "Daily digest")],
    briefingRuns: {
      "briefing-existing": []
    },
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [createMockTask("task-briefing", "M6 briefings smoke source")]
  });

  await page.goto("/briefings");
  await expect(page.getByRole("heading", { name: "Briefings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Daily digest" })).toBeVisible();

  const definitions = page.locator('[aria-label="Briefing definitions"]');
  const detail = page.locator('[aria-label="Briefing detail"]');

  await definitions.getByLabel("New briefing title").fill("M6 briefing smoke");
  await definitions.getByLabel("tasks.listVisible").check();
  await definitions.getByRole("button", { name: "Create briefing" }).click();
  await expect(page.getByRole("button", { name: "M6 briefing smoke" })).toBeVisible();

  await detail.getByLabel("Edit briefing title").fill("M6 briefing smoke updated");
  await detail.getByRole("button", { name: "Save briefing" }).click();
  await expect(page.getByRole("button", { name: "M6 briefing smoke updated" })).toBeVisible();

  await detail.getByRole("button", { name: "Run briefing" }).click();
  await expect(detail.getByText(/Queued briefing-run/)).toBeVisible();
  await expect(detail.getByText("succeeded", { exact: true })).toBeVisible();
  await expect(detail.getByText("Tasks: 1 visible; top: M6 briefings smoke source")).toBeVisible();
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
    await page.locator(".module-nav").getByRole("button", { name: "Chat" }).click();

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
    await page.locator(".module-nav").getByRole("button", { name: "Chat" }).click();

    await expect(page.locator(".action-request-card")).toBeVisible({ timeout: 3000 });
    await page.locator(".action-request-card").getByRole("button", { name: "Deny" }).click();
    await expect(page.locator(".action-request-card")).toContainText("Resolved.");

    // Assert the rejection decision and the path's action-request id actually went over the wire.
    expect(resolveBody).toEqual({ status: "rejected" });
    expect(resolveUrl).toContain("/api/chat/action-requests/ar_test_2/resolve");
  });
});
