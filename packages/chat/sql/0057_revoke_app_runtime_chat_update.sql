-- Revoke the dead UPDATE grant on chat_messages from jarvis_app_runtime.
-- Granted by 0035; no app_runtime code path updates chat messages (only jarvis_worker_runtime does).
REVOKE UPDATE ON app.chat_messages FROM jarvis_app_runtime;

-- Narrow the chat_messages_update RLS policy to worker_runtime only.
-- Recreated (not ALTER) to avoid syntax gotchas; DROP IF EXISTS is safe.
-- The owner-scoped USING/WITH CHECK predicate is PRESERVED VERBATIM from
-- 0036_chat_worker_runtime_grants.sql:58-59 — this ONLY drops jarvis_app_runtime
-- from the role list. Replacing it with USING (true) would let the worker update
-- any user's chat messages regardless of the withDataContext actor, violating the
-- "RLS applies to all actors / private-by-default" hard invariant.
DROP POLICY IF EXISTS chat_messages_update ON app.chat_messages;
CREATE POLICY chat_messages_update ON app.chat_messages
  FOR UPDATE
  TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
