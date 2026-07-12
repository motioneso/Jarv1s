# #866 herdr-install — relay-7 continuation

Spec: `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` (approved)
Plan: `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md` (commit `cc126a3e`,
**coordinator-approved**, 7 TDD tasks) — read it IN FULL before touching anything, it is
self-contained (exact file paths, exact code, exact tests).
Branch/worktree: `build/866-herdr-install` (this worktree — reuse, do NOT create a new one)
Coordinator label: `Coordinator` (resolve pane fresh via `herdr pane list`; don't reuse a `…-N`)

## State: Tasks 1-3 done+committed. Task 4 in progress (test written+red). Tasks 5-7 not started.

- Task 1 (live multiplexer status probe) — DONE, commit `3e3e4350`.
- Task 2 (DTO+schema) — DONE, commit `da1e1834`.
- Task 3 (wire probe through composition root, `module-registry/src/index.ts`) — DONE, commit
  `5df0d7fd`. Also fixed a readonly/mutable array typecheck bug in Task 2's test file
  (`tests/unit/platform-api-chat-multiplexer-schema.test.ts`) discovered while verifying Task 3 —
  that fix is bundled into the `5df0d7fd` commit.
- Task 4 (settings routes consume the live probe) — **IN PROGRESS, uncommitted**:
  `tests/integration/chat-multiplexer-admin.test.ts` has been extended per the plan's Task 4 Step 1
  (3 tests: full live-status GET, PUT echo, env-override reflection) and confirmed RED via
  `pnpm exec tsx scripts/test-integration.ts tests/integration/chat-multiplexer-admin.test.ts`
  (3 failed as expected — routes still return the old `{multiplexer, available}` shape / 500s
  because `dependencies.chatMultiplexerAvailability` no longer exists as a field name mismatch is
  not yet reconciled). **Do not re-write this test file** — it's already in the plan's target
  state. Resume at Task 4 **Step 3** (import block update in `packages/settings/src/routes.ts`).

## Known deviation from the plan (already handled, no action needed)

Task 3's plan step 8 said `pnpm --filter @jarv1s/module-registry typecheck` should PASS standalone.
It doesn't, until Task 4 lands — `registerSettingsRoutes(server, {...})` at routes.ts:777 is an
object literal typed against `SettingsRoutesDependencies` (excess-property-checked), so passing
`getChatMultiplexerStatus` before that package's interface has the field is a real, expected
compile error across the Task 3/4 boundary. This was verified as the *only* remaining error after
Task 3's edits (confirmed by rerunning typecheck) — proceeded to commit Task 3 anyway and is fixed
by Task 4. Not a plan defect worth escalating; just don't expect the Task 3 gate to go fully green
in isolation.

## Next steps in order

1. Read the plan file in full (if not already in context).
2. Finish Task 4: `packages/settings/src/routes.ts` — Steps 3-9 of the plan:
   - Step 3: import block (~lines 11-35) — add `type ChatMultiplexerAvailability`,
     `type MultiplexerKind`, `type MultiplexerSource` to the `@jarv1s/shared` import (the rest of
     that import block already matches the plan's target).
   - Step 4: add `export type GetChatMultiplexerStatus = ...` alias and retype the
     `SettingsRoutesDependencies.chatMultiplexerAvailability` field (~line 126-127) to
     `getChatMultiplexerStatus?: GetChatMultiplexerStatus`.
   - Step 5/6: rewrite the GET (~line 620) and PUT (~line 640) handlers' trailing status
     construction — **preserve the existing repository-write/RLS/assertAdminUser call ordering
     exactly**, only change the trailing `available: dependencies.chatMultiplexerAvailability ?? ...`
     line to call `dependencies.getChatMultiplexerStatus?.(multiplexer)` (see plan for exact object
     shape/fallback).
   - Step 7: rename the `registerHostDiagnosticsRoutes` call site field (~line 700-708):
     `chatMultiplexerAvailability: dependencies.chatMultiplexerAvailability` →
     `getChatMultiplexerStatus: dependencies.getChatMultiplexerStatus`.
   - Step 8: rerun `pnpm exec tsx scripts/test-integration.ts tests/integration/chat-multiplexer-admin.test.ts`
     (isolated-DB runner — plain `pnpm vitest run` on this file errors "refusing to reset shared
     jarv1s database"; always use the tsx runner or `pnpm test:integration` for this suite).
   - Step 9: `git add packages/settings/src/routes.ts tests/integration/chat-multiplexer-admin.test.ts`
     (never `-A`), commit per plan's message.
3. Task 5 → Task 6 → Task 7, each via `superpowers:test-driven-development` (manual, task-by-task —
   `executing-plans`/`subagent-driven-development` are disabled in this repo per `coordinated-build`).
   Task 5's own integration test (`host-diagnostics-admin.test.ts`) also needs the tsx isolated-DB
   runner, not plain vitest.
4. Before every push: `pnpm format:check && pnpm lint && pnpm typecheck` then
   `git fetch origin main && git rebase origin/main`.
5. Relay again on the next 70% context-meter warning or compaction summary (message Coordinator
   first, then use `relay` skill — this doc is relay-7; next would be relay-8).
6. On completion of all 7 tasks + spec Exit Criteria met → `coordinated-wrap-up` (PR + report only —
   never merge/board/close). Elevated QA at wrap-up: `/security-review` + `/code-review`.
7. Coordinator already approved the plan — no need to re-message for approval. Coordinator has been
   pinged twice already (Task 3 done, and this relay) — ping again at PR-ready or if blocked.

## Bans still in force

- Worktree/branch only as above; explicit `git add <path>`, never `-A`/`.`.
- Never touch `docs/coordination/`.
- No secrets in any doc/payload/log.
- No web API route may install Herdr — hard non-goal (STOP + escalate if the build ever seems to
  need one).
- Never assume a migration number (not applicable to this feature — no migrations touched).
