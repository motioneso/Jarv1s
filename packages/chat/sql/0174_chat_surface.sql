-- JS-00: isolate live chat conversations by host surface while keeping existing
-- rows and the drawer's behavior as the default.
ALTER TABLE app.chat_threads
  ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'drawer';

ALTER TABLE app.chat_threads
  ADD CONSTRAINT chat_threads_surface_format
  CHECK (surface ~ '^[a-z][a-z0-9-]{1,31}$');

CREATE INDEX IF NOT EXISTS chat_threads_owner_surface_last_active_idx
  ON app.chat_threads (owner_user_id, surface, last_active_at DESC);

DROP FUNCTION app.list_incognito_chat_threads_for_cleanup();

CREATE FUNCTION app.list_incognito_chat_threads_for_cleanup()
RETURNS TABLE(actor_user_id uuid, thread_id uuid, surface text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT owner_user_id, id, surface
  FROM app.chat_threads
  WHERE incognito = true
  ORDER BY last_active_at, id
$$;

REVOKE ALL ON FUNCTION app.list_incognito_chat_threads_for_cleanup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_incognito_chat_threads_for_cleanup() TO jarvis_app_runtime;
