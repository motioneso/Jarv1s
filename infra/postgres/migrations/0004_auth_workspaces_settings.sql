ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE app.users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS app.auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);

CREATE TABLE IF NOT EXISTS app.better_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app.auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.instance_settings (
  key text PRIMARY KEY CHECK (length(btrim(key)) > 0),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.resource_grants
  ADD COLUMN IF NOT EXISTS granted_by_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx
  ON app.auth_accounts(user_id);

CREATE INDEX IF NOT EXISTS better_auth_sessions_user_id_idx
  ON app.better_auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx
  ON app.auth_verifications(identifier);

CREATE INDEX IF NOT EXISTS workspaces_created_by_user_id_idx
  ON app.workspaces(created_by_user_id);

GRANT SELECT, INSERT, UPDATE ON app.users
  TO jarvis_app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON app.auth_accounts, app.better_auth_sessions, app.auth_verifications
  TO jarvis_app_runtime;

GRANT SELECT, INSERT, UPDATE
  ON app.workspaces, app.workspace_memberships, app.resource_grants, app.instance_settings
  TO jarvis_app_runtime;

GRANT SELECT
  ON app.workspaces, app.instance_settings
  TO jarvis_worker_runtime;
