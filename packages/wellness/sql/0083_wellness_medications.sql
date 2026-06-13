-- Medications. Owner-only (no share). Discriminated frequency_type with type-specific
-- fields. DB CHECKs enforce the discriminator contract (defense-in-depth alongside the
-- route-layer validation, which gives friendly 400s); the DB is the last line so a bad
-- write from any path is rejected (Codex R1: schema was too weak).

CREATE TABLE IF NOT EXISTS app.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  dosage text,
  form text,
  frequency_type text NOT NULL CHECK (frequency_type IN
    ('once_daily', 'times_per_day', 'specific_weekdays', 'every_n_hours', 'as_needed', 'cyclical')),
  times_per_day smallint CHECK (times_per_day IS NULL OR times_per_day BETWEEN 1 AND 24),
  interval_hours smallint CHECK (interval_hours IS NULL OR interval_hours BETWEEN 1 AND 24),
  weekdays smallint[],
  schedule_times time[],
  cycle_days_on smallint CHECK (cycle_days_on IS NULL OR cycle_days_on >= 1),
  cycle_days_off smallint CHECK (cycle_days_off IS NULL OR cycle_days_off >= 0),
  cycle_anchor_date date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Discriminator: required field per frequency_type.
  CONSTRAINT medications_times_per_day_present
    CHECK (frequency_type <> 'times_per_day' OR times_per_day IS NOT NULL),
  CONSTRAINT medications_interval_hours_present
    CHECK (frequency_type <> 'every_n_hours' OR interval_hours IS NOT NULL),
  CONSTRAINT medications_weekdays_present
    CHECK (frequency_type <> 'specific_weekdays'
      OR (weekdays IS NOT NULL AND array_length(weekdays, 1) >= 1)),
  -- ISO weekday range (1=Mon..7=Sun) enforced at the DB, not just the route (Codex R2).
  -- NOTE: a CHECK constraint cannot contain a subquery (Codex R3) — use the array containment
  -- operator `<@` against the allowed set instead of `SELECT bool_and(...) FROM unnest(...)`.
  CONSTRAINT medications_weekdays_range
    CHECK (weekdays IS NULL
      OR (array_length(weekdays, 1) >= 1
          AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])),
  -- Scheduled families need at least one clock time to produce slots.
  CONSTRAINT medications_schedule_times_present
    CHECK (frequency_type NOT IN ('once_daily', 'times_per_day', 'specific_weekdays', 'cyclical')
      OR (schedule_times IS NOT NULL AND array_length(schedule_times, 1) >= 1)),
  -- times_per_day must enumerate exactly that many clock times (computeSchedule emits one slot
  -- per time, so the count must agree — Codex R2).
  CONSTRAINT medications_times_per_day_count
    CHECK (frequency_type <> 'times_per_day'
      OR (schedule_times IS NOT NULL AND array_length(schedule_times, 1) = times_per_day)),
  -- Cyclical needs its anchor + on-days to compute on/off windows.
  CONSTRAINT medications_cycle_fields_present
    CHECK (frequency_type <> 'cyclical'
      OR (cycle_anchor_date IS NOT NULL AND cycle_days_on IS NOT NULL)),
  -- as_needed (PRN) is unscheduled: it must NOT carry ANY scheduling/cycle field.
  CONSTRAINT medications_as_needed_unscheduled
    CHECK (frequency_type <> 'as_needed'
      OR (schedule_times IS NULL AND times_per_day IS NULL AND interval_hours IS NULL
          AND weekdays IS NULL AND cycle_anchor_date IS NULL
          AND cycle_days_on IS NULL AND cycle_days_off IS NULL))
);

CREATE INDEX IF NOT EXISTS medications_owner_idx
  ON app.medications (owner_user_id);

ALTER TABLE app.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.medications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medications_select ON app.medications;
CREATE POLICY medications_select ON app.medications
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medications_insert ON app.medications;
CREATE POLICY medications_insert ON app.medications
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medications_update ON app.medications;
CREATE POLICY medications_update ON app.medications
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medications_delete ON app.medications;
CREATE POLICY medications_delete ON app.medications
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.medications TO jarvis_app_runtime;
