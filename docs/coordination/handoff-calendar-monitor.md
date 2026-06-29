# Build Handoff — calendar-monitor

**Spec (approved):** `docs/superpowers/specs/2026-06-27-restrained-proactive-monitoring.md`

**GitHub issues:** #564, #567 — fix both in one PR.
**Risk tier:** `sensitive` (#567 is same external-channel sanitization class as security finding in #531)
**Worktree:** ~/Jarv1s/.claude/worktrees/calendar-monitor **Branch:** calendar-monitor (off origin/main)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify exactly one pane holds this label before messaging)
**Coordinator session id:** `f8a5b8f7-a287-4665-b480-0f46dc52bed2`
**Relay threshold:** ~80–100k tokens OR compaction summary in your own context → relay immediately.

## What to build

Two proactive monitoring fixes — one logic bug, one sanitization gap.

### #564 — Scanner ranking index mismatch after sort

In `packages/monitoring/src/scanner.ts:160-206`, after `sorted = [...ranked].sort(byScore)`, the loop pairs `sorted[i]` (which carries the priority band and reasons from the sorted order) with `allowedSignals[i]` (which is still in the original pre-sort order). The sort breaks index correspondence — cards get the wrong priority band assigned.

**Required:**
- Fix the loop so the priority band travels with the signal through the sort. The pattern should sort once and use only the sorted array (or sort both arrays together). The fix must preserve within-owner only semantics — no cross-user/RLS implications here.
- Add or update a test that verifies priority bands remain associated with their correct signals after sorting.

### #567 — Calendar monitor-provider: sanitize event.title and event.location

In `packages/calendar/src/monitor-provider.ts` (~lines 69, 72-73), `event.title` and `event.location` are written to proactive card fields (title/summary) without `sanitizeSnippet()` wrapping. The email monitor-provider was fixed for the same class of issue in PR #531.

**Required:**
- Apply `sanitizeSnippet(event.title)` and `sanitizeSnippet(event.location)` before writing to proactive card fields.
- Follow the exact pattern at `packages/email/src/monitor-provider.ts:78,80`.
- Add a test that verifies the sanitization is applied (assert sanitized output, not raw input).

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec above IN FULL.
3. Grep `packages/monitoring/src/scanner.ts` and `packages/calendar/src/monitor-provider.ts` on YOUR branch to confirm both gaps are still real.
4. Invoke `coordinated-build`, write the plan, escalate to Coordinator for approval, then build.

## Your compact

- Both fixes in one PR titled `fix(monitoring): scanner ranking index mismatch, sanitize calendar event title/location (#564 #567)`.
- Run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files; record exit codes in wrap-up.
- Work only in this worktree. `git add` only your changed files.
- Never touch the project board, milestones, or merge.
- Escalate to `Coordinator` on: plan ready, blocker, design fork outside spec, done.

## Collision notes

- No other agent touches `packages/monitoring/` or `packages/calendar/` this run.
- No migrations needed.
