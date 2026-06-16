-- Shared memory corrections/suppressions store.
-- #243 writes reason='rejected' rows when an inferred chat_memory_fact is rejected.
-- #244 corrections-log will extend/reuse this table instead of creating a parallel store.

CREATE TABLE IF NOT EXISTS app.chat_memory_suppressions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  signature     TEXT        NOT NULL,
  category      TEXT        NOT NULL CHECK (category IN ('preference', 'fact', 'profile', 'goal')),
  content       TEXT        NOT NULL,
  reason        TEXT        NOT NULL CHECK (reason IN ('rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, signature)
);

CREATE INDEX IF NOT EXISTS chat_memory_suppressions_owner_idx
  ON app.chat_memory_suppressions (owner_user_id, created_at DESC);

ALTER TABLE app.chat_memory_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_memory_suppressions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_memory_suppressions_select ON app.chat_memory_suppressions;
CREATE POLICY chat_memory_suppressions_select ON app.chat_memory_suppressions
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_suppressions_insert ON app.chat_memory_suppressions;
CREATE POLICY chat_memory_suppressions_insert ON app.chat_memory_suppressions
  FOR INSERT TO jarvis_app_runtime, jarvis_worker_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT ON app.chat_memory_suppressions TO jarvis_app_runtime;
GRANT SELECT, INSERT ON app.chat_memory_suppressions TO jarvis_worker_runtime;
