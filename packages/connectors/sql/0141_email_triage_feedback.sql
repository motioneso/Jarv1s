-- #729 §6: durable accept/reject feedback for email triage suggestions. Owner-only rows;
-- learning reads aggregate by sender domain. Never stores email bodies — subject_prefix is
-- capped by the writer (≤120 chars) and reason is a short enum-ish string, not free content.
CREATE TABLE app.email_triage_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  -- Intentionally no FK: feedback must survive connector-account removal so the
  -- learning signal persists across reconnects.
  connector_account_id uuid,
  source text NOT NULL DEFAULT 'email',
  actionability text NOT NULL,
  sender text NOT NULL,
  sender_domain text NOT NULL,
  subject_prefix text,
  action_type text,
  confidence real,
  model_version text,
  verdict text NOT NULL CHECK (verdict IN ('accepted', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_triage_feedback_owner_domain_idx
  ON app.email_triage_feedback (owner_user_id, sender_domain, verdict);

ALTER TABLE app.email_triage_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_triage_feedback FORCE ROW LEVEL SECURITY;

CREATE POLICY email_triage_feedback_app_rw ON app.email_triage_feedback
  FOR ALL TO jarvis_app_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND owner_user_id = app.current_actor_user_id()
  )
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND owner_user_id = app.current_actor_user_id()
  );

CREATE POLICY email_triage_feedback_worker_rw ON app.email_triage_feedback
  FOR ALL TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND owner_user_id = app.current_actor_user_id()
  )
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND owner_user_id = app.current_actor_user_id()
  );

GRANT SELECT, INSERT ON app.email_triage_feedback TO jarvis_app_runtime, jarvis_worker_runtime;
