CREATE TABLE IF NOT EXISTS app.data_export_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'building', 'ready', 'failed', 'expired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  expires_at        timestamptz,
  error_message     text
);

ALTER TABLE app.data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.data_export_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY data_export_jobs_owner ON app.data_export_jobs
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE ON app.data_export_jobs TO jarvis_app_runtime;
GRANT UPDATE ON app.data_export_jobs TO jarvis_worker_runtime;
