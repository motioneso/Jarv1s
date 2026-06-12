-- OTNR #168 P27 (MED): add FK-covering index for chat_memory_facts.source_thread_id.
--
-- source_thread_id is a nullable FK → app.chat_threads (added in 0041_memory_facts.sql).
-- Partial index covers only non-NULL rows (the common lookup path: find facts for a thread).
-- The WHERE clause keeps the index small — NULL rows (facts from other sources) are excluded.

CREATE INDEX IF NOT EXISTS chat_memory_facts_source_thread_idx
  ON app.chat_memory_facts (source_thread_id) WHERE source_thread_id IS NOT NULL;
