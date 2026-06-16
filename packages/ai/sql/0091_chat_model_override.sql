ALTER TABLE app.ai_configured_models
  ADD COLUMN IF NOT EXISTS allow_user_override boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS ai_provider_configs_select ON app.ai_provider_configs;
CREATE POLICY ai_provider_configs_select
ON app.ai_provider_configs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
);

DROP POLICY IF EXISTS ai_configured_models_select ON app.ai_configured_models;
CREATE POLICY ai_configured_models_select
ON app.ai_configured_models
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
);

DROP POLICY IF EXISTS ai_provider_configs_insert ON app.ai_provider_configs;
CREATE POLICY ai_provider_configs_insert
ON app.ai_provider_configs
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_is_admin()
);

DROP POLICY IF EXISTS ai_provider_configs_update ON app.ai_provider_configs;
CREATE POLICY ai_provider_configs_update
ON app.ai_provider_configs
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_is_admin()
)
WITH CHECK (
  app.current_actor_is_admin()
);

DROP POLICY IF EXISTS ai_configured_models_insert ON app.ai_configured_models;
CREATE POLICY ai_configured_models_insert
ON app.ai_configured_models
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_is_admin()
);

DROP POLICY IF EXISTS ai_configured_models_update ON app.ai_configured_models;
CREATE POLICY ai_configured_models_update
ON app.ai_configured_models
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_is_admin()
)
WITH CHECK (
  app.current_actor_is_admin()
);
