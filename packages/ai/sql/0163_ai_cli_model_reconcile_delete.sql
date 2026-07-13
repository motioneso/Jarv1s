-- #982/#869 D6: hard delete-and-rediscover for CLI providers needs DELETE on configured models.
-- Least privilege: runtime gets DELETE on this table only; FORCE RLS still requires an admin actor.
-- The sentinel is protected here and in repository filtering so reconciliation cannot orphan chat.
GRANT DELETE ON app.ai_configured_models TO jarvis_app_runtime;

DROP POLICY IF EXISTS ai_configured_models_delete ON app.ai_configured_models;
CREATE POLICY ai_configured_models_delete
ON app.ai_configured_models
FOR DELETE
TO jarvis_app_runtime
USING (
  app.current_actor_is_admin()
  AND provider_model_id <> 'default'
);
