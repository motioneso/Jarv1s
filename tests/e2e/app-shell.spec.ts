import { expect, test } from "@playwright/test";

import {
  createMockConnectorAccount,
  createMockConnectorProviders,
  createMockUser,
  createMockNotification,
  createMockTask,
  mockApi
} from "./mock-api.js";
import { createMockAiModel } from "./mock-ai-api.js";

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

  await expect(page.getByRole("heading", { name: "Account & preferences" })).toBeVisible();
  await expect(page.getByText("Member of this instance.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin / Setup" })).toHaveCount(0);
  await expect(page.getByText("People & access")).toHaveCount(0);
});

test("people access uses approval model and revokes member sessions", async ({ page }) => {
  let revokeUrl: string | undefined;

  await mockApi(page, {
    authenticated: true,
    adminUsers: [
      createMockUser("user-1", "Owner User", "owner@example.test", {
        isInstanceAdmin: true,
        isBootstrapOwner: true
      }),
      createMockUser("member-1", "Member User", "member@example.test")
    ],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    revokedAdminSessionCount: 3,
    tasks: []
  });

  await page.route("**/api/admin/users/*/revoke-sessions", async (route) => {
    revokeUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, count: 3 })
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Admin / Setup" }).click();

  await expect(page.getByRole("heading", { name: "People & access" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Invite/i })).toHaveCount(0);
  await expect(
    page.getByText("New people create an account, then wait for approval here.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Actions for Member User" }).click();
  await page.getByRole("menuitem", { name: "Sign out everywhere" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign out Member User everywhere?" })
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Sign out Member User everywhere?" })
    .getByRole("button", { name: "Sign out everywhere" })
    .click();

  await expect.poll(() => revokeUrl).toContain("/api/admin/users/member-1/revoke-sessions");
  await expect(
    page.getByText("Member User signed out everywhere (3 sessions revoked)")
  ).toBeVisible();
  await expect(page.getByText(/session-/i)).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Day", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Week", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Month", exact: true })).toBeVisible();
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

test("auto-discovers AI models and configures capability routing through settings REST calls", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    aiModels: [
      createMockAiModel("ai-model-auto", {
        providerConfigId: "ai-provider-1",
        providerKind: "anthropic",
        providerDisplayName: "Anthropic",
        providerModelId: "gpt-4o",
        displayName: "gpt-4o",
        capabilities: ["chat", "tool-use", "json", "summarization"]
      })
    ],
    aiProviders: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");
  // Provider roster + capability routing live under Admin -> Assistant & AI.
  await page.getByRole("button", { name: "Admin / Setup" }).click();
  await page.getByRole("button", { name: "Assistant & AI" }).click();

  await expect(page.getByRole("heading", { name: "Assistant & AI" })).toBeVisible();
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByRole("button", { name: "Anthropic", exact: true }).click();
  await expect(page.locator(".prov__name", { hasText: "Anthropic" })).toBeVisible();

  await page.getByRole("button", { name: "Test", exact: true }).click();
  await expect(page.getByText("Provider credential is valid.")).toBeVisible();

  // #982/#869 Lane B: connecting is the whole setup flow. Models appear automatically and the
  // manual Discover/Add/picker surfaces no longer exist.
  await expect(page.locator(".mdl__id", { hasText: "gpt-4o" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Discover", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Discovered models")).toHaveCount(0);
  await expect(page.getByLabel("Model id")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add model", exact: true })).toHaveCount(0);

  // #870 Slice 1: services (Chat / Voice) replace the old capability-routing rows.
  // exact:true — the default substring match also hits the footer Note ("…follows the
  // services above"), so scope to the section heading div (strict-mode 2-element violation).
  await expect(page.getByText("Services", { exact: true })).toBeVisible();
  await expect(page.getByText(/Routing override .*not wired/)).toHaveCount(0);
  await page.getByLabel("Binding for Chat & briefing").selectOption("mode:reasoning");
  await expect(page.getByText("Service updated")).toBeVisible();

  await page.getByRole("button", { name: "Remove Anthropic" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("No providers yet")).toBeVisible();
});

test("serves PWA metadata", async ({ page }) => {
  const response = await page.request.get("/manifest.webmanifest");
  const manifest = (await response.json()) as { readonly name?: string };

  expect(response.ok()).toBe(true);
  expect(manifest.name).toBe("Jarv1s");
});

test.describe("Chat drawer — Approve/Reject card", () => {
  test("renders Approve/Reject card and resolves on Approve", async ({ page }) => {
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

    // Wait for the Approve/Reject card to appear
    await expect(page.locator(".action-request-card")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".action-request-summary")).toContainText("Write the value 'test'");

    // Approve
    await page.locator(".action-request-card").getByRole("button", { name: "Approve" }).click();

    // Card should show Resolved.
    await expect(page.locator(".action-request-card")).toContainText("Resolved.");

    // Assert the approval decision and the path's action-request id actually went over the wire.
    expect(resolveBody).toEqual({ status: "confirmed" });
    expect(resolveUrl).toContain("/api/chat/action-requests/ar_test_1/resolve");
  });

  test("Reject resolves the card", async ({ page }) => {
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
    await page.locator(".action-request-card").getByRole("button", { name: "Reject" }).click();
    await expect(page.locator(".action-request-card")).toContainText("Resolved.");

    // Assert the rejection decision and the path's action-request id actually went over the wire.
    expect(resolveBody).toEqual({ status: "rejected" });
    expect(resolveUrl).toContain("/api/chat/action-requests/ar_test_2/resolve");
  });
});
