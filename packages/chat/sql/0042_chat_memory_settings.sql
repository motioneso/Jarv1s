-- Per-user memory settings (recall on/off, facts on/off).
-- Also adds the incognito flag to chat_threads for temporary/private chats.

CREATE TABLE IF NOT EXISTS app.chat_user_memory_settings (
  user_id        UUID        PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  recall_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  facts_enabled  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app.chat_user_memory_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_user_memory_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_memory_settings_select ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_select ON app.chat_user_memory_settings
  FOR SELECT USING (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_settings_insert ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_insert ON app.chat_user_memory_settings
  FOR INSERT WITH CHECK (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_settings_update ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_update ON app.chat_user_memory_settings
  FOR UPDATE USING (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_memory_settings_delete ON app.chat_user_memory_settings;
CREATE POLICY chat_memory_settings_delete ON app.chat_user_memory_settings
  FOR DELETE USING (user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_user_memory_settings TO jarvis_app_runtime;

-- Add incognito flag to chat_threads. Immutable once set; default false.
-- Incognito threads are never embedded and never recalled into.
ALTER TABLE app.chat_threads ADD COLUMN IF NOT EXISTS incognito BOOLEAN NOT NULL DEFAULT FALSE;
