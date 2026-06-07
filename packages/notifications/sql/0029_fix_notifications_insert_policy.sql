-- 0024 was applied without the recipient_user_id constraint on INSERT.
-- Recreate the policy with the correct constraint so existing databases are healed.

DROP POLICY IF EXISTS notifications_insert ON app.notifications;

CREATE POLICY notifications_insert
ON app.notifications
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (actor_user_id IS NULL OR actor_user_id = app.current_actor_user_id())
  AND recipient_user_id = app.current_actor_user_id()
);
