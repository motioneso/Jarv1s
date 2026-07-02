# #672 — wellness export worker silent RLS omission

## Premise verified (branch @ 5bbffb8e, coord/672-wellness-export-rls)

- 0135 (from #671) grants `jarvis_worker_runtime` raw table `SELECT` on
  `wellness_checkins`/`medications`/`medication_logs`/`wellness_therapy_notes`, but adds **no RLS
  policy**. Existing SELECT policies on all 4 are `FOR SELECT TO jarvis_app_runtime USING
(owner_user_id = app.current_actor_user_id())` — scoped to the app role only.
- Under FORCE RLS, worker role has the table grant but no matching policy → query succeeds,
  returns **zero rows**, no error. Confirms #672's premise exactly.
- `WellnessRepository.listCheckinsForRange/listMedications/listLogsForRange/listTherapyNotesForRange`
  (`packages/wellness/src/repository.ts`) issue raw Kysely selects against these 4 tables, called
  directly from `export-job.ts`'s worker handler — no bounded-function indirection today.
- The existing #671 worker-role regression test (`wellness-export-job.test.ts:233`) only asserts
  `status === "ready"` / `error_message === null` — it does **not** seed data for the worker-role
  run or check exported content, so it does not catch this. Confirmed gap.
- **SECURITY DEFINER bounded-function pattern from #671 (0137/0138) does NOT transfer here.** That
  pattern worked for `data_export_jobs` because its SELECT policy has no `TO` restriction (applies
  to all roles). These 4 wellness tables' policies ARE restricted `TO jarvis_app_runtime`, and the
  function owner `jarvis_migration_owner` is NOBYPASSRLS with no policy of its own — the codebase
  already carries two explicit warnings about this exact trap (`0084_wellness_medication_logs.sql`,
  `0089_wellness_therapy_notes.sql`: "a DEFINER body would see ZERO rows under FORCE RLS").
- Not in `scripts/audit-release-hardening.ts`'s `protectedTables`/audit static checks — no
  hardening-test conflict expected (unlike #671's `admin_audit_events` collision).

## Fix (minimum change)

Add ONE new migration `packages/wellness/sql/0139_wellness_worker_read_policies.sql` (next
available number, confirmed via full scan of `infra/postgres/migrations/` + `packages/*/sql/`):
4 new **additional permissive** SELECT policies (Postgres ORs multiple permissive policies), one
per table, named `<table>_worker_select`, identical predicate to the existing owner policy:

```sql
CREATE POLICY wellness_checkins_worker_select ON app.wellness_checkins
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
-- + medications, medication_logs, wellness_therapy_notes, same shape
```

No RLS broadening — worker gets exactly the same owner-only predicate the app role already has,
nothing wider. 0135's existing raw GRANT stays (prerequisite for the policy to apply). No REVOKE
needed, no SECURITY DEFINER functions, no repository/export-job.ts code changes required — the
existing `WellnessRepository` read methods start working correctly for the worker role automatically
once the policy exists.

## Regression test

Extend `tests/integration/wellness-export-job.test.ts`: add a new worker-role test (near the
existing #671 one) that seeds a **dedicated, uniquely-marked** owner's wellness data under
`dataContext` (app role) covering all 4 tables (checkin note marker, medication name, a dose-marked
medication log, therapy-note body marker), runs `handleWellnessExportJob` under the real
`workerDataContext` (`jarvis_worker_runtime`) for categories `["checkins","medications",
"therapyNotes"]`, reads the exported HTML from vault, and asserts all 4 markers are present (not
just `status === "ready"`). This is the "fails if seeded owner data is silently omitted" regression
the issue requires — the current test suite does not have it.

Also add the new migration's row to `tests/integration/foundation.test.ts`'s migration-list
`toEqual` assertion.

## Local gate

`JARVIS_PGDATABASE=jarv1s_672` isolated DB: `pnpm db:migrate`, focused run of
`wellness-export-job.test.ts` + `foundation.test.ts`, then `pnpm format:check && pnpm lint &&
pnpm typecheck`. Full `verify:foundation` before wrap-up per handoff.

## Explicitly out of scope

No touch to #671's `data_export_jobs`/`admin_audit_events` grants/functions. No RLS predicate
change (still owner-only). No new worker bypass.
