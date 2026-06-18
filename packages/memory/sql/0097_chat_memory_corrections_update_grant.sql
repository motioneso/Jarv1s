-- Corrections can upgrade an existing suppressed signature into a corrected log row.
-- Keep UPDATE owner-only for both app and worker runtimes.

DROP POLICY IF EXISTS chat_memory_suppressions_update ON app.chat_memory_suppressions;
CREATE POLICY chat_memory_suppressions_update ON app.chat_memory_suppressions
  FOR UPDATE TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT UPDATE ON app.chat_memory_suppressions TO jarvis_app_runtime;
GRANT UPDATE ON app.chat_memory_suppressions TO jarvis_worker_runtime;
