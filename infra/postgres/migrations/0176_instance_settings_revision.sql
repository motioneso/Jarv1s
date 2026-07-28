-- #1264: forward infra for CAS on app.instance_settings (core-owned table).
-- No consumer in this PR; mirrors app.preferences.revision (0175) so a future
-- self-operation admin-settings tool can CAS without a follow-up migration.
ALTER TABLE app.instance_settings
  ADD COLUMN revision integer NOT NULL DEFAULT 1;
