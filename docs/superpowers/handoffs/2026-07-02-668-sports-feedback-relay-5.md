# Relay 5 — #668 Sports Feedback Pass

Continue via `coordinated-build`.

Issue: https://github.com/motioneso/Jarv1s/issues/668
Branch/worktree: `coord/668-sports-feedback-build` at `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`

## State

Previous completed checkpoints:

- Task 1 committed: `4bfb7531`
- Task 2 committed: `02c1d005` + `3911dba0`

The prior agent started Task 3 and hit relay territory before a commit.

Dirty files at relay:

- `tests/unit/espn-source.test.ts`
- `packages/sports/src/source/__fixtures__/fifa-standings.json`
- `packages/sports/src/source/__fixtures__/nfl-standings.json`
- `.claude/context-meter.log` is untracked; leave it unstaged.

These edits are only the Task 3 fixture/test boundary:

- added FIFA standings fixture
- added NFL standings fixture
- started rewriting/adding standings parser tests for grouped sections and winPercent

## Next

1. Inspect the dirty diff; do not assume it is complete.
2. Finish the immediate Task 3 test boundary and parser changes from `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md`.
3. Commit Task 3 with explicit paths only.
4. Continue Tasks 4-7, including extra #668 feedback from issue comments: header copy cleanup, remove `cached`, fix Manage link, improve Sports nav icon if local.

Do not touch `docs/coordination/`. Do not use `git add .` or `git add -A`.
