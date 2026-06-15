-- Adopt the design emotion taxonomy: replace the old wellness_feeling_core enum
-- (mad/sad/scared/joyful/powerful/peaceful) with wellness_emotion_core
-- (happy/sad/fear/anger/disgust/surprise) and update the wheel_version default.
--
-- Re-run-safe: to_regtype() returns NULL rather than raising when the old type is
-- absent; DROP TYPE IF EXISTS is idempotent; the DO block checks atttypid so a
-- second run (after the ALTER has already flipped the column) is a no-op.
--
-- Zero-row invariant: wellness_checkins must be empty at migration time — Wellness
-- is not yet installed for any user so there is no data to remap. The DO block
-- asserts this explicitly; if it finds rows it raises before any ALTER.

-- 1. Create the new enum (idempotent).
DO $$ BEGIN
  CREATE TYPE app.wellness_emotion_core AS ENUM
    ('happy', 'sad', 'fear', 'anger', 'disgust', 'surprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Update wheel_version default on the checkins table (idempotent ALTER DEFAULT).
ALTER TABLE app.wellness_checkins
  ALTER COLUMN wheel_version SET DEFAULT 'jarvis-emotion-v1';

-- 3. Guard-and-swap: only runs when the old type still exists AND the column
--    still points to it. Uses to_regtype() — NEVER a bare ::regtype cast — so
--    re-runs after the old type is dropped are completely safe.
DO $$
DECLARE
  old_oid   oid;
  col_typid oid;
BEGIN
  -- to_regtype returns NULL when the type does not exist (safe on re-run).
  old_oid := to_regtype('app.wellness_feeling_core');

  IF old_oid IS NULL THEN
    -- Old type already gone; nothing to do.
    RETURN;
  END IF;

  -- Check whether the column still uses the old type.
  SELECT atttypid INTO col_typid
    FROM pg_attribute
   WHERE attrelid = 'app.wellness_checkins'::regclass
     AND attname  = 'feeling_core'
     AND attnum   > 0;

  IF col_typid IS DISTINCT FROM old_oid THEN
    -- Column was already migrated to the new type; nothing to do.
    RETURN;
  END IF;

  -- Assert the table is empty: the no-remap swap path is only valid with zero rows.
  -- A USING cast on non-empty rows would fail for any old-enum value not present in
  -- the new enum (e.g. 'mad', 'scared', 'joyful', 'powerful', 'peaceful').
  IF EXISTS (SELECT 1 FROM app.wellness_checkins) THEN
    RAISE EXCEPTION
      'wellness_checkins is non-empty; the zero-row taxonomy swap is unsafe — '
      'author a remap migration that translates old values to new ones instead.';
  END IF;

  -- Swap the column type. Zero rows means the USING expression never evaluates.
  ALTER TABLE app.wellness_checkins
    ALTER COLUMN feeling_core
    TYPE app.wellness_emotion_core
    USING (feeling_core::text::app.wellness_emotion_core);
END $$;

-- 4. Drop the old type now that the column no longer references it (idempotent).
DROP TYPE IF EXISTS app.wellness_feeling_core;
