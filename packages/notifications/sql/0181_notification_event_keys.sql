-- Migration 0181. Task 2b (#1283): ctx.notify lets an external module post a KEYED notification —
-- re-firing the same key updates the existing row in place and returns it to
-- unread, rather than piling up a duplicate. This migration adds the columns,
-- the partial unique index that makes "same key = same row" enforceable at the
-- DB layer (not just in application code), and the grant/policy pairs the keyed
-- upsert's UPDATE and the return-to-unread DELETE actually need — none of which
-- existed before this file, for EITHER runtime role.
--
-- New file — never edit the applied 0008/0024/0029/0071/0101/0102/0105/0142/0166/0170.

ALTER TABLE app.notifications
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS href text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- One notification per (recipient, module, key): a module that reuses a key
-- updates its existing notification instead of piling up duplicates. NULL
-- event_key (the un-keyed path every notification used before this task) is
-- excluded — un-keyed notifications have never been deduplicated and are not
-- becoming so now. This exact shape is also the ON CONFLICT target used by
-- NotificationsRepository.create's keyed upsert.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_recipient_module_event_key_idx
  ON app.notifications (recipient_user_id, module_id, event_key)
  WHERE event_key IS NOT NULL;

-- List ordering moves from created_at to "most recently touched": a keyed
-- re-fire must resurface at the top of the list exactly like a new notification
-- would, or the return-to-unread ruling is visible in the badge count but not
-- in the list itself. coalesce() covers rows written before this column existed
-- (backfilled to now() by the ADD COLUMN default, but the query stays defensive).
CREATE INDEX IF NOT EXISTS notifications_recipient_updated_at_idx
  ON app.notifications (recipient_user_id, (coalesce(updated_at, created_at)) DESC);

-- --- jarvis_app_runtime: UPDATE on notifications, DELETE on notification_reads ---
-- Both are new capabilities the keyed upsert needs: UPDATE to rewrite an existing
-- keyed notification's title/body/etc in place, DELETE to clear its read row on a
-- re-fire (the "return to unread" ruling) in the SAME statement as the upsert.

GRANT UPDATE ON app.notifications TO jarvis_app_runtime;

DROP POLICY IF EXISTS notifications_update ON app.notifications;
CREATE POLICY notifications_update
ON app.notifications
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND recipient_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND recipient_user_id = app.current_actor_user_id()
);

GRANT DELETE ON app.notification_reads TO jarvis_app_runtime;

-- Mirrors notification_reads_update's USING clause verbatim (0008), including its
-- EXISTS guard against a visible parent notification — a read row for a
-- notification the actor can no longer see must not be deletable either.
DROP POLICY IF EXISTS notification_reads_delete ON app.notification_reads;
CREATE POLICY notification_reads_delete
ON app.notification_reads
FOR DELETE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.notifications visible_notification
    WHERE visible_notification.id = notification_id
  )
);

-- --- jarvis_worker_runtime: the SAME two grants/policies, mirrored exactly ---
-- The real crawl only ever posts keyed notifications from the worker/queue lane
-- (K5), so without this pair the whole feature passes every app-role test and
-- silently no-ops the moment it runs in production — the exact gap 0071 fixed
-- once already for INSERT. Split into its own policy per role, matching 0071's
-- convention rather than 0166's shared-policy one (0071 is the direct template
-- here: a brand-new capability being extended to the worker role).

GRANT UPDATE ON app.notifications TO jarvis_worker_runtime;

DROP POLICY IF EXISTS notifications_update_worker ON app.notifications;
CREATE POLICY notifications_update_worker
ON app.notifications
FOR UPDATE
TO jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND recipient_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND recipient_user_id = app.current_actor_user_id()
);

GRANT DELETE ON app.notification_reads TO jarvis_worker_runtime;

DROP POLICY IF EXISTS notification_reads_delete_worker ON app.notification_reads;
CREATE POLICY notification_reads_delete_worker
ON app.notification_reads
FOR DELETE
TO jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.notifications visible_notification
    WHERE visible_notification.id = notification_id
  )
);
