-- M-A5 Tasks Foundation. Additive. Order matters: create+seed+alter+backfill happen
-- BEFORE RLS is enabled on the new tables; the one backfill that touches the already
-- FORCE-RLS app.tasks uses a transient migration-scoped policy (precedent: shares_internal_select, 0017).

-- 1. New tables (no RLS yet) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.task_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_lists_owner_name_idx
  ON app.task_lists (owner_user_id, lower(name));

CREATE TABLE IF NOT EXISTS app.task_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES app.task_lists(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS task_tags_list_name_idx
  ON app.task_tags (list_id, lower(name));

CREATE TABLE IF NOT EXISTS app.task_tag_assignments (
  task_id uuid NOT NULL REFERENCES app.tasks(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES app.task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

CREATE TABLE IF NOT EXISTS app.task_preferences (
  owner_user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  default_view text NOT NULL DEFAULT 'priority' CHECK (default_view IN ('priority','matrix')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed a Personal list for every user (tables still RLS-free) -------------------
INSERT INTO app.task_lists (owner_user_id, name)
SELECT id, 'Personal' FROM app.users
ON CONFLICT DO NOTHING;

-- 3. Add new columns to app.tasks (nullable for now) ------------------------------
ALTER TABLE app.tasks
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES app.task_lists(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES app.tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS do_at timestamptz,
  ADD COLUMN IF NOT EXISTS effort text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS external_key text,
  ADD COLUMN IF NOT EXISTS recurrence jsonb,
  ADD COLUMN IF NOT EXISTS recurrence_series_id uuid;

-- 4. Backfill app.tasks under a transient migration policy ------------------------
CREATE POLICY tasks_migration_backfill ON app.tasks
  TO jarvis_migration_owner USING (true) WITH CHECK (true);

UPDATE app.tasks t
  SET list_id = l.id
  FROM app.task_lists l
  WHERE l.owner_user_id = t.owner_user_id AND l.name = 'Personal' AND t.list_id IS NULL;

UPDATE app.tasks SET status = 'todo' WHERE status = 'in_progress';

UPDATE app.tasks
  SET priority = NULL
  WHERE priority IS NOT NULL AND (priority < 1 OR priority > 5);

DROP POLICY tasks_migration_backfill ON app.tasks;

-- 5. Constrain app.tasks ----------------------------------------------------------
ALTER TABLE app.tasks ALTER COLUMN list_id SET NOT NULL;
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_priority_range CHECK (priority IS NULL OR priority BETWEEN 1 AND 5),
  ADD CONSTRAINT tasks_effort_values CHECK (effort IS NULL OR effort IN ('quick','medium','large'));

CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_external_key_idx
  ON app.tasks (owner_user_id, source, external_key) WHERE external_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tasks_recurrence_occurrence_idx
  ON app.tasks (recurrence_series_id, (recurrence->>'occurrence_date'))
  WHERE recurrence_series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_drift_idx
  ON app.tasks (owner_user_id, status, priority, due_at);
CREATE INDEX IF NOT EXISTS tasks_parent_position_idx
  ON app.tasks (parent_task_id, position);

-- 6. Triggers ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tasks_hierarchy_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    IF NEW.parent_task_id = NEW.id THEN
      RAISE EXCEPTION 'task cannot be its own parent';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tasks p WHERE p.id = NEW.parent_task_id AND p.parent_task_id IS NOT NULL) THEN
      RAISE EXCEPTION 'subtasks may not have children (one-level hierarchy)';
    END IF;
    IF EXISTS (SELECT 1 FROM app.tasks p WHERE p.id = NEW.parent_task_id AND p.recurrence IS NOT NULL) THEN
      RAISE EXCEPTION 'a recurring task may not be a parent';
    END IF;
  END IF;
  IF NEW.recurrence IS NOT NULL
     AND EXISTS (SELECT 1 FROM app.tasks c WHERE c.parent_task_id = NEW.id) THEN
    RAISE EXCEPTION 'a recurring task may not be a parent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_hierarchy_guard ON app.tasks;
CREATE TRIGGER tasks_hierarchy_guard BEFORE INSERT OR UPDATE ON app.tasks
  FOR EACH ROW EXECUTE FUNCTION app.tasks_hierarchy_guard();

CREATE OR REPLACE FUNCTION app.task_tag_list_match() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.tasks t JOIN app.task_tags g ON g.id = NEW.tag_id
    WHERE t.id = NEW.task_id AND g.list_id = t.list_id
  ) THEN
    RAISE EXCEPTION 'tag must belong to the task''s list';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS task_tag_list_match ON app.task_tag_assignments;
CREATE TRIGGER task_tag_list_match BEFORE INSERT OR UPDATE ON app.task_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION app.task_tag_list_match();

-- 7. Enable RLS + policies + grants on new tables ---------------------------------
ALTER TABLE app.task_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_lists FORCE ROW LEVEL SECURITY;
ALTER TABLE app.task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE app.task_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_tag_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE app.task_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.task_preferences FORCE ROW LEVEL SECURITY;

-- task_lists: owner-only (forward-compatible with a future has_share('list',...) disjunct)
CREATE POLICY task_lists_rw ON app.task_lists FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY task_tags_rw ON app.task_tags FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

-- assignments gated on parent-task visibility (mirrors task_activity pattern)
CREATE POLICY task_tag_assignments_rw ON app.task_tag_assignments FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id))
  WITH CHECK (EXISTS (SELECT 1 FROM app.tasks t WHERE t.id = task_id));

CREATE POLICY task_preferences_rw ON app.task_preferences FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_lists TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_tags TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_tag_assignments TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.task_preferences TO jarvis_app_runtime;
GRANT SELECT ON app.task_lists TO jarvis_worker_runtime;
GRANT SELECT ON app.task_tags TO jarvis_worker_runtime;
GRANT SELECT ON app.task_tag_assignments TO jarvis_worker_runtime;
GRANT SELECT ON app.task_preferences TO jarvis_worker_runtime;

-- 8. task_activity gains actor_kind ----------------------------------------------
ALTER TABLE app.task_activity
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'user'
  CHECK (actor_kind IN ('user','jarvis','system'));
