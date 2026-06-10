-- Fix: grant EXECUTE on app.current_actor_user_id() to jarvis_auth_runtime.
--
-- app.current_actor_is_admin() (0050) is SECURITY DEFINER owned by jarvis_auth_runtime.
-- SECURITY DEFINER functions execute with the owner's privilege set, so jarvis_auth_runtime
-- needs EXECUTE on current_actor_user_id() for the function to call it. This was omitted
-- from 0050 and caused a "permission denied for function current_actor_user_id" error when
-- the admin-scoped UPDATE policy evaluated current_actor_is_admin().
GRANT EXECUTE ON FUNCTION app.current_actor_user_id() TO jarvis_auth_runtime;
