# Build Handoff - rfa-735-module-notification-preferences

**Spec (approved):** docs/superpowers/specs/2026-07-04-module-notification-preferences.md
**GitHub issue:** #735
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-735-module-notification-preferences
**Branch:** rfa-735-module-notification-preferences off `origin/main@422157a1`
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` - escalate via `herdr-pane-message`; before messaging,
verify `herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time.
**Coordinator session id:** `019f2dc9-26c0-75c2-a7d8-4ccbec45510f`
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
- No secrets in docs, payloads, logs, prompts, or job data.

## Collision Notes

- #735 follows merged settings/data/chat work through #754. Re-verify all spec premises against
  `origin/main@422157a1` before planning.
- Sensitive tier: preserve module isolation, DataContextDb-only repository boundaries, metadata-only
  job payload expectations, and no frontend exposure of secrets.
- Notification creation must get a real `moduleId` at the shared boundary. Do not add category
  controls or push/email digest implementation; leave those as tracked unavailable rows for #743 and
  #742.
- If a migration is needed, add a new module-owned migration only; never edit applied migrations and
  do not assume a migration number without checking current files.
