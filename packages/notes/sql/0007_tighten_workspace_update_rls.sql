-- tasks_update was originally tightened here; it is now owned by
-- packages/tasks/sql/0019_tasks_owner_or_share.sql (owner-or-share model,
-- Slice 1b). The tasks_update block has been removed to avoid overwriting
-- the new policy. Only notes_update is managed here.

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
