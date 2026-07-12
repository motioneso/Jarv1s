# #866 herdr-install — relay-6 continuation

Spec: `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` (approved)
Plan: `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md` (commit `cc126a3e`,
**coordinator-approved**, 7 TDD tasks)
Branch/worktree: `build/866-herdr-install` (this worktree — reuse, do NOT create a new one)
Coordinator label: `Coordinator` (resolve pane fresh via `herdr pane list`; don't reuse a `…-N`)

## State: plan approved, Tasks 1-2 done+committed, Task 3 next. Build in progress via TDD.

- Task 1 (live multiplexer status probe, `chat-multiplexer.ts`) — DONE, commit `3e3e4350`.
- Task 2 (DTO+schema, `platform-api.ts`) — DONE, commit `da1e1834`.
- Task 3 (wire probe through composition root, `module-registry/src/index.ts`) — NOT STARTED.
- Tasks 4-7 (settings routes, host-diagnostics rewire, HostPane UI, install-herdr.sh) — NOT STARTED.

## Do NOT re-plan or re-read source files before starting Task 3

The plan file (`docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`) is
self-contained — every task has exact file paths, exact current code, exact new code, exact test
code, and a Self-Review mapping to spec Acceptance Criteria. **Read that plan file in full**, then
start directly at Task 3, Step 1 (no new test for Task 3 — proceed straight to implementation, per
the plan). Task 3 touches only `packages/module-registry/src/index.ts` (5 spots: import blocks,
`BuiltInRouteDependencies` field, settings wiring, `registerBuiltInApiRoutes`, deps object literal —
exact line refs and exact code are all in the plan).

## Next steps in order

1. Read the plan file in full.
2. Task 3 → Task 4 → Task 5 → Task 6 → Task 7, each via `superpowers:test-driven-development`
   (manual, task-by-task — `executing-plans`/`subagent-driven-development` are disabled in this
   repo per `coordinated-build`). Each task: write failing test (except Task 3, no new test) →
   verify fail → implement → verify pass → `git add <exact files>` (never `-A`) → commit with
   `Co-Authored-By: Claude` trailer.
3. Before every push: `pnpm format:check && pnpm lint && pnpm typecheck` then
   `git fetch origin main && git rebase origin/main`.
4. Relay again on the next 70% context-meter warning or compaction summary (message Coordinator
   first, then use `relay` skill — this doc is relay-6; next would be relay-7).
5. On completion of all 7 tasks + spec Exit Criteria met → `coordinated-wrap-up` (PR + report only —
   never merge/board/close). Elevated QA at wrap-up: `/security-review` + `/code-review`.
6. Coordinator already approved the plan — no need to re-message for approval. Ping the
   coordinator at the next natural checkpoint (PR-ready or if blocked), per its own instruction.

## Bans still in force

- Worktree/branch only as above; explicit `git add <path>`, never `-A`/`.`.
- Never touch `docs/coordination/`.
- No secrets in any doc/payload/log.
- No web API route may install Herdr — hard non-goal (STOP + escalate if the build ever seems to
  need one).
- Never assume a migration number (not applicable to this feature — no migrations touched).
