-- M-A1: widen embeddings to 768 dims (nomic-embed-text-v1.5), add model provenance,
-- and add a file-level ingestion checkpoint table for idempotent/incremental ingest.
-- memory_chunks is derived/rebuildable, so truncating to change vector width is safe.

-- HNSW index must be dropped before altering the vector dimension.
DROP INDEX IF EXISTS app.memory_chunks_embedding_idx;

-- Truncate derived data (fully rebuilt by ingestion).
TRUNCATE TABLE app.memory_chunks;
TRUNCATE TABLE app.memory_links;

ALTER TABLE app.memory_chunks
  ALTER COLUMN embedding TYPE vector(768);

ALTER TABLE app.memory_chunks
  ADD COLUMN IF NOT EXISTS embed_model_name    text,
  ADD COLUMN IF NOT EXISTS embed_model_version text;

CREATE INDEX memory_chunks_embedding_idx
  ON app.memory_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.memory_file_index (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_kind         text        NOT NULL CHECK (source_kind IN ('vault', 'connector')),
  source_path         text        NOT NULL,
  file_hash           text        NOT NULL,
  chunk_count         integer     NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  embed_model_name    text        NOT NULL,
  embed_model_version text        NOT NULL,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, source_kind, source_path)
);

CREATE INDEX IF NOT EXISTS memory_file_index_owner_idx
  ON app.memory_file_index (owner_user_id, source_kind);

ALTER TABLE app.memory_file_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_file_index FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_file_index_select ON app.memory_file_index;
CREATE POLICY memory_file_index_select ON app.memory_file_index
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_insert ON app.memory_file_index;
CREATE POLICY memory_file_index_insert ON app.memory_file_index
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_update ON app.memory_file_index;
CREATE POLICY memory_file_index_update ON app.memory_file_index
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_file_index_delete ON app.memory_file_index;
CREATE POLICY memory_file_index_delete ON app.memory_file_index
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_file_index TO jarvis_app_runtime;
