# Relay r7 — #656 sports module Task 10

Coordinator-created dirty relay because `Build-656-sports-r6` hit 100% context while finishing the Task 10 RLS integration test.

## Worktree

- Worktree: `~/Jarv1s/.claude/worktrees/656-sports-module`
- Branch: `coord/656-sports-module`
- Coordinator label: `Coordinator`
- Previous agent: `Build-656-sports-r6`, pane `w1:p1V`, session `8e2d354d-3ff7-4d92-b171-4a6506564f8d`

## Last Committed Sports Work

- Task 9 committed: `f48a6b01` (`feat(sports): manifest + briefing-only followedFactsToday read tool`)
- r6 relay handoff commit: `69eeef63`

## Current Dirty State

Task 10 is in progress and dirty. Do not start Task 11 until Task 10 is committed green.

Expected dirty files:

- `packages/module-registry/package.json`
- `packages/module-registry/src/index.ts`
- `pnpm-lock.yaml`
- `tests/integration/foundation.test.ts`
- `tests/unit/sports-registry.test.ts`
- `tests/integration/sports-follows-repository.test.ts`
- `.claude/context-meter.log` (do not stage)
- `docs/coordination/handoffs/2026-07-01-656-sports-module.md` (do not stage)

Known status:

- Migration `0133_sports_follows.sql` is sports-owned; #647/#648 are not claiming migrations.
- `tests/integration/foundation.test.ts` migration list was updated to include `0133_sports_follows.sql`.
- r6 wrote `tests/integration/sports-follows-repository.test.ts` and removed an unused `OutgoingHttpHeaders` parity stub immediately before relay.
- r6 was about to re-confirm PG quiet before running PG-heavy tests. Coordinator had already cleared PG after #648 local full gate completed; still avoid running concurrently with another local integration gate if that changes.

## Next Steps

1. Read this handoff fully.
2. Inspect dirty files and continue Task 10 only.
3. Run focused non-PG checks for registry code first.
4. Run focused PG integration for sports follows RLS/foundation once local PG is quiet.
5. Run relevant typecheck/lint/format checks for touched files.
6. Commit Task 10 with explicit paths only.
7. Report commit and verification to `Coordinator`.

## Guardrails

- No `git add -A` or `git add .`; explicit paths only.
- Do not touch `docs/coordination/`.
- No repo-wide format; format only touched files.
- Preserve module isolation and DataContextDb.
- Keep AccessContext unchanged.
