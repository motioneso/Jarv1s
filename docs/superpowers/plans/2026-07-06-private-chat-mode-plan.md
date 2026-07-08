# Private Chat Mode Without Memory Writes (#744) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Coordinated-build approval gate applies: do not start code until Coordinator approves this plan.

**Spec:** `docs/superpowers/specs/2026-07-05-private-chat-mode.md` (read it first; it is the
authority on product behavior).

**Goal:** Private chat as a fully ephemeral, new-thread-only mode: no `chat_messages` rows, no
memory jobs, no history listing, no resume, bookkeeping row + on-disk CLI transcripts purged on
every session-end path.

**Architecture:** Extend the existing `chat_threads.incognito` mechanism (immutable column, job-skip
gate in `DataContextChatPersistence.recordTurn`). Add an incognito branch to turn persistence, an
end-of-session cleanup path shared by the explicit end route and the idle reaper, transcript-file
purging in the engine layer, and a frontend entry point + private banner + best-effort tab-close
kill.

**Tech Stack:** Fastify routes in `packages/chat`, Kysely via branded `DataContextDb`, pg-boss job
gate (already exists), React chat drawer.

## Settled decisions (Ben, 2026-07-05) — nothing below is gated

1. **Session lifetime identity:** last-SSE-subscriber-detach refcount with a short grace window (a
   reload re-attaches within the grace window and survives). `beforeunload` + `navigator.sendBeacon`
   stays as a best-effort accelerator only. Kill-on-any-close is the approved fallback **only if**
   the refcount proves unworkable during build — if taken, flag it in the PR and update the UI copy
   (closing any tab ends the private chat).
2. **Idle reaper vs open tab:** an attached SSE subscriber counts as activity — the reaper collects
   only zero-subscriber private sessions. The client shows a "private chat ended" state for residual
   cases (server restart, crash).

## File Map

| File                                             | Change                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/chat/src/repository.ts`                | Modify: incognito branch in `recordCompletedTurn`; thread cleanup helper; `listThreads` already excludes? verify + test                                            |
| `packages/chat/src/live/persistence.ts`          | Modify: skip message writes, auto-title, and rolling summary for incognito                                                                                         |
| `packages/chat/src/live/chat-session-manager.ts` | Modify: `destroyPrivateSession` cleanup; subscriber-refcount lifetime + grace timer; reaper treats attached subscribers as activity and purges incognito artifacts |
| `packages/chat/src/live/cli-chat-engine.ts`      | Modify: `purgeTranscripts()` using `transcriptGlobDir` paths, session-scoped                                                                                       |
| `packages/chat/src/live-routes.ts`               | Modify: `POST /api/chat/private/end` (sendBeacon target), private start via existing `/api/chat/clear?incognito=true`                                              |
| `packages/chat/src/routes.ts`                    | Modify: `serializeThread` exposes `incognito`; history routes exclude incognito                                                                                    |
| `packages/chat/src/manifest.ts`                  | Modify: register new route permission                                                                                                                              |
| `apps/web/src/chat/chat-drawer.tsx`              | Modify: private-chat entry point, private banner, transcript-state retention                                                                                       |
| `apps/web/src/chat/use-chat-stream.ts`           | Modify: keep private transcript state across in-app navigation (lift state or cache)                                                                               |
| `apps/web/src/api/client.ts`                     | Modify: `endPrivateSession()` + sendBeacon helper                                                                                                                  |
| `packages/chat/tests/…` (integration)            | New tests per acceptance criteria                                                                                                                                  |

No new migration expected (incognito column exists, `0058`). If one becomes necessary, remember:
next migration number is **global by landing order** (check `ls packages/*/sql/*.sql | sort | tail`
at build time; ≥0145), SQL lives in `packages/chat/sql/`, and `foundation.test.ts` asserts the FULL
migration list with `toEqual` — add the new row and run the full `test:integration`, not just the
module suite.

## Decisions (from spec — do not relitigate)

- Private = new chat only; no conversion of existing threads. Immutable `incognito = true`.
- Ephemeral: zero `chat_messages` rows, zero memory jobs, no history listing, no resume, no export
  rows. Bookkeeping `chat_threads` row allowed while live, deleted on end, and must never hold
  user-derived content (no auto title, no `conversation_summary`).
- On-disk CLI transcript files must be deleted on every end path (close, new chat, reaper).
- Keep the existing skip-the-call memory suppression; never write-then-delete.
- Module-owned action audit trails are preserved untouched.
- Reaper remains a fallback, not a user-facing TTL.

## Task 1 — Ephemeral persistence (backend core)

**Files:** `packages/chat/src/live/persistence.ts`, `packages/chat/src/repository.ts`, tests.

- [ ] **Step 1 (test first):** Integration test: complete a turn on an incognito thread → assert
      zero `app.chat_messages` rows, no auto-derived title (title stays default), no
      `conversation_summary`, and `sendJob` not called (extend the existing job-skip regression
      test). Also assert a normal thread still writes both rows (no regression).
- [ ] **Step 2:** In `recordTurn` (persistence.ts): when `thread.incognito`, skip
      `recordCompletedTurn`, skip `deriveChatTitle` auto-titling, skip
      `updateConversationSummary`. Keep `touchThread` (reaper bookkeeping) — verify `touchThread`
      writes no content, only timestamps.
- [ ] **Step 3:** Defense-in-depth: add an incognito guard inside
      `ChatRepository.recordCompletedTurn` (throw or no-op with a clear reason) so a future caller
      cannot reintroduce durable private rows.
- [ ] **Step 4:** Verify: `pnpm typecheck && pnpm test:integration -- <chat persistence test file>`.

## Task 2 — History/listing/export exclusion + incognito surfacing

**Files:** `packages/chat/src/routes.ts`, `packages/chat/src/repository.ts`, tests.

- [ ] **Step 1 (test first):** Tests: incognito thread absent from `GET /api/chat/threads`;
      `serializeThread` output for the active thread includes `incognito: true`; settings data
      export contains zero private message rows (it already reads `app.chat_messages` owner-scoped —
      zero rows by construction, pin with a test); `chat.listTodaysTurns` still excludes incognito.
- [ ] **Step 2:** Filter incognito from `listThreads` (or its route) and expose `incognito` in
      `serializeThread` + the shared chat DTO so the client can render the private banner.
- [ ] **Step 3:** Verify: focused integration suite + `pnpm typecheck`.

## Task 3 — Transcript purge in the engine layer

**Files:** `packages/chat/src/live/cli-chat-engine.ts`, `packages/ai/src/adapters/tmux-bridge.ts`
(read-only reference), tests.

- [ ] **Step 1 (test first):** Unit test with a fake home base: after `purgeTranscripts()`, the
      session's transcript file(s) under the anthropic-style encoded-dir path are gone; a sibling
      file in the shared codex per-day directory belonging to another session is untouched.
- [ ] **Step 2:** Implement `purgeTranscripts()` on the engine: resolve
      `transcriptGlobDir(provider, neutralDir, homeBase)`; anthropic → remove the whole
      per-session encoded dir; openai-compatible → remove only this session's file(s) (match by
      recorded sessionId), never the shared day directory; google → same session-scoped rule.
      Handle already-missing files quietly (idempotent).
- [ ] **Step 3:** Call it from every incognito end path (wired in Task 4). Note: this is engine-side
      `fs` on engine-owned artifacts, not vault I/O — `VaultContext` does not apply here, but keep
      all paths derived from engine state, never from request input.
- [ ] **Step 4:** Verify: `pnpm typecheck && pnpm test:unit -- <engine test>`.

## Task 4 — Unified end-of-session cleanup (route + reaper)

**Files:** `packages/chat/src/live/chat-session-manager.ts`, `packages/chat/src/live-routes.ts`,
`packages/chat/src/manifest.ts`, tests.

- [ ] **Step 1 (test first):** Integration tests: (a) `POST /api/chat/private/end` kills the
      engine, deletes the incognito `chat_threads` row, revokes the MCP token, and purges
      transcripts; (b) reaper on an idle zero-subscriber incognito session does all of the same;
      (c) reaper on a normal session keeps today's behavior (rows untouched); (d) starting a new
      chat (`/api/chat/clear`) while a private session is live performs full private cleanup first;
      (e) reaper skips an incognito session that has an attached SSE subscriber, regardless of
      idle time; (f) when the last subscriber of an incognito session detaches, the session is
      destroyed after the grace window; a re-attach within the grace window cancels destruction.
- [ ] **Step 2:** Extract a `destroyPrivateSession(actorUserId)` helper in the session manager:
      engine.kill() → purgeTranscripts() → delete bookkeeping row → revoke token → drop session
      entry. Call from the new route, from `clear`/`resumeThread`/`switchProvider` paths when the
      outgoing thread is incognito, and from `reapIdle`.
- [ ] **Step 3:** Subscriber-refcount lifetime (settled decision 1): the session manager already
      tracks SSE subscribers per session — on detach of an incognito session's **last** subscriber,
      start a short grace timer (pick a small constant, e.g. 30–60 s) that calls
      `destroyPrivateSession`; cancel the timer when a subscriber re-attaches. In `reapIdle`, treat
      an attached subscriber as activity: skip incognito sessions with `subscribers > 0` (settled
      decision 2).
- [ ] **Step 4:** Add `POST /api/chat/private/end` to `live-routes.ts` + manifest permission. It
      must be sendBeacon-friendly (no response body needed, tolerate `text/plain` content type). It
      is an accelerator for the refcount path, not the authoritative lifetime.
- [ ] **Step 5:** Verify: `pnpm test:integration -- <live routes/session manager tests>`.

## Task 5 — Frontend entry point, banner, tab-close signal

**Files:** `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/chat/use-chat-stream.ts`,
`apps/web/src/api/client.ts`.

- [ ] **Step 1:** Private-chat entry point next to New Chat calling
      `clearChat({ incognito: true })`; active-session private banner driven by the serialized
      `incognito` flag (copy per spec guardrails — must not imply module actions leave no records).
- [ ] **Step 2:** Best-effort tab-close accelerator: `beforeunload` + `navigator.sendBeacon` to
      `/api/chat/private/end`. The authoritative lifetime is the server-side subscriber refcount
      (Task 4 Step 3), so in-app navigation and reload are safe by construction — do not add any
      client logic that kills the session on navigation.
- [ ] **Step 3:** Keep private transcript UI state alive across in-app navigation (lift
      `useChatStream` records to a drawer-level/module-level store for private sessions — it can
      never be refetched).
- [ ] **Step 4:** Ended-state UI (required by settled decision 2): detect the dead engine (server
      restart/crash residuals) and render "private chat ended" instead of silently continuing in a
      fresh, context-free engine.

## Task 6 — Final slice verification

- [ ] Full acceptance sweep against the spec's criteria list (each has a test or a manual check).
- [ ] `pnpm verify:foundation` (full gate, real exit code — never pipe to `tail`).
- [ ] Grep sweep: no private turn text in job payloads, logs, or diagnostics
      (`rg -n "userText|turnText" packages/chat/src --type ts` and inspect log/job call sites).
- [ ] Commit in small slices with **explicit paths only — never `git add -A`** (shared tree).

## Self-Review

- [ ] Does every end path (route, new-chat, resume, switch, reaper) run the same
      `destroyPrivateSession` helper?
- [ ] Is transcript deletion session-scoped for the shared codex day-directory?
- [ ] Did I add any field to `AccessContext` or accept a root Kysely handle anywhere? (Must be no.)
- [ ] Are the two settled decisions implemented exactly (subscriber-refcount lifetime with grace
      window; subscriber-as-activity reaper + ended-state UI), with no silent substitutes? If the
      kill-on-any-close fallback was taken, is it flagged in the PR with updated UI copy?
