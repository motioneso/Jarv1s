# Relay 3 — #668 Sports Feedback Pass

Continue via `coordinated-build`.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
Coordinator label: `Coordinator`

## Current State

The prior agent hit a context checkpoint during Task 2 and was interrupted by the coordinator to prevent auto-compaction with dirty work. Treat this as a dirty-state continuation.

Last committed code checkpoint:

- `4bfb7531` — `#668 feat(sports): CSP img-src follows SportsSource image hosts`

Dirty files at relay time:

- `packages/shared/src/sports-api.ts`
- `packages/sports/src/source/__fixtures__/nfl-news.json`
- `packages/sports/src/source/espn-source.ts`
- `packages/sports/src/source/sports-source.ts`
- `tests/unit/espn-source.test.ts`
- `.claude/context-meter.log` is untracked; leave it unstaged.

Task 2 was in progress:

- Shared `Headline` shape was being extended with `imageUrl` and `teamKeys`.
- Source types were being extended with `SourceHeadline`, `SourceTeamRef`, and ESPN `sourceTeamId` / article image/category parsing.
- `tests/unit/espn-source.test.ts` and `packages/sports/src/source/__fixtures__/nfl-news.json` were already dirty for this task.

Before continuing implementation, inspect the dirty diff and reconcile it with the plan. Do not assume the prior edits are complete.

## Added Feedback To Include In #668

Ben added these while Task 2 was in flight. They are persisted on issue #668 and should be folded into this same branch if they remain small/local:

- Rewrite the top `/sports` header wording so it sounds less stiff/textbook.
- Remove the redundant green `Sports` label in the top section because the app header already says Sports.
- Remove the word `cached` from the top/header copy.
- Fix the `Manage` link so it opens/navigates to sports follow/team management instead of Today.
- Improve the Sports module nav graphic, e.g. ball/trophy-style icon, if it is a small local icon swap; escalate if it requires broader nav design changes.

## Next Steps

1. Read `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` only as needed; avoid reloading large context if possible.
2. Inspect the dirty Task 2 diff.
3. Finish Task 2 with focused tests, then commit the Task 2 files explicitly.
4. Continue Tasks 3-7 from the plan, including the added feedback above.
5. If context rises again, relay early with a pointer handoff.

Do not touch `docs/coordination/`. Do not use `git add .` or `git add -A`.
