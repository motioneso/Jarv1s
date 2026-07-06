# Relay 4 — #668 Sports Feedback Pass

Continue via `coordinated-build`.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator`

## Current State

Relay 3's agent hit a context checkpoint again during Task 2 without committing. This relay
**verified the dirty diff line-by-line against the plan** — it is clean and correct, matching
Task 2 Steps 1-6 exactly. Do not re-derive or second-guess it; resume at Step 7.

Last committed code checkpoint:

- `4bfb7531` — `#668 feat(sports): CSP img-src follows SportsSource image hosts`

Dirty files at relay time (verified matching plan Steps 1-6, still uncommitted):

- `packages/shared/src/sports-api.ts` — `Headline.imageUrl`/`teamKeys` + schema (Step 4). Done.
- `packages/sports/src/source/sports-source.ts` — `SourceTeamRef`, `SourceHeadline` types,
  method signatures (Step 5). Done.
- `packages/sports/src/source/espn-source.ts` — `listTeams`/`getHeadlines` adapter rewrite
  (Step 6). Done.
- `packages/sports/src/source/__fixtures__/nfl-news.json` — augmented fixture (Step 1). Done.
- `tests/unit/espn-source.test.ts` — two new adapter tests (Step 2). Done.
- `.claude/context-meter.log` is untracked; leave it unstaged.

## Task 2 — resume here

Read `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` Task 2 (starts ~line 243) for
exact code. Remaining steps:

- **Step 7**: plumb `SourceHeadline`/`SourceTeamRef` through `packages/sports/src/sports-service.ts`
  (cache/type plumbing only, no behavior change) — this file is still **untouched**.
- **Step 8**: update every `Headline`/`SourceHeadline` test fixture — `tests/unit/sports-service.test.ts`,
  `tests/unit/sports-page.test.tsx`, `tests/unit/sports-routes.test.ts`, and check
  `tests/unit/web-sports-client.test.ts` — add `imageUrl: null, teamKeys: []` (+ `sourceTeamIds`
  where source-level) and leak-pin assertions (`not.toContain("sourceTeamId")`).
- **Step 9**: `pnpm vitest run tests/unit/espn-source.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts tests/unit/sports-page.test.tsx` then `pnpm typecheck` — both exit 0.
- **Step 10**: commit exactly the files listed in the plan's Step 10 `git add` (add
  `web-sports-client.test.ts` too if Step 8 touched it). Message:
  `#668 feat(sports): headline images and provider team tags through the source seam`.

## Then continue Tasks 3-7

Same plan doc. Task 3 = competition-correct standings, Task 4 = relevance/teamKeys join, Task 5 =
followed-team cards, Task 6 = Top Stories rail + league news, Task 7 = final gate/wrap-up (read
as needed — do not preload all of it, it's long).

## Added Feedback To Include In #668

Ben added these; still outstanding, fold into this branch if small/local (escalate if not):

- Rewrite the top `/sports` header wording so it sounds less stiff/textbook.
- Remove the redundant green `Sports` label in the top section (app header already says Sports).
- Remove the word `cached` from the top/header copy.
- Fix the `Manage` link so it opens/navigates to sports follow/team management instead of Today.
- Improve the Sports module nav graphic (ball/trophy-style icon) if a small local swap; escalate
  if it needs broader nav design changes.

## Process note for the next agent

Context checkpointed at 73% (~110k/151k tok) immediately per the coordinated-build self-monitor
rule, after verifying the diff but before writing any new code — do the same: verify-then-relay
beats burning remaining headroom on Step 7 implementation with no room to write a clean handoff.

Do not touch `docs/coordination/`. Do not use `git add .` or `git add -A`.
