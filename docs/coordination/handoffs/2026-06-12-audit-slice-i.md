# Build Handoff — Audit Slice I (Portability + Observability Tail)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-i-portability-tail.md`
**Implementation plan (pre-written + Fable-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-i-portability-tail.md`
**GitHub issues:** #170 (export omits private memory/structured-state), #149 (handleRouteError dead-401), #140 (list/parent-task ownership check), #166 (foundation test share hygiene, LOW).
**Risk tier:** `sensitive` (#170 user-data export) + `routine` (#149/#140/#166). Treated as `security`-tier for QA in this run (#170 is a privacy/data-egress path) — built to that bar.
**Worktree:** `~/Jarv1s/.claude/worktrees/audit-slice-i` **Branch:** `audit-slice-i` (off `origin/main` @ e0a9e2a)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED.** Do not rewrite it; do not wait for a plan-approval round-trip. Execute task-by-task via **`superpowers:executing-plans`** (TDD: failing test → FAIL → minimal impl → PASS → commit).
4. Run `pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** on: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[DESIGN-FORK]`.
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant: export must NOT include secrets or derived data (no `embedding`/`content_hash`/`file_hash`/`*_key`/`*_secret`/`*_token`); RLS-backed ownership checks inside `withDataContext`; 500s must not leak internal error detail.
- **Caveman mode** for status/escalations. PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **0 migrations — code-only, fully parallel to the migration spine.** You may merge as soon as you're green; no spine ordering applies.
- **`tests/integration/foundation.test.ts` — SHARED with Slice B** (running in parallel). You add a targeted `afterAll` near line 220 (#166); B adds a new `it` inside `describe("MVP foundation scaffold")`. Different regions; **B merges first**, so expect a `git fetch origin main` rebase before your push — keep your edit tightly scoped to the specific dangling-share row.
- No other file overlap with the current wave (F=ai, G=memory/structured-state).
