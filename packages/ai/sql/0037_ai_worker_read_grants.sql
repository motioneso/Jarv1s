-- M-A3 fix: the chat-execution pg-boss worker (jarvis_worker_runtime) resolves the
-- active chat model and loads the provider config (with encrypted credential) to make
-- the AI call — see packages/chat/src/jobs.ts -> AiRepository.selectModelForCapability
-- / selectProviderWithCredential.
--
-- The original AI grants/policies (0013_ai_module) targeted jarvis_app_runtime ONLY,
-- so once chat_messages access was fixed the worker would next fail reading
-- ai_configured_models / ai_provider_configs. Grant the worker read access and add it
-- to the owner-scoped SELECT policies. Read-only: the worker never inserts or updates
-- AI config. The owner-scoped USING expressions are preserved verbatim from 0013.

GRANT SELECT ON app.ai_provider_configs TO jarvis_worker_runtime;
GRANT SELECT ON app.ai_configured_models TO jarvis_worker_runtime;

DROP POLICY IF EXISTS ai_provider_configs_select ON app.ai_provider_configs;
CREATE POLICY ai_provider_configs_select
ON app.ai_provider_configs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

DROP POLICY IF EXISTS ai_configured_models_select ON app.ai_configured_models;
CREATE POLICY ai_configured_models_select
ON app.ai_configured_models
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
