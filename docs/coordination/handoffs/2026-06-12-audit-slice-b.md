# Build Handoff — Audit Slice B (Dead Subsystem Deletion)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-b-dead-subsystem-deletion.md`
**Implementation plan (pre-written + Fable-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-b-dead-subsystem-deletion.md`
**GitHub issues:** #120 (workspaces), #153 (resource-grants no-op), #115/#116 (resolved by deletion), #152 (manifest narrowing). Advances workspace-halves of #155/#127/#101.
**Risk tier:** `security` (shared-table DROP migration touching RLS surface). ⇒ cross-model QA + sign-off before merge — build to that bar.
**Worktree:** `~/Jarv1s/.claude/worktrees/audit-slice-b`   **Branch:** `audit-slice-b` (off `origin/main` @ e0a9e2a)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging. Never guess a `…-N` pane-id.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED** (authored + Fable adversarial-reviewed + fixes applied by the coordinator). Do **not** rewrite it and do **not** wait for a plan-approval round-trip. Execute it task-by-task via **`superpowers:executing-plans`** (or `subagent-driven-development`): write failing test → run/expect FAIL → minimal real impl → run/expect PASS → commit.
4. Run the pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[RLS]`/`[DESIGN-FORK]` as applicable.
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt. Never edit an applied migration (hash-checked).
- **Caveman mode** for status/escalations to the coordinator (terse, full technical accuracy). PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **You are the migration-spine HEAD.** Your DROP migration is **0056** (pinned in the plan; fallback to next free number if another infra migration landed first — confirm with `SELECT version, name FROM app.schema_migrations ORDER BY version DESC LIMIT 5`). You merge first; D → G → H follow you.
- **`tests/integration/foundation.test.ts` — SHARED with Slice I** (running in parallel). You add a table-absence `it` inside `describe("MVP foundation scaffold")`; Slice I adds a targeted `afterAll` near line 220. Different regions; if you merge first, I rebases. Keep your edit tightly scoped to your new `it`.
- **`tests/integration/structured-state.test.ts` — SHARED with Slice G** (running in parallel). You (Task 11) and G both edit it. Keep your edit minimal; coordinator sequences the rebase at merge.
- You land the workspace removal first; Slice E (auth) rebases its bootstrap edit on top of you later.
