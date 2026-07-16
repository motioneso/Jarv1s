-- #1077: export.build reads app.ai_assistant_action_requests as jarvis_worker_runtime but the
-- role has never had SELECT here. Mirror the existing jarvis_app_runtime
-- ai_assistant_action_requests_select predicate exactly — SELECT only, no writes.

GRANT SELECT ON app.ai_assistant_action_requests TO jarvis_worker_runtime;

DROP POLICY IF EXISTS ai_assistant_action_requests_select
  ON app.ai_assistant_action_requests;
CREATE POLICY ai_assistant_action_requests_select
ON app.ai_assistant_action_requests
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
