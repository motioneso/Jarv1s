# Build Handoff - rfa-747-chat-feedback-layout-stability

**Spec (approved):** docs/superpowers/specs/2026-07-04-chat-feedback-layout-stability.md
**GitHub issue:** #747
**Risk tier:** `routine`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-747-chat-feedback-layout-stability **Branch:** rfa-747-chat-feedback-layout-stability off `origin/main@ec6b8569`
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2d17-354b-7d40-a2e7-115384f1b579`
**Relay threshold:** countable events - ~80-100k tokens OR a compaction summary in your own context.

## Start

1. Resolve `coordinated-build`; if unavailable, read the absolute build skill path above and follow it.
2. `pnpm install` only if `node_modules` is missing: `[ -d node_modules ] || pnpm install`.
3. Read the spec above IN FULL. It says proposed in-file, but Ben approved it in the coordinator lane
   and issue #747 now has the `RFA` label.
4. Verify the spec against `origin/main@ec6b8569` before planning. Confirm where chat feedback/status
   controls render and what currently causes body-column squeeze.
5. Escalate a compact plan to `Coordinator` for approval before code.

## Compact Rules

- Work only in this worktree/branch. Do not touch `docs/coordination/`, project board, milestones,
  or merge state.
- Stage only your files; never use broad `git add -A`.
- No code before coordinator approval of your implementation plan.
- Keep scope to layout stability for assistant feedback/status controls. Do not change feedback
  persistence semantics, add feedback states, or alter chat behavior.
- Preserve accessible controls at mobile widths. No overlapping controls/content.
- Run focused UI/unit coverage plus `pnpm format:check && pnpm lint && pnpm typecheck` before wrap-up.

## Collision Notes

- #733 is concurrently active in Settings > General quiet-hours files. Avoid settings files.
- This lane should stay in chat UI/feedback layout files and any focused tests for that behavior.
