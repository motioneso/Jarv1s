import { expect, test } from "@playwright/test";

import { createMockConnectorProviders, mockApi } from "./mock-api.js";

/**
 * Live chat drawer E2E.
 *
 * What is mocked:
 *  - The full REST surface via mockApi (auth/me/modules/etc.).
 *  - POST /api/chat/turn → { reply } (the drawer ignores this body; the stream renders).
 *  - POST /api/chat/clear → 204 for the "New chat" action.
 *  - GET  /api/chat/stream (SSE) → a one-shot, fulfilled text/event-stream body
 *    containing the user echo and the assistant reply as two `data:` events.
 *
 * The SSE stream is the SINGLE SOURCE OF TRUTH for rendered records: the drawer no
 * longer appends the POST response, so a real stream mock is required (not an empty
 * stub). Playwright's route.fulfill with a string event-stream body works here — the
 * browser EventSource reads the two events, then the fulfilled connection ends.
 * We assert both records render exactly once (no double-render).
 *
 * The chat is now a GLOBAL drawer mounted in the app shell and toggled from the topbar.
 * The stream connects at app load, so the records
 * have already arrived by the time we open the drawer.
 */
test("opens the live chat drawer from the nav and renders the streamed records once", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // Mock the SSE stream as the source of truth: a one-shot event-stream body with
  // the user echo and the assistant reply. The EventSource reads both events, then
  // the fulfilled connection ends. EventSource auto-reconnects after a closed
  // stream, so we serve the two events ONCE and then hold the connection open
  // (empty body, never resolved) on reconnect — otherwise the events would replay
  // and the records would render twice.
  let streamServed = false;
  await page.route("**/api/chat/stream", async (route) => {
    if (streamServed) {
      // Hold the reconnect open with no data so events don't replay.
      return; // leave the route hanging; the page is about to assert and finish
    }
    streamServed = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body:
        'data: {"kind":"user","text":"Hi there"}\n\n' +
        'data: {"kind":"reply","text":"Hello from the assistant"}\n\n'
    });
  });

  await page.route("**/api/chat/turn", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: "Hello from the assistant" })
    })
  );

  await page.route("**/api/chat/clear", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/");

  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();

  // Send a turn (the reply arrives over the SSE stream, which is the source of truth).
  await drawer.getByLabel("Message Jarvis").fill("Hi there");
  await drawer.getByLabel("Message Jarvis").press("Enter");

  // Both records arrive over the SSE stream and render exactly once each.
  await expect(drawer.getByText("Hi there")).toHaveCount(1);
  await expect(drawer.getByText("Hello from the assistant")).toHaveCount(1);

  // "New chat" clears the transcript.
  await drawer.getByRole("button", { name: "New chat" }).click();
  await expect(drawer.getByText("What can I help with?")).toBeVisible();
});

test("clicking a history row renders stored messages read-only", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "thread-old",
        ownerUserId: "user-1",
        title: "Planning notes",
        createdAt: "2026-06-05T12:00:00.000Z",
        updatedAt: "2026-06-05T12:00:00.000Z"
      }
    ],
    chatMessages: {
      "thread-old": [
        {
          id: "msg-user",
          threadId: "thread-old",
          ownerUserId: "user-1",
          role: "user",
          status: "stored",
          body: "What did we decide?",
          modelRoute: null,
          tools: [],
          activity: [],
          createdAt: "2026-06-05T12:01:00.000Z",
          updatedAt: "2026-06-05T12:01:00.000Z"
        },
        {
          id: "msg-assistant",
          threadId: "thread-old",
          ownerUserId: "user-1",
          role: "assistant",
          status: "stored",
          body: "We chose the small path.",
          modelRoute: null,
          tools: [],
          activity: [{ kind: "tool", text: "Looked up prior notes" }],
          createdAt: "2026-06-05T12:02:00.000Z",
          updatedAt: "2026-06-05T12:02:00.000Z"
        }
      ]
    },
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });

  await drawer.getByRole("button", { name: "Planning notes" }).click();

  await expect(drawer.getByText("What did we decide?")).toBeVisible();
  await expect(drawer.getByText("We chose the small path.")).toBeVisible();
  await drawer.getByText("Behind the scenes").click();
  await expect(drawer.getByText("Looked up prior notes")).toBeVisible();
  await expect(drawer.getByLabel("Message Jarvis")).toBeDisabled();
});
