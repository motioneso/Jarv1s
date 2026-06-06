import { expect, test } from "@playwright/test";

import {
  createMockBriefingDefinition,
  createMockCalendarEvent,
  createMockConnectorProviders,
  createMockEmailMessage,
  createMockNote,
  createMockNotification,
  createMockTask,
  mockApi
} from "./mock-api.js";

test("signs in and renders shell navigation", async ({ page }) => {
  await mockApi(page, {
    authenticated: false,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notes: [],
    notifications: [],
    tasks: []
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();

  await expect(page.locator(".module-nav").getByRole("link", { name: "Tasks" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Notes" })).toBeVisible();
  await expect(
    page.locator(".module-nav").getByRole("link", { name: "Notifications" })
  ).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Calendar" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Email" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Chat" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Briefings" })).toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveValue("workspace-1");
});

test("creates and updates tasks through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notes: [],
    notifications: [],
    tasks: [createMockTask("task-1", "Existing secure task")]
  });

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Task Board" })).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveValue("workspace-1");

  await page.getByLabel("Title").fill("Plan M4 smoke");
  await page.getByLabel("Description").fill("Exercise the Tasks API from the UI");
  await page.getByRole("button", { name: "Add task" }).click();

  await expect(page.getByRole("link", { name: "Plan M4 smoke" })).toBeVisible();
  await page.getByLabel("Status for Plan M4 smoke").selectOption("done");
  await expect(page.getByLabel("Status for Plan M4 smoke")).toHaveValue("done");

  await page.getByRole("link", { name: "Plan M4 smoke" }).click();
  await expect(page.getByRole("heading", { name: "Edit Task" })).toBeVisible();

  await page.getByLabel("Title").fill("Plan M4 smoke updated");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Plan M4 smoke updated");

  await page.getByLabel("Comment").fill("Activity from smoke test");
  await page.getByRole("button", { name: "Add activity" }).click();
  await expect(page.getByText("Activity saved")).toBeVisible();
});

test("creates, reads, updates, and archives notes through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notes: [createMockNote("note-1", "Existing private note")],
    notifications: [],
    tasks: []
  });

  await page.goto("/notes");
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveValue("workspace-1");

  await page.getByLabel("Title").fill("Plan M5 notes");
  await page.getByLabel("Body").fill("Exercise the Notes API from the UI");
  await page.getByRole("button", { name: "Add note" }).click();

  await expect(page.getByRole("link", { name: "Plan M5 notes" })).toBeVisible();
  await page.getByRole("link", { name: "Plan M5 notes" }).click();
  await expect(page.getByRole("heading", { name: "Edit Note" })).toBeVisible();

  await page.getByLabel("Title").fill("Plan M5 notes updated");
  await page.getByLabel("Body").fill("Updated note body");
  await page.getByLabel("Archived").check();
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Plan M5 notes updated");
  await expect(page.getByLabel("Archived")).toBeChecked();

  await page.locator(".back-link", { hasText: "Notes" }).click();
  await page.getByRole("button", { name: /Archived/ }).click();
  await expect(page.getByRole("link", { name: "Plan M5 notes updated" })).toBeVisible();
});

test("lists and marks notifications read through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notes: [],
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

test("navigates Calendar and Email read surfaces through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    calendarEvents: [
      createMockCalendarEvent("event-1", "Design review", {
        location: "Alpha room",
        summary: "Review the MVP shell"
      })
    ],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    emailMessages: [
      createMockEmailMessage("message-1", "Launch note", {
        sender: "team@example.test",
        recipients: ["owner@example.test"],
        snippet: "Thin read surfaces are ready"
      })
    ],
    notes: [],
    notifications: [],
    tasks: []
  });

  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByText("Design review")).toBeVisible();
  await expect(page.getByText("Alpha room")).toBeVisible();

  await page.locator(".module-nav").getByRole("link", { name: "Email" }).click();
  await expect(page.getByRole("heading", { name: "Email" })).toBeVisible();
  await expect(page.getByText("Launch note")).toBeVisible();
  await expect(page.getByText("Thin read surfaces are ready")).toBeVisible();
});

test("adds and revokes connector accounts through settings REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notes: [],
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Connector Providers" })).toBeVisible();

  const connectorAccounts = page.getByRole("region", { name: "Connector Accounts" });

  await connectorAccounts.getByLabel("Provider").selectOption("google-email");
  await connectorAccounts.getByLabel("Scopes").fill("gmail.readonly");
  await connectorAccounts.getByLabel("Token JSON").fill('{"accessToken":"secret"}');
  await connectorAccounts.getByRole("button", { name: "Add connector" }).click();
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
    notes: [],
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

test("creates chat threads and records assistant metadata through REST calls", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    aiModels: [
      {
        id: "ai-model-chat",
        providerConfigId: "ai-provider-chat",
        providerKind: "anthropic",
        providerDisplayName: "Anthropic Smoke",
        providerStatus: "active",
        providerModelId: "claude-smoke",
        displayName: "Claude Smoke",
        capabilities: ["chat", "tool-use"],
        status: "active",
        createdAt: "2026-06-06T12:00:00.000Z",
        updatedAt: "2026-06-06T12:00:00.000Z"
      }
    ],
    aiProviders: [
      {
        id: "ai-provider-chat",
        providerKind: "anthropic",
        displayName: "Anthropic Smoke",
        baseUrl: null,
        status: "active",
        hasCredential: true,
        revokedAt: null,
        createdAt: "2026-06-06T12:00:00.000Z",
        updatedAt: "2026-06-06T12:00:00.000Z"
      }
    ],
    chatMessages: {},
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notes: [],
    notifications: [],
    tasks: [createMockTask("task-chat", "Chat must not mutate this task")]
  });

  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();
  await expect(page.getByText("Claude Smoke via Anthropic Smoke")).toBeVisible();
  await expect(
    page.getByLabel("Assistant tool metadata").getByText("tasks.updateStatus")
  ).toBeVisible();

  await page.getByLabel("Thread title").fill("M6 chat smoke");
  await page.getByRole("button", { name: "Create thread" }).click();
  await expect(page.getByRole("button", { name: "M6 chat smoke" })).toBeVisible();

  await page.getByLabel("Message").fill("Please update task status");
  await page.getByLabel("tasks.updateStatus").check();
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Please update task status")).toBeVisible();
  await expect(page.getByText("blocked", { exact: true })).toBeVisible();
  await expect(page.getByText(/Tool request recorded but blocked/)).toBeVisible();
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
    notes: [],
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
  await detail.getByLabel("notes.listVisible").check();
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
