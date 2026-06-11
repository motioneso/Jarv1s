-- Replace count_all_users() bootstrap exemption with admin-existence check (#97).
--
-- The 0053 exemption (count_all_users() = 1) is overly narrow: it only permits the
-- first admin promotion when exactly one user exists. A legitimate recovery scenario
-- also exists when all admins have been removed — the system needs to allow any user
-- to reclaim the admin role in that state.
--
-- Fix: block self-escalation only when at least one admin already exists. Bootstrap
-- and admin-recovery are both the same condition — no active admins present.
--
-- app.any_admin_exists() is a SECURITY DEFINER helper so it can bypass RLS on
-- app.users. The trigger itself stays SECURITY INVOKER (it must call
-- current_actor_user_id() and current_actor_is_admin(), which are only granted to
-- the app/worker runtime roles, not to the function owner). The helper performs a
-- simple read-only existence check — elevated privilege is narrowly scoped.

CREATE OR REPLACE FUNCTION app.any_admin_exists()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT EXISTS (SELECT 1 FROM app.users WHERE is_instance_admin = true);
$$;

GRANT EXECUTE ON FUNCTION app.any_admin_exists()
  TO jarvis_app_runtime, jarvis_worker_runtime, jarvis_auth_runtime;

CREATE OR REPLACE FUNCTION app.users_guard_admin_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, public
AS $$
BEGIN
  IF NEW.is_instance_admin IS DISTINCT FROM OLD.is_instance_admin
     AND app.current_actor_user_id() IS NOT NULL
     AND NOT app.current_actor_is_admin()
     AND app.any_admin_exists()
  THEN
    RAISE EXCEPTION 'permission denied: only an active admin may change is_instance_admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
