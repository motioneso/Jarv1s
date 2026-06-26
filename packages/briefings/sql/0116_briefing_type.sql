DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'briefing_type'
  ) THEN
    CREATE TYPE app.briefing_type AS ENUM ('morning', 'evening');
  END IF;
END
$$;

ALTER TABLE app.briefing_definitions
  ADD COLUMN IF NOT EXISTS briefing_type app.briefing_type NOT NULL DEFAULT 'morning';

ALTER TABLE app.briefing_runs
  ADD COLUMN IF NOT EXISTS briefing_type app.briefing_type NOT NULL DEFAULT 'morning';

CREATE INDEX IF NOT EXISTS briefing_definitions_owner_type_updated_at_idx
  ON app.briefing_definitions(owner_user_id, briefing_type, updated_at DESC);
