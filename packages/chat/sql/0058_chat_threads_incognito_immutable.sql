-- Enforce incognito immutability on chat_threads after creation.
-- The column comment in 0042 claimed immutability but no DB constraint enforced it.
-- A column-specific BEFORE UPDATE trigger fires only when incognito appears in the
-- UPDATE SET list, leaving all other column updates unaffected.
CREATE OR REPLACE FUNCTION app.chat_threads_guard_incognito()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.incognito IS DISTINCT FROM OLD.incognito THEN
    RAISE EXCEPTION 'incognito is immutable after creation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_threads_guard_incognito ON app.chat_threads;
CREATE TRIGGER chat_threads_guard_incognito
BEFORE UPDATE OF incognito ON app.chat_threads
FOR EACH ROW EXECUTE FUNCTION app.chat_threads_guard_incognito();
