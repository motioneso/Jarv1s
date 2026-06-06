DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'notification_visibility'
  ) THEN
    CREATE TYPE app.notification_visibility AS ENUM ('private', 'workspace');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.notifications (
  id uuid PRIMARY KEY,
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  recipient_user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
  workspace_id uuid,
  visibility app.notification_visibility NOT NULL DEFAULT 'private',
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      visibility = 'private'
      AND recipient_user_id IS NOT NULL
    )
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS app.notification_reads (
  notification_id uuid NOT NULL REFERENCES app.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_user_id_created_at_idx
  ON app.notifications(recipient_user_id, created_at DESC)
  WHERE recipient_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_workspace_id_created_at_idx
  ON app.notifications(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notification_reads_user_id_idx
  ON app.notification_reads(user_id);

GRANT SELECT, INSERT ON app.notifications TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.notification_reads TO jarvis_app_runtime;

ALTER TABLE app.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE app.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notification_reads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON app.notifications;
DROP POLICY IF EXISTS notifications_insert ON app.notifications;
DROP POLICY IF EXISTS notification_reads_select ON app.notification_reads;
DROP POLICY IF EXISTS notification_reads_insert ON app.notification_reads;
DROP POLICY IF EXISTS notification_reads_update ON app.notification_reads;

CREATE POLICY notifications_select
ON app.notifications
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    (
      visibility = 'private'
      AND recipient_user_id = app.current_actor_user_id()
    )
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY notifications_insert
ON app.notifications
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    actor_user_id IS NULL
    OR actor_user_id = app.current_actor_user_id()
  )
  AND (
    (
      visibility = 'private'
      AND recipient_user_id = app.current_actor_user_id()
    )
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);

CREATE POLICY notification_reads_select
ON app.notification_reads
FOR SELECT
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

CREATE POLICY notification_reads_insert
ON app.notification_reads
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.notifications visible_notification
    WHERE visible_notification.id = notification_id
  )
);

CREATE POLICY notification_reads_update
ON app.notification_reads
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.notifications visible_notification
    WHERE visible_notification.id = notification_id
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.notifications visible_notification
    WHERE visible_notification.id = notification_id
  )
);
