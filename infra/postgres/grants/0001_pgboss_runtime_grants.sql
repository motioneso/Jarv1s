GRANT USAGE ON SCHEMA pgboss TO jarvis_app_runtime, jarvis_worker_runtime;

GRANT USAGE ON TYPE pgboss.job_state TO jarvis_app_runtime, jarvis_worker_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss
  TO jarvis_app_runtime, jarvis_worker_runtime;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;
