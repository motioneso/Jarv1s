ALTER TABLE app.notifications
  ADD COLUMN module_id text;

COMMENT ON COLUMN app.notifications.module_id IS
  'Owning Jarv1s module id for notification preference gating. Nullable only for historical rows; new repository writes require it.';

CREATE INDEX notifications_recipient_module_unread_idx
  ON app.notifications (recipient_user_id, module_id, created_at DESC)
  WHERE module_id IS NOT NULL;
