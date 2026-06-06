CREATE TABLE IF NOT EXISTS app.admin_audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  target_type text NOT NULL CHECK (length(btrim(target_type)) > 0),
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_events_actor_user_id_created_at_idx
  ON app.admin_audit_events(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_target_created_at_idx
  ON app.admin_audit_events(target_type, target_id, created_at DESC);

GRANT SELECT, INSERT ON app.admin_audit_events TO jarvis_app_runtime;

GRANT DELETE ON app.workspace_memberships, app.resource_grants TO jarvis_app_runtime;
