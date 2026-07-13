ALTER TABLE app.jarvis_action_audit_log
  ADD COLUMN input_summary jsonb
  CHECK (input_summary IS NULL OR jsonb_typeof(input_summary) = 'object');
