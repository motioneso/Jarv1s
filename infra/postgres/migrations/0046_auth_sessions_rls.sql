-- Close the auth_sessions bearer-token gap (P1 #74, Fable H1) and finish the
-- auth_verifications gap left open by 0045 (REVOKE done, RLS not applied).
--
-- app.auth_sessions:
--   Migration 0001 granted SELECT to jarvis_app_runtime + jarvis_worker_runtime.
--   Its id column IS a bearer token — direct SELECT = impersonation risk.
--   Fix: REVOKE the grant, FORCE RLS, restrict to jarvis_auth_runtime only, and
--   expose a SECURITY DEFINER function (owned by jarvis_auth_runtime) so the
--   AuthSessionResolver can do a scoped by-token lookup without direct table access.
--
-- app.auth_verifications:
--   Migration 0045 revoked the 0004 grant from jarvis_app_runtime but never applied
--   ENABLE/FORCE RLS or a policy, leaving the table outside the audit boundary.
--   Fix: ENABLE + FORCE RLS, restrict to jarvis_auth_runtime.
--
-- Pattern mirrors 0045 (count_all_users / better_auth_sessions) exactly.

-- 1a. Grant jarvis_auth_runtime full access to auth_sessions.
--     (0045 granted it on auth_accounts / better_auth_sessions / auth_verifications / users
--     but never on auth_sessions — which was missing from that migration's scope.)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON app.auth_sessions
  TO jarvis_auth_runtime;

-- 1b. Revoke direct table access on auth_sessions from app + worker runtime roles.
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON app.auth_sessions
  FROM jarvis_app_runtime, jarvis_worker_runtime;

-- 2. Enable and force RLS on auth_sessions.
ALTER TABLE app.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_sessions FORCE ROW LEVEL SECURITY;

-- 3. Policy — auth_sessions: only jarvis_auth_runtime (matches better_auth_sessions pattern).
DROP POLICY IF EXISTS auth_sessions_auth_runtime ON app.auth_sessions;
CREATE POLICY auth_sessions_auth_runtime
  ON app.auth_sessions
  FOR ALL
  TO jarvis_auth_runtime
  USING (true)
  WITH CHECK (true);

-- 4. SECURITY DEFINER by-token lookup owned by jarvis_auth_runtime.
--    Allows AuthSessionResolver (running as jarvis_app_runtime) to verify a bearer token
--    without holding any direct privilege on the table.
--    Returns only the actor user_id — never the token/session secrets.

CREATE OR REPLACE FUNCTION app.resolve_auth_session(p_session_id uuid)
  RETURNS TABLE(user_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
  SELECT user_id FROM auth_sessions WHERE id = p_session_id AND expires_at > now()
$$;

-- Temporary CREATE grant enables the ALTER OWNER below (PostgreSQL requirement).
GRANT CREATE ON SCHEMA app TO jarvis_auth_runtime;

-- Transfer ownership: migration_owner is a member of jarvis_auth_runtime (bootstrap),
-- satisfying PostgreSQL's "current user must be member of new owner" requirement.
ALTER FUNCTION app.resolve_auth_session(uuid) OWNER TO jarvis_auth_runtime;

-- Remove the temporary CREATE grant; jarvis_auth_runtime retains function ownership.
REVOKE CREATE ON SCHEMA app FROM jarvis_auth_runtime;

-- Act as jarvis_auth_runtime (which now owns the function) to lock down execute access.
SET LOCAL ROLE jarvis_auth_runtime;
REVOKE EXECUTE ON FUNCTION app.resolve_auth_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_auth_session(uuid) TO jarvis_app_runtime;
RESET ROLE;

-- 5. Enable and force RLS on auth_verifications (REVOKE already done in 0045).
ALTER TABLE app.auth_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_verifications FORCE ROW LEVEL SECURITY;

-- 6. Policy — auth_verifications: only jarvis_auth_runtime.
--    jarvis_auth_runtime already holds SELECT, INSERT, UPDATE, DELETE from 0045.
DROP POLICY IF EXISTS auth_verifications_auth_runtime ON app.auth_verifications;
CREATE POLICY auth_verifications_auth_runtime
  ON app.auth_verifications
  FOR ALL
  TO jarvis_auth_runtime
  USING (true)
  WITH CHECK (true);
