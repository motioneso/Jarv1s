DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'connector_provider_type'
  ) THEN
    CREATE TYPE app.connector_provider_type AS ENUM ('calendar', 'email');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'connector_provider_status'
  ) THEN
    CREATE TYPE app.connector_provider_status AS ENUM ('available', 'disabled');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'connector_account_status'
  ) THEN
    CREATE TYPE app.connector_account_status AS ENUM ('active', 'error', 'revoked');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.connector_definitions (
  provider_id text PRIMARY KEY,
  provider_type app.connector_provider_type NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  status app.connector_provider_status NOT NULL DEFAULT 'available',
  default_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.connector_accounts (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL REFERENCES app.connector_definitions(provider_id),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES app.workspaces(id) ON DELETE CASCADE,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status app.connector_account_status NOT NULL DEFAULT 'active',
  encrypted_secret jsonb NOT NULL CHECK (jsonb_typeof(encrypted_secret) = 'object'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS connector_accounts_owner_user_id_idx
  ON app.connector_accounts(owner_user_id);

CREATE INDEX IF NOT EXISTS connector_accounts_workspace_id_idx
  ON app.connector_accounts(workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS connector_accounts_provider_id_idx
  ON app.connector_accounts(provider_id);

INSERT INTO app.connector_definitions (
  provider_id,
  provider_type,
  display_name,
  status,
  default_scopes
)
VALUES
  (
    'google-calendar',
    'calendar',
    'Google Calendar',
    'available',
    ARRAY['https://www.googleapis.com/auth/calendar.readonly']::text[]
  ),
  (
    'google-email',
    'email',
    'Google Email',
    'available',
    ARRAY['https://www.googleapis.com/auth/gmail.readonly']::text[]
  ),
  (
    'microsoft-calendar',
    'calendar',
    'Microsoft Calendar',
    'available',
    ARRAY['Calendars.Read']::text[]
  ),
  (
    'microsoft-email',
    'email',
    'Microsoft Email',
    'available',
    ARRAY['Mail.Read']::text[]
  )
ON CONFLICT (provider_id) DO UPDATE SET
  provider_type = excluded.provider_type,
  display_name = excluded.display_name,
  status = excluded.status,
  default_scopes = excluded.default_scopes,
  updated_at = now();

CREATE OR REPLACE FUNCTION app.prevent_connector_account_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'connector account owner_user_id cannot be changed';
  END IF;

  IF NEW.provider_id <> OLD.provider_id THEN
    RAISE EXCEPTION 'connector account provider_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'connector account created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connector_accounts_prevent_identity_change ON app.connector_accounts;

CREATE TRIGGER connector_accounts_prevent_identity_change
BEFORE UPDATE OF owner_user_id, provider_id, created_at ON app.connector_accounts
FOR EACH ROW
EXECUTE FUNCTION app.prevent_connector_account_identity_change();

GRANT SELECT ON app.connector_definitions TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.connector_accounts TO jarvis_app_runtime;

ALTER TABLE app.connector_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.connector_definitions FORCE ROW LEVEL SECURITY;

ALTER TABLE app.connector_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.connector_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connector_definitions_select ON app.connector_definitions;
DROP POLICY IF EXISTS connector_accounts_select ON app.connector_accounts;
DROP POLICY IF EXISTS connector_accounts_insert ON app.connector_accounts;
DROP POLICY IF EXISTS connector_accounts_update ON app.connector_accounts;

CREATE POLICY connector_definitions_select
ON app.connector_definitions
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
);

CREATE POLICY connector_accounts_select
ON app.connector_accounts
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND (
    workspace_id IS NULL
    OR (
      workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY connector_accounts_insert
ON app.connector_accounts
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND (
    workspace_id IS NULL
    OR (
      workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY connector_accounts_update
ON app.connector_accounts
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND (
    workspace_id IS NULL
    OR (
      workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND (
    workspace_id IS NULL
    OR (
      workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);
