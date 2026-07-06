-- packages/sports/sql/0133_sports_follows.sql
-- Owner-only, user-private follow list. RLS classification: owner-only (== app.wellness_checkins).
-- A row with team_key = NULL means "follow the whole competition".

CREATE TABLE IF NOT EXISTS app.sports_follows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  competition_key text NOT NULL,
  team_key        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- NOTE: Postgres treats NULL as distinct in a UNIQUE constraint, so two identical
  -- whole-competition follows (owner, 'nfl', NULL) are NOT deduped here. The repository
  -- guards whole-competition duplicates with an explicit existence check before insert.
  -- Do not add NULLS NOT DISTINCT (raises the PG version floor).
  UNIQUE (owner_user_id, competition_key, team_key)
);

CREATE INDEX IF NOT EXISTS sports_follows_owner_idx
  ON app.sports_follows (owner_user_id, created_at DESC);

ALTER TABLE app.sports_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sports_follows FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sports_follows_select ON app.sports_follows;
CREATE POLICY sports_follows_select ON app.sports_follows
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS sports_follows_insert ON app.sports_follows;
CREATE POLICY sports_follows_insert ON app.sports_follows
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS sports_follows_update ON app.sports_follows;
CREATE POLICY sports_follows_update ON app.sports_follows
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS sports_follows_delete ON app.sports_follows;
CREATE POLICY sports_follows_delete ON app.sports_follows
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.sports_follows TO jarvis_app_runtime;
