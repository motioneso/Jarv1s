-- Feelings check-ins. Multiple rows per day are expected (timestamped, NOT one-per-day).
-- Owner-only (no share, no admin data read), mirroring app.preferences.

DO $$ BEGIN
  CREATE TYPE app.wellness_feeling_core AS ENUM
    ('mad', 'sad', 'scared', 'joyful', 'powerful', 'peaceful');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app.wellness_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  feeling_core app.wellness_feeling_core NOT NULL,
  feeling_secondary text,
  feeling_tertiary text,
  wheel_version text NOT NULL DEFAULT 'willcox-1982',
  sensations text[] NOT NULL DEFAULT '{}',
  -- `intensity` = how STRONG the feeling is (1–5). It is NOT a readiness/energy proxy.
  intensity smallint CHECK (intensity BETWEEN 1 AND 5),
  -- `energy` = self-rated readiness/energy (1 = depleted, 5 = energized). This is the
  -- ONLY field the focus-signal readiness derivation reads; a low-intensity calm feeling
  -- must NOT imply low readiness (Codex R1 finding: do not conflate emotion with energy).
  energy smallint CHECK (energy BETWEEN 1 AND 5),
  note text,
  identified_via text NOT NULL DEFAULT 'wheel'
    CHECK (identified_via IN ('wheel', 'assisted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wellness_checkins_owner_time_idx
  ON app.wellness_checkins (owner_user_id, checked_in_at DESC);

ALTER TABLE app.wellness_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.wellness_checkins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wellness_checkins_select ON app.wellness_checkins;
CREATE POLICY wellness_checkins_select ON app.wellness_checkins
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_checkins_insert ON app.wellness_checkins;
CREATE POLICY wellness_checkins_insert ON app.wellness_checkins
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_checkins_update ON app.wellness_checkins;
CREATE POLICY wellness_checkins_update ON app.wellness_checkins
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_checkins_delete ON app.wellness_checkins;
CREATE POLICY wellness_checkins_delete ON app.wellness_checkins
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.wellness_checkins TO jarvis_app_runtime;
