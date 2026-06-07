-- Provenance tracks how Jarvis came to believe something.
DO $$ BEGIN
  CREATE TYPE app.provenance_kind AS ENUM ('volunteered', 'inferred', 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Commitments use a drift-aware lifecycle; recovery states are first-class.
DO $$ BEGIN
  CREATE TYPE app.commitment_status AS ENUM
    ('open', 'at_risk', 'slipped', 'done', 'renegotiated', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.commitment_source_kind AS ENUM ('manual', 'inferred', 'email', 'calendar');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Entity types supported in this slice.
DO $$ BEGIN
  CREATE TYPE app.entity_type AS ENUM ('person', 'organization', 'account');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Commitments ───────────────────────────────────────────────────────────────
-- Open loops: something Jarvis noticed the user is on the hook for.
-- Distinct from Tasks (user-chosen) — Jarvis infers or confirms these.

CREATE TABLE IF NOT EXISTS app.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  counterparty text,
  due_at timestamptz,
  status app.commitment_status NOT NULL DEFAULT 'open',
  provenance app.provenance_kind NOT NULL,
  source_kind app.commitment_source_kind NOT NULL DEFAULT 'manual',
  source_ref text,
  surfaced_state text,
  life_area text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commitments_owner_idx ON app.commitments (owner_user_id);
CREATE INDEX IF NOT EXISTS commitments_status_idx ON app.commitments (owner_user_id, status);

ALTER TABLE app.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.commitments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commitments_select ON app.commitments;
CREATE POLICY commitments_select ON app.commitments
  FOR SELECT TO jarvis_app_runtime
  USING (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('commitment', id, 'view')
  );

DROP POLICY IF EXISTS commitments_insert ON app.commitments;
CREATE POLICY commitments_insert ON app.commitments
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS commitments_update ON app.commitments;
CREATE POLICY commitments_update ON app.commitments
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS commitments_delete ON app.commitments;
CREATE POLICY commitments_delete ON app.commitments
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.commitments TO jarvis_app_runtime;

-- ── Entities ──────────────────────────────────────────────────────────────────
-- People, orgs, and accounts the agent knows about.
-- vault_note_path links the DB row to a People-note file for write-back.

CREATE TABLE IF NOT EXISTS app.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  type app.entity_type NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  attributes jsonb NOT NULL DEFAULT '{}',
  provenance app.provenance_kind NOT NULL,
  vault_note_path text,
  connector_refs jsonb,
  life_area text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entities_owner_idx ON app.entities (owner_user_id);
CREATE INDEX IF NOT EXISTS entities_type_idx ON app.entities (owner_user_id, type);

ALTER TABLE app.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.entities FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entities_select ON app.entities;
CREATE POLICY entities_select ON app.entities
  FOR SELECT TO jarvis_app_runtime
  USING (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('entity', id, 'view')
  );

DROP POLICY IF EXISTS entities_insert ON app.entities;
CREATE POLICY entities_insert ON app.entities
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS entities_update ON app.entities;
CREATE POLICY entities_update ON app.entities
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS entities_delete ON app.entities;
CREATE POLICY entities_delete ON app.entities
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.entities TO jarvis_app_runtime;

-- ── Preferences ───────────────────────────────────────────────────────────────
-- Typed per-user agent/persona settings. Owner-only — not shareable.
-- Key examples: "persona.name", "persona.tone", "persona.directness".

CREATE TABLE IF NOT EXISTS app.preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (length(btrim(key)) > 0),
  value_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, key)
);

CREATE INDEX IF NOT EXISTS preferences_owner_idx ON app.preferences (owner_user_id);

ALTER TABLE app.preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preferences_select ON app.preferences;
CREATE POLICY preferences_select ON app.preferences
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS preferences_insert ON app.preferences;
CREATE POLICY preferences_insert ON app.preferences
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS preferences_update ON app.preferences;
CREATE POLICY preferences_update ON app.preferences
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS preferences_delete ON app.preferences;
CREATE POLICY preferences_delete ON app.preferences
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.preferences TO jarvis_app_runtime;
