-- #771: 0107 added local_date/timezone_offset ("Adversarial remediation (#326)") but the write
-- path (createCheckin) never populated either column, so every check-in inserted between 0107
-- landing and the #771 fix still has a NULL local_date despite the one-time backfill 0107 ran at
-- migration-apply time. Re-run that same UTC-derived backfill for any rows still NULL today.
-- This is only an approximation for these historical rows (their true local day depends on the
-- user's timezone at check-in time, which was never captured) — going forward createCheckin
-- writes the real local_date on every insert via resolveRouteTimeZone.
UPDATE app.wellness_checkins
SET local_date = TO_CHAR(checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE local_date IS NULL;
