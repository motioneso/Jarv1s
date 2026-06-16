ALTER TABLE app.ai_configured_models
  ADD COLUMN IF NOT EXISTS allow_user_override boolean NOT NULL DEFAULT true;

-- jarvis_worker_runtime needs app.get_user_by_id to evaluate the SELECT policies below.
-- The function is SECURITY DEFINER owned by jarvis_auth_runtime; grant must run as that role.
SET LOCAL ROLE jarvis_auth_runtime;
GRANT EXECUTE ON FUNCTION app.get_user_by_id(uuid) TO jarvis_worker_runtime;
RESET ROLE;

-- SELECT: visible to the owner (per-user key case) OR to any authenticated user when the
-- owner is an active instance admin (admin-managed instance-level configs).  Per-user AI keys
-- owned by non-admin users remain strictly owner-only; admin-created configs are visible to
-- all users so chat routing can resolve them cross-user.
DROP POLICY IF EXISTS ai_provider_configs_select ON app.ai_provider_configs;
CREATE POLICY ai_provider_configs_select
ON app.ai_provider_configs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR EXISTS (
      SELECT 1 FROM app.get_user_by_id(owner_user_id) u
      WHERE u.is_instance_admin = true AND u.status = 'active'
    )
  )
);

DROP POLICY IF EXISTS ai_configured_models_select ON app.ai_configured_models;
CREATE POLICY ai_configured_models_select
ON app.ai_configured_models
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR EXISTS (
      SELECT 1 FROM app.get_user_by_id(owner_user_id) u
      WHERE u.is_instance_admin = true AND u.status = 'active'
    )
  )
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
