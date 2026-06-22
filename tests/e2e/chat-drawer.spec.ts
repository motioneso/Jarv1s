import { expect, test, type Page } from "@playwright/test";

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

  // "New chat" clears the transcript. (Assert the streamed records are gone rather than a
  // specific empty-state copy: since v0.1.4 the empty state is onboarding-gated and shows the
  // connect-a-provider explainer when no provider is configured, as in this mock.)
  await drawer.getByRole("button", { name: "New chat" }).click();
  await expect(drawer.getByText("Hello from the assistant")).toHaveCount(0);
  await expect(drawer.getByText("Hi there")).toHaveCount(0);
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

  await drawer.getByRole("button", { name: "Show chat history" }).click();
  await drawer.getByRole("button", { name: "Planning notes" }).click();

  await expect(drawer.getByText("What did we decide?")).toBeVisible();
  await expect(drawer.getByText("We chose the small path.")).toBeVisible();
  await drawer.getByText("Behind the scenes").click();
  await expect(drawer.getByText("Looked up prior notes")).toBeVisible();
  await expect(drawer.getByLabel("Message Jarvis")).toBeDisabled();
});

test("reviewing an empty history row does not expose send suggestions", async ({ page }) => {
  let turnRequests = 0;
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "thread-empty",
        ownerUserId: "user-1",
        title: "Empty review",
        createdAt: "2026-06-05T12:00:00.000Z",
        updatedAt: "2026-06-05T12:00:00.000Z"
      }
    ],
    chatMessages: { "thread-empty": [] },
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [
      {
        id: "task-1",
        ownerUserId: "user-1",
        listId: "list-1",
        title: "Call Sam",
        description: null,
        status: "todo",
        priority: null,
        position: 0,
        dueAt: null,
        doAt: null,
        effort: null,
        parentTaskId: null,
        source: "manual",
        sourceRef: null,
        completedAt: null,
        tags: [],
        createdAt: "2026-06-05T12:00:00.000Z",
        updatedAt: "2026-06-05T12:00:00.000Z"
      }
    ]
  });
  await page.route("**/api/chat/turn", (route) => {
    turnRequests += 1;
    return route.fulfill({ status: 500, body: "" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });

  await drawer.getByRole("button", { name: "Show chat history" }).click();
  await drawer.getByRole("button", { name: "Empty review" }).click();

  await expect(drawer.getByLabel("Message Jarvis")).toBeDisabled();
  await expect(drawer.getByText("What can I help with?")).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /Call Sam/ })).toHaveCount(0);
  expect(turnRequests).toBe(0);
});

/**
 * Helper: serve a single assistant `reply` record over the SSE stream (the source of
 * truth), then hold any reconnect open so the event does not replay. Mirrors the
 * one-shot stream pattern used above.
 */
async function streamReply(page: Page, replyText: string) {
  let streamServed = false;
  await page.route("**/api/chat/stream", async (route) => {
    if (streamServed) {
      return; // hold reconnect open; no replay
    }
    streamServed = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: `data: ${JSON.stringify({ kind: "reply", text: replyText })}\n\n`
    });
  });
}

test("renders assistant markdown as rich HTML (table, bold, code, list)", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const md =
    "**bold text** and `inline`\n\n" +
    "| A | B |\n|---|---|\n| 1 | 2 |\n\n" +
    "- one\n- two\n\n" +
    "```\ncode block\n```";
  await streamReply(page, md);

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();

  // Markdown parsed into semantic elements (not literal source).
  await expect(drawer.locator(".chatd-md table")).toHaveCount(1);
  await expect(drawer.locator(".chatd-md strong")).toHaveText("bold text");
  await expect(drawer.locator(".chatd-md code").first()).toContainText("inline");
  await expect(drawer.locator(".chatd-md pre")).toContainText("code block");
  await expect(drawer.locator(".chatd-md li")).toHaveCount(2);
  // The raw GFM table source must NOT appear literally.
  await expect(drawer.getByText("| A | B |")).toHaveCount(0);
});

test("does not inject executable HTML from untrusted markdown", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // Untrusted reply covering every injection vector: raw <script>, an <img onerror>, a
  // raw-HTML event-handler blob, a javascript: markdown link, a data:text/html markdown
  // link, and a bare URL (which remark-gfm autolinks into an <a> without link syntax).
  // None may produce executable HTML; only http(s)/mailto hrefs may survive.
  const evil =
    "<script>window.__pwned = 1</script>\n\n" +
    '<img src=x onerror="window.__pwned = 1">\n\n' +
    '<div onclick="window.__pwned = 1">raw html blob</div>\n\n' +
    "[click me](javascript:alert(1))\n\n" +
    "[doc link](data:text/html,<script>window.__pwned=1</script>)\n\n" +
    "bare autolink https://example.com/safe here";
  await streamReply(page, evil);

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();
  // Wait for the reply to render (the link text survives as plain text).
  await expect(drawer.getByText("click me")).toBeVisible();
  // The markdown renderer is active (ties this security test to the feature).
  await expect(drawer.locator(".chatd-md")).toHaveCount(1);
  // The bare URL was autolinked (proves the gfm autolink path is exercised, not bypassed).
  await expect(drawer.locator('.chatd-md a[href="https://example.com/safe"]')).toHaveCount(1);

  // No script/img/event-handler element was injected into the chat bubble.
  await expect(drawer.locator(".chatd-md script")).toHaveCount(0);
  await expect(drawer.locator(".chatd-md img")).toHaveCount(0);
  await expect(drawer.locator(".chatd-md [onclick]")).toHaveCount(0);

  // Every surviving href is on the http(s)/mailto allowlist — no javascript:/data:/etc.
  const hrefs = await drawer
    .locator(".chatd-md a")
    .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""));
  for (const href of hrefs) {
    expect(href === "" || /^(https?:|mailto:)/i.test(href)).toBe(true);
  }

  // Every rendered link opens safely.
  const rels = await drawer
    .locator(".chatd-md a")
    .evaluateAll((els) => els.map((el) => el.getAttribute("rel") ?? ""));
  for (const rel of rels) {
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  }

  // The injection side-effect never fired.
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)
  ).toBeUndefined();
});

test("renders a large markdown reply without error", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // A reply arrives as ONE whole record (the backend pushes the full reply text; the SSE
  // consumer is append-only and never grows a record token-by-token). This guards that a
  // large markdown body renders correctly in a single parse — the realistic worst case.
  const big = Array.from({ length: 80 }, (_, i) => `## Section ${i}\n\n- item **${i}**`).join(
    "\n\n"
  );
  await streamReply(page, big);

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();

  await expect(drawer.locator(".chatd-md h2")).toHaveCount(80);
  await expect(drawer.locator(".chatd-md li")).toHaveCount(80);
});
