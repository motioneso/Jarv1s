-- Add jarvis_worker_runtime RLS policies on memory tables (#98).
--
-- Migration 0040 granted jarvis_worker_runtime full DML on memory_chunks and
-- memory_file_index, and SELECT on memory_links — required for recall embed jobs.
-- No matching RLS policies were added in 0040, so FORCE RLS silently denies every
-- worker write. This migration adds the missing policies, mirroring the existing
-- jarvis_app_runtime policies with the same owner_user_id = current_actor_user_id()
-- predicate.

-- memory_chunks (mirrors app_runtime policies from 0030)
DROP POLICY IF EXISTS memory_chunks_worker_select ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_select ON app.memory_chunks
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_worker_insert ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_insert ON app.memory_chunks
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_worker_update ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_update ON app.memory_chunks
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_worker_delete ON app.memory_chunks;
CREATE POLICY memory_chunks_worker_delete ON app.memory_chunks
  FOR DELETE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- memory_file_index (mirrors app_runtime policies from 0032)
DROP POLICY IF EXISTS memory_file_index_worker_select ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_select ON app.memory_file_index
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_worker_insert ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_insert ON app.memory_file_index
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_worker_update ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_update ON app.memory_file_index
  FOR UPDATE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_worker_delete ON app.memory_file_index;
CREATE POLICY memory_file_index_worker_delete ON app.memory_file_index
  FOR DELETE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- memory_links (SELECT only — 0040 gave worker only SELECT on links)
DROP POLICY IF EXISTS memory_links_worker_select ON app.memory_links;
CREATE POLICY memory_links_worker_select ON app.memory_links
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
