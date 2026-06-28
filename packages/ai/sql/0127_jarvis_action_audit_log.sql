CREATE TABLE IF NOT EXISTS app.jarvis_action_audit_log (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  tool_module_id text NOT NULL CHECK (length(btrim(tool_module_id)) > 0),
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) > 0),
  action_family_id text,
  action_kind text NOT NULL CHECK (action_kind IN ('write', 'destructive')),
  approval_mode text NOT NULL
    CHECK (approval_mode IN ('auto', 'confirmed', 'rejected', 'cancelled', 'timeout')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failed', 'denied', 'cancelled')),
  error_class text CHECK (error_class IS NULL OR length(error_class) <= 64),
  request_id text,
  chat_session_id text,
  source_surface text NOT NULL DEFAULT 'chat'
    CHECK (source_surface IN ('chat', 'proactive', 'scheduled', 'unknown')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jarvis_action_audit_log_owner_time_idx
  ON app.jarvis_action_audit_log(owner_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS jarvis_action_audit_log_owner_family_time_idx
  ON app.jarvis_action_audit_log(owner_user_id, action_family_id, occurred_at DESC);

GRANT SELECT, INSERT ON app.jarvis_action_audit_log TO jarvis_app_runtime;

ALTER TABLE app.jarvis_action_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_action_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jarvis_action_audit_log_select
  ON app.jarvis_action_audit_log;
DROP POLICY IF EXISTS jarvis_action_audit_log_insert
  ON app.jarvis_action_audit_log;
DROP POLICY IF EXISTS jarvis_action_audit_log_maintenance_select
  ON app.jarvis_action_audit_log;
DROP POLICY IF EXISTS jarvis_action_audit_log_maintenance_delete
  ON app.jarvis_action_audit_log;

CREATE POLICY jarvis_action_audit_log_select
ON app.jarvis_action_audit_log
FOR SELECT TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_action_audit_log_insert
ON app.jarvis_action_audit_log
FOR INSERT TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

-- Allows the SECURITY DEFINER purge function (running as jarvis_migration_owner) to scan all rows
CREATE POLICY jarvis_action_audit_log_maintenance_select
ON app.jarvis_action_audit_log
FOR SELECT
TO jarvis_migration_owner
USING (true);

-- Allows the SECURITY DEFINER purge function (running as jarvis_migration_owner) to delete
CREATE POLICY jarvis_action_audit_log_maintenance_delete
ON app.jarvis_action_audit_log
FOR DELETE
TO jarvis_migration_owner
USING (true);

CREATE OR REPLACE FUNCTION app.purge_jarvis_action_audit_log(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM app.jarvis_action_audit_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_jarvis_action_audit_log(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_jarvis_action_audit_log(timestamptz) TO jarvis_app_runtime;
