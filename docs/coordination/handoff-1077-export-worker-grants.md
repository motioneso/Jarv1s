# Build Handoff — #1077 export worker grants

**Spec (approved):** `docs/superpowers/specs/2026-07-15-1077-export-worker-grants.md`
**GitHub issue:** #1077
**Risk tier:** `security` — role grants and RLS policies require adversarial Opus QA and Ben's
explicit merge sign-off.
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-1077-export-grants`
**Branch:** `ux/1077-export-grants` from `origin/main` `bd825344`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `UX Coordinator` — resolve fresh by exact label and session before messaging.
**Coordinator session id:** `019f68a1-899f-7cc1-bba5-2159ae14aaed`
**Relay trigger:** context-meter 70% warning or any compaction summary → message the coordinator,
then invoke `relay` immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read the approved spec by section, then invoke `coordinated-build`.
3. Use the codebase knowledge graph first to trace every worker-scoped export table and its owning
   module/policies; fall back to literal search only where the graph is insufficient.
4. Post a compact plan pointer and wait for `UX Coordinator` approval before editing.

## Locked decisions

- Audit all worker-scoped export tables; do not stop at `notification_reads`.
- Add only confirmed missing `SELECT` grants and exact owner-visible worker policies in the owning
  module's SQL.
- Use the next available migration number at implementation time; do not assume `0166` remains free.
- TDD: populated-all-tables export success plus worker write denial and migration inventory checks.
- Defer failure-handler transaction hardening; no new abstraction or unrelated cleanup.

## Run-specific bans

- Work only here. Stage explicit paths; never `git add -A`, `git add .`, or repo-wide format.
- Never touch `docs/coordination/`, project boards, milestones, PR #1075, issue state, or merge.
- Never weaken RLS, add worker write privileges, expose secrets/export contents, or change payloads.

## Collision and merge order

- This security blocker lands before PR #1075 can repeat live UAT or merge.
- #988 stays strictly serialized after #1002.
- Fetch `origin/main` before choosing migration numbers; any non-trivial conflict returns to this
  lane for resolution.
