# Build Handoff — chat-heartbeat-stop (#456) — SENSITIVE TIER

**Spec (approved):** docs/superpowers/specs/2026-06-24-chat-heartbeat-stop.md
**GitHub issue:** #456
**Risk tier:** `sensitive` (touches chat turn lifecycle + RPC contract; cross-module: chat engine, RPC client, web UI)
**Worktree:** ~/Jarv1s/.claude/worktrees/chat-heartbeat-stop
**Branch:** chat-heartbeat-stop (off origin/main @ 92b16488)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"`)
**Coordinator session id:** `ses_111f40556ffeVraVZuie2X8ScJ`
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. `main` shows red but is NOT a code failure. **Local gate is the source of truth.** Do NOT run `gh pr checks`. Run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest before push; record exit codes.

## Your task (#456 — read the spec IN FULL: docs/superpowers/specs/2026-06-24-chat-heartbeat-stop.md)

Replace the broken ~50s chat turn timeout with an idle/heartbeat model + user-driven Stop. Five work items, all required for MVP:

### 1. Remove hard poll cap; add idle/heartbeat watchdog

In `packages/chat/src/live/chat-session-manager.ts`:
- Remove `DEFAULT_MAX_POLLS` as a wall-clock cap (the `:130` const, `:187-188` defaults, `:352-366` cap + timeout emit).
- Replace with an **idle watchdog**: the deadline resets whenever `engine.readNew` yields new transcript records (tool call, thinking marker, partial reply). Only a turn emitting **nothing** for the idle window trips it.
- **Idle window:** ~180000ms (3 min), tunable via env `JARVIS_CHAT_IDLE_WATCHDOG_MS`.
- On watchdog trip: end turn with accurate message (e.g. "No response from the model for N seconds — ending turn."), NOT `TIMEOUT_MESSAGE`.

### 2. Make the 45s RPC deadline activity-aware

In `packages/chat/src/live/chat-engine-rpc-client.ts` (`:85-91` `DEFAULT_RPC_TIMEOUT_MS`, `:241`, `:368`):
- The deadline resets on engine activity (new transcript records). Actively-producing turn never trips it; wedged cli-runner still recovers (#445 preserved).
- Keep env override `JARVIS_CLI_RUNNER_RPC_TIMEOUT_MS`.
- The reset hooks the same "new records observed" signal as item 1 — shared concept, two layers.

### 3. Surface "thinking" indicators in chat UI (expandable, collapsed by default)

In `apps/web/src/` chat components (locate the active-turn renderer):
- Render coarse progress from transcript records: tool-call names (e.g. "running: notes.search"), thinking markers, partial-reply presence.
- **Expandable** — collapsed by default (minimal "thinking…"), expanded shows the running list.
- Source: `TranscriptRecord[]` from `engine.readNew` already distinguishes tool calls.
- No token streaming, no time estimates, no progress bar.

### 4. Add Stop button

During an in-flight turn, a Stop control in the chat UI:
- Calls a new cancel route (e.g. `POST /api/chat/sessions/:id/turn/cancel`) → invokes existing session-level `kill()` RPC (`packages/chat/src/live/types.ts:72`).
- `kill()` ends the turn; turn-in-flight lock releases.
- Turn persists as "stopped by user" (new status, NOT error/timeout).
- UI returns to input-ready immediately; user can send a new message.

### 5. Kill the "Chat timed out" message

Remove `TIMEOUT_MESSAGE` from user-facing paths. Idle-watchdog trip + RPC-deadline trip each surface their OWN accurate messages. No path emits "Chat timed out" anymore.

## Verify (your gate)

```bash
pnpm exec vitest run tests/unit/chat-live-manager.test.ts tests/unit/chat-session-manager*.test.ts tests/unit/cli-chat-engine.test.ts tests/unit/chat-engine-rpc-client*.test.ts 2>/dev/null
pnpm typecheck
pnpm format:check   # repo-wide may warn on pre-existing plan docs — verify YOUR files pass
pnpm lint           # repo-wide may fail on pre-existing test files — verify YOUR files pass
```
Update existing tests' assertions for the removed cap + new status messages. Add tests for: idle-watchdog resets on emission, idle-watchdog fires after silent window, cancel route releases lock + persists "stopped by user", RPC deadline resets on activity.

Record exit codes (per-file if repo-wide is red from pre-existing main breakage).

## Build workflow

1. **Orient.** `cd ~/Jarv1s/.claude/worktrees/chat-heartbeat-stop`. Confirm branch = `chat-heartbeat-stop`. `pnpm install` if node_modules missing. `pnpm db:up` if integration tests need Postgres.
2. **Read CLAUDE.md Hard Invariants.** This lane touches the chat turn lifecycle — honor "Provider-agnostic AI" (no model hardcode in the watchdog), "Metadata-only job payloads" (cancel route payload = session/turn IDs only), and "DataContextDb only" for any DB writes.
3. **Read the spec IN FULL** before coding: `docs/superpowers/specs/2026-06-24-chat-heartbeat-stop.md`.
4. **Plan-first gate (this lane is NOT pre-approved task-by-task).** Write a bite-sized plan to `docs/superpowers/plans/2026-06-24-chat-heartbeat-stop.md` (TDD tasks, exact files, green per commit), escalate it to the coordinator for approval via `herdr pane run <Coordinator-pane> "plan ready: <path>. approve?"`. **STOP and wait.** Do not write code until the coordinator approves. This is bigger than the wave-1 lanes — the plan gate is real here.
5. On approval, build TDD task-by-task. Commit green per task. `git add` only your task's files.
6. **Pre-push trio + rebase** before every push.
7. Push, open PR, report to coordinator (caveman-terse, include sensitive-tier invariant attestations).
8. **Stop.** Coordinator owns QA/merge/board/close.

## Your compact (non-negotiable)

- Work only in your worktree on `chat-heartbeat-stop`.
- **Sensitive tier** — build to the invariant bar.
- **Plan-first gate is REAL for this lane** — write plan, escalate, wait for approval. Do not code before approval.
- CI down — local gate truth; record exit codes.
- Escalate blockers / design forks to `Coordinator` label via `herdr pane run`. If `herdr pane list` shows 0 or >1 Coordinator pane, halt.
- Never touch board/milestones/issues/merge.
- Caveman for coordinator messages; conventional for commits/PR/code.
- Pre-push trio before every push.

## Collision notes

- You touch `packages/chat/src/live/` (chat-session-manager.ts, chat-engine-rpc-client.ts, types.ts) + `apps/web/src/chat/` + a new cancel route.
- `a11y-contrast-polish` lane touches `apps/web/src/styles/tokens.css` + `apps/web/src/styles/settings-panes-2.css` + `components-core.css` + 1-2 component files for aria-live — NO overlap with your chat-package work.
- No migrations, no schema. Do NOT add a migration.
