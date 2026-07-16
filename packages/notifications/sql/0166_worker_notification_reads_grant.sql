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

-- Re-state the 0102 defense-in-depth comment: DROP POLICY clears any COMMENT ON POLICY
-- attached to the old object, so recreating the policy here must restate it verbatim.
COMMENT ON POLICY notification_reads_select ON app.notification_reads IS
  'Exists-with-visible-parent guard: user_id owns the row AND the parent notification is '
  'currently visible to the actor (both jarvis_app_runtime and jarvis_worker_runtime, '
  'SELECT only). The parent check is defense-in-depth, not redundant.';
