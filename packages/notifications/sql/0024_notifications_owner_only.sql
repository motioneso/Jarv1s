-- Slice 1c-1d: convert Notifications to recipient-only access. Notifications are
-- personal messages and are NOT shareable. workspace_id/visibility columns remain
-- inert (dropped in Slice 1f). notification_reads policies are unchanged; they
-- rely on the parent notification SELECT policy via the EXISTS subquery.

DROP POLICY IF EXISTS notifications_select ON app.notifications;
DROP POLICY IF EXISTS notifications_insert ON app.notifications;

CREATE POLICY notifications_select
ON app.notifications
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND recipient_user_id = app.current_actor_user_id()
);

CREATE POLICY notifications_insert
ON app.notifications
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (actor_user_id IS NULL OR actor_user_id = app.current_actor_user_id())
);
