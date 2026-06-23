-- Adversarial remediation (#326): add local_date + timezone_offset for temporal wellness analysis.
-- timezone_offset (minutes) defaults 0 (UTC). local_date backfilled from checked_in_at at UTC.
ALTER TABLE app.wellness_checkins
  ADD COLUMN IF NOT EXISTS local_date       text,
  ADD COLUMN IF NOT EXISTS timezone_offset  smallint NOT NULL DEFAULT 0;

UPDATE app.wellness_checkins
SET local_date = TO_CHAR(checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE local_date IS NULL;
