-- Owner-scoped metadata-only usefulness feedback ledger (#527).

CREATE TABLE IF NOT EXISTS app.usefulness_feedback_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (
    target_kind IN ('chat_message', 'briefing_run', 'briefing_item', 'proactive_card')
  ),
  target_ref text NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 1024),
  surface text NOT NULL CHECK (surface IN ('chat', 'briefing', 'today', 'proactive')),
  kind text NOT NULL CHECK (
    kind IN (
      'more_like_this',
      'too_much',
      'wrong_priority',
      'not_useful',
      'remember_this',
      'dismiss'
    )
  ),
  source_kind text,
  source_label text CHECK (source_label IS NULL OR length(source_label) <= 80),
  priority_band text CHECK (
    priority_band IS NULL OR priority_band IN ('critical', 'high', 'normal', 'low')
  ),
  effect_kind text,
  effect_ref text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'undone')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (owner_user_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS usefulness_feedback_signals_active_dedupe_idx
  ON app.usefulness_feedback_signals (owner_user_id, target_kind, target_ref, kind)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS usefulness_feedback_signals_owner_created_idx
  ON app.usefulness_feedback_signals (owner_user_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS usefulness_feedback_signals_owner_target_idx
  ON app.usefulness_feedback_signals (owner_user_id, target_kind, target_ref, surface)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS app.usefulness_feedback_targets (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (
    target_kind IN ('chat_message', 'briefing_run', 'briefing_item', 'proactive_card')
  ),
  target_ref text NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 1024),
  surface text NOT NULL CHECK (surface IN ('chat', 'briefing', 'today', 'proactive')),
  source_kind text,
  source_label text CHECK (source_label IS NULL OR length(source_label) <= 80),
  priority_band text CHECK (
    priority_band IS NULL OR priority_band IN ('critical', 'high', 'normal', 'low')
  ),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata_json) = 'object'),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, target_kind, target_ref, surface)
);

ALTER TABLE app.usefulness_feedback_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usefulness_feedback_signals FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usefulness_feedback_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usefulness_feedback_targets FORCE ROW LEVEL SECURITY;

CREATE POLICY usefulness_feedback_signals_owner ON app.usefulness_feedback_signals
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

CREATE POLICY usefulness_feedback_targets_owner ON app.usefulness_feedback_targets
  FOR ALL TO jarvis_app_runtime, jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE ON app.usefulness_feedback_signals
  TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT SELECT, INSERT, UPDATE ON app.usefulness_feedback_targets
  TO jarvis_app_runtime, jarvis_worker_runtime;
