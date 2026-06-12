# Build Handoff — Audit Slice E (Auth Module Hardening)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-e-auth-hardening.md`
**Implementation plan (pre-written + Fable-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-e-auth-hardening.md`
**GitHub issues:** #101 (module-isolation), #127 (bootstrap actor-GUC), #141 (OAuth error-body leak). (#113 bearer-token design fork DEFERRED to issue #183 — do NOT touch it.)
**Risk tier:** `security` (auth module isolation, session GUC, credential leak). ⇒ cross-model QA + sign-off before merge — build to that bar.
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/audit-slice-e` **Branch:** `audit-slice-e` (off `origin/main` @ 97da30d)
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging. Never guess a `…-N` pane-id.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED** (authored + Fable adversarial-reviewed + fixes applied; final Fable gate APPROVE received). Do **not** rewrite it and do **not** wait for a plan-approval round-trip. Execute it task-by-task via **`superpowers:executing-plans`**: write failing test → run/expect FAIL → minimal real impl → run/expect PASS → commit.
4. Run the pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[AUTH]`/`[DESIGN-FORK]` as applicable.
- **Never touch** `docs/coordination/` — coordinator-only. Scope `pnpm format` to your own changed paths only (never repo-wide `pnpm format` followed by broad `git add`).
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt. Never edit an applied migration (hash-checked).
- **Caveman mode** for status/escalations to the coordinator (terse, full technical accuracy). PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **Code-only (no migration)** — parallel-safe relative to the migration spine.
- **Rebase on B first.** Slice B (#127/#101 bootstrap, workspace removal) has already landed at `97da30d`. Your branch was created off this — you should already be clean. Verify with `git log --oneline -5`.
- **`packages/auth/src/index.ts` is the single primary file.** Serialize all changes internally — no parallel sub-tasks that touch this file simultaneously.
- Do NOT touch #113 (bearer-token design) — it is deferred to issue #183.
- Line numbers in the plan may have shifted post-B rebase (the plan notes this). Use `grep`/locate-by-name, not hard line refs.
