-- prn_reason is now optional; logged doses may omit the reason (persists as NULL).
-- Drops only the reason-required half of the original dual-purpose check.
-- The scheduled_for presence rule (medication_logs_scheduled_for_present) is unchanged.
ALTER TABLE app.medication_logs
  DROP CONSTRAINT IF EXISTS medication_logs_prn_reason;
