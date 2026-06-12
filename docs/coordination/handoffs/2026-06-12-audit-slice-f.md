# Build Handoff — Audit Slice F (AI Tool-Path Hardening)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-f-ai-toolpath-hardening.md`
**Implementation plan (pre-written + Fable-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-f-ai-toolpath-hardening.md`
**GitHub issues:** #132 (REST validateToolInput), #119 (server-side session allowlist), #148 (blank ToolContext in briefings), #172 (tools/list actor-scope).
**Risk tier:** `security` (AI tool invocation paths, actor-scope + trust-boundary enforcement). ⇒ cross-model QA + sign-off before merge.
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/audit-slice-f` **Branch:** `audit-slice-f` (off `origin/main` @ e0a9e2a)
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED.** Do not rewrite it; do not wait for a plan-approval round-trip. Execute task-by-task via **`superpowers:executing-plans`** (TDD: failing test → FAIL → minimal impl → PASS → commit).
4. Run `pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator). Build as **one atomic PR** — all four issues touch `packages/ai/` or its dependents.

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** on: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[DESIGN-FORK]`.
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant: provider-agnostic AI (no hardcoded provider/model), secrets never escape, metadata-only payloads. No secrets in any doc/log/prompt.
- **Caveman mode** for status/escalations. PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **No file collisions with the current wave (B, G, I).** You own `packages/ai/` + `packages/chat/src/mcp-transport.ts` + `packages/chat/src/routes.ts` (allowlist capture at line 93) + `packages/briefings/` + `tests/integration/mcp-gateway.test.ts`. None of B/G/I touch these.
- **0 migrations** — fully parallel to the migration spine. You may merge as soon as you're green; no spine ordering applies.
- Spec note re #119: state explicitly in the PR whether the allowlist set stores bare tool names or `mcp__jarvis__<name>` format.
