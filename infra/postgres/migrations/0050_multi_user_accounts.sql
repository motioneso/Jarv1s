-- Multi-user accounts (Phase 2 Slice A): account status lifecycle + registration levers.
--
-- 1. Adds app.users.status ('pending'|'active'|'deactivated') and is_bootstrap_owner.
-- 2. Seeds the two registration instance settings (idempotent).
-- 3. Adds app.current_actor_is_admin() SECURITY DEFINER (owned by jarvis_auth_runtime)
--    so jarvis_app_runtime can write OTHER users' rows when the actor is an active admin,
--    mirroring the app.count_all_users() pattern from 0045.
-- 4. Adds an admin-scoped UPDATE policy on app.users. See the plan's Security Decision:
--    app.users holds no secrets; content tables keep their own owner-only RLS.

-- 1. Columns. NOT NULL DEFAULT 'active' keeps every existing user active on upgrade.
ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'deactivated')),
  ADD COLUMN IF NOT EXISTS is_bootstrap_owner boolean NOT NULL DEFAULT false;

-- 2. Registration settings seed. ON CONFLICT DO NOTHING so re-runs never clobber operator edits.
INSERT INTO app.instance_settings (key, value, updated_by_user_id, created_at, updated_at)
VALUES
  ('registration.enabled', '{"value": true}'::jsonb, NULL, now(), now()),
  ('registration.requires_approval', '{"value": true}'::jsonb, NULL, now(), now())
ON CONFLICT (key) DO NOTHING;

-- 3. SECURITY DEFINER helper: is the current actor an ACTIVE instance admin?
--    Owned by jarvis_auth_runtime (USING(true) on users under FORCE RLS) so it sees the row
--    despite app_runtime's self-row restriction. Returns false when the actor GUC is unset.
CREATE OR REPLACE FUNCTION app.current_actor_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.users
    WHERE id = app.current_actor_user_id()
      AND is_instance_admin = true
      AND status = 'active'
  );
$$;

-- Transfer ownership to jarvis_auth_runtime and lock down EXECUTE (mirrors 0045 step 5).
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;
ALTER FUNCTION app.current_actor_is_admin() OWNER TO jarvis_auth_runtime;
REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;
SET LOCAL ROLE jarvis_auth_runtime;
REVOKE EXECUTE ON FUNCTION app.current_actor_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_actor_is_admin() TO jarvis_app_runtime;
RESET ROLE;

-- 4. Rebuild SECURITY DEFINER read helpers to expose status + is_bootstrap_owner.
--    CREATE OR REPLACE cannot change return types, so we DROP + CREATE as the owning role.
--    EXECUTE grants must be re-applied after DROP removes them. Ownership transfers automatically
--    because CREATE runs as jarvis_auth_runtime (via SET LOCAL ROLE).
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;
SET LOCAL ROLE jarvis_auth_runtime;

DROP FUNCTION IF EXISTS app.get_user_by_id(uuid);
CREATE FUNCTION app.get_user_by_id(p_user_id uuid)
  RETURNS TABLE(
    id                uuid,
    email             text,
    name              text,
    email_verified    boolean,
    image             text,
    is_instance_admin boolean,
    status            text,
    is_bootstrap_owner boolean,
    created_at        timestamptz,
    updated_at        timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT id, email, name, email_verified, image, is_instance_admin,
         status, is_bootstrap_owner, created_at, updated_at
  FROM users
  WHERE id = p_user_id
$$;
REVOKE EXECUTE ON FUNCTION app.get_user_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_user_by_id(uuid) TO jarvis_app_runtime;

DROP FUNCTION IF EXISTS app.list_all_users();
CREATE FUNCTION app.list_all_users()
  RETURNS TABLE(
    id                uuid,
    email             text,
    name              text,
    email_verified    boolean,
    image             text,
    is_instance_admin boolean,
    status            text,
    is_bootstrap_owner boolean,
    created_at        timestamptz,
    updated_at        timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT id, email, name, email_verified, image, is_instance_admin,
         status, is_bootstrap_owner, created_at, updated_at
  FROM users
  ORDER BY created_at, id
$$;
REVOKE EXECUTE ON FUNCTION app.list_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_all_users() TO jarvis_app_runtime;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;

-- 6. Admin-scoped UPDATE policy on app.users for jarvis_app_runtime. RLS combines permissive
--    policies with OR, so this ADDS to the existing self-row users_app_runtime_update policy:
--    an actor may update its own row OR (when it is an active admin) any row.
DROP POLICY IF EXISTS users_app_runtime_admin_update ON app.users;
CREATE POLICY users_app_runtime_admin_update
  ON app.users
  FOR UPDATE
  TO jarvis_app_runtime
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());
