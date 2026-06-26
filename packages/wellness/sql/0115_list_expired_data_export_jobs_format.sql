-- Wellness selective export (#484): extend list_expired_data_export_jobs to return format,
-- so the cleanup worker deletes the right vault file extension (.json vs .html).
-- DROP + RECREATE the function (CREATE OR REPLACE can't change a return type's column set in
-- place). The policy + grants from 0112 are preserved verbatim.
DROP FUNCTION IF EXISTS app.list_expired_data_export_jobs(timestamptz);

CREATE FUNCTION app.list_expired_data_export_jobs(cutoff timestamptz)
RETURNS TABLE(id uuid, "ownerUserId" uuid, format text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT id, owner_user_id AS "ownerUserId", format
  FROM app.data_export_jobs
  WHERE status = 'ready'
    AND expires_at IS NOT NULL
    AND expires_at <= cutoff
  ORDER BY expires_at ASC, id ASC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION app.list_expired_data_export_jobs(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_expired_data_export_jobs(timestamptz) TO jarvis_worker_runtime;
