-- #1077: export.build reads app.jarvis_action_audit_log as jarvis_worker_runtime but the role
-- has never had SELECT here. Mirror the existing jarvis_app_runtime
-- jarvis_action_audit_log_select predicate exactly — SELECT only, no writes. Leaves the
-- jarvis_migration_owner maintenance policies (0127) untouched.

GRANT SELECT ON app.jarvis_action_audit_log TO jarvis_worker_runtime;

DROP POLICY IF EXISTS jarvis_action_audit_log_select
ON app.jarvis_action_audit_log;
CREATE POLICY jarvis_action_audit_log_select
ON app.jarvis_action_audit_log
FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
