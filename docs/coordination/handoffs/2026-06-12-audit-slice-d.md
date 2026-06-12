# Build Handoff — Audit Slice D (Settings → DataContextDb)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-d-settings-datacontext.md`
**Implementation plan (pre-written + Fable adversarial-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-d-settings-datacontext.md`
**GitHub issues:** #95 (RLS bypass via raw Kysely), #155 (settings DataContextDb migration). Prerequisite for Slice E (auth hardening).
**Risk tier:** `security` (RLS bypass closure, GUC-gated trigger path). ⇒ cross-model QA + sign-off before merge — build to that bar.
**Worktree:** `~/Jarv1s/.claude/worktrees/audit-slice-d` **Branch:** `audit-slice-d` (off `origin/main` @ 5d262c7)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging. Never guess a `…-N` pane-id.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED** (authored + three rounds of Fable adversarial review; all findings resolved). Do **not** rewrite it and do **not** wait for a plan-approval round-trip. Execute it task-by-task via **`superpowers:executing-plans`**: write failing test → run/expect FAIL → minimal real impl → run/expect PASS → commit.
4. Run the pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[RLS]`/`[DESIGN-FORK]` as applicable.
- **Never touch** `docs/coordination/` — coordinator-only. Scope `pnpm format` to your own changed paths only (never repo-wide `pnpm format` followed by broad `git add`).
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt. Never edit an applied migration (hash-checked).
- **Caveman mode** for status/escalations to the coordinator (terse, full technical accuracy). PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **No migration** — this slice is code-only (DataContextDb conversion, no schema changes). Parallel-safe relative to the migration spine.
- **Slice B already landed** (origin/main @ 5d262c7). Workspace/membership/grant methods are already deleted — do not reference them. The plan notes this explicitly.
- **Slice E is BLOCKED on you.** E (auth hardening) depends on `SettingsRepository.insertAuditEvent` taking `DataContextDb` as its first param. The E build agent is HELD waiting for your merge. This gives your slice high priority.
- `packages/settings/src/` is yours alone — no parallel slice touches it.
- Line numbers in the plan may have shifted post-Slice-B rebase; the plan marks all such assertions as content-only (locate by string, not line number).
