-- Close the auth-secret RLS gap (P1 #52).
--
-- Three tables hold every user's deepest secrets with no row-level security:
--   app.auth_accounts        — OAuth tokens, password hashes
--   app.better_auth_sessions — live session tokens
--   app.users                — user records (needed by all runtime code)
--
-- jarvis_auth_runtime is created + configured in bootstrap/0000_roles.sql.
-- GRANT jarvis_auth_runtime TO jarvis_migration_owner is also in the bootstrap,
-- enabling ALTER FUNCTION ... OWNER TO jarvis_auth_runtime (PostgreSQL requires
-- the current user to be a member of the new owner role for this operation).
--
-- Note: REVOKE jarvis_auth_runtime FROM jarvis_migration_owner at migration end was
-- considered for least-privilege tidy-up, but requires ADMIN OPTION which the
-- bootstrap GRANT does not include. The membership is inert at runtime — migration_owner
-- has NOINHERIT so it does not automatically receive auth_runtime privileges.
--
-- This migration:
--   1. Grants jarvis_auth_runtime schema access + full table access on the auth tables.
--   2. Revokes jarvis_app_runtime's access to the secret-material tables.
--   3. ENABLEs + FORCEs ROW LEVEL SECURITY on all three tables.
--   4. Adds per-role permissive policies.
--   5. Creates app.count_all_users() SECURITY DEFINER owned by jarvis_auth_runtime
--      so jarvis_app_runtime can count all users despite its own self-row restriction.

-- 1. Grant jarvis_auth_runtime access.
GRANT USAGE ON SCHEMA app TO jarvis_auth_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON app.auth_accounts, app.better_auth_sessions, app.auth_verifications, app.users
  TO jarvis_auth_runtime;

-- 2. Revoke jarvis_app_runtime's direct access to the secret-material tables.
--    app.users is kept (needed for self-row SELECT/UPDATE via owner-only policies).
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON app.auth_accounts, app.better_auth_sessions, app.auth_verifications
  FROM jarvis_app_runtime;

-- 3. Enable and force RLS on the three target tables.
ALTER TABLE app.auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_accounts FORCE ROW LEVEL SECURITY;

ALTER TABLE app.better_auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.better_auth_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;

-- 4. Policies — auth_accounts (only jarvis_auth_runtime accesses this table).
DROP POLICY IF EXISTS auth_accounts_auth_runtime ON app.auth_accounts;
CREATE POLICY auth_accounts_auth_runtime
  ON app.auth_accounts
  FOR ALL
  TO jarvis_auth_runtime
  USING (true)
  WITH CHECK (true);

-- Policies — better_auth_sessions (only jarvis_auth_runtime).
DROP POLICY IF EXISTS better_auth_sessions_auth_runtime ON app.better_auth_sessions;
CREATE POLICY better_auth_sessions_auth_runtime
  ON app.better_auth_sessions
  FOR ALL
  TO jarvis_auth_runtime
  USING (true)
  WITH CHECK (true);

-- Policies — users: three roles, each scoped appropriately.
DROP POLICY IF EXISTS users_auth_runtime ON app.users;
CREATE POLICY users_auth_runtime
  ON app.users
  FOR ALL
  TO jarvis_auth_runtime
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS users_app_runtime_select ON app.users;
CREATE POLICY users_app_runtime_select
  ON app.users
  FOR SELECT
  TO jarvis_app_runtime
  USING (id = app.current_actor_user_id());

DROP POLICY IF EXISTS users_app_runtime_insert ON app.users;
CREATE POLICY users_app_runtime_insert
  ON app.users
  FOR INSERT
  TO jarvis_app_runtime
  WITH CHECK (id = app.current_actor_user_id());

DROP POLICY IF EXISTS users_app_runtime_update ON app.users;
CREATE POLICY users_app_runtime_update
  ON app.users
  FOR UPDATE
  TO jarvis_app_runtime
  USING (id = app.current_actor_user_id())
  WITH CHECK (id = app.current_actor_user_id());

-- Worker has a legacy SELECT grant on users from migration 0001; add a self-row policy
-- so FORCE RLS does not silently deny future legitimate reads.
DROP POLICY IF EXISTS users_worker_runtime_select ON app.users;
CREATE POLICY users_worker_runtime_select
  ON app.users
  FOR SELECT
  TO jarvis_worker_runtime
  USING (id = app.current_actor_user_id());

-- 5. SECURITY DEFINER helper function owned by jarvis_auth_runtime.
--
--    app.count_all_users() lets jarvis_app_runtime count ALL users despite its own
--    self-row restriction, so bootstrapFirstJarvisUser can detect the first-user
--    condition correctly and atomically (within the advisory-lock transaction).
--
--    Strategy:
--    a) migration_owner creates the function (owns the schema, has CREATE).
--    b) Temporarily grant CREATE on schema to jarvis_auth_runtime — required by
--       PostgreSQL for ALTER FUNCTION ... OWNER TO (new owner must have CREATE on schema).
--    c) Transfer ownership to jarvis_auth_runtime; revoke the temporary CREATE grant.
--       (The function itself is unaffected; REVOKE only prevents future object creation.)
--    d) SET LOCAL ROLE to jarvis_auth_runtime to manage execute privileges as owner.

CREATE OR REPLACE FUNCTION app.count_all_users()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT count(*) FROM users
$$;

-- Temporary CREATE grant enables the ALTER OWNER below (PostgreSQL requirement).
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;

-- Transfer ownership: migration_owner is a member of jarvis_auth_runtime (bootstrap),
-- satisfying PostgreSQL's "current user must be member of new owner" requirement.
ALTER FUNCTION app.count_all_users() OWNER TO jarvis_auth_runtime;

-- Remove the temporary CREATE grant; jarvis_auth_runtime retains function ownership.
REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;

-- Act as jarvis_auth_runtime (which now owns the function) to lock down execute access.
SET LOCAL ROLE jarvis_auth_runtime;
REVOKE EXECUTE ON FUNCTION app.count_all_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.count_all_users() TO jarvis_app_runtime;
RESET ROLE;
