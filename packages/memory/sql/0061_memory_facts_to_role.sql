-- Batch 1 (audit remediation): add the missing `TO <role>` targeting to the
-- chat_memory_facts RLS policies (OTNR-P1 #117, OTNR-P12 #146).
--
-- The policies created in 0041 omit a `TO` clause, so they apply to PUBLIC. This is
-- defense-in-depth only — no active bypass — because every predicate also requires
-- app.current_actor_user_id() AND the table GRANT is held only by the runtime roles.
-- chat_memory_facts is granted to BOTH the app and worker runtime roles (the worker
-- extracts facts), so both are named here. Predicates are unchanged.

DROP POLICY IF EXISTS chat_memory_facts_select ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_select ON app.chat_memory_facts
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_facts_insert ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_insert ON app.chat_memory_facts
  FOR INSERT TO jarvis_app_runtime, jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_facts_update ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_update ON app.chat_memory_facts
  FOR UPDATE TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_facts_delete ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_delete ON app.chat_memory_facts
  FOR DELETE TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
