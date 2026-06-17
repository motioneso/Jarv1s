ALTER TABLE app.ai_configured_models
  ADD COLUMN IF NOT EXISTS allow_user_override boolean NOT NULL DEFAULT true;

-- jarvis_worker_runtime needs app.get_user_by_id to evaluate the SELECT policies below.
-- The function is SECURITY DEFINER owned by jarvis_auth_runtime; grant must run as that role.
SET LOCAL ROLE jarvis_auth_runtime;
GRANT EXECUTE ON FUNCTION app.get_user_by_id(uuid) TO jarvis_worker_runtime;
RESET ROLE;

-- Single audit point for the "owner is an active instance admin" predicate. Both AI-config
-- SELECT policies share this one definition so the admin-visibility rule cannot drift between
-- tables, and there is exactly one place to review when the cross-user-read boundary changes.
-- SECURITY INVOKER (default): runs as the calling runtime role, which already holds EXECUTE on
-- the SECURITY DEFINER app.get_user_by_id. search_path is pinned for hygiene.
CREATE OR REPLACE FUNCTION app.owner_is_active_admin(p_owner_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = app, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.get_user_by_id(p_owner_user_id) u
    WHERE u.is_instance_admin = true AND u.status = 'active'
  );
$$;
REVOKE ALL ON FUNCTION app.owner_is_active_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.owner_is_active_admin(uuid) TO jarvis_app_runtime, jarvis_worker_runtime;

-- SELECT: visible to the owner (per-user key case) OR to any authenticated user when the
-- owner is an active instance admin (admin-managed instance-level configs). Per-user AI keys
-- owned by non-admin users remain strictly owner-only; admin-created configs are visible to
-- all users so chat routing can resolve them cross-user. Both the live-chat (app_runtime) and
-- briefing/worker (worker_runtime) resolution paths require this read.
DROP POLICY IF EXISTS ai_provider_configs_select ON app.ai_provider_configs;
CREATE POLICY ai_provider_configs_select
ON app.ai_provider_configs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.owner_is_active_admin(owner_user_id)
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
    OR app.owner_is_active_admin(owner_user_id)
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
