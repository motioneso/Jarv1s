ALTER TABLE app.jarvis_action_audit_log
  DROP CONSTRAINT IF EXISTS jarvis_action_audit_log_approval_mode_check;

ALTER TABLE app.jarvis_action_audit_log
  ADD CONSTRAINT jarvis_action_audit_log_approval_mode_check
  CHECK (approval_mode IN ('auto', 'yolo', 'confirmed', 'rejected', 'cancelled', 'timeout'));
