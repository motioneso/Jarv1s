# Build Handoff — rfa-540-safe-automation-audit-log

**Spec (approved):** docs/superpowers/specs/2026-06-28-safe-automation-audit-log.md
**GitHub issue:** #540
**Risk tier:** `sensitive` (new table migration, cross-module write from action gateway, data export surface)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-540-safe-automation-audit-log **Branch:** rfa-540-safe-automation-audit-log (off origin/main @ 6835a9d0)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044` (immutable authority — label is routing, number is ephemeral)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Check:
   `packages/ai/src/gateway/gateway.ts`, `packages/ai/src/gateway/policy.ts`,
   `packages/ai/sql/0016_ai_assistant_actions.sql` — confirm the audit log table does NOT already
   exist and the three gateway exit points (confirmed, skipped, failed) don't already write to an
   audit table. If already shipped, escalate.
5. Invoke the **`coordinated-build`** skill and follow it.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files.
- Work **only** in this worktree/branch. Commit green per task; explicit `git add` paths only.
- Plan approval from coordinator before code. Escalate blockers/forks/done.
- **Never touch** the project board, milestones, or merge.
- **Self-monitor context** — relay at ~80–100k tokens or on compaction summary.
- Honor CLAUDE.md Hard Invariants. No secrets in payloads/logs/prompts.
- **Caveman mode** for coordinator escalations.

## Collision notes (from the coordinator)

- **Migration number:** Expected slot is **0128**. Use placeholder `XXXX` during development.
  Coordinator confirms before push. (0127 is reserved for #538.)
- **Parallel in-flight: #538, #539, #541.** You own `packages/ai/src/gateway/` exclusively.
  Do NOT touch packages/chat/src/live/, packages/shared/src/chat-api.ts, packages/people/, or
  packages/briefings/. Limit writes to packages/ai/ and packages/settings/src/data-export.ts.
- **Sensitive invariants (mandatory):**
  - The action execution gateway is the **only writer** — no module, route, job, or UI writes audit
    rows directly.
  - Audit log rows are **append-only** (no UPDATE/DELETE by app_runtime).
  - Logged fields: tool_module_id, tool_name, action_family_id, effective_tier, outcome,
    actor_user_id, occurred_at, request_id. Never log tool_input, tool_output, source content,
    or any private data.
  - ENABLE RLS + FORCE RLS on the audit table; owner-scoped via `app.current_actor_user_id()`.
  - Export handler required for audit records. Delete handler: audit rows follow actor delete cascade.
  - Module isolation: packages/ai writes the audit row; packages/settings reads it via a public
    repository API — never direct cross-module SQL.
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A`.
