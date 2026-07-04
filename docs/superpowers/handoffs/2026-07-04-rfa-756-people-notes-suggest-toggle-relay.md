# RFA-756 relay handoff

**Spec:** issue #756 (approved as spec, per handoff doc in coordinator worktree
`docs/coordination/handoffs/2026-07-04-rfa-fleet/rfa-756-people-notes-suggest-toggle.md`).
**Plan:** `docs/superpowers/plans/2026-07-04-people-notes-suggest-toggle.md` (coordinator-approved).
**Branch/worktree:** `rfa-756-people-notes-suggest-toggle`, this worktree.
**Coordinator:** label `Coordinator`, session id `0f374652-df12-44cc-8592-881c421dfebb` (re-resolve
fresh via `herdr pane list` — never reuse a `…-N` pane number).

## Done (all committed)

1. `9cdbb910` — `PEOPLE_NOTES_SOURCE_BEHAVIORS` descriptor in
   `apps/web/src/settings/settings-source-behaviors.ts` + `tests/unit/settings-source-behaviors.test.ts`.
2. `eaa7e3b7` — toggle rendered in `apps/web/src/settings/settings-people-pane.tsx`
   (`sourceBehaviorsQuery`/`sourceBehaviorMutation` + `Row`/`Switch` in the "People notes" group) +
   2 new tests in `tests/unit/settings-people-pane.test.tsx`.
3. `33ff19fa` — prettier formatting fixup + added the plan doc to the tree.

All 3 commits are on `rfa-756-people-notes-suggest-toggle`, rebased clean on `origin/main` (no
conflicts, branch was already up to date at rebase time).

## Gate status

- `pnpm format:check && pnpm lint && pnpm typecheck` — **clean**.
- `pnpm test:unit` — **clean** (247 files, 1630 passed, 2 skipped).
- `pnpm vitest run tests/unit/settings-people-pane.test.tsx tests/unit/settings-source-behaviors.test.ts`
  — **9/9 passed** (the tests this PR added/touches).
- `pnpm test:integration` (via `pnpm verify:foundation`) — **78/112 files fail**, but pre-existing
  and unrelated to this diff: `relation "app.chat_threads" does not exist` /
  `app.usefulness_feedback_signals` / `app.usefulness_feedback_targets` in the shared dev `jarv1s`
  Postgres database, even though `pnpm db:migrate` reports "133 already current". This diff touches
  zero backend/migration/module-registry code (2 frontend files only) — root cause looks like
  `BUILT_IN_MODULES` sql-dir wiring for chat/usefulness-feedback being stale in the shared DB, not
  something this PR caused. Reported to the coordinator (queued message sent, not yet acked at
  relay time) with the exact failure signatures. **This is exactly the multi-agent-pg-contention /
  grounding-discipline pattern flagged in agentmemory — do not attempt to fix the shared DB
  yourself; verify against origin/main state or ask the coordinator.**

## What's left

1. Confirm with coordinator whether the integration-test DB drift blocks PR opening, or whether to
   proceed with format/lint/typecheck/unit + targeted-test evidence only (my last message to the
   coordinator proposed proceeding; awaiting explicit ack or override).
2. Once confirmed: invoke `coordinated-wrap-up` (push, open PR referencing issue #756, report PR
   link + this evidence back to the coordinator). Do **not** merge, move the board, or close the
   issue — coordinator-only.
3. Task list state (this session's TaskCreate/TaskUpdate tracking, IDs are local to that session —
   recreate if needed): plan-approval done, Task 1 done, Task 2 done, wrap-up in progress.

## Notes for the successor

- `node_modules` already present in this worktree — skip `pnpm install`.
- Don't re-run the full `pnpm verify:foundation` gate expecting integration to pass; it won't,
  for the reason above. Re-run `pnpm test:unit` + the 2 targeted test files if you want to reconfirm
  green before opening the PR.
- The coordinator pane's `pane_id` reflows — always re-resolve via `herdr pane list` by label
  `Coordinator` before messaging.
