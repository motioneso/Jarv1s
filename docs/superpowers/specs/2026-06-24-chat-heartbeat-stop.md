# Spec: Chat Heartbeat + User-Driven Stop (#456)

**Status:** approved (brief locked 2026-06-24)
**Tracking issue:** #456
**Risk tier:** `sensitive` (touches the chat turn lifecycle + RPC contract; cross-module change spanning chat engine, RPC client, and web UI)
**Depends on:** Plan Task 1 (#463, merged) — the `tool_call_mcp_elicitation=false` flag unblocks tool-calling turns that this feature then allows to run long.

## Problem

Chat turns time out at ~50s and surface a "Chat timed out before the model finished responding" message. That message is itself broken — it represents a legitimate turn being killed, not a real timeout. Long-running turns (notes ingest, agentic multi-tool reasoning, local-embedding queries) exceed the cap and get cut off mid-stream. Users can't tell if a turn is working or stuck, and have no way to stop one that is. Ben hit this as a 504 in prod on 2026-06-23.

## Root causes (two independent layers)

1. **Turn poll cap (the user-facing timeout).** `ChatSessionManager.runTurn` polls `engine.readNew` up to `DEFAULT_MAX_POLLS` (default **2000**) with `pollMs` (default **25ms**) → hard wall-clock cap of **~50s per turn**. On hitting it, emits `{kind:"error", text: TIMEOUT_MESSAGE}` and stores `TIMEOUT_MESSAGE` as the reply.
   - `packages/chat/src/live/chat-session-manager.ts:130` (`DEFAULT_MAX_POLLS`), `:187-188` (defaults), `:352-366` (the cap + timeout emit).
2. **RPC turn-verb deadline (a liveness guard, not a duration cap).** Turn verbs (`submit`/`readNew`/`isAlive`/`kill`) reject after `DEFAULT_RPC_TIMEOUT_MS` (**45s**, env `JARVIS_CLI_RUNNER_RPC_TIMEOUT_MS`) → `CliChatUnavailableError` → HTTP 503. Exists to recover from a **wedged cli-runner** after an api restart (#445); NOT meant as a "model is slow" cap.
   - `packages/chat/src/live/chat-engine-rpc-client.ts:85-91, 241, 368`.

## Goal

If the model is doing something — emitting tool calls, thinking, partial output — the turn must not time out. Show the user what the model is doing (expandable, collapsed by default). Give them a Stop button to cancel an in-flight turn. The "Chat timed out" message never appears for an actively-producing turn.

## User

All users, all contexts. No carve-outs.

## Success Criteria

- A long-running turn (notes conversation, multi-tool, 3+ minutes) completes and renders the full reply — no "Chat timed out" message ever for an actively-producing turn.
- During an in-flight turn, an expandable thinking indicator shows what the model is doing (tool names, thinking markers from the transcript). Collapsed by default; user expands to see detail.
- A Stop button is available during an in-flight turn; clicking it ends the turn cleanly, releases the turn-in-flight lock, and lets the user immediately send a new message. Persisted state shows "stopped by user," not error/timeout.
- A genuinely stuck turn (no output for the idle window) still recovers — with an accurate message, not "timed out."
- #445 (cli-runner wedge recovery) preserved.

## Non-Goals

- Token-by-token streaming (not possible in the CLI transcript format — the engine polls `readNew` for transcript records, not a token stream).
- Estimated time remaining / progress bar / percentage.
- Background/push notifications when a long turn finishes (user must keep the tab open).
- Anything beyond what's listed in MVP Scope.

## MVP Scope

### 1. Remove the hard poll cap; replace with idle/heartbeat watchdog

Remove `DEFAULT_MAX_POLLS` as a wall-clock cap in `ChatSessionManager.runTurn`. Replace with an **idle watchdog**: the deadline resets whenever `engine.readNew` yields new transcript records (tool call, thinking marker, partial reply). Only a turn that emits **nothing** for the full idle window trips the watchdog.

- **Idle window:** ~2-3 minutes (tunable, env override `JARVIS_CHAT_IDLE_WATCHDOG_MS`, default e.g. 180000). This is NOT a duration cap — it resets on every emission.
- **Watchdog trip path:** when the idle window elapses with no new records, end the turn with an **accurate** message (e.g. "No response from the model for N seconds — ending turn."), NOT the broken `TIMEOUT_MESSAGE`.
- Files: `packages/chat/src/live/chat-session-manager.ts` (the poll loop at `:130`, `:187-188`, `:352-366`); possibly `packages/chat/src/live/types.ts` for the config shape.

### 2. Make the 45s RPC deadline activity-aware

In `chat-engine-rpc-client.ts`, the `DEFAULT_RPC_TIMEOUT_MS` deadline for turn verbs resets on engine activity (new transcript records). An actively-producing turn never trips it; a genuinely wedged cli-runner (no activity) still hits it and recovers (#445 preserved).

- Keep the env override (`JARVIS_CLI_RUNNER_RPC_TIMEOUT_MS`).
- The reset hooks into the same "new records observed" signal as the idle watchdog — shared concept, two layers.
- Files: `packages/chat/src/live/chat-engine-rpc-client.ts:85-91, 241, 368`.

### 3. Surface "thinking" indicators in the chat UI (expandable, collapsed by default)

During an in-flight turn, render coarse progress from the transcript: tool-call names (e.g. "running: notes.search"), thinking markers, partial-reply presence. **Expandable** — collapsed by default showing minimal status (e.g. "thinking…"), expanded shows the running list of tool calls / markers.

- Source: whatever the transcript records already expose (the engine's `readNew` returns `TranscriptRecord[]` — tool calls are already distinguishable there).
- No token streaming, no time estimates, no progress bar.
- Files: `apps/web/src/` chat component(s) — locate the active turn renderer; new sub-component for the expandable thinking pane.

### 4. Add a Stop button

During an in-flight turn, a Stop control is visible in the chat UI. Clicking it:

1. Calls a cancel route (new API endpoint, e.g. `POST /api/chat/sessions/:id/turn/cancel`) → which invokes the existing session-level `kill()` RPC (`packages/chat/src/live/types.ts:72`).
2. `kill()` ends the engine turn; the turn-in-flight lock releases.
3. The turn persists as "stopped by user" (new status, not error/timeout).
4. The UI returns to input-ready state immediately; user can send a new message.

- The `kill()` RPC exists today (used for orphan reaping/reconciliation); this exposes it as a user action with clean state handling.
- Files: `apps/web/src/` (Stop button component + turn-state handling); `packages/chat/src/` (cancel route + "stopped by user" status); `packages/chat/src/live/types.ts` (status enum if needed).

### 5. Kill the "Chat timed out" message

Remove `TIMEOUT_MESSAGE` from the user-facing paths. The idle-watchdog trip (genuinely stuck turn) and the RPC-deadline trip (wedged cli-runner) each surface their **own accurate** messages. No path emits "Chat timed out" anymore.

- Files: `packages/chat/src/live/chat-session-manager.ts` (where `TIMEOUT_MESSAGE` is defined and emitted).

## Verification

1. **Long turn completes (the real test):** Ben talks about his notes with the agent — a notes-grounded conversation that runs multi-tool, 3+ minutes, completes and renders the full reply. No "Chat timed out" message.
2. **Thinking indicators render:** During the notes conversation, expand the thinking pane — tool names / thinking markers are visible. Collapse it — UI stays clean.
3. **Stop button works:** Mid-turn, click Stop. The turn ends, lock releases, new message can be sent immediately. Persisted state shows "stopped by user."
4. **Idle watchdog fires accurately:** A genuinely stuck turn (engine emits nothing for the idle window) ends with the accurate "no response for N seconds" message, not "timed out."
5. **#445 preserved:** Kill the cli-runner container during an idle turn; api recovers via the (now activity-aware) RPC deadline, doesn't hang.
6. **No regression:** Existing chat tests pass, with assertions updated for removed cap + new status messages.

## Notes

- This spec locks the brief from 2026-06-24. The brief's "all users, all contexts" framing means no operator config to disable the watchdog or hide the Stop button.
- The idle window (~2-3 min) is a judgment call — long enough that a genuinely-working turn on a slow model/local embedding never false-trips, short enough that a wedged turn recovers in reasonable time. Tunable via env for operators who want different defaults.
