-- Notes sync runs in jarvis_worker_runtime and calls MemoryRepository.replaceFileLinks
-- for every notes file. 0040/0054 only allowed worker SELECT on memory_links, so
-- the first note containing a wikilink failed with INSERT denied under FORCE RLS.

GRANT INSERT, DELETE ON app.memory_links TO jarvis_worker_runtime;

DROP POLICY IF EXISTS memory_links_worker_insert ON app.memory_links;
CREATE POLICY memory_links_worker_insert ON app.memory_links
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_links_worker_delete ON app.memory_links;
CREATE POLICY memory_links_worker_delete ON app.memory_links
  FOR DELETE TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
