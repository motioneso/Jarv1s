# Build Handoff - rfa-736-calendar-automation-modes

**Spec (approved):** docs/superpowers/specs/2026-07-04-calendar-automation-modes.md
**GitHub issue:** #736
**Risk tier:** `security`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-736-calendar-automation-modes
**Branch:** rfa-736-calendar-automation-modes off `origin/main@6a79777d`
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` - escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time.
**Coordinator session id:** `019f2e2e-bed2-7031-bab2-c21e6e7598f2`
**Relay trigger:** the context-meter 70% warning, or a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `AGENTS.md`, `CLAUDE.md`, this handoff, and the spec IN FULL.
3. Invoke and follow `coordinated-build` end-to-end:
   verify the spec against this branch -> write plan -> send plan to `Coordinator` for approval ->
   wait -> TDD build -> coordinated wrap-up.

## Run-Specific Bans

- Work only in this worktree/branch.
- Do not touch `docs/coordination/`, project board, milestones, or merge.
- Stage explicit files only; never `git add -A`.
- No secrets in docs, payloads, logs, prompts, job payloads, or frontend responses.
- The spec and this handoff are coordinator bootstrap context copied into your worktree; do not
  commit them.

## Collision Notes

- #736 starts after merged #735/#766 at `origin/main@6a79777d`; re-verify every stale spec premise
  before planning.
- Security tier: any policy-touching writeback, action execution, feedback/provenance, or
  user-data deletion/cancellation path must preserve RLS/private-by-default behavior and secrets
  boundaries. This PR will need adversarial QA and Ben/security sign-off before merge.
- Calendar owns Calendar follow-through settings and writeback. Do not build a central automation
  engine or change Email/Tasks automation except where Calendar-owned behavior creates a task.
- Not-useful removal may only remove/cancel Jarv1s-created calendar blocks/tasks with clear
  provenance. Never remove user-created or external items through this path.
- If a migration is needed, add a new module-owned migration only; never edit applied migrations and
  do not assume a migration number without checking current files.
