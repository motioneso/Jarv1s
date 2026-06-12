-- Guard app.users.is_instance_admin against non-admin self-escalation (#97).
--
-- The existing self-row UPDATE policy (users_app_runtime_update, 0045) checks only
-- id = current_actor_user_id() — no column restriction. A non-admin user can therefore
-- UPDATE their own row and set is_instance_admin = true. This trigger closes that gap by
-- rejecting any change to is_instance_admin unless the actor is an active admin.
--
-- NULL guard: the trigger short-circuits when no actor GUC is set (migration/direct-DB
-- paths), as those run outside the app_runtime security boundary.
--
-- Bootstrap exemption: bootstrapFirstJarvisUser() (packages/auth/src/index.ts) sets the
-- actor GUC to the new user's ID before calling the UPDATE so the self-row RLS policy
-- passes. At that moment the user is not yet an admin, so without an exemption the
-- trigger would block the legitimate first-user bootstrap. The exemption is safe: it
-- fires only when count_all_users() = 1, i.e. exactly one user exists — the bootstrap
-- user being promoted. Post-bootstrap the count is always > 1, so the exemption is
-- unreachable through the normal signup flow.
--
-- Mirrors the pattern planned for #135 (incognito flag immutability via trigger).

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
     -- Bootstrap self-promotion: only 1 user exists (first-user context)
     AND NOT (NEW.is_instance_admin = true AND app.count_all_users() = 1)
  THEN
    RAISE EXCEPTION 'permission denied: only an active admin may change is_instance_admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_guard_admin_flag ON app.users;
CREATE TRIGGER users_guard_admin_flag
  BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.users_guard_admin_flag();
