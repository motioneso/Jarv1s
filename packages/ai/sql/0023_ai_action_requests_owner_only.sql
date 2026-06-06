-- Slice 1c: remove the workspace-membership guard from the assistant action
-- requests INSERT policy (workspace context is being torn down). SELECT and UPDATE
-- are already owner-only and unchanged. ai_provider_configs / ai_configured_models
-- are already owner-only with no workspace logic and need no migration. None of
-- these tables are shareable (they hold or relate to encrypted credentials), so no
-- app.has_share arm is added. The workspace_id column on
-- app.ai_assistant_action_requests remains but is no longer consulted; dropped in
-- Slice 1f.

DROP POLICY IF EXISTS ai_assistant_action_requests_insert ON app.ai_assistant_action_requests;

CREATE POLICY ai_assistant_action_requests_insert
ON app.ai_assistant_action_requests
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
