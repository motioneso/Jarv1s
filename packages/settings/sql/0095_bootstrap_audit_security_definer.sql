DROP POLICY IF EXISTS admin_audit_events_bootstrap_insert ON app.admin_audit_events;
CREATE POLICY admin_audit_events_bootstrap_insert ON app.admin_audit_events
  FOR INSERT TO jarvis_migration_owner
  WITH CHECK (
    action = 'bootstrap_owner_created'
    AND target_type = 'user'
    AND actor_user_id = target_id::uuid
    AND metadata = jsonb_build_object('recordedBy', 'record_bootstrap_owner_audit_event')
  );

CREATE OR REPLACE FUNCTION app.record_bootstrap_owner_audit_event(
  actor_user_id uuid,
  target_user_id uuid,
  request_id text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  INSERT INTO app.admin_audit_events (
    id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata,
    request_id,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    actor_user_id,
    'bootstrap_owner_created',
    'user',
    target_user_id::text,
    jsonb_build_object('recordedBy', 'record_bootstrap_owner_audit_event'),
    request_id,
    now()
  );
$$;

ALTER FUNCTION app.record_bootstrap_owner_audit_event(uuid, uuid, text)
  OWNER TO jarvis_migration_owner;

REVOKE EXECUTE ON FUNCTION app.record_bootstrap_owner_audit_event(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_bootstrap_owner_audit_event(uuid, uuid, text)
  TO jarvis_app_runtime;
