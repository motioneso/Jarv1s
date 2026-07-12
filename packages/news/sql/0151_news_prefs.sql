-- packages/news/sql/0151_news_prefs.sql
-- Owner-only, user-private news preferences. RLS classification: owner-only
-- (same posture as app.sports_follows / app.wellness_checkins).
--
-- One row per preference (spec docs/superpowers/specs/2026-07-08-news-module.md):
--   kind='source'         key=<sourceKey>  → explicit include (any row of this kind replaces
--                                            the catalog defaults as the enabled-source set)
--   kind='source_exclude' key=<sourceKey>  → exclude (applied after includes/defaults)
--   kind='topic'          key=<topicKey>   → restrict feeds to this topic (none = "top" mode)
-- Keys reference the static in-code catalog, never free text shown to other users.

CREATE TABLE IF NOT EXISTS app.news_prefs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('source', 'source_exclude', 'topic')),
  key           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, kind, key)
);

CREATE INDEX IF NOT EXISTS news_prefs_owner_idx
  ON app.news_prefs (owner_user_id, created_at DESC);

ALTER TABLE app.news_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.news_prefs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS news_prefs_select ON app.news_prefs;
CREATE POLICY news_prefs_select ON app.news_prefs
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS news_prefs_insert ON app.news_prefs;
CREATE POLICY news_prefs_insert ON app.news_prefs
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS news_prefs_update ON app.news_prefs;
CREATE POLICY news_prefs_update ON app.news_prefs
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS news_prefs_delete ON app.news_prefs;
CREATE POLICY news_prefs_delete ON app.news_prefs
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.news_prefs TO jarvis_app_runtime;
