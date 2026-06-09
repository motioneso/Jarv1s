-- Widen the source_kind CHECK on memory_chunks and memory_file_index to allow
-- 'chat', and grant jarvis_worker_runtime access (required for recall embed jobs).
-- The worker previously had no grants on these tables — same trap as chat pre-#17/#36.

ALTER TABLE app.memory_chunks DROP CONSTRAINT IF EXISTS memory_chunks_source_kind_check;
ALTER TABLE app.memory_chunks
  ADD CONSTRAINT memory_chunks_source_kind_check
  CHECK (source_kind IN ('vault', 'connector', 'chat'));

ALTER TABLE app.memory_file_index DROP CONSTRAINT IF EXISTS memory_file_index_source_kind_check;
ALTER TABLE app.memory_file_index
  ADD CONSTRAINT memory_file_index_source_kind_check
  CHECK (source_kind IN ('vault', 'connector', 'chat'));

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_chunks TO jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_file_index TO jarvis_worker_runtime;
GRANT SELECT ON app.memory_links TO jarvis_worker_runtime;
