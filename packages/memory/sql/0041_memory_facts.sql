-- LLM-extracted facts about the user (preferences, profile, goals).
-- Always-loaded at session launch alongside episodic recall chunks.

CREATE TABLE IF NOT EXISTS app.chat_memory_facts (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID         NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  category         TEXT         NOT NULL CHECK (category IN ('preference', 'fact', 'profile', 'goal')),
  content          TEXT         NOT NULL,
  source_thread_id UUID         REFERENCES app.chat_threads(id) ON DELETE SET NULL,
  importance       NUMERIC(3,2) NOT NULL DEFAULT 0.50
                                CHECK (importance BETWEEN 0.00 AND 1.00),
  status           TEXT         NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'superseded')),
  superseded_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_memory_facts_owner_idx
  ON app.chat_memory_facts (owner_user_id);

CREATE INDEX IF NOT EXISTS chat_memory_facts_status_idx
  ON app.chat_memory_facts (owner_user_id, status);

ALTER TABLE app.chat_memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_memory_facts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_memory_facts_select ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_select ON app.chat_memory_facts
  FOR SELECT USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_facts_insert ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_insert ON app.chat_memory_facts
  FOR INSERT WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_facts_update ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_update ON app.chat_memory_facts
  FOR UPDATE USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_facts_delete ON app.chat_memory_facts;
CREATE POLICY chat_memory_facts_delete ON app.chat_memory_facts
  FOR DELETE USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_memory_facts TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_memory_facts TO jarvis_worker_runtime;
