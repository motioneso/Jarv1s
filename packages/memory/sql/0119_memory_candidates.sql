-- Memory distillation candidate store (#529).
-- Owner-scoped pending/promoted/rejected candidates; graph writes stay in graph repositories.

CREATE TABLE IF NOT EXISTS app.memory_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  episode_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('entity', 'fact', 'alias', 'supersession', 'conflict')),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'link', 'supersede', 'reject')),
  payload_json JSONB NOT NULL,
  candidate_signature TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'promoted', 'rejected', 'merged', 'suppressed')
  ),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0.000 AND 1.000),
  importance NUMERIC(4,3) NOT NULL CHECK (importance BETWEEN 0.000 AND 1.000),
  provenance TEXT NOT NULL CHECK (provenance IN ('volunteered', 'inferred')),
  promotion_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (owner_user_id, id),
  UNIQUE (owner_user_id, candidate_signature),
  FOREIGN KEY (owner_user_id, episode_id)
    REFERENCES app.memory_episodes(owner_user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS memory_candidates_owner_status_idx
  ON app.memory_candidates (owner_user_id, status, created_at DESC);

ALTER TABLE app.memory_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_candidates_owner ON app.memory_candidates;
CREATE POLICY memory_candidates_owner ON app.memory_candidates
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_candidates TO jarvis_app_runtime, jarvis_worker_runtime;
