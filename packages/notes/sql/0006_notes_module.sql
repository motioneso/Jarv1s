DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'note_visibility'
  ) THEN
    CREATE TYPE app.note_visibility AS ENUM ('private', 'workspace');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.notes (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid,
  visibility app.note_visibility NOT NULL DEFAULT 'private',
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  body text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notes_owner_user_id_idx
  ON app.notes(owner_user_id);

CREATE INDEX IF NOT EXISTS notes_workspace_id_idx
  ON app.notes(workspace_id)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notes_archived_at_idx
  ON app.notes(archived_at);

CREATE OR REPLACE FUNCTION app.prevent_note_owner_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'note owner_user_id cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_prevent_owner_change ON app.notes;

CREATE TRIGGER notes_prevent_owner_change
BEFORE UPDATE OF owner_user_id ON app.notes
FOR EACH ROW
EXECUTE FUNCTION app.prevent_note_owner_change();

GRANT SELECT, INSERT, UPDATE ON app.notes TO jarvis_app_runtime;

ALTER TABLE app.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_select ON app.notes;
DROP POLICY IF EXISTS notes_insert ON app.notes;
DROP POLICY IF EXISTS notes_update ON app.notes;

CREATE POLICY notes_select
ON app.notes
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant('note', id, app.current_actor_user_id())
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY notes_insert
ON app.notes
FOR INSERT
TO jarvis_app_runtime
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

CREATE POLICY notes_update
ON app.notes
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant_level('note', id, app.current_actor_user_id(), ARRAY['manage'])
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant_level('note', id, app.current_actor_user_id(), ARRAY['manage'])
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);
