-- Personal skill library (#760). Owner-only, no sharing/marketplace — mirrors
-- app.wellness_checkins RLS shape, not app.chat_threads (no share/workspace triggers needed).

CREATE TABLE IF NOT EXISTS app.chat_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  frontmatter jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL CHECK (source IN ('authored', 'uploaded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_skills_owner_idx
  ON app.chat_skills (owner_user_id, enabled, updated_at DESC);

ALTER TABLE app.chat_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_skills FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_skills_select ON app.chat_skills;
CREATE POLICY chat_skills_select ON app.chat_skills
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_skills_insert ON app.chat_skills;
CREATE POLICY chat_skills_insert ON app.chat_skills
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_skills_update ON app.chat_skills;
CREATE POLICY chat_skills_update ON app.chat_skills
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS chat_skills_delete ON app.chat_skills;
CREATE POLICY chat_skills_delete ON app.chat_skills
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.chat_skills TO jarvis_app_runtime;
