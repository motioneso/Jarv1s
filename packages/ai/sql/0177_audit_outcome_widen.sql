-- #1264: widen audit outcome for settings self-operation writes, which can fail with a CAS
-- conflict (stale revision) or a validation error distinct from the existing 'failed'/'denied'.
ALTER TABLE app.jarvis_action_audit_log
  DROP CONSTRAINT jarvis_action_audit_log_outcome_check;
ALTER TABLE app.jarvis_action_audit_log
  ADD CONSTRAINT jarvis_action_audit_log_outcome_check
  CHECK (outcome IN ('success', 'failed', 'denied', 'cancelled', 'invalid', 'conflict'));
