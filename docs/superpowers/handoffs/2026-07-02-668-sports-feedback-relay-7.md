# Relay 7 — #668 Sports Feedback Pass

Continue via `coordinated-build`. **relay-6 is authoritative for full context**; this doc is a
pointer only — do not re-derive what's below, act on it.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator`

## What changed since relay-6

Nothing. This relay hit the context checkpoint (~112k tok) during diff inspection, before any
edit. No new commits, no working-tree changes beyond what relay-6 already described.

## Verified state (read-only inspection this session)

Plan: `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md`, Task 3 (line 464), Step 7 (line 819).

Confirmed via `git diff` against the plan text — **Task 3 Steps 1–6 are done and match the plan
exactly**:

- `packages/shared/src/sports-api.ts` — `StandingsShape`, `StandingsSection`, `winPercent`,
  schema updates: done.
- `packages/sports/src/source/catalog.ts` — `standingsShape` per entry: done.
- `packages/sports/src/source/sports-source.ts` — `StandingsTable`, `getStandings` signature: done.
- `packages/sports/src/source/espn-source.ts` — `toStandingsRow` extracted, sectioned
  `getStandings` rewrite: done.
- `packages/sports/src/sports-service.ts` — `EMPTY_STANDINGS`, `StandingsTable` cache/map,
  flattened rows into `buildCard`, `standingsShape` in catalog + groups: done.
- `tests/unit/espn-source.test.ts` — 3 rewritten/added tests (soccer single-section, fifa groups,
  nfl record winPercent): done.
- `__fixtures__/fifa-standings.json`, `__fixtures__/nfl-standings.json`: present, match plan.

**Step 7 is NOT done** — `apps/web/src/sports/sports-page.tsx` only has the `StandingsRow` type
import added (line ~9-14). `StandingsRail` (currently lines 401–456) is still the old flat
`group.rows` single-table render and needs the plan's per-section, shape-aware rewrite verbatim
from plan lines 826–886 (the `group.sections.map(...)` JSX block + `recordLine` /
`formatPct` helpers). Plan explicitly says: keep the `followedKeys` prop signature as-is here —
Task 4 is what swaps it to `followedPairs`.

## Next

1. Apply plan Task 3 Step 7 (lines 819–888) to `apps/web/src/sports/sports-page.tsx`.
2. Do Steps 8–10: update `sports-service.test.ts` / `sports-routes.test.ts` /
   `sports-page.test.tsx` / `sports-catalog.test.ts` fixtures per plan lines 890–935, run
   `pnpm vitest run tests/unit && pnpm typecheck`, then commit with **explicit paths** per plan
   lines 943–951 (verify `git status --short` before `git add tests/unit`).
3. Continue Tasks 4–7 per the plan, plus extra #668 feedback from issue comments (see relay-5/6
   for the specific copy/nav items if not already folded into the plan).

Do not touch `docs/coordination/`. Do not use `git add .` or `git add -A`.
