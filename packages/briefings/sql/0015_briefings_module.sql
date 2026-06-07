DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'briefing_cadence'
  ) THEN
    CREATE TYPE app.briefing_cadence AS ENUM ('manual', 'daily', 'weekly');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'briefing_run_status'
  ) THEN
    CREATE TYPE app.briefing_run_status AS ENUM ('succeeded', 'blocked', 'failed');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'briefing_run_kind'
  ) THEN
    CREATE TYPE app.briefing_run_kind AS ENUM ('manual', 'scheduled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.briefing_definitions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  cadence app.briefing_cadence NOT NULL DEFAULT 'manual',
  schedule_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(schedule_metadata) = 'object'
  ),
  enabled boolean NOT NULL DEFAULT true,
  selected_tool_names text[] NOT NULL CHECK (
    cardinality(selected_tool_names) > 0
    AND array_position(selected_tool_names, '') IS NULL
  ),
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.briefing_runs (
  id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES app.briefing_definitions(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  status app.briefing_run_status NOT NULL,
  run_kind app.briefing_run_kind NOT NULL DEFAULT 'manual',
  summary_text text NOT NULL CHECK (length(btrim(summary_text)) > 0),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(source_metadata) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS briefing_definitions_owner_user_id_updated_at_idx
  ON app.briefing_definitions(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS briefing_runs_definition_id_created_at_idx
  ON app.briefing_runs(definition_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS briefing_runs_owner_user_id_created_at_idx
  ON app.briefing_runs(owner_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.prevent_briefing_definition_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'briefing definition id cannot be changed';
  END IF;

  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'briefing definition owner_user_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'briefing definition created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_briefing_run_definition_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  definition_owner_user_id uuid;
BEGIN
  SELECT owner_user_id
  INTO definition_owner_user_id
  FROM app.briefing_definitions
  WHERE id = NEW.definition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'briefing run definition does not exist';
  END IF;

  IF NEW.owner_user_id <> definition_owner_user_id THEN
    RAISE EXCEPTION 'briefing run owner_user_id must match its definition';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS briefing_definitions_prevent_identity_change
  ON app.briefing_definitions;

CREATE TRIGGER briefing_definitions_prevent_identity_change
BEFORE UPDATE OF id, owner_user_id, created_at ON app.briefing_definitions
FOR EACH ROW
EXECUTE FUNCTION app.prevent_briefing_definition_identity_change();

DROP TRIGGER IF EXISTS briefing_runs_enforce_definition_context
  ON app.briefing_runs;

CREATE TRIGGER briefing_runs_enforce_definition_context
BEFORE INSERT OR UPDATE OF definition_id, owner_user_id
ON app.briefing_runs
FOR EACH ROW
EXECUTE FUNCTION app.enforce_briefing_run_definition_context();

GRANT SELECT, INSERT, UPDATE ON app.briefing_definitions TO jarvis_app_runtime;
GRANT SELECT, INSERT ON app.briefing_runs TO jarvis_app_runtime;

GRANT SELECT, UPDATE ON app.briefing_definitions TO jarvis_worker_runtime;
GRANT SELECT, INSERT ON app.briefing_runs TO jarvis_worker_runtime;

ALTER TABLE app.briefing_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.briefing_definitions FORCE ROW LEVEL SECURITY;

ALTER TABLE app.briefing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.briefing_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS briefing_definitions_select ON app.briefing_definitions;
DROP POLICY IF EXISTS briefing_definitions_insert ON app.briefing_definitions;
DROP POLICY IF EXISTS briefing_definitions_update ON app.briefing_definitions;
DROP POLICY IF EXISTS briefing_runs_select ON app.briefing_runs;
DROP POLICY IF EXISTS briefing_runs_insert ON app.briefing_runs;

CREATE POLICY briefing_definitions_select
ON app.briefing_definitions
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY briefing_definitions_insert
ON app.briefing_definitions
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY briefing_definitions_update
ON app.briefing_definitions
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY briefing_runs_select
ON app.briefing_runs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY briefing_runs_insert
ON app.briefing_runs
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.briefing_definitions definition
    WHERE definition.id = briefing_runs.definition_id
      AND definition.owner_user_id = app.current_actor_user_id()
  )
);
