-- Batch 1 (audit remediation): add the missing `TO <role>` targeting to the
-- chat_user_memory_settings RLS policies (OTNR-P1 #117).
--
-- The policies created in 0042 omit a `TO` clause, so they apply to PUBLIC. This is
-- defense-in-depth only — no active bypass — because every predicate also requires
-- app.current_actor_user_id() AND the table GRANT is held only by jarvis_app_runtime.
-- This migration recreates them targeted at the runtime role, matching the rest of the
-- codebase's policy style. Predicates are unchanged.

DROP POLICY IF EXISTS chat_memory_settings_select ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_select ON app.chat_user_memory_settings
  FOR SELECT TO jarvis_app_runtime
  USING (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_settings_insert ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_insert ON app.chat_user_memory_settings
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_settings_update ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_update ON app.chat_user_memory_settings
  FOR UPDATE TO jarvis_app_runtime
  USING (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_settings_delete ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_delete ON app.chat_user_memory_settings
  FOR DELETE TO jarvis_app_runtime
  USING (user_id = app.current_actor_user_id());
