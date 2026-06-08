-- Live chat: track conversation recency (the drawer opens to the most-recent active
-- conversation). Owner-scoped; app_runtime updates it during live turns.
ALTER TABLE app.chat_threads
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS chat_threads_owner_last_active_idx
  ON app.chat_threads (owner_user_id, last_active_at DESC);
