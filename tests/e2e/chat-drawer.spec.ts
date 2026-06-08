import { expect, test } from "@playwright/test";

import { createMockConnectorProviders, mockApi } from "./mock-api.js";

/**
 * Live chat drawer E2E.
 *
 * What is mocked:
 *  - The full REST surface via mockApi (auth/me/modules/etc.).
 *  - POST /api/chat/turn → { reply } so the assistant reply renders via the POST path.
 *  - POST /api/chat/clear → 204 for the "New chat" action.
 *  - GET  /api/chat/stream (SSE) → an immediately-closed empty event-stream response.
 *    Mocking a live EventSource in Playwright is awkward, so the drawer degrades
 *    gracefully: it renders the user's message optimistically and renders the reply
 *    from the sendChatTurn() POST response. The stream is stubbed only so the
 *    EventSource connection resolves without hanging or erroring the page.
 */
test("opens the live chat drawer, sends a message, and renders the reply", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // Stub the SSE stream with an empty, closed event-stream body.
  await page.route("**/api/chat/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: ""
    })
  );

  await page.route("**/api/chat/turn", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: "Hello from the assistant" })
    })
  );

  await page.route("**/api/chat/clear", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Chat" })).toBeVisible();

  await page.getByRole("button", { name: "Live chat" }).click();
  const drawer = page.getByRole("complementary", { name: "Live chat" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Send a message to start chatting")).toBeVisible();

  await drawer.getByLabel("Message").fill("Hi there");
  await drawer.getByRole("button", { name: "Send" }).click();

  // User message renders optimistically; reply renders from the POST response.
  await expect(drawer.getByText("Hi there")).toBeVisible();
  await expect(drawer.getByText("Hello from the assistant")).toBeVisible();

  // "New chat" clears the local transcript.
  await drawer.getByRole("button", { name: "New chat" }).click();
  await expect(drawer.getByText("Send a message to start chatting")).toBeVisible();
});
