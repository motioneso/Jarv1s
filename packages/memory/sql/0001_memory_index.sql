-- Memory index: derived, rebuildable. Wiping these tables and re-scanning the
-- vault fully reconstructs them. All rows are strictly private (owner-only RLS).

CREATE TABLE IF NOT EXISTS app.memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('vault', 'connector')),
  source_path text NOT NULL,
  line_start integer NOT NULL CHECK (line_start >= 0),
  line_end integer NOT NULL CHECK (line_end >= line_start),
  content_hash text NOT NULL,
  text text NOT NULL,
  embedding vector(384),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_chunks_owner_idx
  ON app.memory_chunks (owner_user_id);

CREATE INDEX IF NOT EXISTS memory_chunks_path_idx
  ON app.memory_chunks (owner_user_id, source_path);

CREATE INDEX IF NOT EXISTS memory_chunks_embedding_idx
  ON app.memory_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.memory_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  from_path text NOT NULL,
  to_path text NOT NULL,
  UNIQUE (owner_user_id, from_path, to_path)
);

CREATE INDEX IF NOT EXISTS memory_links_from_idx
  ON app.memory_links (owner_user_id, from_path);

-- RLS
ALTER TABLE app.memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE app.memory_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_chunks_select ON app.memory_chunks;
CREATE POLICY memory_chunks_select ON app.memory_chunks
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_insert ON app.memory_chunks;
CREATE POLICY memory_chunks_insert ON app.memory_chunks
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_update ON app.memory_chunks;
CREATE POLICY memory_chunks_update ON app.memory_chunks
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_chunks_delete ON app.memory_chunks;
CREATE POLICY memory_chunks_delete ON app.memory_chunks
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_links_select ON app.memory_links;
CREATE POLICY memory_links_select ON app.memory_links
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_links_insert ON app.memory_links;
CREATE POLICY memory_links_insert ON app.memory_links
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS memory_links_delete ON app.memory_links;
CREATE POLICY memory_links_delete ON app.memory_links
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

-- Runtime grants (app runtime only; no worker grants — no worker-driven ingestion in this slice)
GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_chunks TO jarvis_app_runtime;
GRANT SELECT, INSERT, DELETE ON app.memory_links TO jarvis_app_runtime;
