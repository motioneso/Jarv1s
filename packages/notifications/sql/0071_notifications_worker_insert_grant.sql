-- Phase 3 real-briefings: the briefings pg-boss worker runs as jarvis_worker_runtime
-- and fires a "Your morning briefing is ready" notification on a scheduled run's
-- completion (via NotificationsRepository.create, inside the owner's RLS context).
-- Migrations 0008/0024/0029 granted INSERT/SELECT + the INSERT/SELECT policies to
-- jarvis_app_runtime ONLY, so the worker silently could not deliver the notification.
-- Add the worker role to both:
--   * INSERT: so the worker can write the notification row.
--   * SELECT: NotificationsRepository.create uses INSERT ... RETURNING *, and Postgres
--     requires SELECT privilege on RETURNING columns — without it the INSERT errors,
--     poisoning the worker's transaction and rolling back the briefing run itself.
-- Both policies mirror the LIVE app-role policies (0029 INSERT, 0024 SELECT) EXACTLY so
-- the recipient-only invariant holds: the worker can only insert/read a notification
-- whose recipient is the active actor (the briefing owner). New file — never edit the
-- applied 0008/0024/0029.

GRANT SELECT, INSERT ON app.notifications TO jarvis_worker_runtime;

DROP POLICY IF EXISTS notifications_insert_worker ON app.notifications;
CREATE POLICY notifications_insert_worker
ON app.notifications
FOR INSERT
TO jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (actor_user_id IS NULL OR actor_user_id = app.current_actor_user_id())
  AND recipient_user_id = app.current_actor_user_id()
);

DROP POLICY IF EXISTS notifications_select_worker ON app.notifications;
CREATE POLICY notifications_select_worker
ON app.notifications
FOR SELECT
TO jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND recipient_user_id = app.current_actor_user_id()
);
