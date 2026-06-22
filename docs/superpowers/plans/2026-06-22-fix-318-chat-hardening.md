# Fix 318 Chat Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden live chat routes against excess route calls, unbounded SSE streams, write-after-close races, and oversized turn text.

**Architecture:** Keep changes local to the existing live chat surface. Reuse Fastify route-local rate limits with `sessionRateLimitKey`, keep stream counting inside `ChatSessionManager`, and enforce `text` length in `live-routes.ts` before manager calls.

**Tech Stack:** TypeScript, Fastify, @fastify/rate-limit, Vitest, Jarv1s chat live runtime.

---

## Files

- Modify: `packages/chat/src/live-routes.ts`
  - Add route-local limit constants for `/clear` and `/switch`.
  - Add explicit `MAX_CHAT_TURN_TEXT_LENGTH`.
  - Guard SSE writes with `destroyed` / `writableEnded`.
  - Map stream-limit errors to 429.
- Modify: `packages/chat/src/live/chat-session-manager.ts`
  - Add `ChatStreamLimitError`.
  - Add small per-actor subscriber cap, default 5.
  - Enforce cap at `subscribe`.
- Modify: `tests/integration/route-local-rate-limit.test.ts`
  - Extend route-local tests for `/clear` and `/switch`.
- Modify: `tests/unit/chat-session-manager.test.ts`
  - Add subscriber cap tests.
- Modify: `tests/integration/chat-live-api.test.ts`
  - Add max-length rejection and SSE write-after-close guard tests.

## Task 1: Route-Local Limits For Clear And Switch

**Files:**
- Modify: `tests/integration/route-local-rate-limit.test.ts`
- Modify: `packages/chat/src/live-routes.ts`

- [ ] **Step 1: Write failing tests**

Add two tests beside existing chat limiter tests:

```ts
process.env.JARVIS_RL_CHAT_MUTATION_MAX = "2";

it("rate-limits POST /api/chat/clear per valid session principal", async () => {
  const send = () =>
    chatApp.inject({
      method: "POST",
      url: "/api/chat/clear",
      remoteAddress: "203.0.113.80",
      headers: { authorization: `Bearer ${VALID_SESSION_UUID}` }
    });

  expect((await send()).statusCode).toBe(204);
  expect((await send()).statusCode).toBe(204);
  expect((await send()).statusCode).toBe(429);
});

it("rate-limits POST /api/chat/switch per valid session principal", async () => {
  const send = () =>
    chatApp.inject({
      method: "POST",
      url: "/api/chat/switch",
      remoteAddress: "203.0.113.81",
      headers: { authorization: `Bearer ${VALID_SESSION_UUID}` }
    });

  expect((await send()).statusCode).toBe(200);
  expect((await send()).statusCode).toBe(200);
  expect((await send()).statusCode).toBe(429);
});
```

Also extend `stubRuntime.manager` in the test setup:

```ts
const stubRuntime = {
  manager: {
    submitTurn: async () => ({ reply: "ok" }),
    clear: async () => undefined,
    switchProvider: async () => undefined
  },
  resolveUserName: async () => "Tester"
};
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm vitest run tests/integration/route-local-rate-limit.test.ts
```

Expected: new `/clear` and `/switch` tests fail because third request is not 429.

- [ ] **Step 3: Minimal implementation**

In `packages/chat/src/live-routes.ts`, add route constants:

```ts
const CHAT_MUTATION_MAX = parsePositiveIntEnv(process.env.JARVIS_RL_CHAT_MUTATION_MAX, 20);
```

Wrap `/clear` and `/switch` registrations with route config:

```ts
server.post(
  "/api/chat/clear",
  {
    config: {
      rateLimit: {
        max: CHAT_MUTATION_MAX,
        timeWindow: "1 minute",
        keyGenerator: sessionRateLimitKey
      }
    }
  },
  async (request, reply) => {
    // existing body unchanged
  }
);
```

Apply same config to `/api/chat/switch`. Use one env knob; both are state-mutating and share same ceiling.

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
pnpm vitest run tests/integration/route-local-rate-limit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/route-local-rate-limit.test.ts packages/chat/src/live-routes.ts
git commit -m "fix(chat): rate-limit live mutation routes" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 2: Per-Actor SSE Stream Ceiling

**Files:**
- Modify: `tests/unit/chat-session-manager.test.ts`
- Modify: `packages/chat/src/live/chat-session-manager.ts`

- [ ] **Step 1: Write failing tests**

Add tests under `describe("ChatSessionManager", ...)`:

```ts
it("caps simultaneous subscribers per actor", () => {
  const { manager } = makeManager();
  const unsubs = Array.from({ length: 5 }, () => manager.subscribe("user-1", () => {}));

  expect(() => manager.subscribe("user-1", () => {})).toThrow("Too many open chat streams");

  for (const unsubscribe of unsubs) unsubscribe();
});

it("allows another subscriber after unsubscribe frees a slot", () => {
  const { manager } = makeManager();
  const unsubs = Array.from({ length: 5 }, () => manager.subscribe("user-1", () => {}));

  unsubs.pop()?.();
  const unsubscribe = manager.subscribe("user-1", () => {});

  expect(unsubscribe).toBeTypeOf("function");
  unsubscribe();
  for (const remaining of unsubs) remaining();
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts
```

Expected: first new test fails because sixth subscriber does not throw.

- [ ] **Step 3: Minimal implementation**

In `chat-session-manager.ts`, add near other constants:

```ts
const MAX_SUBSCRIBERS_PER_ACTOR = 5;
```

Add exported error:

```ts
export class ChatStreamLimitError extends Error {
  constructor() {
    super("Too many open chat streams for this user.");
    this.name = "ChatStreamLimitError";
  }
}
```

Enforce in `subscribe` before `set.add(fn)`:

```ts
if (set.size >= MAX_SUBSCRIBERS_PER_ACTOR) {
  throw new ChatStreamLimitError();
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/chat-session-manager.test.ts packages/chat/src/live/chat-session-manager.ts
git commit -m "fix(chat): cap live stream subscribers" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 3: Stream Route 429 And Write Guard

**Files:**
- Modify: `tests/integration/chat-live-api.test.ts`
- Modify: `packages/chat/src/live-routes.ts`

- [ ] **Step 1: Write failing tests**

Add tests in `Chat live API (turn / clear / switch / stream)`:

```ts
it("GET /api/chat/stream returns 429 when actor already has max streams", async () => {
  const { createChatSessionRuntime, registerChatLiveRoutes } = await import("@jarv1s/chat");
  const Fastify = (await import("fastify")).default;
  const app = Fastify({ logger: false });
  const runtime = createChatSessionRuntime({ dataContext, engineFactory: fakeEngineFactory });
  const unsubs = Array.from({ length: 5 }, () => runtime.manager.subscribe(ids.userA, () => {}));
  try {
    registerChatLiveRoutes(app, {
      resolveAccessContext: async () => userAContext(),
      runtime
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/chat/stream" });

    expect(response.statusCode).toBe(429);
    expect(response.json<{ error: string }>().error).toBe("Too many open chat streams.");
  } finally {
    for (const unsubscribe of unsubs) unsubscribe();
    await app.close();
  }
});

it("does not write SSE records after the stream response is ended", async () => {
  const { createChatSessionRuntime, registerChatLiveRoutes } = await import("@jarv1s/chat");
  const Fastify = (await import("fastify")).default;
  const app = Fastify({ logger: false });
  const runtime = createChatSessionRuntime({ dataContext, engineFactory: fakeEngineFactory });
  let writes = 0;

  app.addHook("onRequest", (_request, reply, done) => {
    const raw = reply.raw as typeof reply.raw & { writeHead: typeof reply.raw.writeHead };
    raw.writeHead = (() => raw) as typeof raw.writeHead;
    raw.write = (() => {
      writes += 1;
      return true;
    }) as typeof raw.write;
    raw.end();
    done();
  });
  registerChatLiveRoutes(app, {
    resolveAccessContext: async () => userAContext(),
    runtime
  });
  await app.ready();

  await app.inject({ method: "GET", url: "/api/chat/stream" });
  runtime.manager.injectRecord(ids.userA, { kind: "reply", text: "late" });

  expect(writes).toBe(0);
  await app.close();
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm vitest run tests/integration/chat-live-api.test.ts
```

Expected: 429 test fails until route maps `ChatStreamLimitError`; write-guard test fails until callback skips ended stream.

- [ ] **Step 3: Minimal implementation**

Import `ChatStreamLimitError`:

```ts
import { ChatStreamLimitError, ChatTurnInFlightError } from "./live/chat-session-manager.js";
```

Wrap stream subscription:

```ts
let unsubscribe: (() => void) | undefined;
try {
  unsubscribe = runtime.manager.subscribe(access.actorUserId, (record) => {
    if (reply.raw.destroyed || reply.raw.writableEnded) return;
    reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
  });
} catch (error) {
  return handleLiveRouteError(error, reply);
}

request.raw.on("close", () => {
  unsubscribe?.();
  if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
});
```

Add error mapping:

```ts
if (error instanceof ChatStreamLimitError) {
  return reply.code(429).send({ error: "Too many open chat streams." });
}
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
pnpm vitest run tests/integration/chat-live-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/chat-live-api.test.ts packages/chat/src/live-routes.ts
git commit -m "fix(chat): guard live stream writes" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 4: Turn Text Max Length

**Files:**
- Modify: `tests/integration/chat-live-api.test.ts`
- Modify: `packages/chat/src/live-routes.ts`

- [ ] **Step 1: Write failing test**

Add test in `Chat live API (turn / clear / switch / stream)`:

```ts
it("POST /api/chat/turn rejects text over the per-turn max before processing", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/api/chat/turn",
    headers: { authorization: `Bearer ${ids.sessionA}` },
    payload: { text: "x".repeat(32_001) }
  });

  expect(response.statusCode).toBe(400);
  expect(response.json<{ error: string }>().error).toBe("text must be 32000 characters or fewer");
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
pnpm vitest run tests/integration/chat-live-api.test.ts
```

Expected: test fails because oversized text reaches manager and returns 200.

- [ ] **Step 3: Minimal implementation**

Add near rate constants:

```ts
const MAX_CHAT_TURN_TEXT_LENGTH = 32_000;
```

Change `readText`:

```ts
function readText(body: unknown): { text: string } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "text is required" };
  const value = (body as Record<string, unknown>).text;
  if (typeof value !== "string") return { error: "text is required" };
  if (value.length > MAX_CHAT_TURN_TEXT_LENGTH) {
    return { error: `text must be ${MAX_CHAT_TURN_TEXT_LENGTH} characters or fewer` };
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? { text: trimmed } : { error: "text is required" };
}
```

Update caller:

```ts
const textResult = readText(request.body);
if ("error" in textResult) {
  return reply.code(400).send({ error: textResult.error });
}
const { text } = textResult;
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```bash
pnpm vitest run tests/integration/chat-live-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/chat-live-api.test.ts packages/chat/src/live-routes.ts
git commit -m "fix(chat): cap live turn text" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 5: Final Verification

**Files:**
- No code changes unless verification fails.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run tests/integration/route-local-rate-limit.test.ts tests/unit/chat-session-manager.test.ts tests/integration/chat-live-api.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run requested gates**

```bash
pnpm test:integration
pnpm verify:foundation
```

Expected: PASS.

- [ ] **Step 3: Pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: PASS and branch rebased.

## Self-Review

- Spec coverage: `/switch` and `/clear` get route-local per-principal limits; `/stream` relies on per-actor subscriber ceiling; SSE writes are skipped after close/end; `POST /api/chat/turn` rejects text above 32,000 chars before manager processing.
- Placeholder scan: no TODO/TBD/fill-in steps.
- Type consistency: new `ChatStreamLimitError` is exported from manager and imported by route error mapper; `readText` caller handles discriminated result.
