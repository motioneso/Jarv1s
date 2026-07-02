-- #671 follow-up: worker_get_data_export_job needs app.data_export_jobs.params, which this
-- module's own 0114 migration added. Module SQL directories apply in BUILT_IN_MODULES order
-- (packages/module-registry/src/index.ts), and the settings directory (which owns
-- 0137_data_export_jobs_worker_bounded_functions.sql, the sibling status-mutation functions)
-- runs BEFORE this one, so a settings-owned migration cannot reference `params` at migration
-- time. Defined here instead — this module owns both the column dependency and the only
-- caller (packages/wellness/src/export-job.ts: handleWellnessExportJobInner). Mirrors the
-- existing 0112 (settings) / 0115 (wellness) split for app.list_expired_data_export_jobs.
--
-- Scoped by job id AND app.current_actor_user_id(), same as the sibling worker_* functions in
-- 0137 — a caller can only ever touch the job row matching its own session actor.
--
-- Return set omits `format`: the only caller (export-job.ts) reads only `.params`, verified by
-- grep. Add it back only if a real caller needs it.
CREATE FUNCTION app.worker_get_data_export_job(p_job_id uuid)
RETURNS TABLE(
  id uuid,
  owner_user_id uuid,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  error_message text,
  params jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT id, owner_user_id, status, created_at, completed_at, expires_at, error_message, params
  FROM app.data_export_jobs
  WHERE id = p_job_id
    AND owner_user_id = app.current_actor_user_id();
$$;

REVOKE ALL ON FUNCTION app.worker_get_data_export_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.worker_get_data_export_job(uuid)
  TO jarvis_worker_runtime, jarvis_app_runtime;
