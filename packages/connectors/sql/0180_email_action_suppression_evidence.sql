CREATE TABLE app.email_action_suppression_evidence (
  owner_user_id uuid NOT NULL,
  subject_signature text NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('deadline', 'context')),
  evidence_key text NOT NULL CHECK (char_length(evidence_key) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, subject_signature, evidence_kind, evidence_key),
  FOREIGN KEY (owner_user_id, subject_signature)
    REFERENCES app.email_action_suppression (owner_user_id, subject_signature)
    ON DELETE CASCADE
);

ALTER TABLE app.email_action_suppression_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_action_suppression_evidence FORCE ROW LEVEL SECURITY;

CREATE POLICY email_action_suppression_evidence_app_rw ON app.email_action_suppression_evidence
  FOR ALL TO jarvis_app_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id())
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

CREATE POLICY email_action_suppression_evidence_worker_rw ON app.email_action_suppression_evidence
  FOR ALL TO jarvis_worker_runtime
  USING (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id())
  WITH CHECK (app.current_actor_user_id() IS NOT NULL AND owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, DELETE
  ON app.email_action_suppression_evidence
  TO jarvis_app_runtime, jarvis_worker_runtime;
