# Relay 6 — #668 Sports Feedback Pass

Continue via `coordinated-build`.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`

## State

Completed commits:

- Task 1: `4bfb7531`
- Task 2: `02c1d005` + `3911dba0`

Task 3 is in progress and dirty. Prior agent reported:

- Step 3 shared types/schema done
- Step 4 catalog `standingsShape` done
- Step 5 ESPN adapter rewrite done
- Step 6 sports-service composition done
- Step 7 just started; only `StandingsRow` import was added in `apps/web/src/sports/sports-page.tsx`

Dirty files at relay:

- `apps/web/src/sports/sports-page.tsx`
- `packages/shared/src/sports-api.ts`
- `packages/sports/src/source/catalog.ts`
- `packages/sports/src/source/espn-source.ts`
- `packages/sports/src/source/sports-source.ts`
- `packages/sports/src/sports-service.ts`
- `tests/unit/espn-source.test.ts`
- `packages/sports/src/source/__fixtures__/fifa-standings.json`
- `packages/sports/src/source/__fixtures__/nfl-standings.json`
- `.claude/context-meter.log` is untracked; leave it unstaged.

## Next

1. Inspect dirty diff first; do not assume completeness.
2. Resume Task 3 Step 7: finish shape-aware `StandingsRail` in `apps/web/src/sports/sports-page.tsx`.
3. Finish Task 3 Steps 8-10: fixtures/assertions, focused tests/typecheck, explicit-path commit.
4. Continue Tasks 4-7 and the extra #668 feedback from issue comments.

Do not touch `docs/coordination/`. Do not use `git add .` or `git add -A`.
