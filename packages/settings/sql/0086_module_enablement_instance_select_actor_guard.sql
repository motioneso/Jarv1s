-- Defense-in-depth consistency: add the `current_actor_user_id() IS NOT NULL` guard
-- to the instance-scope SELECT policy on app.module_enablement.
--
-- Migration 0065 shipped the instance SELECT policy as `USING (scope = 'instance')`
-- with no actor-presence guard, while every other policy on the table (the user-scope
-- SELECT/INSERT/UPDATE/DELETE) requires `current_actor_user_id() IS NOT NULL`. Without
-- the guard an authed runtime connection with NO actor context set (the GUC unset, so
-- `current_actor_user_id()` returns NULL) could still read the instance deny-list floor.
-- This is not a cross-user leak (instance rows are the same admin-controlled floor for
-- every actor and carry no private data), but the inconsistency is exactly the kind of
-- gap that erodes the "every policy gates on a present actor" invariant the rest of the
-- table — and the codebase — relies on. Legitimate request-scoped reads always run with
-- the actor GUC set (withDataContext), so this is byte-for-byte behavior-preserving for
-- real traffic; it only fails closed for an actor-less connection.
--
-- 0065 is already applied (hash-checked), so this is a NEW migration that DROPs and
-- re-CREATEs the policy rather than editing the original. Both runtime grant targets
-- (jarvis_app_runtime, jarvis_worker_runtime) are preserved exactly as in 0065.

DROP POLICY IF EXISTS module_enablement_instance_select ON app.module_enablement;
CREATE POLICY module_enablement_instance_select ON app.module_enablement
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND scope = 'instance'
  );
