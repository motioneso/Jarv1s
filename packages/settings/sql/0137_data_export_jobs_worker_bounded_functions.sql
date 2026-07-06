-- #671 follow-up: 0134 gave jarvis_worker_runtime a blanket
-- `GRANT SELECT ON app.data_export_jobs`, which fixed the worker's UPDATE ... WHERE id = $1
-- permission error but also let the worker role run an unbounded `SELECT * FROM
-- app.data_export_jobs` (RLS/FORCE RLS still applies, but the raw table-level privilege is
-- broader than the worker ever needs). Coordinator decision: replace the blanket SELECT grant
-- with narrow SECURITY DEFINER functions, mirroring the existing
-- app.list_expired_data_export_jobs pattern from 0112. Each function is scoped by job id AND
-- app.current_actor_user_id() (the same actor-context mechanism the owner-only RLS policy
-- itself reads), so a caller can only ever touch the job row matching its own session actor —
-- no broader than the RLS-filtered raw SELECT the worker had, just without the standing
-- table-level grant.
--
-- Granted to both jarvis_worker_runtime (the only caller in production) and
-- jarvis_app_runtime (several integration tests exercise the wellness/settings export job
-- handlers under the app role, mirroring how most of this suite already tests worker handlers
-- — see tests/integration/wellness-export-job.test.ts). This is safe because ownership is
-- enforced inside each function body via app.current_actor_user_id(), not by the caller's role.
--
-- worker_get_data_export_job is NOT defined here — it needs the `params` column, which is
-- added by wellness's own 0114 migration. Module SQL directories apply in BUILT_IN_MODULES
-- order (module-registry/src/index.ts), and the settings directory runs BEFORE the wellness
-- directory, so a settings-owned migration cannot reference that column at migration time.
-- Defined instead in wellness's own migration (0138), which owns both the dependency and the
-- only caller (packages/wellness/src/export-job.ts) — mirrors the existing 0112 (settings) /
-- 0115 (wellness) split for app.list_expired_data_export_jobs.
REVOKE SELECT ON app.data_export_jobs FROM jarvis_worker_runtime;

DROP POLICY IF EXISTS data_export_jobs_worker_functions_write
  ON app.data_export_jobs;

CREATE POLICY data_export_jobs_worker_functions_write
ON app.data_export_jobs
FOR UPDATE
TO jarvis_migration_owner
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION app.worker_update_data_export_job_status(p_job_id uuid, p_status text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  UPDATE app.data_export_jobs
  SET status = p_status
  WHERE id = p_job_id
    AND owner_user_id = app.current_actor_user_id();
$$;

REVOKE ALL ON FUNCTION app.worker_update_data_export_job_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_update_data_export_job_status(uuid, text)
  TO jarvis_worker_runtime, jarvis_app_runtime;

CREATE OR REPLACE FUNCTION app.worker_complete_data_export_job(
  p_job_id uuid,
  p_completed_at timestamptz,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  UPDATE app.data_export_jobs
  SET status = 'ready', completed_at = p_completed_at, expires_at = p_expires_at
  WHERE id = p_job_id
    AND owner_user_id = app.current_actor_user_id();
$$;

REVOKE ALL ON FUNCTION app.worker_complete_data_export_job(uuid, timestamptz, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_complete_data_export_job(uuid, timestamptz, timestamptz)
  TO jarvis_worker_runtime, jarvis_app_runtime;

CREATE OR REPLACE FUNCTION app.worker_fail_data_export_job(p_job_id uuid, p_error_message text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  UPDATE app.data_export_jobs
  SET status = 'failed', error_message = p_error_message
  WHERE id = p_job_id
    AND owner_user_id = app.current_actor_user_id();
$$;

REVOKE ALL ON FUNCTION app.worker_fail_data_export_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_fail_data_export_job(uuid, text)
  TO jarvis_worker_runtime, jarvis_app_runtime;
