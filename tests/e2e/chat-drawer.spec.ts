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

test("private activation blocks send until the server confirms, then allows it", async ({
  page
}) => {
  let releaseClear: (() => void) | undefined;
  const clearGate = {
    promise: new Promise<void>((resolve) => {
      releaseClear = resolve;
    }),
    release: () => releaseClear?.()
  };

  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    clearGate
  });

  let turnCalled = false;
  await page.route("**/api/chat/turn", async (route) => {
    turnCalled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  // The shared mock's SSE stream closes after one heartbeat, which fires EventSource.onerror
  // and would end the private session mid-test. Keep it pending — this test doesn't assert
  // on stream events.
  await page.route("**/api/chat/stream", () => new Promise<void>(() => {}));

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Start private chat" }).click();

  // While the server confirmation is held open, the private banner must not show yet,
  // and attempting to send must not reach POST /api/chat/turn.
  await expect(drawer.locator(".chatd-private").filter({ hasText: "not saved" })).toHaveCount(0);
  await drawer.getByLabel("Message Jarvis").fill("secret during race");
  await drawer.getByLabel("Message Jarvis").press("Enter");
  await page.waitForTimeout(100);
  expect(turnCalled).toBe(false);

  clearGate.release();

  await expect(drawer.locator(".chatd-private").filter({ hasText: "not saved" })).toBeVisible();
});

test("reloading the page restores private-mode indication from server truth", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    incognito: true
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();

  await expect(drawer.getByRole("button", { name: "Start private chat" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("stages next message while response is running and sends it after stop", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  const turnTexts: string[] = [];
  let cancelRequests = 0;
  let releaseFirstTurn: (() => void) | null = null;
  const firstTurnStopped = new Promise<void>((resolve) => {
    releaseFirstTurn = resolve;
  });

  await page.route("**/api/chat/turn", async (route) => {
    const body = route.request().postDataJSON() as { readonly text: string };
    turnTexts.push(body.text);

    if (body.text === "First question") {
      await firstTurnStopped;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: `Reply for ${body.text}` })
    });
  });

  await page.route("**/api/chat/turn/cancel", async (route) => {
    cancelRequests += 1;
    releaseFirstTurn?.();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/chat/clear", (route) => route.fulfill({ status: 204, body: "" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  const composerInput = drawer.getByLabel("Message Jarvis");
  const queuedChip = drawer.locator(".chatd-next__text");

  await composerInput.fill("First question");
  await composerInput.press("Enter");

  const composerAction = drawer.locator(".chatd-input .chatd-send");
  await expect(composerAction).toHaveAttribute("aria-label", "Stop generating");
  await expect(drawer.locator(".chatd-loading .chatd-stop")).toHaveCount(0);

  await composerInput.fill("Line one");
  await composerInput.press("Shift+Enter");
  await expect(composerInput).toHaveValue("Line one\n");
  await composerInput.type("Line two");
  await composerInput.press("Enter");
  await expect(composerInput).toHaveValue("");
  await expect(queuedChip).toContainText('Next: "Line one Line two"');

  await composerInput.fill("Replacement next");
  await composerInput.press("Enter");
  await expect(queuedChip).toContainText('Next: "Replacement next"');
  await expect(drawer.getByText(/Line one/)).toHaveCount(0);

  await drawer.getByRole("button", { name: "Edit queued message" }).click();
  await expect(composerInput).toHaveValue("Replacement next");
  await expect(drawer.getByText(/Next:/)).toHaveCount(0);

  await composerInput.fill("Discard me");
  await composerInput.press("Enter");
  await drawer.getByRole("button", { name: "Discard queued message" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(drawer.getByText(/Next:/)).toHaveCount(0);

  await composerInput.fill("Drained queued");
  await composerInput.press("Enter");
  await expect(queuedChip).toContainText('Next: "Drained queued"');

  await composerAction.click();

  await expect.poll(() => turnTexts).toEqual(["First question", "Drained queued"]);
  expect(cancelRequests).toBe(1);
  await expect(drawer.getByText(/Next:/)).toHaveCount(0);
});

test("selecting a History row both opens and activates it — no separate resume step", async ({
  page
}) => {
  let resumeCalledWith: string | null = null;
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "thread-old",
        ownerUserId: "user-1",
        title: "Old chat",
        incognito: false,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    ],
    chatMessages: { "thread-old": [] },
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });
  await page.route("**/api/chat/threads/thread-old/resume", async (route) => {
    resumeCalledWith = "thread-old";
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await drawer.getByRole("button", { name: "Show chat history" }).click();
  await drawer.getByText("Old chat").click();

  await expect.poll(() => resumeCalledWith).toBe("thread-old");
  await expect(drawer.locator(".chatd-review")).toHaveCount(0);
  await expect(drawer.getByLabel("Message Jarvis")).toBeEditable();
});

test("clicking a history row renders stored messages while activation is pending", async ({
  page
}) => {
  let completeResume: (() => void) | undefined;
  await mockApi(page, {
    authenticated: true,
    chatThreads: [
      {
        id: "thread-old",
        ownerUserId: "user-1",
        title: "Planning notes",
        incognito: false,
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
  await page.route("**/api/chat/threads/thread-old/resume", async (route) => {
    await new Promise<void>((resolve) => {
      completeResume = resolve;
    });
    await route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });

  await drawer.getByRole("button", { name: "Show chat history" }).click();
  await drawer.locator("button.chatd-sess__row").filter({ hasText: "Planning notes" }).click();

  await expect(drawer.getByText("What did we decide?")).toBeVisible();
  await expect(drawer.getByText("We chose the small path.")).toBeVisible();
  await drawer.getByText("Behind the scenes").click();
  await expect(drawer.getByText("Looked up prior notes")).toBeVisible();
  await expect(drawer.getByLabel("Message Jarvis")).toBeEditable();

  completeResume?.();
  await expect(drawer.getByRole("button", { name: "Show chat history" })).toBeVisible();
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

test("#638: reopening the drawer scrolls to the newest message, not the top", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // Enough records to overflow the drawer body so a fresh (top-scrolled) mount is
  // visibly distinguishable from a bottom-pinned one.
  const events = Array.from(
    { length: 30 },
    (_, i) => `data: ${JSON.stringify({ kind: "reply", text: `Message number ${i}` })}\n\n`
  ).join("");
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
      body: events
    });
  });

  await page.goto("/");

  const navToggle = page.getByRole("button", { name: "Chat with Jarvis" });
  await navToggle.click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Message number 29")).toBeVisible();

  // Close, then reopen — the drawer unmounts its scroll container while closed (renders
  // null), so a fresh mount must re-pin to the newest message rather than starting at the top.
  await navToggle.click();
  await expect(drawer).toBeHidden();
  await navToggle.click();
  await expect(drawer).toBeVisible();

  await expect(drawer.getByText("Message number 29")).toBeInViewport();
});

test("#664: a sent message renders after the prior turn, not at the top", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  // Hold the SSE stream open WITHOUT delivering any records. This isolates the
  // POST-fallback path: props.records stays empty, so records rendered while waiting for
  // the stream come entirely from fallbackRecords + the optimistic pending bubble.
  await page.route("**/api/chat/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: ""
    })
  );

  // POST /turn #1 resolves immediately so its user+reply land in fallbackRecords before #2.
  // POST /turn #2 is held pending so the optimistic pending bubble stays on screen for the
  // ordering assertion (once it resolves the records reshuffle).
  const gate: { resolve: (() => void) | null } = { resolve: null };
  const secondTurnReleased = new Promise<void>((resolve) => {
    gate.resolve = resolve;
  });
  await page.route("**/api/chat/turn", async (route) => {
    const body = route.request().postDataJSON() as { readonly text: string };
    if (body.text === "Second message") {
      await secondTurnReleased;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: `Reply to ${body.text}`,
        userMessageId: `user-${body.text}`,
        assistantMessageId: `assistant-${body.text}`
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Chat with Jarvis" }).click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  const composerInput = drawer.getByLabel("Message Jarvis");

  // Send #1 — POST resolves, fallbackRecords becomes [user1, reply1]. SSE delivers nothing.
  await composerInput.fill("First message");
  await composerInput.press("Enter");
  await expect(drawer.getByText("Reply to First message")).toBeVisible();

  // Send #2 — held pending, so the optimistic "Second message" bubble is on screen.
  await composerInput.fill("Second message");
  await composerInput.press("Enter");

  // The just-sent "Second message" must render AFTER the prior turn, not at the top.
  // Today this FAILS: effectiveRecords = [pendingUser2, user1, reply1] (user2 on top, #664).
  const userBubbles = drawer.locator(".chatd-msg--me .chatd-bubble");
  await expect
    .poll(async () => (await userBubbles.allTextContents()).map((t) => t.trim()))
    .toEqual(["First message", "Second message"]);

  gate.resolve?.();
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
