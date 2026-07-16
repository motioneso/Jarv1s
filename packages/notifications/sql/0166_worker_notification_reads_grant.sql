-- #1077: export.build reads app.notification_reads as jarvis_worker_runtime but the role
-- has never had SELECT here (owner rows only, no worker grant existed). Mirror the existing
-- jarvis_app_runtime notification_reads_select predicate exactly — SELECT only, no writes.

GRANT SELECT ON app.notification_reads TO jarvis_worker_runtime;

DROP POLICY IF EXISTS notification_reads_select ON app.notification_reads;
CREATE POLICY notification_reads_select ON app.notification_reads
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND user_id = app.current_actor_user_id()
    AND EXISTS (
      SELECT 1 FROM app.notifications visible_notification
      WHERE visible_notification.id = notification_reads.notification_id
    )
  );
