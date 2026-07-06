# #672 relay — resume at plan-approval wait

Worktree: `~/Jarv1s/.claude/worktrees/672-wellness-export-rls` (continue in place — `node_modules`
already installed, skip `pnpm install`).
Branch: `coord/672-wellness-export-rls` off `origin/main` at `5bbffb8e` (unchanged, no commits yet).
Original handoff: `docs/coordination/handoffs/2026-07-02-672-wellness-export-rls.md` (coordinator-
owned, untracked in this worktree — do not commit it, do not edit it).
Skill: `coordinated-build`. Coordinator label: `Coordinator` (resolve fresh via `herdr pane list`
before messaging — never reuse a pane number from this doc; confirmed exactly one `Coordinator`-
labeled pane as of this relay, `agent_session.value` `019f23ce-8811-7573-a554-db21fff67cff`).

## Status: PLAN APPROVED by Coordinator. Build not yet started — successor starts the build.

Plan doc: `docs/superpowers/plans/2026-07-02-672-wellness-export-rls.md` (committed this relay,
commit below). Read it IN FULL for the verified root cause and fix design — do not re-derive.

Coordinator's approval message (verbatim, received before this relay handed off): "#672 plan
APPROVED. Build exactly this plan: one 0139 migration adding four owner-predicate SELECT policies
TO jarvis_worker_runtime, focused worker-role exported-content regression covering all four
observed wellness tables, foundation migration-list row. No repository/export-job rewrite. Do not
touch #671 data_export_jobs/admin_audit_events paths. Security-tier remains: final PR needs
adversarial security QA + Ben/Fable sign-off. If context is at relay danger, finish relay first and
have successor continue from this approval."

**Successor: skip the approval-wait step below — go straight to step 2 (implement).** No
acknowledgement message back to Coordinator is needed for the approval itself; just proceed to
build, then report per `coordinated-wrap-up` when the PR is up.

## Plan summary (full detail in the plan doc — read it, this is just a pointer)

Root cause confirmed by direct file read: migration `0135_wellness_worker_read_grants.sql` (landed
in #671/PR #674) is GRANT-only for `jarvis_worker_runtime` on `wellness_checkins`/`medications`/
`medication_logs`/`wellness_therapy_notes` — no RLS policy. Existing SELECT policies on all 4 are
`TO jarvis_app_runtime` only. Under FORCE RLS this means worker reads succeed but silently return
zero rows — the #672 bug, confirmed.

The SECURITY DEFINER bounded-function pattern #671 used for `data_export_jobs`/`admin_audit_events`
does **not** transfer to these 4 tables (verified: their policies are role-restricted, and the
function-owner role `jarvis_migration_owner` is NOBYPASSRLS with no policy of its own — the
codebase already has 2 comments warning about this exact zero-row trap, in `0084` and `0089`).

Fix: one new migration (next number, confirm via `ls infra/postgres/migrations/ packages/*/sql/ |
grep -oE '^[0-9]{4}' | sort -n | tail -1` — was `0138` at plan time, so `0139`) adding 4 new
*additional permissive* SELECT policies `TO jarvis_worker_runtime`, identical owner-only predicate
to the existing app-role policy on each table. No repository/export-job.ts code changes needed.

Regression test: extend `tests/integration/wellness-export-job.test.ts` — the existing #671
worker-role test only checks `status === "ready"`, not content, so it would NOT have caught this.
New test must seed distinctly-marked data for all 4 categories, run under the real
`workerDataContext` (`jarvis_worker_runtime`), and assert the exported HTML actually contains all 4
markers. Also add the new migration's row to `foundation.test.ts`'s migration-list `toEqual`.

## What's left (in order) — approval already granted, start at step 1

1. Re-confirm 0139 is still the next free migration number (re-scan — other agents may have landed
   migrations since this doc was written): `ls infra/postgres/migrations/ packages/*/sql/ 2>/dev/null
   | grep -oE '[0-9]{4}' | sort -n | tail -1`.
2. `superpowers:test-driven-development`: write the migration, the regression test, the
   `foundation.test.ts` row. Isolated DB gate (`JARVIS_PGDATABASE=jarv1s_672`, reset + `pnpm
   db:migrate` + focused vitest runs), then pre-push trio (`format:check && lint && typecheck`) +
   `git fetch origin main && git rebase origin/main`.
3. `coordinated-wrap-up`: push, open PR (flag security-tier / cross-model QA + Ben sign-off per
   handoff doc), report to Coordinator. Do not merge/board/close.

## Constraints carried forward

- Stage only own files — never `git add -A`/`git add .`. `.claude/context-meter.log` and
  `docs/coordination/**` are not mine to touch.
- New migration file only — never edit an applied/committed migration.
- Security tier: final PR needs cross-model security QA + explicit Ben/Fable sign-off before merge
  (per original handoff doc).
- Self-monitor context; relay again at ~80–100k tokens or on a compaction summary.
