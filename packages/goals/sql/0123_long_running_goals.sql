CREATE TABLE IF NOT EXISTS app.jarvis_goals (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) <= 160),
  desired_outcome text NOT NULL CHECK (length(desired_outcome) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'blocked', 'completed', 'archived')),
  priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  review_cadence text NOT NULL DEFAULT 'weekly' CHECK (review_cadence IN ('none', 'daily', 'weekly', 'biweekly', 'monthly', 'custom')),
  next_review_at timestamptz,
  target_at timestamptz,
  last_progress_summary text CHECK (last_progress_summary IS NULL OR length(last_progress_summary) <= 1000),
  last_progress_at timestamptz,
  blocker_summary text CHECK (blocker_summary IS NULL OR length(blocker_summary) <= 1000),
  next_suggested_action text CHECK (next_suggested_action IS NULL OR length(next_suggested_action) <= 1000),
  memory_synced_at timestamptz,
  memory_synced_goal_updated_at timestamptz,
  memory_sync_error_class text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  archived_at timestamptz,
  UNIQUE (owner_user_id, id)
);

CREATE TABLE IF NOT EXISTS app.jarvis_goal_evidence (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('context', 'task', 'status', 'progress', 'blocker', 'decision', 'checkpoint', 'suggested_action')),
  source_kind text NOT NULL CHECK (source_kind IN ('goal', 'task', 'note', 'email', 'calendar', 'chat', 'memory', 'manual')),
  source_ref text,
  source_label text NOT NULL CHECK (length(source_label) <= 200),
  summary text NOT NULL CHECK (length(summary) <= 1000),
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id, goal_id) REFERENCES app.jarvis_goals(owner_user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS jarvis_goal_evidence_owner_goal_idx ON app.jarvis_goal_evidence (owner_user_id, goal_id);

CREATE OR REPLACE FUNCTION app.jarvis_goals_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Internal sync fields do not bump updated_at, but we only trigger when other fields change
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jarvis_goals_updated_at ON app.jarvis_goals;
CREATE TRIGGER jarvis_goals_updated_at BEFORE UPDATE ON app.jarvis_goals
  FOR EACH ROW
  WHEN (
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.desired_outcome IS DISTINCT FROM OLD.desired_outcome OR
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.priority IS DISTINCT FROM OLD.priority OR
    NEW.review_cadence IS DISTINCT FROM OLD.review_cadence OR
    NEW.next_review_at IS DISTINCT FROM OLD.next_review_at OR
    NEW.target_at IS DISTINCT FROM OLD.target_at OR
    NEW.last_progress_summary IS DISTINCT FROM OLD.last_progress_summary OR
    NEW.last_progress_at IS DISTINCT FROM OLD.last_progress_at OR
    NEW.blocker_summary IS DISTINCT FROM OLD.blocker_summary OR
    NEW.next_suggested_action IS DISTINCT FROM OLD.next_suggested_action OR
    NEW.completed_at IS DISTINCT FROM OLD.completed_at OR
    NEW.archived_at IS DISTINCT FROM OLD.archived_at
  )
  EXECUTE FUNCTION app.jarvis_goals_updated_at();

ALTER TABLE app.jarvis_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_goals FORCE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_goal_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.jarvis_goal_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY jarvis_goals_rw ON app.jarvis_goals FOR ALL
  TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY jarvis_goals_worker_ro ON app.jarvis_goals FOR SELECT
  TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

CREATE POLICY jarvis_goals_worker_upd ON app.jarvis_goals FOR UPDATE
  TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY jarvis_goal_evidence_rw ON app.jarvis_goal_evidence FOR ALL
  TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY jarvis_goal_evidence_worker_ro ON app.jarvis_goal_evidence FOR SELECT
  TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.jarvis_goals TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.jarvis_goal_evidence TO jarvis_app_runtime;

GRANT SELECT, UPDATE ON app.jarvis_goals TO jarvis_worker_runtime;
GRANT SELECT ON app.jarvis_goal_evidence TO jarvis_worker_runtime;
