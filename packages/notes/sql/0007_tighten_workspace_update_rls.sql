DROP POLICY IF EXISTS tasks_update ON app.tasks;

CREATE POLICY tasks_update
ON app.tasks
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant_level('task', id, app.current_actor_user_id(), ARRAY['manage'])
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
    visibility = 'private'
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant_level('task', id, app.current_actor_user_id(), ARRAY['manage'])
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

DROP POLICY IF EXISTS notes_update ON app.notes;

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
    visibility = 'private'
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
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
