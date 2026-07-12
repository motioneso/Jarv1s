CREATE TABLE IF NOT EXISTS app.jarvis_error_log (
  id uuid PRIMARY KEY,
  owner_user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  feature text NOT NULL CHECK (length(btrim(feature)) > 0 AND length(feature) <= 80),
  operation text NOT NULL CHECK (length(btrim(operation)) > 0 AND length(operation) <= 120),
  error_category text NOT NULL
    CHECK (length(btrim(error_category)) > 0 AND length(error_category) <= 80),
  retryable boolean NOT NULL DEFAULT false,
  user_message text NOT NULL CHECK (length(btrim(user_message)) > 0 AND length(user_message) <= 500),
  internal_summary text NOT NULL
    CHECK (length(btrim(internal_summary)) > 0 AND length(internal_summary) <= 1000),
  request_id text
);

CREATE INDEX IF NOT EXISTS jarvis_error_log_owner_time_idx
  ON app.jarvis_error_log(owner_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS jarvis_error_log_owner_feature_time_idx
  ON app.jarvis_error_log(owner_user_id, feature, occurred_at DESC);

GRANT SELECT, INSERT ON app.jarvis_error_log TO jarvis_app_runtime;

ALTER TABLE app.jarvis_error_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_error_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jarvis_error_log_select
  ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_insert
  ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_maintenance_insert
  ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_maintenance_select
  ON app.jarvis_error_log;
DROP POLICY IF EXISTS jarvis_error_log_maintenance_delete
  ON app.jarvis_error_log;

CREATE POLICY jarvis_error_log_select
ON app.jarvis_error_log
FOR SELECT TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_error_log_insert
ON app.jarvis_error_log
FOR INSERT TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY jarvis_error_log_maintenance_select
ON app.jarvis_error_log
FOR SELECT
TO jarvis_migration_owner
USING (true);

CREATE POLICY jarvis_error_log_maintenance_insert
ON app.jarvis_error_log
FOR INSERT
TO jarvis_migration_owner
WITH CHECK (owner_user_id IS NULL);

CREATE POLICY jarvis_error_log_maintenance_delete
ON app.jarvis_error_log
FOR DELETE
TO jarvis_migration_owner
USING (true);

CREATE OR REPLACE FUNCTION app.record_anonymous_error(
  event_id uuid,
  event_feature text,
  event_operation text,
  event_error_category text,
  event_retryable boolean,
  event_user_message text,
  event_internal_summary text,
  event_request_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
BEGIN
  INSERT INTO app.jarvis_error_log (
    id,
    owner_user_id,
    feature,
    operation,
    error_category,
    retryable,
    user_message,
    internal_summary,
    request_id
  )
  VALUES (
    event_id,
    NULL,
    event_feature,
    event_operation,
    event_error_category,
    event_retryable,
    event_user_message,
    event_internal_summary,
    event_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION app.record_anonymous_error(
  uuid,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_anonymous_error(
  uuid,
  text,
  text,
  text,
  boolean,
  text,
  text,
  text
) TO jarvis_app_runtime;

CREATE OR REPLACE FUNCTION app.purge_jarvis_error_log(older_than timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM app.jarvis_error_log WHERE occurred_at < older_than;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION app.purge_jarvis_error_log(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_jarvis_error_log(timestamptz) TO jarvis_app_runtime;
