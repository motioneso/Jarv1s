# Plan — Chat Heartbeat + User-Driven Stop (#456)

**Spec:** docs/superpowers/specs/2026-06-24-chat-heartbeat-stop.md (approved)
**Handoff:** docs/coordination/handoffs/2026-06-24-chat-heartbeat-stop.md
**Risk tier:** sensitive (chat turn lifecycle + RPC contract + web UI)
**Branch:** chat-heartbeat-stop (off origin/main @ 92b16488)
**Depends on:** #463 (merged) — tool_call_mcp_elicitation=false

## Spec vs. current-code reconciliation (read first)

The spec was written against an older code shape. Current state (verified on this branch):

- **Item 1 (poll cap):** `DEFAULT_MAX_POLLS` / `TIMEOUT_MESSAGE` / the `:352-366` cap DO NOT EXIST. `runTurn` (chat-session-manager.ts:321-351) is already an unbounded poll loop (polls until `complete`, no wall-clock cap). The "broken ~50s timeout" the spec targets is ALREADY REMOVED. **Net work for item 1: ADD the idle watchdog** (reset on emission, fire on silent window). There is no cap to remove.
- **Item 2 (RPC deadline activity-aware):** REAL WORK. `DEFAULT_RPC_TIMEOUT_MS=45_000` (chat-engine-rpc-client.ts:91) is fixed per-call from call-start (`callTimeoutMs` at :231-250, timer set once at :386-396). An actively-producing turn whose individual `readNew` calls each take <45s but whose total turn exceeds 45s is fine today (each call resets), BUT a single `readNew` that blocks >45s trips it with no activity awareness. Make the deadline reset on observed activity.
- **Item 3 (thinking indicators):** ALREADY EXISTS. `ActivityPeek` (chat-drawer.tsx:408-430) is an expandable `<details>` (collapsed by default) showing tool/thinking/status records. `isWaiting` indicator (:251-302) shows "Jarvis is thinking". **No work needed** beyond verifying the SSE stream delivers the records (it does — `use-chat-stream.ts` parses all `ChatRecordKind` values). Confirm only.
- **Item 4 (Stop button):** REAL WORK. No cancel route, no Stop button, no `stopTurn`/`cancelTurn` method. `kill()` exists on the engine (types.ts:72) and is invoked by `clear()` (chat-session-manager.ts:365) and reconciliation — but NOT exposed as a user action. Need: manager method + route + UI button.
- **Item 5 (kill "Chat timed out" message):** ALREADY DONE. Grep for `TIMEOUT_MESSAGE` / `Chat timed out` / `timed out before` across packages/apps/tests = zero matches. **No work.**

### Design fork requiring coordinator decision (Item 4 — "stopped by user" persistence)

Spec §4.3 says: "The turn persists as 'stopped by user' (new status, not error/timeout)."
Handoff §Collision notes: **"No migrations, no schema. Do NOT add a migration."**

`ChatMessageStatus = "stored" | "pending" | "blocked" | "no_model" | "working" | "error"` (packages/db/src/types.ts:175). No "stopped" value. Adding one = migration = forbidden.

**Proposed resolution (my recommendation, needs coordinator sign-off):**

- On Stop: `kill()` the engine, release the turn-in-flight lock, emit a `status` transcript record `{kind:"status", text:"Stopped by user."}` over SSE (surfaces in the UI via the existing `ActivityPeek`/`RecordRow` path — `status` is already a rendered kind).
- Do NOT persist the partial assistant reply (the model was mid-generation; a partial reply is not a complete turn). The user message is also not persisted (the turn never completed — matches the existing semantics where `recordTurn` only runs after `complete`).
- Rationale: avoids schema change, matches spec intent ("stopped by user" surfaces to the user via SSE), and a stopped turn leaving no DB trace is defensible (it produced no usable reply). If the coordinator prefers persisting the user message with `error` status + "stopped by user" body, that's also viable without a migration — flag it.

## Work items (TDD, green per commit)

### Task A — Idle watchdog in ChatSessionManager (spec item 1)

**Files:**

- `packages/chat/src/live/chat-session-manager.ts` (modify `runTurn`)
- `tests/unit/chat-session-manager.test.ts` (add watchdog tests)

**Changes:**

1. Add `idleWatchdogMs` to `ChatSessionManagerDeps` (default 180000; env `JARVIS_CHAT_IDLE_WATCHDOG_MS` resolved by the composition root, NOT this module — manager stays env-free per existing pattern). Resolve in constructor.
2. In `runTurn`'s poll loop: track `lastEmissionAt = clock.now()`. Reset on every iteration where `records.length > 0`. After each `readNew` (and before the `pollMs` sleep), check `clock.now() - lastEmissionAt > idleWatchdogMs` → if true, break the loop and emit an accurate `status` record: `{kind:"status", text:"No response from the model for N seconds — ending turn."}` (N = idleWatchdogMs/1000, rounded). Do NOT call `recordTurn` for a watchdog trip (no reply was produced).
3. The watchdog uses the injected `clock` (testable, no `Date.now()` directly).

**Tests (add, TDD — write first, watch fail, then implement):**

- `resets the idle deadline whenever readNew yields new records (long actively-producing turn does NOT trip watchdog)` — engine emits records across several polls spanning >idleWatchdogMs of wall time; turn completes normally.
- `trips the idle watchdog after a silent window and emits an accurate status record (no TIMEOUT_MESSAGE)` — engine emits nothing for >idleWatchdogMs; loop breaks, status record emitted with "No response from the model" text, `recordTurn` NOT called.

**Commit:** `fix(chat): replace hard poll cap with idle/heartbeat watchdog (#456)`

### Task B — Activity-aware RPC deadline (spec item 2)

**Files:**

- `packages/chat/src/live/chat-engine-rpc-client.ts` (modify `call()` / add activity hook)
- `tests/unit/chat-rpc-client.test.ts` (add activity-reset test)

**Changes:**
The per-call deadline (`callTimeoutMs`, :386-396) is set once when the frame is written. To make it activity-aware, the deadline must reset when the engine observes new transcript records. The cleanest seam: a callback the manager invokes on activity that resets the pending call's timer.

**Design:**

- Add optional `onActivity?: () => void` reset hook to `RpcConnection`'s pending-call machinery: when set, calling it clears + re-arms the timer (same `timeoutMs`).
- Expose a method on `ChatEngineRpcClient` (or pass through `readNew`) so the manager can signal "activity observed" for the in-flight `readNew`. However — the activity signal is "new records returned", which the manager ALREADY sees from `readNew`'s return value. The reset is most natural INSIDE the client: `readNew` returns records → if records non-empty, the NEXT `readNew` call is a fresh call with its own fresh deadline (already true). The gap is a SINGLE `readNew` that blocks long.
- **Revised approach (simpler, matches spec intent):** The deadline already resets per-call. The "activity-aware" requirement is that a turn consisting of many short `readNew` calls (each <45s) never trips the deadline — which is ALREADY the behavior. The real fix is at the MANAGER layer (Task A's watchdog replaces the wall-clock cap). The RPC deadline stays as-is: it remains a liveness guard for a single wedged verb, not a turn-duration cap.
- **BUT the spec explicitly says "the deadline resets on engine activity (new transcript records)"** and "the reset hooks the same signal as item 1". So implement it: add a `resetActivityDeadline(sessionKey)` method on `RpcConnection` that re-arms the timer for any in-flight turn verb of that sessionKey. The manager calls it from `runTurn` whenever `records.length > 0`.

**Tests:**

- `a readNew that would trip the 45s deadline does NOT trip it when activity is signaled before the deadline` — server delays response past deadline, but client signals activity mid-window → deadline resets → call eventually resolves.

**Commit:** `fix(chat): make RPC turn-verb deadline activity-aware (#456)`

### Task C — Stop button: manager method + cancel route (spec item 4, backend)

**Files:**

- `packages/chat/src/live/chat-session-manager.ts` (add `stopTurn(actorUserId)`)
- `packages/chat/src/live-routes.ts` (add `POST /api/chat/turn/cancel`)
- `tests/unit/chat-session-manager.test.ts` (stopTurn tests)
- `tests/unit/chat-live-routes.test.ts` or new test (cancel route — check exists first)

**Changes (manager):**

1. Add `stopTurn(actorUserId: string): Promise<void>`:
   - If no turn in flight for user: no-op (idempotent — user may click after turn ended).
   - If turn in flight: call `session.engine.kill()`, emit `{kind:"status", text:"Stopped by user."}` to subscribers, release the turn-in-flight lock. The in-flight `runTurn`'s `readNew` will reject (engine killed) → its try/finally clears the lock; `stopTurn` must coordinate so it doesn't double-clear. Use an `AbortSignal`-style flag the `runTurn` loop checks: a `stopped` flag on `UserSession` that the loop reads after each `readNew`; if set, break without emitting error.
   - Do NOT persist a partial reply or the user message (see design fork above).
2. Thread an `AbortController` per turn: `runTurn` creates one, stores it on the session; `stopTurn` calls `.abort()`; the poll loop checks `signal.aborted` after each `readNew` and breaks cleanly.

**Changes (route):**

- `POST /api/chat/turn/cancel` (no body) → `runtime.manager.stopTurn(access.actorUserId)` → 200 `{ok:true}`. Same rate-limit key/rate as `/clear`. Idempotent (200 even if nothing in flight).

**Tests:**

- `stopTurn kills the engine, emits a 'stopped by user' status record, releases the turn lock, does not persist a partial reply`
- `stopTurn is idempotent (no-op when no turn in flight)`
- `a stopped turn's runTurn loop exits cleanly without throwing`
- `POST /api/chat/turn/cancel returns 200 and invokes stopTurn` (route test)

**Commit:** `feat(chat): add user-driven Stop (cancel route + stopTurn) (#456)`

### Task D — Stop button: web UI (spec item 4, frontend)

**Files:**

- `apps/web/src/api/client.ts` (add `cancelChatTurn()`)
- `apps/web/src/chat/chat-drawer.tsx` (render Stop button while `isSending`)

**Changes:**

1. `cancelChatTurn()`: `POST /api/chat/turn/cancel` → `{ok:boolean}`.
2. In `ChatDrawer`: while `isWaiting`/`isSending`, render a Stop button (Square icon from lucide) next to / replacing the loading indicator. On click: call `cancelChatTurn()`; the SSE stream delivers the `status:"Stopped by user."` record; `isSending` clears when the POST `/turn` promise settles (the killed turn rejects/resolve via the manager).
3. The Stop button must not show during history review (`reviewing`) or when not sending.

**Tests:** web has no unit test harness for chat-drawer (it's component-level); rely on typecheck + manual verification per spec §V. If a Vitest+RTL setup exists for chat, add a minimal render test; otherwise skip (matches existing pattern — chat-drawer has no current tests).

**Commit:** `feat(web): add Stop button to in-flight chat turns (#456)`

### Task E — Verify items 3 + 5 are already satisfied (no code change)

- Item 3: confirm `ActivityPeek` renders tool/thinking/status records (chat-drawer.tsx:408-430). Already expandable + collapsed by default. **No change.**
- Item 5: confirm no `TIMEOUT_MESSAGE` / "Chat timed out" string anywhere (grep = 0 matches). **No change.**

Document this in the final PR body so QA knows items 3+5 were verified-as-already-done, not skipped.

## Gate (run before every push, record exit codes)

```bash
pnpm exec vitest run tests/unit/chat-session-manager.test.ts tests/unit/chat-live-manager.test.ts tests/unit/chat-rpc-client.test.ts tests/unit/cli-chat-engine.test.ts
pnpm typecheck
pnpm exec prettier --check <my-files>
pnpm exec eslint <my-files> --max-warnings=0
```

Repo-wide format/lint may be red from pre-existing files outside this lane — record per-file exit codes (precedent: chat-mcp-flag #463, chat-persona #464).

## Ordering

Tasks are sequential (B depends on A's activity concept; C depends on A's loop shape; D depends on C's route). One commit per task, green per commit. No pushes until the full lane is green + rebased.

## Open question for coordinator (blocks Task C/D)

The "stopped by user" persistence fork (see design fork section above). My recommendation: emit `status` SSE record + persist nothing. Needs coordinator ruling before Task C.
