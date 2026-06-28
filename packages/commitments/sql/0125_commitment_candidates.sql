CREATE TYPE app.commitment_candidate_kind AS ENUM (
  'deadline',
  'promise',
  'obligation',
  'intent'
);

CREATE TYPE app.commitment_candidate_status AS ENUM (
  'pending_review',
  'accepted',
  'rejected',
  'snoozed',
  'expired',
  'explicit_non_action'
);

CREATE TYPE app.commitment_suggested_handling AS ENUM (
  'create_task',
  'create_goal',
  'create_calendar_event',
  'send_reply',
  'dismiss'
);

CREATE TABLE app.commitment_candidates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         TEXT NOT NULL,
  candidate_signature   TEXT NOT NULL,
  kind                  app.commitment_candidate_kind NOT NULL,
  title                 TEXT NOT NULL CHECK (char_length(title) <= 1000),
  due_local_date        DATE,
  counterparty_label    TEXT CHECK (char_length(counterparty_label) <= 200),
  status                app.commitment_candidate_status NOT NULL DEFAULT 'pending_review',
  confidence            TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  suggested_handling    app.commitment_suggested_handling,
  resolution_ref        TEXT,
  suppressed_by         UUID REFERENCES app.commitment_candidates(id) ON DELETE SET NULL,
  source_count          INTEGER NOT NULL DEFAULT 0,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  snoozed_until         TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_candidate_owner_sig UNIQUE (owner_user_id, candidate_signature)
);

ALTER TABLE app.commitment_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY commitment_candidates_app_runtime ON app.commitment_candidates
  AS PERMISSIVE
  FOR ALL
  TO jarvis_app_runtime
  USING (owner_user_id = current_setting('app.current_user_id', true))
  WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));

CREATE POLICY commitment_candidates_worker_runtime ON app.commitment_candidates
  AS PERMISSIVE
  FOR ALL
  TO jarvis_worker_runtime
  USING (true)
  WITH CHECK (true);

GRANT INSERT, SELECT, UPDATE, DELETE ON app.commitment_candidates TO jarvis_app_runtime;
GRANT SELECT, UPDATE ON app.commitment_candidates TO jarvis_worker_runtime;

CREATE TABLE app.commitment_candidate_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL,
  owner_user_id   TEXT NOT NULL,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('chat', 'email', 'notes')),
  source_ref      TEXT NOT NULL,
  source_version  INTEGER NOT NULL DEFAULT 0,
  evidence_excerpt TEXT NOT NULL CHECK (char_length(evidence_excerpt) <= 500),
  occurred_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_ccs_candidate FOREIGN KEY (candidate_id)
    REFERENCES app.commitment_candidates(id) ON DELETE CASCADE,
  CONSTRAINT uq_ccs_candidate_source UNIQUE (candidate_id, source_kind, source_ref)
);

ALTER TABLE app.commitment_candidate_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY commitment_candidate_sources_app_runtime ON app.commitment_candidate_sources
  AS PERMISSIVE
  FOR ALL
  TO jarvis_app_runtime
  USING (owner_user_id = current_setting('app.current_user_id', true))
  WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));

CREATE POLICY commitment_candidate_sources_worker_runtime ON app.commitment_candidate_sources
  AS PERMISSIVE
  FOR ALL
  TO jarvis_worker_runtime
  USING (true)
  WITH CHECK (true);

GRANT INSERT, SELECT, UPDATE, DELETE ON app.commitment_candidate_sources TO jarvis_app_runtime;
GRANT SELECT, UPDATE ON app.commitment_candidate_sources TO jarvis_worker_runtime;

CREATE TABLE app.commitment_candidate_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL,
  owner_user_id   TEXT NOT NULL,
  event_kind      TEXT NOT NULL CHECK (event_kind IN (
    'created', 'status_changed', 'resolution_set', 'snoozed', 'suppressed', 'evidence_added'
  )),
  from_status     app.commitment_candidate_status,
  to_status       app.commitment_candidate_status,
  actor_user_id   TEXT NOT NULL,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_cce_candidate FOREIGN KEY (candidate_id)
    REFERENCES app.commitment_candidates(id) ON DELETE CASCADE
);

ALTER TABLE app.commitment_candidate_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY commitment_candidate_events_app_runtime ON app.commitment_candidate_events
  AS PERMISSIVE
  FOR ALL
  TO jarvis_app_runtime
  USING (owner_user_id = current_setting('app.current_user_id', true))
  WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));

CREATE POLICY commitment_candidate_events_worker_runtime ON app.commitment_candidate_events
  AS PERMISSIVE
  FOR ALL
  TO jarvis_worker_runtime
  USING (true);

GRANT INSERT, SELECT ON app.commitment_candidate_events TO jarvis_app_runtime;
GRANT SELECT ON app.commitment_candidate_events TO jarvis_worker_runtime;

CREATE TABLE app.commitment_extraction_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     TEXT NOT NULL,
  source_kind       TEXT NOT NULL CHECK (source_kind IN ('chat', 'email', 'notes')),
  last_extracted_at TIMESTAMPTZ,
  last_run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ces_owner_source UNIQUE (owner_user_id, source_kind)
);

ALTER TABLE app.commitment_extraction_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY commitment_extraction_state_app_runtime ON app.commitment_extraction_state
  AS PERMISSIVE
  FOR ALL
  TO jarvis_app_runtime
  USING (owner_user_id = current_setting('app.current_user_id', true))
  WITH CHECK (owner_user_id = current_setting('app.current_user_id', true));

CREATE POLICY commitment_extraction_state_worker_runtime ON app.commitment_extraction_state
  AS PERMISSIVE
  FOR ALL
  TO jarvis_worker_runtime
  USING (true)
  WITH CHECK (true);

GRANT INSERT, SELECT, UPDATE ON app.commitment_extraction_state TO jarvis_app_runtime;
GRANT SELECT, UPDATE ON app.commitment_extraction_state TO jarvis_worker_runtime;
