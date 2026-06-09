-- 0041: unified Google Connection (uses the 'google' enum value added in 0040).

-- connector_definitions has FORCE ROW LEVEL SECURITY (from 0009). Migrations run as
-- jarvis_migration_owner, which FORCE subjects to RLS as well, so seed the row under a
-- transient migration-owner policy (the 0039 convention) and drop it. The per-file
-- transaction in sql-runner.ts keeps this atomic.
CREATE POLICY connector_definitions_migration_seed ON app.connector_definitions
  TO jarvis_migration_owner USING (true) WITH CHECK (true);

INSERT INTO app.connector_definitions (provider_id, provider_type, display_name, status, default_scopes)
VALUES (
  'google',
  'google',
  'Google',
  'available',
  ARRAY[
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar'
  ]::text[]
)
ON CONFLICT (provider_id) DO UPDATE SET
  provider_type = excluded.provider_type,
  display_name = excluded.display_name,
  status = excluded.status,
  default_scopes = excluded.default_scopes,
  updated_at = now();

DROP POLICY connector_definitions_migration_seed ON app.connector_definitions;

-- Short-lived in-flight authorization state (between /authorize and /complete).
CREATE TABLE IF NOT EXISTS app.connector_oauth_pending (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  provider_id text NOT NULL REFERENCES app.connector_definitions(provider_id),
  state text NOT NULL CHECK (length(btrim(state)) > 0),
  encrypted_secret jsonb NOT NULL CHECK (jsonb_typeof(encrypted_secret) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS connector_oauth_pending_owner_idx
  ON app.connector_oauth_pending(owner_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.connector_oauth_pending TO jarvis_app_runtime;

ALTER TABLE app.connector_oauth_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.connector_oauth_pending FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_oauth_pending_select ON app.connector_oauth_pending;
DROP POLICY IF EXISTS connector_oauth_pending_insert ON app.connector_oauth_pending;
DROP POLICY IF EXISTS connector_oauth_pending_update ON app.connector_oauth_pending;
DROP POLICY IF EXISTS connector_oauth_pending_delete ON app.connector_oauth_pending;

CREATE POLICY connector_oauth_pending_select ON app.connector_oauth_pending
  FOR SELECT TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY connector_oauth_pending_insert ON app.connector_oauth_pending
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY connector_oauth_pending_update ON app.connector_oauth_pending
  FOR UPDATE TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id())
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY connector_oauth_pending_delete ON app.connector_oauth_pending
  FOR DELETE TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());
