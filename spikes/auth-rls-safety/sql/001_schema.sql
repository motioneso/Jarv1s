DROP SCHEMA IF EXISTS app CASCADE;

CREATE SCHEMA app AUTHORIZATION jarvis_migration_owner;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO jarvis_app_runtime, jarvis_worker_runtime;

CREATE TYPE app.rls_probe_visibility AS ENUM ('private', 'workspace');

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  is_instance_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.workspace_memberships (
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE app.resource_grants (
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  grantee_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  grant_level text NOT NULL CHECK (grant_level IN ('view', 'contribute', 'manage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_type, resource_id, grantee_user_id)
);

CREATE TABLE app.rls_probe_items (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid,
  visibility app.rls_probe_visibility NOT NULL DEFAULT 'private',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.spike_jobs (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX rls_probe_items_owner_user_id_idx
  ON app.rls_probe_items(owner_user_id);

CREATE INDEX rls_probe_items_workspace_id_idx
  ON app.rls_probe_items(workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX resource_grants_lookup_idx
  ON app.resource_grants(resource_type, resource_id, grantee_user_id, grant_level);

CREATE INDEX workspace_memberships_lookup_idx
  ON app.workspace_memberships(workspace_id, user_id);

CREATE INDEX spike_jobs_actor_user_id_idx
  ON app.spike_jobs(actor_user_id);

GRANT SELECT ON app.users, app.auth_sessions TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT ON app.rls_probe_items TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, UPDATE ON app.spike_jobs TO jarvis_worker_runtime;
