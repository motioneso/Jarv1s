DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'calendar_event_visibility'
  ) THEN
    CREATE TYPE app.calendar_event_visibility AS ENUM ('private', 'workspace');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.calendar_events (
  id uuid PRIMARY KEY,
  connector_account_id uuid NOT NULL REFERENCES app.connector_accounts(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES app.workspaces(id) ON DELETE CASCADE,
  visibility app.calendar_event_visibility NOT NULL DEFAULT 'private',
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location text,
  summary text,
  body_excerpt text,
  external_id text NOT NULL CHECK (length(btrim(external_id)) > 0),
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(external_metadata) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_account_id, external_id),
  CHECK (ends_at >= starts_at),
  CHECK (
    (
      visibility = 'private'
      AND workspace_id IS NULL
    )
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS calendar_events_owner_user_id_starts_at_idx
  ON app.calendar_events(owner_user_id, starts_at);

CREATE INDEX IF NOT EXISTS calendar_events_workspace_id_starts_at_idx
  ON app.calendar_events(workspace_id, starts_at)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calendar_events_connector_account_id_idx
  ON app.calendar_events(connector_account_id);

CREATE OR REPLACE FUNCTION app.prevent_calendar_event_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'calendar event owner_user_id cannot be changed';
  END IF;

  IF NEW.connector_account_id <> OLD.connector_account_id THEN
    RAISE EXCEPTION 'calendar event connector_account_id cannot be changed';
  END IF;

  IF NEW.external_id <> OLD.external_id THEN
    RAISE EXCEPTION 'calendar event external_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'calendar event created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_events_prevent_identity_change ON app.calendar_events;

CREATE TRIGGER calendar_events_prevent_identity_change
BEFORE UPDATE OF owner_user_id, connector_account_id, external_id, created_at
ON app.calendar_events
FOR EACH ROW
EXECUTE FUNCTION app.prevent_calendar_event_identity_change();

GRANT SELECT, INSERT, UPDATE ON app.calendar_events TO jarvis_app_runtime;

ALTER TABLE app.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.calendar_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_insert ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_update ON app.calendar_events;

CREATE POLICY calendar_events_select
ON app.calendar_events
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY calendar_events_insert
ON app.calendar_events
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND definitions.provider_type = 'calendar'
  )
  AND (
    visibility = 'private'
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY calendar_events_update
ON app.calendar_events
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND (
    visibility = 'private'
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);
