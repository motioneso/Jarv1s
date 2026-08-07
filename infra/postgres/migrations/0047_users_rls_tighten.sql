-- Tighten users SELECT policy (P1 remediation #75).
--
-- Migration 0045 left users_app_runtime_select USING(true): any app-runtime
-- query without a GUC set can read every user row → identity enumeration.
-- This deviates from the approved owner-only intent.
--
-- Fix:
--   1. Replace users_app_runtime_select with self-row restriction
--      (id = app.current_actor_user_id()).
--   2. Add two SECURITY DEFINER helper functions (owned by jarvis_auth_runtime)
--      for the three SettingsRepository paths and connectors.requireAdmin() that
--      legitimately need cross-user or GUC-less access to users:
--        - app.get_user_by_id(uuid)  — for getUserById, requireUser, connectors admin
--        - app.list_all_users()      — for /api/admin/users (admin list)
--   3. app.count_all_users() is unchanged (still needed by bootstrapFirstJarvisUser
--      and /api/bootstrap/status).
--
-- Pattern mirrors 0045 count_all_users / 0046 resolve_auth_session exactly.
-- jarvis_auth_runtime has USING(true) on users, so SD functions owned by it
-- can see all rows regardless of the new self-row policy on app_runtime.

-- 1. Tighten the SELECT policy on users for jarvis_app_runtime.
DROP POLICY IF EXISTS users_app_runtime_select ON app.users;

CREATE POLICY users_app_runtime_select
  ON app.users
  FOR SELECT
  TO jarvis_app_runtime
  USING (id = app.current_actor_user_id());

-- 2a. SECURITY DEFINER: get a single user by id.
--     Used by SettingsRepository.getUserById(), requireUser(), and
--     connectors.requireAdmin() for instance-admin checks.
CREATE OR REPLACE FUNCTION app.get_user_by_id(p_user_id uuid)
  RETURNS TABLE(
    id            uuid,
    email         text,
    name          text,
    email_verified boolean,
    image         text,
    is_instance_admin boolean,
    created_at    timestamptz,
    updated_at    timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT id, email, name, email_verified, image, is_instance_admin, created_at, updated_at
  FROM users
  WHERE id = p_user_id
$$;

-- 2b. SECURITY DEFINER: list all users ordered by created_at, id.
--     Used by SettingsRepository.listUsers() → /api/admin/users.
CREATE OR REPLACE FUNCTION app.list_all_users()
  RETURNS TABLE(
    id            uuid,
    email         text,
    name          text,
    email_verified boolean,
    image         text,
    is_instance_admin boolean,
    created_at    timestamptz,
    updated_at    timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT id, email, name, email_verified, image, is_instance_admin, created_at, updated_at
  FROM users
  ORDER BY created_at, id
$$;

-- 3. Transfer ownership of both new functions to jarvis_auth_runtime.
--    Temporary CREATE grant required by PostgreSQL ALTER FUNCTION ... OWNER TO.
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;

ALTER FUNCTION app.get_user_by_id(uuid) OWNER TO jarvis_auth_runtime;
ALTER FUNCTION app.list_all_users() OWNER TO jarvis_auth_runtime;

REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;

-- 4. Lock down execute: only jarvis_app_runtime may call these functions.
SET LOCAL ROLE jarvis_auth_runtime;

REVOKE EXECUTE ON FUNCTION app.get_user_by_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_user_by_id(uuid) TO jarvis_app_runtime;

REVOKE EXECUTE ON FUNCTION app.list_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_all_users() TO jarvis_app_runtime;

RESET ROLE;
