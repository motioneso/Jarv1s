-- #671: handleWellnessExportJobInner (packages/wellness/src/export-job.ts) calls the sanctioned
-- recordAuditEvent() cross-module API at the end of the worker-run export job. app.admin_audit_events
-- had zero grant for jarvis_worker_runtime, so the worker's audit INSERT failed with a permission
-- error inside the same transaction as the job's own status UPDATE, masking as "current transaction
-- is aborted" on the subsequent failJob() write. Scoped narrowly to this table only - no broader
-- admin grants. Mirrors the jarvis_app_runtime insert policy shape (0059_admin_tables_rls.sql):
-- permissive WITH CHECK (true), append-only (no UPDATE/DELETE). SELECT policy stays
-- jarvis_app_runtime-only per the confidentiality finding in that file, so this worker SELECT grant
-- has no matching SELECT policy - a worker SELECT will read zero rows, which is fine/expected for a
-- write-only worker path.
GRANT INSERT, SELECT ON app.admin_audit_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS admin_audit_events_worker_insert ON app.admin_audit_events;
CREATE POLICY admin_audit_events_worker_insert ON app.admin_audit_events
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (true);
