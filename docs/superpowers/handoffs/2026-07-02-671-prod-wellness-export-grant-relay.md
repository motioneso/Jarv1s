# Relay — #671 Prod wellness export jobs fail on data_export_jobs permission

Issue: https://github.com/motioneso/Jarv1s/issues/671
Coordinator label: `Coordinator` (resolve fresh by `herdr pane list`; label + `agent_session.value`
is authority, never a baked `…-N` number).
Branch/worktree: `coord/671-prod-wellness-export-grant` at
`~/Jarv1s/.claude/worktrees/671-prod-wellness-export-grant` (this worktree — continue in place,
`node_modules` already installed, skip `pnpm install`).
Spec: `docs/superpowers/plans/2026-07-01-671-prod-wellness-export-grant.md` (original narrow scope;
superseded/widened per two Coordinator escalation responses below — read this doc, not just the
spec, for current authorized scope).
Detailed investigation trail: agentmemory `mem_mr329y5e_64da66e60220` (project `jarv1s`, type `bug`)
— read via `memory_smart_search` if you need the full reasoning chain; this doc has the operative
summary.

## Status: NOT green. Do not wrap up yet.

The worker-role regression test
(`tests/integration/wellness-export-job.test.ts` — `"runs under the actual jarvis_worker_runtime DB
role, not just jarvis_app_runtime (#671)"`) is still failing. Three root causes were found; two are
fixed/in-progress, the third (this relay's main task) is authorized but **not yet implemented**.

## Root-cause chain (confirmed, in order encountered)

1. **`app.data_export_jobs`** — worker had `UPDATE` but not `SELECT` (Postgres requires `SELECT` on
   any column referenced in an `UPDATE ... WHERE` clause). Fixed:
   `packages/settings/sql/0134_data_export_jobs_worker_select_grant.sql` — `GRANT SELECT` only, no
   policy change needed (existing owner policy has no `TO` restriction). **Committed-ready,
   untracked on disk.**
2. **Wellness content tables** (`wellness_checkins`, `medications`, `medication_logs`,
   `wellness_therapy_notes`) — RLS policies are scoped `TO jarvis_app_runtime` only. A bare
   `GRANT SELECT` to `jarvis_worker_runtime` does **not** error — it silently returns **zero rows**
   (empirically confirmed via raw psql `SET ROLE`). Currently addressed as a **GRANT-only probe**:
   `packages/wellness/sql/0135_wellness_worker_read_grants.sql` (already in the wellness module's
   own `sql/` dir — **must** be here, not in `packages/settings/sql/`, because migrations apply
   per-module-directory in `BUILT_IN_MODULES` registration order in
   `packages/module-registry/src/index.ts`, and `wellness` migrates long after `settings`; a
   wellness-table grant in the settings dir fails with `relation "app.wellness_checkins" does not
   exist`). **Coordinator (UPDATE 2) confirmed this is a separate, lower-priority finding — do NOT
   add an RLS policy for it in #671 unless it blocks the end-to-end regression test.** Root cause 3
   below is what's actually blocking the regression right now; the wellness tables read cleanly
   (just empty) and are not the blocker. Leave 0135 as GRANT-only unless testing proves otherwise.
3. **`app.admin_audit_events` — THE ACTUAL CURRENT BLOCKER.** `handleWellnessExportJobInner`
   (`packages/wellness/src/export-job.ts:279-286`) ends with
   `recordAuditEvent(scopedDb, { actorUserId, action: "wellness.export.generate", ... })`
   (`packages/settings/src/repository.ts:869-880`, the sanctioned generic cross-module audit API).
   `app.admin_audit_events` has **zero** grant for `jarvis_worker_runtime`
   (`infra/postgres/migrations/0005_admin_audit_events.sql:18` grants
   `SELECT, INSERT` to `jarvis_app_runtime` only). The worker's `recordAuditEvent` INSERT fails with
   a real permission error, which — because `DataContextRunner.withDataContext`
   (`packages/db/src/data-context.ts:54-91`) wraps the whole handler in **one transaction** — poisons
   the transaction, so the outer catch's `failJob` UPDATE then fails too, surfacing as the misleading
   `"current transaction is aborted, commands ignored until end of transaction block"`.

## Coordinator decision — UPDATE 2 (authoritative, implement exactly this, nothing wider)

> "Coordinator decision for #671 UPDATE 2: choose A for the blocking audit write. Widen #671 to add
> the minimum worker support for recordAuditEvent from worker jobs: jarvis_worker_runtime
> INSERT+SELECT grant on app.admin_audit_events plus the matching RLS insert policy, mirroring the
> existing app_runtime insert policy pattern as narrowly as possible. Reason: without this, the
> export job still fails in the same transaction, so data_export_jobs-only/wellness-only knowingly
> leaves prod broken. Keep this bounded to admin_audit_events audit writes; no broad admin grants, no
> unrelated audit redesign. Because this touches audit/RLS, final PR needs stronger/Fable 5 security
> review before merge. The silent-empty wellness category read gap is separate; do not solve it in
> #671 unless it blocks the current end-to-end regression."

**Existing pattern to mirror exactly** (`infra/postgres/migrations/0059_admin_tables_rls.sql:49-63`,
the `jarvis_app_runtime` policies on this same table):

```sql
ALTER TABLE app.admin_audit_events ENABLE ROW LEVEL SECURITY;   -- already enabled, don't re-run
ALTER TABLE app.admin_audit_events FORCE ROW LEVEL SECURITY;    -- already enabled, don't re-run

DROP POLICY IF EXISTS admin_audit_events_select ON app.admin_audit_events;
CREATE POLICY admin_audit_events_select ON app.admin_audit_events
  FOR SELECT TO jarvis_app_runtime
  USING (app.current_actor_is_admin());

DROP POLICY IF EXISTS admin_audit_events_insert ON app.admin_audit_events;
CREATE POLICY admin_audit_events_insert ON app.admin_audit_events
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (true);
-- No UPDATE/DELETE policy: the audit log is append-only.
```

Note `admin_audit_events_insert` is `WITH CHECK (true)` — permissive by design (self-demote timing;
see comment above line 14 in that file). The worker-role insert policy should mirror that same
permissive `WITH CHECK (true)` shape — do not gate it on `current_actor_is_admin()` (the worker isn't
an admin actor; that would just reintroduce a permission denial). The `_select` policy stays
`jarvis_app_runtime`-only per the confidentiality finding noted in that file — worker only needs
`INSERT` capability plus enough `SELECT` for Postgres's own privilege check on the INSERT statement
(Postgres does not require SELECT for a plain INSERT without a RETURNING/WHERE, but grant SELECT
alongside INSERT per the Coordinator's literal instruction — confirm empirically whether SELECT is
actually load-bearing here, similar to the data_export_jobs UPDATE/WHERE case; if it's not needed,
you can still grant it per the explicit instruction since it's a read of the actor's own write, not a
broadening of exposure — SELECT policy remains app_runtime-only so worker SELECT grant without a
matching SELECT policy would itself read zero rows, which is fine/expected for a write-only worker
path).

### Concrete next migration to write

New file: `packages/wellness/sql/0136_admin_audit_events_worker_insert.sql` (wellness dir, since the
worker call site is `packages/wellness/src/export-job.ts`; module-directory placement doesn't matter
for `admin_audit_events` since it's an infra-level table already created before any module
migrates — confirm this by checking `infra/postgres/migrations/0005_admin_audit_events.sql` runs in
the infra phase, not a module phase). Suggested content (verify column/policy names against current
migrated state before applying):

```sql
-- #671: handleWellnessExportJobInner (packages/wellness/src/export-job.ts) calls the sanctioned
-- recordAuditEvent() cross-module API at the end of the worker-run export job. app.admin_audit_events
-- had zero grant for jarvis_worker_runtime, so the worker's audit INSERT failed with a permission
-- error inside the same transaction as the job's own status UPDATE, masking as "current transaction
-- is aborted" on the subsequent failJob() write. Scoped narrowly to this table only — no broader
-- admin grants. Mirrors the jarvis_app_runtime insert policy shape (0059_admin_tables_rls.sql):
-- permissive WITH CHECK (true), append-only (no UPDATE/DELETE).
GRANT INSERT, SELECT ON app.admin_audit_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS admin_audit_events_worker_insert ON app.admin_audit_events;
CREATE POLICY admin_audit_events_worker_insert ON app.admin_audit_events
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (true);
```

Then:
- Add `{ version: "0136", name: "0136_admin_audit_events_worker_insert.sql" }` to the migration-list
  `toEqual` assertion in `tests/integration/foundation.test.ts` (after the `0135` row this relay
  already added).
- Reset the isolated test DB and re-migrate: `JARVIS_PGDATABASE=jarv1s_671` +
  `docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS jarv1s_671;" -c "CREATE DATABASE jarv1s_671;"`
  then `pnpm db:migrate` (same DB/env used throughout this investigation).
- Run the regression test: `JARVIS_PGDATABASE=jarv1s_671 pnpm exec vitest run tests/integration/wellness-export-job.test.ts`
  — expect all tests green, including the worker-role test (`status: "ready"`, `error_message: null`).
- Also re-run `tests/integration/foundation.test.ts` to confirm the migration-list assertion passes
  with the `0135`/`0136` rows.

## Explicitly OUT of scope for #671 (per both escalation responses)

- No RLS/policy change on the wellness content tables (`wellness_checkins`, `medications`,
  `medication_logs`, `wellness_therapy_notes`) — leave `0135` as GRANT-only. The silent-empty-read
  risk on those tables is a **separate, real finding** worth its own followup issue, but only file
  that issue / raise it in the wrap-up report — do not fix it here unless the regression test proves
  it's actually required (it currently is not — the blocker is `admin_audit_events`, not these
  tables).
- No broader `admin_audit_events` redesign, no other admin-table grants.
- If the worker-role regression proves yet another table/permission is required beyond what's listed
  in this doc: **stop and escalate again** to the Coordinator — do not widen unilaterally a third
  time.

## Security review requirement (Coordinator, UPDATE 2)

Because this migration touches an audit table's RLS policy, the Coordinator requires a **stronger
review pass (Fable 5 or equivalent) before merge** — flag this explicitly in the wrap-up report; do
not let `coordinated-wrap-up` skip it. This is in addition to the normal PR report.

## What's uncommitted right now (this relay's disk state)

```
M  tests/integration/foundation.test.ts        (0134 + 0135 rows added)
M  tests/integration/wellness-export-job.test.ts   (worker-role regression test, from earlier in build)
?? docs/superpowers/plans/2026-07-01-671-prod-wellness-export-grant.md
?? packages/settings/sql/0134_data_export_jobs_worker_select_grant.sql
?? packages/wellness/sql/0135_wellness_worker_read_grants.sql
?? docs/superpowers/handoffs/2026-07-02-671-prod-wellness-export-grant-relay.md   (this file)
```

Also present, NOT yours to touch: `.claude/context-meter.log` (untracked local tooling artifact).

**Stage explicitly by filename** (never `git add -A`/`git add .`) when you commit this relay
snapshot and again when you land the 0136 migration.

## Remaining steps for the successor

1. `git add` the files listed above (explicit paths) and commit this relay snapshot as WIP —
   message should make clear it's mid-flight, e.g.
   `wip(wellness): #671 data_export_jobs + wellness-table worker grants, admin_audit_events pending`.
2. Write `packages/wellness/sql/0136_admin_audit_events_worker_insert.sql` per above, add its
   `foundation.test.ts` row, reset+migrate the isolated test DB, run the regression + foundation
   tests to green.
3. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck` on touched files, then
   `git fetch origin main && git rebase origin/main`.
4. `coordinated-wrap-up`: push, open PR (explicitly flag the required Fable 5 / stronger security
   review in the PR body and in your report to the Coordinator, per UPDATE 2), report PR URL +
   verification evidence to the Coordinator. Also mention the wellness-table silent-empty-read
   finding as a suggested followup issue (not fixed in this PR).
5. Do not merge, move the board, or close the issue — Coordinator-only.

## Constraints carried forward (unchanged, still binding)

- `coordinated-build` skill; never touch `docs/coordination/` (coordinator-only).
- No repo-wide format/broad staging; never `git add -A`/`git add .`.
- Preserve DataContextDb/RLS invariants and metadata-only job payloads.
- New migration files only — never edit an applied/committed migration.
- Self-monitor context; relay again at ~80–100k tokens or on a compaction summary.
