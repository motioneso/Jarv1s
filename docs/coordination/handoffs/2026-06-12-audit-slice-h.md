# Build Handoff — Audit Slice H (Migration / Job Infrastructure)

**Spec (approved):** `docs/superpowers/specs/2026-06-12-audit-slice-h-migration-job-infra.md`
**Implementation plan (pre-written + Fable-reviewed — DO NOT rewrite):** `docs/superpowers/plans/2026-06-12-audit-slice-h-migration-job-infra.md`
**GitHub issues:** #124 (schema_migrations cross-dir version uniqueness), #134 (worker dead UPDATE grant REVOKE on `chat_messages`), #135 (incognito column immutability trigger), #157 (metadata-only send-side payload guard), #174 (pgboss runtime least-privilege grants).
**Risk tier:** `security` (migration-runner integrity, RLS/grant changes, job-payload guard). ⇒ cross-model Fable QA + posted verdict before merge — build to that bar.
**Worktree:** `~/Jarv1s/.claude/worktrees/audit-slice-h` **Branch:** `audit-slice-h` (off `origin/main`)
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify `herdr pane list` shows exactly one such pane before messaging. Never guess a `…-N` pane-id — they reflow when panes close.)
**Relay threshold:** ~80–100k tokens OR a compaction summary in your own context → relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read the spec AND the plan above IN FULL.
3. **The plan is PRE-APPROVED** (authored + Fable adversarial-reviewed + fixes applied — including the #134 `chat_messages_update` owner-scoping fix). Do **not** rewrite it and do **not** wait for a plan-approval round-trip. Execute it task-by-task via **`superpowers:executing-plans`** (or `subagent-driven-development`): write failing test → run/expect FAIL → minimal real impl → run/expect PASS → commit.
4. Run the pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh `git fetch origin main` rebase before every push.
5. Close out with **`coordinated-wrap-up`** (open PR, report to coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. `git add` only that task's files. `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a design fork outside this spec/plan, a review request, or **done**. Tag `[SECURITY]`/`[RLS]`/`[DESIGN-FORK]` as applicable.
- **Never touch** `docs/coordination/` — coordinator-only. Scope `pnpm format` to your own changed paths only (never repo-wide `pnpm format` followed by broad `git add`).
- **Never touch** the project board, milestones, or merge — coordinator-only.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt. **Never edit an applied migration (hash-checked) — add new files only.**
- **Caveman mode** for status/escalations to the coordinator (terse, full technical accuracy). PR body + commits stay conventional.

## Collision notes (from the coordinator)

- **⚠️ MIGRATION NUMBERS — assigned: `0057` + `0058`.** The migration spine HEAD on `origin/main` is **`0056`** (Slice B's DROP). D (#188) merged code-only, added no migration. Slices A/B/G are all landed. Your two versioned migrations in `packages/chat/sql/` take **`0057`** and **`0058`**. The plan body still says "current global max is `0055`" — that is STALE (pre-B). **Before creating the files, run a global scan of every migration directory to confirm the real max is `0056`, then use `0057`/`0058`.** Do not pre-trust the plan's placeholder numbers.
- **Migrations land LAST on the spine** — you are the tail. No other migration-adding slice is in flight.
- **Slice E (#189, auth, code-only) may merge to `main` while you build.** It touches `packages/auth` only — zero overlap with your files (migration runner, `packages/chat/sql/`, `infra/postgres/grants/`, `packages/jobs`, `packages/db/src/migrations/sql-runner.ts`, `scripts/migrate.ts`). A post-E rebase should be clean; if `foundation.test.ts` conflicts, it is a trivial test-block merge.
- **`foundation.test.ts` is shared and reset up to 4× in this slice** (Tasks 4/5/6 each add a `describe` with its own `resetFoundationDatabase()`). Keep every describe fully self-seeding — each reset wipes prior describes' seeds. (Plan "Test-file note".)
- **Consume-side payload guards: extend, never contract.** Per-queue inbound validators live in `packages/tasks/src/jobs.ts` (`isDeferredTaskStatusPayloadMetadataOnly`) and `packages/briefings/src/jobs.ts` (`isBriefingRunPayloadMetadataOnly`) — NOT in `packages/jobs/src/pg-boss.ts` (the spec's location claim is wrong). This slice ADDS the send-side `sendJob` guard; it must not weaken or remove those consume-side validators.
- **#134 fix already in the plan:** `chat_messages_update` must stay owner-scoped (`USING`/`WITH CHECK` on owner), NOT `USING(true) WITH CHECK(true)`. Fable caught this at spec review; the plan already encodes the fix — preserve it.
