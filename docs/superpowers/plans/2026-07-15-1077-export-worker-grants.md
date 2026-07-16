# Plan — #1077 export worker grants (4 confirmed gaps)

Spec: `docs/superpowers/specs/2026-07-15-1077-export-worker-grants.md`
Handoff: `docs/superpowers/handoffs/2026-07-15-1077-export-grants-relay.md`
Security tier. No implementation until coordinator approval.

## Task 1 — Red: integration tests (fail against current grants)

`packages/settings/test/data-export.integration.test.ts` (or nearest existing export
integration suite):

- **Populated-export test**: seed an owning account with at least one row in all 38
  worker-scoped export tables (34 already-covered + 4 gap tables), run `export.build` /
  `exportUserData` as `jarvis_worker_runtime`, assert it completes with rows present for
  `notification_reads`, `entities`, `ai_assistant_action_requests`, `jarvis_action_audit_log`
  (currently fails: permission denied on the 4 gap tables).
- **Negative-write test**: as `jarvis_worker_runtime`, assert `INSERT`/`UPDATE`/`DELETE` against
  each of the 4 gap tables raises a permission error (SELECT-only grant).
- **Policy-exactness test**: for the same actor/rows, assert the new `jarvis_worker_runtime`
  SELECT policy on each of the 4 tables returns the identical row set as the existing
  `jarvis_app_runtime` owner-visible predicate (mirror, not a new/tighter predicate).
  Run: confirm all three fail red for the expected reason (permission denied / policy mismatch),
  not a setup error.

## Task 2 — Green: module-local migrations, exact predicates, next number

- Re-verify next global migration number immediately before authoring (handoff notes 0166 as of
  last checkout — reconfirm branch + `origin/main` top-out, another lane may have claimed it).
- One migration per gap table in its owning module `sql/` dir (confirm exact owning dir for
  `entities` and `jarvis_action_audit_log` per handoff's caveat before writing):
  - `packages/notifications/sql/0166_worker_notification_reads_grant.sql`
  - `packages/structured-state/sql/0167_worker_entities_grant.sql` (pending owning-dir confirm)
  - `packages/ai/sql/0168_worker_action_requests_grant.sql`
  - `packages/ai/sql/0169_worker_audit_log_grant.sql` (pending owning-dir confirm)
- Each: `GRANT SELECT ON app.<table> TO jarvis_worker_runtime;` + `DROP POLICY IF EXISTS ... ;
CREATE POLICY ... FOR SELECT TO jarvis_worker_runtime USING (<exact predicate from handoff>)`.
  Never GRANT INSERT/UPDATE/DELETE/BYPASSRLS. Predicates copied verbatim from handoff (mirror
  `jarvis_app_runtime`'s existing predicate per table, no narrowing/widening).
- Do not touch `task_activity` policy (out-of-scope finding, already flagged to coordinator
  separately, non-goal).

## Task 3 — Migration inventory

- Update `foundation.test.ts`'s full migration-list `toEqual` assertion with the new
  migration rows (per `[[migration-invariants]]`) — must be same commit/task as the migrations
  that introduce them, or it breaks latently per prior incident.
- Re-run Task 1's three tests green.

## Task 4 — Gates + wrap-up

- Focused gate first: targeted `pnpm test:integration` scoped to the touched suites, plus
  `pnpm test:unit` for `foundation.test.ts`.
- Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`, fresh `git fetch origin main
&& git rebase origin/main`.
- Full gate: `pnpm verify:foundation`, record commands + exit codes.
- `coordinated-wrap-up`: clean tree, push, open PR, report PR + evidence to coordinator. No
  merge/board/QA (coordinator's).

## Non-goals (unchanged from spec)

- `task_activity` owner-check gap — reported, not fixed here.
- `worker_fail_data_export_job` transaction hardening — deferred.
- Any table outside the 4 confirmed gaps — the 34 already-covered tables are not touched.
