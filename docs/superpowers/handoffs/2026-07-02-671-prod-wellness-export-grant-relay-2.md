# Relay 2 — #671 Prod wellness export jobs fail on data_export_jobs permission

Issue: https://github.com/motioneso/Jarv1s/issues/671
Coordinator label: `Coordinator` (resolve fresh via `herdr pane list`; label + `agent_session.value`
is authority, never a baked `…-N` number).
Branch/worktree: `coord/671-prod-wellness-export-grant` at
`~/Jarv1s/.claude/worktrees/671-prod-wellness-export-grant` (this worktree — continue in place,
`node_modules` already installed, skip `pnpm install`).
Prior relay doc (superseded, read only if you need deep history):
`docs/superpowers/handoffs/2026-07-02-671-prod-wellness-export-grant-relay.md`.

## Status: functionally GREEN on isolated DB. Needs full-gate confirmation + PR.

All three root causes from the investigation are now fixed and committed:

1. `0134_data_export_jobs_worker_select_grant.sql` — worker SELECT on `data_export_jobs`.
2. `0135_wellness_worker_read_grants.sql` — wellness content-table worker SELECT (GRANT-only
   probe, intentionally no RLS policy — out of scope per Coordinator, see prior relay doc).
3. `0136_admin_audit_events_worker_insert.sql` — worker INSERT+SELECT on `admin_audit_events`
   (Coordinator UPDATE 2, implemented this session).

**New this session (not in prior relay doc):** implementing 0136 surfaced a real conflict —
`scripts/audit-release-hardening.ts` had a pre-existing hard invariant that failed if
`jarvis_worker_runtime` had ANY privilege on `admin_audit_events`. Escalated to Coordinator, got
an explicit decision (quoted below), and fixed it.

> Coordinator decision: choose (a). Update scripts/audit-release-hardening.ts to explicitly allow
> jarvis_worker_runtime INSERT+SELECT grants on app.admin_audit_events as the documented #671
> append-only worker-audit exception. Keep the invariant strong: app runtime still SELECT+INSERT
> only; worker runtime must have INSERT+SELECT only; worker UPDATE/DELETE must still fail; no
> broader admin grants. Do not change the admin_audit_events RLS policy beyond the already-approved
> worker INSERT policy. Final PR needs Fable 5/security review because this changes an audit/RLS
> hardening invariant.

Implemented exactly this in `scripts/audit-release-hardening.ts` (`collectFailures`, ~line 424) and
the matching `tests/integration/release-hardening.test.ts` `adminAuditPrivileges` expectation.

## Commits on this branch (in order)

- `33865d96` wip: 0134 + 0135 + worker-role regression test (prior relay's work)
- `bea60377` fix: 0136 migration + foundation.test.ts migration-list row
- `92d2be67` style: prettier-format the plan doc (format:check was failing on it)
- `28603e11` fix: audit-release-hardening.ts + its test, per Coordinator decision above

## Verified so far (isolated `jarv1s_671` DB, NOT the shared dev DB)

Reset via: `docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS jarv1s_671;" -c "CREATE DATABASE jarv1s_671;"`
then `JARVIS_PGDATABASE=jarv1s_671 pnpm db:migrate` (currently fully migrated through 0136 on this
branch's HEAD as of `28603e11`).

- `JARVIS_PGDATABASE=jarv1s_671 pnpm exec vitest run tests/integration/wellness-export-job.test.ts`
  → 8/8 green, incl. the worker-role regression test by exact name.
- `JARVIS_PGDATABASE=jarv1s_671 pnpm exec vitest run tests/integration/foundation.test.ts`
  → 29/29 green (migration-list assertion incl. 0134/0135/0136).
- `JARVIS_PGDATABASE=jarv1s_671 pnpm exec vitest run tests/integration/release-hardening.test.ts`
  → 19/19 green on 3rd attempt. **First two attempts hit `error: tuple concurrently updated`
  during `resetEmptyFoundationDatabase`** — this is cross-agent PG contention (another build
  agent, `Build-668-sports-feedback-14` pane, was running concurrent migrations/tests against the
  same Postgres cluster at that moment; role/catalog-level grants can race across databases in one
  cluster). Confirmed NOT a regression: 3rd run clean. If you hit this again, just retry — check
  `docker exec jarv1s-postgres psql -U postgres -d jarv1s_671 -c "SELECT pid,state,query_start,left(query,80) FROM pg_stat_activity WHERE datname='jarv1s_671';"`
  and `ps aux | grep vitest` to confirm it's contention (another worktree's vitest process alive) vs
  a real failure before retrying blind.
- Pre-push trio (`format:check && lint && typecheck`) was green as of `92d2be67` — **re-run it
  after `28603e11`, not yet re-verified since that last commit.**
- `git fetch origin main && git rebase origin/main` was clean (branch already up to date) as of
  before `28603e11` — **re-check after rebasing your own changes.**

## What's NOT yet done — remaining steps for you

1. **Full gate, for real.** Don't trust the earlier `pnpm verify:foundation` run against the
   default shared `jarv1s` DB — it hit 86/104 failed test files (contention-driven noise: unrelated
   modules like `memory.test.ts`, `chat-live.test.ts` failing with
   `relation "app.X" does not exist`, consistent with a concurrent agent mutating shared dev PG).
   Instead run the full gate against the isolated, already-migrated `jarv1s_671` DB to get a real
   signal:
   ```
   JARVIS_PGDATABASE=jarv1s_671 pnpm verify:foundation > /tmp/cb-vf.log 2>&1; echo "VF_EXIT=$?"
   JARVIS_PGDATABASE=jarv1s_671 pnpm audit:release-hardening > /tmp/cb-audit.log 2>&1; echo "AUDIT_EXIT=$?"
   ```
   Read the exit code AND log tail (never pipe through `tail`/`grep` as the last stage — masks the
   real exit code). If `db:migrate` inside `verify:foundation` tries to re-migrate an
   already-migrated `jarv1s_671`, that's fine (idempotent/no-op for already-applied files). If you
   hit `tuple concurrently updated` again, check for a live concurrent vitest process from another
   worktree before treating it as a real failure — see contention note above.
2. **Re-run pre-push trio** (`pnpm format:check && pnpm lint && pnpm typecheck`) and
   `git fetch origin main && git rebase origin/main` — both need re-confirmation after `28603e11`.
3. **Push + open PR** (`gh pr create --base main`). PR body must state:
   - Scope: #671 fix, three grants (0134/0135/0136) + the audit-hardening invariant update.
   - Spec: `docs/superpowers/plans/2026-07-01-671-prod-wellness-export-grant.md` (narrow original,
     widened twice by Coordinator escalations — both quoted in the prior relay doc and this one).
   - VF_EXIT / AUDIT_EXIT evidence from step 1.
   - **Explicitly flag**: "Requires Fable 5 / stronger security review before merge — this PR
     changes an audit/RLS hardening invariant (`scripts/audit-release-hardening.ts`)." Per
     Coordinator's explicit instruction — do not let this get lost.
   - Deferred/out-of-scope: wellness content-table silent-empty-read risk on `wellness_checkins`,
     `medications`, `medication_logs`, `wellness_therapy_notes` (0135 is GRANT-only, no RLS policy)
     — suggest as a followup issue, not fixed here.
4. **Report to Coordinator** (`herdr-pane-message`, label `Coordinator`, resolve fresh via
   `herdr pane list` — do not reuse any pane id from this doc): PR link, VF_EXIT/AUDIT_EXIT, branch
   sha, the Fable 5 review flag, and the deferred wellness-table followup suggestion. Then stop —
   do not merge, move the board, or close the issue.

## Constraints carried forward (unchanged, still binding)

- `coordinated-build` / `coordinated-wrap-up` skills; never touch `docs/coordination/`.
- No repo-wide format/broad staging; never `git add -A`/`git add .`. `.claude/context-meter.log`
  is untracked local tooling, not yours to touch.
- Preserve DataContextDb/RLS invariants and metadata-only job payloads.
- New migration files only — never edit an applied/committed migration.
- Self-monitor context; relay again at ~80–100k tokens or on a compaction summary.
