-- Confidence-aware memory records (#532).
-- Additive graph-memory metadata; owner scoped with FORCE RLS.

CREATE TABLE IF NOT EXISTS app.memory_conflict_groups (
  owner_user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (owner_user_id, id)
);

ALTER TABLE app.memory_facts
  ADD COLUMN IF NOT EXISTS record_kind TEXT NOT NULL DEFAULT 'fact',
  ADD COLUMN IF NOT EXISTS stale_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_fact_id UUID,
  ADD COLUMN IF NOT EXISTS conflict_group_id UUID;

ALTER TABLE app.memory_facts
  DROP CONSTRAINT IF EXISTS memory_facts_status_check,
  ADD CONSTRAINT memory_facts_status_check CHECK (
    status IN ('active', 'stale', 'expired', 'superseded', 'rejected', 'conflicting')
  );

ALTER TABLE app.memory_facts
  DROP CONSTRAINT IF EXISTS memory_facts_record_kind_check,
  ADD CONSTRAINT memory_facts_record_kind_check CHECK (
    record_kind IN (
      'fact',
      'preference',
      'goal',
      'constraint',
      'decision',
      'relationship',
      'alias',
      'inference'
    )
  );

ALTER TABLE app.memory_facts
  DROP CONSTRAINT IF EXISTS memory_facts_superseded_by_owner_fk,
  ADD CONSTRAINT memory_facts_superseded_by_owner_fk
    FOREIGN KEY (owner_user_id, superseded_by_fact_id)
    REFERENCES app.memory_facts(owner_user_id, id),
  DROP CONSTRAINT IF EXISTS memory_facts_conflict_group_owner_fk,
  ADD CONSTRAINT memory_facts_conflict_group_owner_fk
    FOREIGN KEY (owner_user_id, conflict_group_id)
    REFERENCES app.memory_conflict_groups(owner_user_id, id);

CREATE INDEX IF NOT EXISTS memory_facts_owner_conflict_idx
  ON app.memory_facts (owner_user_id, conflict_group_id)
  WHERE conflict_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS memory_facts_owner_stale_idx
  ON app.memory_facts (owner_user_id, stale_at)
  WHERE stale_at IS NOT NULL;

ALTER TABLE app.memory_conflict_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.memory_conflict_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_conflict_groups_owner ON app.memory_conflict_groups;
CREATE POLICY memory_conflict_groups_owner ON app.memory_conflict_groups
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.memory_conflict_groups TO jarvis_app_runtime, jarvis_worker_runtime;
