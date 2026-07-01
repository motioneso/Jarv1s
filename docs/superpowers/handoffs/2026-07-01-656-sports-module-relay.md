# 656 Sports Module Relay

Run: `2026-06-30-rfa-fleet`
Issue: #656
Worktree: `~/Jarv1s/.claude/worktrees/656-sports-module`
Branch: `coord/656-sports-module`
Coordinator: `Coordinator`, Codex session `019f1f06-e858-7862-9245-ae8a22ea968c`

## Current State

- Task 0 is committed: `93b203b8 docs(sports): restore approved spec and plan`.
- No implementation task is committed yet.
- Old agent `Build-656-sports-module` hit context checkpoint before Task 1 implementation and is being reaped.
- Full approved docs are present:
  - `docs/superpowers/specs/2026-06-30-sports-module.md`
  - `docs/superpowers/plans/2026-07-01-sports-module.md`

## Approved Plan Corrections

- Use migration `0133_sports_follows.sql`; 0130-0132 are already taken. Re-check origin before final push/rebase.
- Do not create `packages/sports/tsconfig.json`; weather and wellness have none. Mirror the real weather package shape.
- Add `sports` to `tests/integration/module-enablement.test.ts` active id assertion.
- `findExecute` is local to `packages/briefings/src/compose.ts`; use actual branch locations.
- `apps/web/src/app-route-metadata.ts` has the route union at the current branch location; weather has no web route precedent there.

## Approved Decisions

- Briefing deviation approved: add exactly one chat-visible `risk: "read"` tool, `sports.followedFactsToday`, because briefings has no provider registry. Do not add rich `sports.scores`.
- UI source: proceed through Tasks 1-12. At Task 13, cheaply try Open Design / Jarvis Design System source first; if unavailable, author from spec section 4.6a taxonomy and note fallback.
- Create only a small local `RationaleChip` if no existing component exists.

## New Drift Found During Task 1 Verification

- Root `vitest.config.ts` does not include general `packages/*/src` tests.
- Repo tests live under `tests/unit` and `tests/integration`.
- Do not add `packages/sports/src/__tests__/*.test.ts`.
- Do not rely on `pnpm --filter @jarv1s/sports test`; use targeted root vitest commands matching existing repo test patterns.

## Next Step

Start Task 1 TDD with targeted reads only:

1. Mirror `packages/weather/package.json` shape.
2. Put sports unit tests under `tests/unit/`.
3. Add shared contracts in `packages/shared/src/sports-api.ts` and re-export from `packages/shared/src/index.ts`.
4. Commit green Task 1 only, then continue through the approved plan.

## Constraints

- Do not touch `docs/coordination/`.
- No broad `git add .` or `git add -A`.
- Format/stage only changed files.
- Preserve `DataContextDb`, owner-only RLS, no secrets, and module isolation invariants.
