-- Notes sync records its heartbeat in app.preferences from the worker process.
-- 0093 allowed worker SELECT only for briefing reads; notes-last-sync needs an
-- owner-scoped upsert after the ingest transaction commits or rolls back.

GRANT INSERT, UPDATE ON app.preferences TO jarvis_worker_runtime;

DROP POLICY IF EXISTS preferences_worker_insert ON app.preferences;
CREATE POLICY preferences_worker_insert ON app.preferences
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS preferences_worker_update ON app.preferences;
CREATE POLICY preferences_worker_update ON app.preferences
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
