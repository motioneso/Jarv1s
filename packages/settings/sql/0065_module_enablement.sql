-- Module-enablement seam (ADR 0009 §3): a deny-list of disabled modules.
-- A row's PRESENCE means "disabled"; absence means "enabled" (honoring the
-- manifest's availability.defaultEnabled, true for all built-ins today). Two scopes:
--   * scope='instance' (user_id NULL): admin-controlled hard floor for all actors.
--   * scope='user' (user_id NOT NULL): owner-scoped per-user refinement.
-- The migration inserts NO rows, so the live surface is byte-for-byte unchanged.
--
-- RLS mirrors instance_settings (0059): instance rows readable by all authed actors
-- so the resolver sees the floor; instance writes admin-only; user rows owner-only.
-- All statements are idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS app.module_enablement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('instance', 'user')),
  module_id text NOT NULL,
  user_id uuid NULL REFERENCES app.users(id) ON DELETE CASCADE,
  disabled_by_user_id uuid NULL REFERENCES app.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_enablement_scope_user_ck CHECK (
    (scope = 'instance' AND user_id IS NULL)
    OR (scope = 'user' AND user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS module_enablement_instance_uq
  ON app.module_enablement (module_id) WHERE scope = 'instance';

CREATE UNIQUE INDEX IF NOT EXISTS module_enablement_user_uq
  ON app.module_enablement (module_id, user_id) WHERE scope = 'user';

ALTER TABLE app.module_enablement ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_enablement FORCE ROW LEVEL SECURITY;

-- Instance rows: readable by all authed actors (resolver floor); writes admin-only.
DROP POLICY IF EXISTS module_enablement_instance_select ON app.module_enablement;
CREATE POLICY module_enablement_instance_select ON app.module_enablement
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (scope = 'instance');

DROP POLICY IF EXISTS module_enablement_instance_insert ON app.module_enablement;
CREATE POLICY module_enablement_instance_insert ON app.module_enablement
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (scope = 'instance' AND app.current_actor_is_admin());

DROP POLICY IF EXISTS module_enablement_instance_update ON app.module_enablement;
CREATE POLICY module_enablement_instance_update ON app.module_enablement
  FOR UPDATE TO jarvis_app_runtime
  USING (scope = 'instance' AND app.current_actor_is_admin())
  WITH CHECK (scope = 'instance' AND app.current_actor_is_admin());

DROP POLICY IF EXISTS module_enablement_instance_delete ON app.module_enablement;
CREATE POLICY module_enablement_instance_delete ON app.module_enablement
  FOR DELETE TO jarvis_app_runtime
  USING (scope = 'instance' AND app.current_actor_is_admin());

-- User rows: owner-only (the actor can only see/write their own per-user deny rows).
DROP POLICY IF EXISTS module_enablement_user_select ON app.module_enablement;
CREATE POLICY module_enablement_user_select ON app.module_enablement
  FOR SELECT TO jarvis_app_runtime
  USING (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

DROP POLICY IF EXISTS module_enablement_user_insert ON app.module_enablement;
CREATE POLICY module_enablement_user_insert ON app.module_enablement
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

DROP POLICY IF EXISTS module_enablement_user_update ON app.module_enablement;
CREATE POLICY module_enablement_user_update ON app.module_enablement
  FOR UPDATE TO jarvis_app_runtime
  USING (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  )
  WITH CHECK (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

DROP POLICY IF EXISTS module_enablement_user_delete ON app.module_enablement;
CREATE POLICY module_enablement_user_delete ON app.module_enablement
  FOR DELETE TO jarvis_app_runtime
  USING (
    scope = 'user'
    AND app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_enablement TO jarvis_app_runtime;
GRANT SELECT ON app.module_enablement TO jarvis_worker_runtime;
