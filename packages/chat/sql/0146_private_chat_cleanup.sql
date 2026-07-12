-- #744: private chat rows are live-session bookkeeping, not history. Cleanup must
-- delete owner-scoped incognito rows and, after an API restart, discover orphaned
-- incognito rows even though normal chat RLS is owner-only.

REVOKE DELETE ON app.chat_threads FROM jarvis_app_runtime;

DROP POLICY IF EXISTS chat_threads_private_cleanup_list ON app.chat_threads;
CREATE POLICY chat_threads_private_cleanup_list
ON app.chat_threads
FOR SELECT
TO jarvis_migration_owner
USING (true);

DROP POLICY IF EXISTS chat_threads_private_cleanup_delete ON app.chat_threads;
CREATE POLICY chat_threads_private_cleanup_delete
ON app.chat_threads
FOR DELETE
TO jarvis_migration_owner
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND incognito = true
);

CREATE OR REPLACE FUNCTION app.list_incognito_chat_threads_for_cleanup()
RETURNS TABLE(actor_user_id uuid, thread_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT owner_user_id, id
  FROM app.chat_threads
  WHERE incognito = true
  ORDER BY last_active_at, id
$$;

REVOKE ALL ON FUNCTION app.list_incognito_chat_threads_for_cleanup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_incognito_chat_threads_for_cleanup() TO jarvis_app_runtime;

CREATE OR REPLACE FUNCTION app.delete_incognito_chat_thread_for_cleanup(p_thread_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  DELETE FROM app.chat_threads
  WHERE id = p_thread_id
    AND owner_user_id = app.current_actor_user_id()
    AND incognito = true
$$;

REVOKE ALL ON FUNCTION app.delete_incognito_chat_thread_for_cleanup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_incognito_chat_thread_for_cleanup(uuid)
  TO jarvis_app_runtime;
