# Build Handoff — rfa-535-long-running-goals

**Spec (approved):** docs/superpowers/specs/2026-06-27-long-running-jarvis-goals.md
**GitHub issue:** #535
**Risk tier:** `security` (touches memory schema, assistant gateway, pg-boss schedules, preferences, RLS/export)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-535-long-running-goals **Branch:** rfa-535-long-running-goals (off origin/main @ 39af841f)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify exactly one pane with this label before messaging)
**Coordinator session id:** `0ae2d4ce-8005-4b66-b7b7-ee9243905817` (immutable authority)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (relay immediately on compaction).

## Start

1. `[ -d node_modules ] || pnpm install` — skip if already present.
2. Read `docs/superpowers/specs/2026-06-27-long-running-jarvis-goals.md` IN FULL.
3. Verify the spec against YOUR branch before planning — grep/read cited files to confirm gaps are still real. Escalate any spec drift to the coordinator before proceeding.
4. Invoke the `coordinated-build` skill and follow it: write the plan → escalate to coordinator for approval → on approval, build TDD/green → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out with `coordinated-wrap-up`.

## Migration slot

**Assigned: `0123`** — your migration file must be `packages/db/src/<module>/sql/0123_long_running_goals.sql` (or similar name). Do NOT assume a different number. This number is globally assigned by landing order.

## Your compact (non-negotiable)

- CI gate: `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files; record exit codes in wrap-up.
- Work only in this worktree/branch. Commit green per task; `git add` only your changed paths.
- Plan approval comes from the coordinator, not a human gate. No code before approval.
- Escalate to `Coordinator` label the moment: blocker, plan ready, design fork, or done.
- Never touch `docs/coordination/`, project board, milestones, or merges.
- Self-monitor context: relay at ~80–100k tokens or on compaction summary.
- Honor all CLAUDE.md Hard Invariants. No secrets in any doc, payload, log, or prompt.
- Caveman mode for all status/escalations to coordinator (terse, full technical accuracy).

## Collision notes

- **Migration 0123 is your slot.** Do not change it without coordinator approval.
- Shares **memory schema/package/API** with #528 (merged), #532 (merged), #533 (merged), #537 (unstarted), #538 (unstarted). Use existing public APIs from merged modules — do not re-implement.
- Shares **app.preferences / settings routes/UI** with #526 (merged), #531 (being merged), #534 (merged). Use preferences in the existing `app.preferences` table pattern.
- Shares **assistant gateway / action requests / manifests** with #525 (merged), #534 (merged), #537 (unstarted). Route through the existing gateway — no second executor.
- Shares **pg-boss metadata-only jobs/schedules** with #529 (merged), #531 (being merged), #536 (unstarted). Payloads must remain metadata-only (actor/resource IDs, kind, idempotency key) — no private content.
- Shares **cross-source module manifests/read providers** with #525 (merged), #531 (being merged), #537 (unstarted).
- Shares **export/delete/RLS coverage** — any new table storing user data needs owner-only RLS + export + delete coverage.
- Stage only your own paths; no `git add -A`. Never run repo-wide `pnpm format` without scoping.
- Do not touch `docs/coordination/` (coordinator-only).
