-- Slice 1b: convert Tasks access from workspace-visibility + resource_grants to
-- the owner-or-share model (app.has_share). The visibility/workspace_id columns
-- and the app.has_resource_grant_level helper remain but are no longer consulted
-- for task access; they are removed in Slice 1f. task_activity policies are left
-- unchanged: they gate on parent-task visibility via an RLS-filtered EXISTS, so
-- they inherit the new model automatically.

DROP POLICY IF EXISTS tasks_select ON app.tasks;
DROP POLICY IF EXISTS tasks_insert ON app.tasks;
DROP POLICY IF EXISTS tasks_update ON app.tasks;

CREATE POLICY tasks_select
ON app.tasks
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('task', id, 'view')
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
    OR app.has_share('task', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('task', id, 'manage')
  )
);
