# Build Handoff — calendar-cache-reconciliation

**Spec (approved):** docs/superpowers/specs/2026-06-25-calendar-cache-reconciliation.md
**GitHub issue:** #473
**Risk tier:** `sensitive` (worker-role DELETE grant migration + reconcile-on-sync logic that DELETEs stale/cancelled events + user-visible "Sync now" button. Data-affecting path. Auto-merge after green QA + Ben digest.)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/calendar-cache-reconciliation **Branch:** build/calendar-cache-reconciliation (off origin/main @ ac56457)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify single Coordinator pane before messaging.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (immutable authority.)
**Relay threshold:** ~80–100k tokens OR compaction summary.

## Start

1. Resolve skills (`coordinated-build` or absolute path).
2. `pnpm install` only if `node_modules` missing.
3. Read spec IN FULL.
4. **Verify spec against branch.** Confirm `packages/connectors/src/sync-jobs.ts:309-378` still upserts-only (no DELETE in the loop) — that's the gap you fix. Confirm current worker grants (SELECT/INSERT/UPDATE on calendar_events, no DELETE).
5. Invoke **`coordinated-build`**: plan → coordinator approval → build TDD/green → pre-push trio + rebase → **`coordinated-wrap-up`**.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest locally and record exit codes; CI also runs via `gh pr checks`.
- Work only in this worktree/branch. Commit green per task; scope `git add`.
- Plan approval from coordinator. No code before it.
- Escalate to `Coordinator` on blocker / plan-ready / design-fork / done.
- Never touch board/milestones/merge.
- Self-monitor context → relay at threshold.
- Honor CLAUDE.md Hard Invariants. No secrets.
- Caveman status; conventional commits/PR/code.

## Collision notes (from the coordinator)

- **YOU OWN A MIGRATION** — the only wave-2 spec that does. Next available migration slot is **0113** (highest existing is 0112). Your migration adds the worker-role DELETE grant on `calendar_events`. **Claim 0113 explicitly** in your plan; do NOT pick a random number (migration ordering is global). File at `infra/postgres/migrations/0113_worker_calendar_events_delete.sql` (or the role-grant location your repo uses for grants — check existing grant migrations for the convention).
- **Reconcile-on-sync:** single DELETE pass AFTER the upsert loop in `sync-jobs.ts`. Handles both deleted events (gone from Google) and cancelled events (status changed). Don't add a separate background job.
- **"Sync now" button** on `AccountRow` (`apps/web/src/settings/settings-personal-data-panes.tsx`) — **collision risk with wave-3 #482** (which also edits that file). Keep your change minimal and self-contained so #482's later rebase is clean. You're first (wave 2), they follow.
- **Data-affecting:** the DELETE only affects cached calendar_events rows that are stale/cancelled — never deletes from Google. Test the reconciliation logic carefully against fixtures with deleted + cancelled events.
- Never touch `docs/coordination/`; never repo-wide format + broad add.
