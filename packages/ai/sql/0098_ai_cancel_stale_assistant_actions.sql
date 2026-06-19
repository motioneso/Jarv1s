DROP POLICY IF EXISTS ai_assistant_action_requests_maintenance_select
  ON app.ai_assistant_action_requests;
DROP POLICY IF EXISTS ai_assistant_action_requests_maintenance_update
  ON app.ai_assistant_action_requests;

CREATE POLICY ai_assistant_action_requests_maintenance_select
ON app.ai_assistant_action_requests
FOR SELECT
TO jarvis_migration_owner
USING (true);

CREATE POLICY ai_assistant_action_requests_maintenance_update
ON app.ai_assistant_action_requests
FOR UPDATE
TO jarvis_migration_owner
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION app.cancel_stale_ai_assistant_action_requests(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE app.ai_assistant_action_requests
  SET status = 'cancelled',
      resolved_at = now(),
      updated_at = now()
  WHERE status = 'pending'
    AND requested_at < older_than;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.cancel_stale_ai_assistant_action_requests(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.cancel_stale_ai_assistant_action_requests(timestamptz)
  TO jarvis_app_runtime;
