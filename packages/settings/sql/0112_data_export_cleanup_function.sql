DROP POLICY IF EXISTS data_export_jobs_cleanup_list
  ON app.data_export_jobs;

CREATE POLICY data_export_jobs_cleanup_list
ON app.data_export_jobs
FOR SELECT
TO jarvis_migration_owner
USING (true);

CREATE OR REPLACE FUNCTION app.list_expired_data_export_jobs(cutoff timestamptz)
RETURNS TABLE(id uuid, "ownerUserId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT id, owner_user_id AS "ownerUserId"
  FROM app.data_export_jobs
  WHERE status = 'ready'
    AND expires_at IS NOT NULL
    AND expires_at <= cutoff
  ORDER BY expires_at ASC, id ASC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION app.list_expired_data_export_jobs(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_expired_data_export_jobs(timestamptz) TO jarvis_worker_runtime;
