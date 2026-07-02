# Chat Stop Esc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make web chat Stop cancel only the active turn, like pressing Esc in the terminal, without killing the reusable chat session.

**Architecture:** Keep the existing `/api/chat/turn/cancel` route and UI. Replace the destructive `stopTurn -> engine.kill()` path with a non-destructive engine interrupt that sends Escape through the existing multiplexer abstraction. Preserve `kill()` for clear/resume/switch/orphan cleanup.

**Tech Stack:** TypeScript, Fastify live chat routes, `CliChatEngine`, RPC client/server, `Multiplexer`, Vitest, Playwright.

---

## Premise Verification

- Existing Stop UI/client/route already shipped: `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/api/client.ts`, `packages/chat/src/live-routes.ts`.
- Root bug still exists: `ChatSessionManager.stopTurn()` aborts the turn then calls `session.engine.kill()`.
- `kill()` is destructive: `CliChatEngineImpl.kill()` kills the mux session, clears handles, and removes the neutral dir; `CliChatEngineHost.kill()` deletes the engine from its map.
- Existing unit coverage encodes the bug: `tests/unit/chat-session-manager.test.ts` currently expects Stop to kill the engine.
- No existing non-destructive interrupt method exists on `Multiplexer` or `CliChatEngine`.

## File Map

- Modify `packages/ai/src/adapters/multiplexer.ts`: add `interrupt(handle)` to the existing terminal abstraction.
- Modify `packages/ai/src/adapters/tmux-multiplexer.ts`: implement interrupt with `tmux send-keys -t <handle> Escape`.
- Modify `packages/ai/src/adapters/herdr-multiplexer.ts`: implement interrupt with `herdr pane send-keys <handle> Escape`.
- Modify `packages/chat/src/live/types.ts`: add optional/required `interrupt()` to `CliChatEngine`.
- Modify `packages/chat/src/live/cli-chat-engine.ts`: forward `interrupt()` to `mux.interrupt(handle)` without clearing session state.
- Modify `packages/chat/src/live/agy-print-chat-engine.ts` and `packages/chat/src/live/claude-print-chat-engine.ts`: implement the same forwarder if they wrap the mux directly.
- Modify `packages/chat/src/live/chat-engine-rpc-client.ts`: add RPC `interrupt()` client method and engine method.
- Modify `packages/chat/src/live/rpc-contract.ts`: add additive `"interrupt"` RPC method.
- Modify `packages/cli-runner/src/connection.ts`: dispatch `"interrupt"`.
- Modify `packages/cli-runner/src/engine-host.ts`: add `interrupt(sessionKey)` that requires an existing engine and does not delete it.
- Modify `packages/chat/src/live/chat-session-manager.ts`: make `stopTurn()` call `session.engine.interrupt()` instead of `kill()`.
- Modify `tests/unit/chat-session-manager.test.ts`: flip Stop regression test to assert engine remains reusable.
- Add/modify the smallest multiplexer/RPC host tests only if type coverage does not exercise the new methods.

## Task 1: Lock Regression in ChatSessionManager

**Files:**

- Modify: `tests/unit/chat-session-manager.test.ts`

- [ ] **Step 1: Write failing unit test**

Change the `GatedEngine` in `ChatSessionManager.stopTurn` tests to expose `interrupted = false` and an `interrupt()` method that resolves the gate without setting `killed`.

```ts
interrupted = false;

async interrupt(): Promise<void> {
  this.interrupted = true;
  this.resolveGate();
}
```

Change the main Stop test name and assertions:

```ts
it("stopTurn interrupts the active turn, keeps the engine alive, releases the turn lock, does not persist", async () => {
  // existing setup/start/stop
  expect(engine.interrupted).toBe(true);
  expect(engine.killed).toBe(false);
  const second = await manager.submitTurn("u1", "Ben", "next");
  expect(second.reply).toBe("should-not-persist");
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts --runInBand
```

Expected: fail because `stopTurn()` still calls `kill()` and no engine interrupt path exists.

## Task 2: Add Minimal Interrupt Path

**Files:**

- Modify: `packages/ai/src/adapters/multiplexer.ts`
- Modify: `packages/ai/src/adapters/tmux-multiplexer.ts`
- Modify: `packages/ai/src/adapters/herdr-multiplexer.ts`
- Modify: `packages/chat/src/live/types.ts`
- Modify: `packages/chat/src/live/cli-chat-engine.ts`
- Modify: `packages/chat/src/live/agy-print-chat-engine.ts`
- Modify: `packages/chat/src/live/claude-print-chat-engine.ts`
- Modify: `packages/chat/src/live/rpc-contract.ts`
- Modify: `packages/chat/src/live/chat-engine-rpc-client.ts`
- Modify: `packages/cli-runner/src/connection.ts`
- Modify: `packages/cli-runner/src/engine-host.ts`
- Modify: `packages/chat/src/live/chat-session-manager.ts`

- [ ] **Step 1: Add terminal interrupt to multiplexer**

Add to `Multiplexer`:

```ts
/** Send terminal interrupt/escape without terminating the session. */
interrupt(handle: MuxHandle): Promise<void>;
```

Implement tmux:

```ts
async interrupt(handle: MuxHandle): Promise<void> {
  await this.runChecked(["send-keys", "-t", handle, "Escape"]);
}
```

Implement herdr:

```ts
async interrupt(handle: MuxHandle): Promise<void> {
  await this.runChecked(["pane", "send-keys", handle, "Escape"], "send-keys");
}
```

- [ ] **Step 2: Add chat engine interrupt**

Add `interrupt(): Promise<void>` to `CliChatEngine`.

For mux-backed engines:

```ts
async interrupt(): Promise<void> {
  if (this.handle !== null) {
    await this.mux.interrupt(this.handle);
  }
}
```

Do not clear handles, delete engine maps, revoke tokens, or remove neutral dirs.

- [ ] **Step 3: Add additive RPC verb**

Add `"interrupt"` beside `"kill"` in `RpcMethod`; include it in `callTimeoutMs()` as a turn verb.

Client:

```ts
interrupt(sessionKey: string): Promise<{ ok: true }> {
  return this.call<{ ok: true }>("interrupt", sessionKey, {});
}

async interrupt(): Promise<void> {
  await this.conn.interrupt(this.sessionKey);
}
```

Server dispatch:

```ts
case "interrupt": {
  const key = requireSessionKey(req);
  await host.interrupt(key);
  return { ok: true };
}
```

Host:

```ts
interrupt(sessionKey: string): Promise<void> {
  const key = sanitizeSessionKey(sessionKey);
  return this.enqueue(key, async () => {
    const engine = this.engines.get(key);
    if (!engine) throw new NotLaunchedError();
    await engine.interrupt();
  });
}
```

- [ ] **Step 4: Change Stop shared path**

In `ChatSessionManager.stopTurn()`:

```ts
controller.abort();
const session = this.sessions.get(actorUserId);
if (session) {
  try {
    await session.engine.interrupt();
  } catch {
    // best-effort: the stop signal already broke the loop; interrupt failure must not wedge.
  }
}
```

Update comments from "kill engine" to "interrupt active turn".

- [ ] **Step 5: Run focused test**

Run:

```bash
pnpm vitest run tests/unit/chat-session-manager.test.ts --runInBand
```

Expected: pass.

## Task 3: Verify UI Stop Contract

**Files:**

- Test: `tests/e2e/chat-drawer.spec.ts`

- [ ] **Step 1: Run existing focused e2e**

Run:

```bash
pnpm playwright test tests/e2e/chat-drawer.spec.ts -g "stages next message while response is running and sends it after stop"
```

Expected: pass; the UI already calls `/api/chat/turn/cancel`, stages the next message, and sends it after Stop.

- [ ] **Step 2: Add no UI code unless this test fails**

Skipped by default. Existing UI already satisfies #665 once backend Stop stops killing the session.

## Task 4: Gate and Commit

**Files:**

- All files changed above.

- [ ] **Step 1: Run required gate**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: all pass.

- [ ] **Step 2: Commit scoped files only**

Run:

```bash
git add packages/ai/src/adapters/multiplexer.ts \
  packages/ai/src/adapters/tmux-multiplexer.ts \
  packages/ai/src/adapters/herdr-multiplexer.ts \
  packages/chat/src/live/types.ts \
  packages/chat/src/live/cli-chat-engine.ts \
  packages/chat/src/live/agy-print-chat-engine.ts \
  packages/chat/src/live/claude-print-chat-engine.ts \
  packages/chat/src/live/rpc-contract.ts \
  packages/chat/src/live/chat-engine-rpc-client.ts \
  packages/cli-runner/src/connection.ts \
  packages/cli-runner/src/engine-host.ts \
  packages/chat/src/live/chat-session-manager.ts \
  tests/unit/chat-session-manager.test.ts \
  docs/superpowers/plans/2026-07-02-chat-stop-esc.md
git commit -m "fix(chat): stop turn without killing session" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Self-Review

- Spec coverage: #665 Stop only. Existing UI/route stays; shared manager path changes from kill to interrupt; lock release remains via existing `finally`; orphan cleanup remains on `kill()`.
- Placeholder scan: no TODO/TBD steps.
- Type consistency: `interrupt()` name is consistent across `Multiplexer`, `CliChatEngine`, RPC client/server, and manager.
