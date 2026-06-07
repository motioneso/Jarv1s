DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'task_status'
  ) THEN
    CREATE TYPE app.task_status AS ENUM ('todo', 'in_progress', 'done', 'archived');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.tasks (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  status app.task_status NOT NULL DEFAULT 'todo',
  priority smallint,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.task_activity (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (length(btrim(activity_type)) > 0),
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_owner_user_id_idx
  ON app.tasks(owner_user_id);

CREATE INDEX IF NOT EXISTS tasks_status_idx
  ON app.tasks(status);

CREATE INDEX IF NOT EXISTS task_activity_task_id_created_at_idx
  ON app.task_activity(task_id, created_at);

CREATE OR REPLACE FUNCTION app.has_resource_grant_level(
  p_resource_type text,
  p_resource_id uuid,
  p_actor_user_id uuid,
  p_grant_levels text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT p_actor_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM resource_grants grants
      WHERE grants.resource_type = p_resource_type
        AND grants.resource_id = p_resource_id
        AND grants.grantee_user_id = p_actor_user_id
        AND grants.grant_level = ANY(p_grant_levels)
    );
$$;

CREATE OR REPLACE FUNCTION app.prevent_task_owner_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'task owner_user_id cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_prevent_owner_change ON app.tasks;

CREATE TRIGGER tasks_prevent_owner_change
BEFORE UPDATE OF owner_user_id ON app.tasks
FOR EACH ROW
EXECUTE FUNCTION app.prevent_task_owner_change();

REVOKE ALL ON FUNCTION app.has_resource_grant_level(text, uuid, uuid, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.has_resource_grant_level(text, uuid, uuid, text[])
  TO jarvis_app_runtime, jarvis_worker_runtime;

GRANT SELECT, INSERT, UPDATE ON app.tasks TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT ON app.task_activity TO jarvis_app_runtime, jarvis_worker_runtime;

ALTER TABLE app.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tasks FORCE ROW LEVEL SECURITY;

ALTER TABLE app.task_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_activity FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON app.tasks;
DROP POLICY IF EXISTS tasks_insert ON app.tasks;
DROP POLICY IF EXISTS tasks_update ON app.tasks;
DROP POLICY IF EXISTS task_activity_select ON app.task_activity;
DROP POLICY IF EXISTS task_activity_insert ON app.task_activity;

CREATE POLICY tasks_select
ON app.tasks
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant('task', id, app.current_actor_user_id())
  )
);

CREATE POLICY tasks_insert
ON app.tasks
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY tasks_update
ON app.tasks
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant_level('task', id, app.current_actor_user_id(), ARRAY['manage'])
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant_level('task', id, app.current_actor_user_id(), ARRAY['manage'])
  )
);

CREATE POLICY task_activity_select
ON app.task_activity
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM app.tasks parent_task
    WHERE parent_task.id = task_id
  )
);

CREATE POLICY task_activity_insert
ON app.task_activity
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND actor_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.tasks parent_task
    WHERE parent_task.id = task_id
  )
);
