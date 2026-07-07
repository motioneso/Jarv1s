# Relay — #834 jobs↔settings↔proactive-monitoring dependency cycle

**Trigger:** context-meter 70% warning fired in the planning session. No compaction seen. Relaying
per `coordinated-build` step 3 / `relay` skill.

**Spec (approved, governing):** `docs/superpowers/specs/2026-07-04-module-web-registry.md`
(module-isolation follow-up from the #798 combined security review)
**Issue:** #834 — `gh issue view 834 --repo motioneso/jarv1s`
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/834-jobs-settings-cycle`
**Branch:** `834-jobs-settings-cycle` off `origin/main` @ `616b9ed1`
**Plan (written + APPROVED):** `docs/superpowers/plans/2026-07-06-jobs-settings-cycle.md`
**Coordinator:** label `Coordinator`, session id `6b766f7c-577d-4e32-b5b8-b441e6788036` — re-resolve
pane number fresh via `herdr pane list` (never reuse a `w…-N` from this doc).
**Original build session id (to be reaped):** `7c7eff4c-e45c-4f1f-b406-30c0fd70dcc1`, label
`dep-cycle`.

## Approval status

**Coordinator approved the plan verbatim** (received mid-relay-prep): *"Approved — inlining the
literal (matching calendar/routes.ts precedent) and dropping the cross-package _MODULE_ID import
is exactly the module-isolation fix the spec calls for, and the cycle-detection gate addition is
good regression coverage. Proceed with all 4 tasks."*

**Do NOT re-ask for approval.** Proceed straight into Task 1 build via `coordinated-build` step 2
(TDD), task by task, in the order below.

## State

- **No code committed yet.** `git status --short` at relay time shows only two untracked docs: this
  file and the plan file — nothing else touched. Working tree is otherwise clean on
  `834-jobs-settings-cycle`.
- `pnpm install` already run in this worktree (`node_modules` exists) — **do not re-run** unless a
  task step explicitly calls for it (Task 3 Step 3 does, after editing `packages/jobs/package.json`).

## What's left — execute in order, TDD, one commit per task

Full step-by-step detail (exact code, exact commands, exact expected output) is in the plan file —
read it IN FULL before starting, this doc is a pointer, not a substitute.

1. **Task 1** — add `export function detectDependencyCycles(...)` to `scripts/check-package-deps.ts`
   + `tests/unit/check-package-deps-cycles.test.ts` (5 cases: acyclic, diamond, direct 2-cycle,
   3-cycle, self-reference no-throw). Red → green → commit.
2. **Task 2** — wire `detectDependencyCycles` into `main()` (extend `Violation.kind` with
   `"cycle"`, build the `@jarv1s/*`-only dependency graph from `loadPackageDescriptor`, push
   `[cycle]` violations). Manually confirm `pnpm check:package-deps` goes **RED** on the live
   `@jarv1s/jobs -> @jarv1s/settings -> @jarv1s/proactive-monitoring -> @jarv1s/jobs` cycle (proves
   the gate catches the real bug) BEFORE fixing it. Commit (tree intentionally red at
   `check:package-deps` after this commit — expected, Task 3 fixes it).
3. **Task 3** — the actual fix: `packages/jobs/src/upgrade-notify.ts` — drop
   `import { SETTINGS_MODULE_ID } from "@jarv1s/settings";`, add local literal
   `const SETTINGS_MODULE_ID = "settings";` with the why-comment from the plan (cites #834, cites
   the calendar/routes.ts precedent, must-stay-in-sync note). Remove
   `"@jarv1s/settings": "workspace:*"` from `packages/jobs/package.json`. `pnpm install` (confirm no
   cyclic-workspace-dependency warning). Confirm `tests/unit/upgrade-notify.test.ts` still passes
   and `pnpm check:package-deps` is green. Commit (includes `pnpm-lock.yaml`).
4. **Task 4** — full verification: `pnpm verify:foundation` (real exit code, not piped through
   `tail`), `pnpm install` (confirm no cyclic warning, independent of the custom gate), record both
   in your `coordinated-wrap-up` report.

## Root cause (already verified, don't re-derive)

Cycle: `jobs -> settings -> proactive-monitoring -> jobs`, plus a direct `settings <-> jobs`
2-cycle. The **only** closing edge is `packages/jobs/src/upgrade-notify.ts:3` importing
`SETTINGS_MODULE_ID` from `@jarv1s/settings` — used once, purely as a notification `moduleId` tag
(`packages/jobs/src/upgrade-notify.ts:32`). Every other cross-module module-id tag in the repo is a
local literal (precedent: `packages/calendar/src/routes.ts:25`,
`CALENDAR_WRITEBACK_MODULE_ID = "calendar"`) — this was the only cross-package `_MODULE_ID` import
repo-wide. `settings -> jobs` (data-export job enqueueing) and `proactive-monitoring -> jobs`
(pg-boss worker registration) are both legitimate and stay; only `jobs`'s edges back out are
removed, making the graph acyclic.

## Collision notes (unchanged from original handoff)

Own `packages/jobs`, `packages/settings`, `packages/proactive-monitoring`,
`scripts/check-package-deps.ts`, `tests/unit/` for this run. No overlap with #835 (settings-ui),
#832/#833/#836 (datasets), #837 (sports).

## Run-specific bans (unchanged)

`git add` by explicit path only, never `-A`. Never touch `docs/coordination/`, the board, or merge.
No secrets in any doc/payload/log.

## After Task 4

Invoke `coordinated-wrap-up` (clean tree, own gate, pre-push trio + rebase, push, open PR, report
PR + evidence to Coordinator). Do not merge, touch the board, or close the issue — that's the
Coordinator's.
