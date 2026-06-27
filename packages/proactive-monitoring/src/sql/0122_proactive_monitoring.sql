-- Migration 0122: proactive monitoring state and cards
-- Owner-scoped, FORCE RLS, no admin bypass (security invariant).

CREATE TABLE app.proactive_monitor_state (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source         text NOT NULL,
  cursor_json    jsonb NOT NULL DEFAULT '{}',
  last_checked_at timestamptz,
  failure_count  integer NOT NULL DEFAULT 0,
  last_error_class text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, source)
);

ALTER TABLE app.proactive_monitor_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.proactive_monitor_state FORCE ROW LEVEL SECURITY;

CREATE POLICY proactive_monitor_state_owner ON app.proactive_monitor_state
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE TABLE app.proactive_cards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  source          text NOT NULL,
  stable_key      text NOT NULL,
  source_ref_hash text NOT NULL,
  title           text NOT NULL,
  summary         text NOT NULL,
  signal_type     text NOT NULL,
  priority_band   text NOT NULL,
  priority_reasons jsonb NOT NULL DEFAULT '[]',
  status          text NOT NULL DEFAULT 'active',
  occurred_at     timestamptz,
  target_at       timestamptz,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  deferred_until  timestamptz,
  expires_at      timestamptz,
  dismissed_at    timestamptz,
  metadata_json   jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Unique active material card per (owner, source, stable_key).
CREATE UNIQUE INDEX proactive_cards_stable_key_uidx
  ON app.proactive_cards (owner_user_id, source, stable_key)
  WHERE status NOT IN ('dismissed', 'expired', 'suppressed');

ALTER TABLE app.proactive_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.proactive_cards FORCE ROW LEVEL SECURITY;

CREATE POLICY proactive_cards_owner ON app.proactive_cards
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

-- Indexes for cap queries.
CREATE INDEX proactive_cards_owner_created ON app.proactive_cards (owner_user_id, created_at);
CREATE INDEX proactive_cards_owner_source ON app.proactive_cards (owner_user_id, source, created_at);

-- Worker writes state and cards; app reads + dismisses cards.
GRANT SELECT, INSERT, UPDATE ON app.proactive_monitor_state TO jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.proactive_cards TO jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.proactive_cards TO jarvis_app_runtime;
