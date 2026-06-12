# Build Handoff — Audit Slice G (Data-Layer Defense-in-Depth)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-g-datalayer-defense.md`
**Implementation plan (pre-written + Fable-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-g-datalayer-defense.md`
**GitHub issues:** #102 (assertDataContextDb in memory/structured-state repos), #144 (vectorSearch owner predicate), #99 (structured-state WITH CHECK migration).
**Risk tier:** `security` (RLS / DataContextDb enforcement + a policy-touching migration). ⇒ cross-model QA + sign-off before merge.
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/audit-slice-g`   **Branch:** `audit-slice-g` (off `origin/main` @ e0a9e2a)
**Build skill path (absolute):** `/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED.** Do not rewrite it; do not wait for a plan-approval round-trip. Execute task-by-task via **`superpowers:executing-plans`** (TDD: failing test → FAIL → minimal impl → PASS → commit).
4. Run `pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** on: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[RLS]`/`[DESIGN-FORK]`.
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant: DataContextDb only, RLS for all actors, never edit an applied migration (hash-checked), module SQL lives in the owning module's `sql/` dir.
- **Caveman mode** for status/escalations. PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **MIGRATION NUMBER IS NOT YOURS TO PICK.** Your #99 structured-state WITH CHECK migration lands on the spine **after B and D**. Do **NOT** hardcode a migration number — write the migration body, leave the number as the plan's placeholder, and the **coordinator assigns the real number at merge** (global landing order; current global max is 0055 and B takes 0056). Confirm the live head with `SELECT version, name FROM app.schema_migrations ORDER BY version DESC LIMIT 5` at rebase time.
- **`tests/integration/structured-state.test.ts` — SHARED with Slice B** (running in parallel; B also edits it). Keep your edit scoped to your new WITH-CHECK assertions; coordinator sequences the rebase at merge (B merges first).
- Memory-repo overlap with Slice A (#98) is already satisfied — A is merged.
- No code dependency on B or D; only the migration number serializes.
