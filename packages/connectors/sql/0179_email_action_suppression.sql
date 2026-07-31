CREATE TABLE app.email_action_suppression (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  subject_signature text NOT NULL CHECK (subject_signature ~ '^[0-9a-f]{64}$'),
  dismissal_count integer NOT NULL DEFAULT 0 CHECK (dismissal_count >= 0),
  last_deadline_evidence_key text CHECK (last_deadline_evidence_key IS NULL OR char_length(last_deadline_evidence_key) <= 500),
  last_context_message_key text CHECK (last_context_message_key IS NULL OR char_length(last_context_message_key) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, subject_signature)
);

ALTER TABLE app.email_action_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_action_suppression FORCE ROW LEVEL SECURITY;

CREATE POLICY email_action_suppression_app_rw ON app.email_action_suppression
  FOR ALL TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id())
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY email_action_suppression_worker_rw ON app.email_action_suppression
  FOR ALL TO jarvis_worker_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id())
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE ON app.email_action_suppression TO jarvis_app_runtime, jarvis_worker_runtime;
