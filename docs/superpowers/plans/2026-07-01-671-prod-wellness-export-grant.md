# Plan — #671 Prod wellness export jobs fail on data_export_jobs permission

## Root cause (confirmed by reading code)

`packages/settings/sql/0108_data_export_jobs.sql:19` grants `jarvis_worker_runtime` only
`UPDATE` on `app.data_export_jobs`, never `SELECT`. Every worker-side write in
`DataExportRepository` (`updateJobStatus`, `completeJob`, `failJob`) does
`.updateTable(...).where("id", "=", jobId)` — Postgres requires `SELECT` privilege on any
column referenced in an `UPDATE ... WHERE` clause (and on the RLS `USING` clause columns),
not just `UPDATE`. Without it: `permission denied for table data_export_jobs`. This matches
the established pattern elsewhere (e.g. `packages/tasks/sql/0075_tasks_worker_recurrence_grant.sql`,
`packages/calendar/sql/0066_calendar_worker_grants_and_google_insert.sql`): every other
worker-write table grants `SELECT` alongside `UPDATE`/`INSERT`.

RLS itself is fine: `registerDataContextWorker` → `toAccessContext` sets `actorUserId` from
the job payload as the RLS principal via `set_config`, and the existing owner policy
(`USING (owner_user_id = app.current_actor_user_id())`) has no `TO` clause restriction, so it
already applies to `jarvis_worker_runtime`. No RLS/policy change needed — grant only.

## Task 1 — migration: grant SELECT to jarvis_worker_runtime

- New file `packages/settings/sql/0134_data_export_jobs_worker_select_grant.sql`:
  `GRANT SELECT ON app.data_export_jobs TO jarvis_worker_runtime;`
- Add `{ version: "0134", name: "0134_data_export_jobs_worker_select_grant.sql" }` to the
  migration list assertion in `tests/integration/foundation.test.ts` (it's a `toEqual` over the
  full list — must add every new row or it fails).

## Task 2 — regression test proving the worker role can complete the job end-to-end

- `tests/integration/wellness-export-job.test.ts` currently drives
  `handleWellnessExportJob` through `connectionStrings.app` (`jarvis_app_runtime`), which
  already had `SELECT` — so it could never have caught this. Add a new test in that file that
  builds a second `DataContextRunner` over `connectionStrings.worker`
  (`jarvis_worker_runtime`, pattern from `tests/integration/tasks-verticals.test.ts`) and runs
  `handleWellnessExportJob` under it end-to-end, asserting the job reaches `status: "ready"`
  (not `permission denied`, not stuck in `building`).

## Verification

- `pnpm --filter @jarv1s/settings test -- wellness-export-job` (or repo's integration test
  command for that file) green, including the new worker-role test — reproduce-then-fix: run
  it once against the pre-migration tree to confirm it fails with `permission denied for table
data_export_jobs`, then apply the migration and confirm green.
- `pnpm format:check && pnpm lint && pnpm typecheck` on touched files.
- Full `pnpm test:integration` for `tests/integration/foundation.test.ts` (migration list
  assertion) and the wellness export test file.

## Exit criteria

- Worker can update `app.data_export_jobs` status through the full pending → building → ready
  (and failed) path without a permission error.
- New migration file only; no edits to `0108_data_export_jobs.sql` or any other applied
  migration.
- Regression test fails on the old grant, passes after the fix.
