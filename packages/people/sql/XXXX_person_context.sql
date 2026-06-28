-- ENUMs
CREATE TYPE app.person_context_status AS ENUM (
  'active', 'archived', 'merged'
);

CREATE TYPE app.person_context_identity_kind AS ENUM (
  'email_address', 'source_identity', 'alias', 'display_name'
);

CREATE TYPE app.person_context_source_kind AS ENUM (
  'email', 'calendar', 'chat', 'note', 'task', 'commitment', 'memory', 'manual'
);

CREATE TYPE app.person_context_identity_status AS ENUM (
  'active', 'pending', 'ambiguous', 'rejected', 'split'
);

CREATE TYPE app.person_context_provenance AS ENUM (
  'source', 'inferred', 'user_confirmed', 'imported'
);

CREATE TYPE app.person_context_link_kind AS ENUM (
  'sender', 'recipient', 'attendee', 'mentioned', 'assigned', 'counterparty', 'related'
);

CREATE TYPE app.person_context_candidate_kind AS ENUM (
  'create_person', 'link_identity', 'merge_people', 'split_identity'
);

CREATE TYPE app.person_context_candidate_status AS ENUM (
  'pending', 'accepted', 'rejected', 'suppressed', 'resolved'
);

CREATE TYPE app.person_context_event_kind AS ENUM (
  'created', 'identity_linked', 'identity_rejected', 'merged', 'split',
  'archived', 'candidate_accepted', 'candidate_rejected', 'candidate_reopened'
);

-- Table 1: people
CREATE TABLE app.person_context_people (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  display_name          TEXT NOT NULL CHECK (char_length(display_name) <= 160),
  relationship_summary  TEXT CHECK (char_length(relationship_summary) <= 1000),
  context_summary       TEXT CHECK (char_length(context_summary) <= 1000),
  status                app.person_context_status NOT NULL DEFAULT 'active',
  confidence            NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  memory_entity_id      UUID,
  merged_into_person_id UUID REFERENCES app.person_context_people(id) ON DELETE SET NULL,
  archived_at           TIMESTAMPTZ,
  merged_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app.person_context_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_people FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_people_app_runtime ON app.person_context_people
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_people_worker_runtime ON app.person_context_people
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_people TO jarvis_app_runtime;
GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_people TO jarvis_worker_runtime;

-- Table 2: identities
CREATE TABLE app.person_context_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  person_id        UUID REFERENCES app.person_context_people(id) ON DELETE SET NULL,
  identity_kind    app.person_context_identity_kind NOT NULL,
  source_kind      app.person_context_source_kind NOT NULL,
  normalized_value TEXT NOT NULL,
  display_value    TEXT NOT NULL,
  source_ref       TEXT,
  source_ref_hash  TEXT,
  status           app.person_context_identity_status NOT NULL DEFAULT 'pending',
  confidence       NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  provenance       app.person_context_provenance NOT NULL DEFAULT 'source',
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_person_context_identities_active
  ON app.person_context_identities (owner_user_id, identity_kind, source_kind, normalized_value)
  WHERE status = 'active' AND identity_kind IN ('email_address', 'source_identity');

ALTER TABLE app.person_context_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_identities FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_identities_app_runtime ON app.person_context_identities
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_identities_worker_runtime ON app.person_context_identities
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_identities TO jarvis_app_runtime;
GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_identities TO jarvis_worker_runtime;

-- Table 3: links
CREATE TABLE app.person_context_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  person_id         UUID NOT NULL REFERENCES app.person_context_people(id) ON DELETE CASCADE,
  source_kind       app.person_context_source_kind NOT NULL,
  source_ref        TEXT NOT NULL,
  source_ref_hash   TEXT NOT NULL,
  source_label      TEXT CHECK (char_length(source_label) <= 200),
  link_kind         app.person_context_link_kind NOT NULL,
  summary           TEXT CHECK (char_length(summary) <= 500),
  occurred_at       TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  confidence        NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  provenance        app.person_context_provenance NOT NULL DEFAULT 'source',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_person_context_links_dedup
  ON app.person_context_links (owner_user_id, person_id, source_ref_hash, link_kind);

ALTER TABLE app.person_context_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_links FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_links_app_runtime ON app.person_context_links
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_links_worker_runtime ON app.person_context_links
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_links TO jarvis_app_runtime;
GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_links TO jarvis_worker_runtime;

-- Table 4: link_sources
CREATE TABLE app.person_context_link_sources (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  link_id          UUID NOT NULL REFERENCES app.person_context_links(id) ON DELETE CASCADE,
  identity_id      UUID REFERENCES app.person_context_identities(id) ON DELETE SET NULL,
  source_ref_hash  TEXT NOT NULL,
  link_kind        app.person_context_link_kind NOT NULL,
  confidence       NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_person_context_link_sources_dedup
  ON app.person_context_link_sources (owner_user_id, link_id, source_ref_hash);

ALTER TABLE app.person_context_link_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_link_sources FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_link_sources_app_runtime ON app.person_context_link_sources
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_link_sources_worker_runtime ON app.person_context_link_sources
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_link_sources TO jarvis_app_runtime;
GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_link_sources TO jarvis_worker_runtime;

-- Table 5: match_candidates
CREATE TABLE app.person_context_match_candidates (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id           UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  candidate_kind          app.person_context_candidate_kind NOT NULL,
  status                  app.person_context_candidate_status NOT NULL DEFAULT 'pending',
  primary_person_id       UUID REFERENCES app.person_context_people(id) ON DELETE SET NULL,
  secondary_person_id     UUID REFERENCES app.person_context_people(id) ON DELETE SET NULL,
  identity_id             UUID REFERENCES app.person_context_identities(id) ON DELETE SET NULL,
  suggested_display_name  TEXT,
  reason_summary          TEXT,
  confidence              NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  candidate_signature     TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_person_context_candidate_sig UNIQUE (owner_user_id, candidate_signature)
);

ALTER TABLE app.person_context_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_match_candidates FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_match_candidates_app_runtime ON app.person_context_match_candidates
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_match_candidates_worker_runtime ON app.person_context_match_candidates
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_match_candidates TO jarvis_app_runtime;
GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_match_candidates TO jarvis_worker_runtime;

-- Table 6: events (metadata only)
CREATE TABLE app.person_context_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  event_kind           app.person_context_event_kind NOT NULL,
  person_id            UUID REFERENCES app.person_context_people(id) ON DELETE SET NULL,
  secondary_person_id  UUID REFERENCES app.person_context_people(id) ON DELETE SET NULL,
  identity_id          UUID REFERENCES app.person_context_identities(id) ON DELETE SET NULL,
  candidate_id         UUID REFERENCES app.person_context_match_candidates(id) ON DELETE SET NULL,
  source_ref_hash      TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app.person_context_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_events FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_events_app_runtime ON app.person_context_events
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_events_worker_runtime ON app.person_context_events
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT ON app.person_context_events TO jarvis_app_runtime;
GRANT INSERT, SELECT ON app.person_context_events TO jarvis_worker_runtime;

-- Table 7: indexing_state
CREATE TABLE app.person_context_indexing_state (
  owner_user_id        UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source               app.person_context_source_kind NOT NULL,
  source_ref_hash      TEXT NOT NULL,
  source_ref           TEXT NOT NULL,
  last_indexed_at      TIMESTAMPTZ,
  last_source_version  TEXT,
  pending_source_version TEXT,
  last_enqueued_at     TIMESTAMPTZ,
  last_started_at      TIMESTAMPTZ,
  last_finished_at     TIMESTAMPTZ,
  failure_count        INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, source, source_ref_hash)
);

ALTER TABLE app.person_context_indexing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.person_context_indexing_state FORCE ROW LEVEL SECURITY;

CREATE POLICY person_context_indexing_state_app_runtime ON app.person_context_indexing_state
  AS PERMISSIVE FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY person_context_indexing_state_worker_runtime ON app.person_context_indexing_state
  AS PERMISSIVE FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_indexing_state TO jarvis_app_runtime;
GRANT INSERT, SELECT, UPDATE, DELETE ON app.person_context_indexing_state TO jarvis_worker_runtime;
