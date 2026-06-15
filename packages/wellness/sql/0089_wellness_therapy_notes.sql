-- Therapy notes. Private per-user notes that may optionally link to a check-in.
-- Owner-only (no share, no admin data read), mirroring app.wellness_checkins.
--
-- linked_checkin_id is guarded by an owner-invariant trigger (SECURITY INVOKER,
-- mirroring enforce_medication_log_owner from 0084) that rejects a link to a
-- check-in the actor cannot see under RLS — closing the cross-owner-link hole
-- that a bare FK cannot close (FK guarantees existence, not ownership).

CREATE TABLE IF NOT EXISTS app.wellness_therapy_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  linked_checkin_id uuid REFERENCES app.wellness_checkins(id) ON DELETE SET NULL,
  linked_emotion app.wellness_emotion_core,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Primary access pattern: owner's notes ordered by most recent.
CREATE INDEX IF NOT EXISTS wellness_therapy_notes_owner_time_idx
  ON app.wellness_therapy_notes (owner_user_id, created_at DESC);

-- Partial index on linked_checkin_id: ON DELETE SET NULL on a non-partial index
-- forces a table scan of all notes on every check-in delete. The partial index
-- restricts that scan to only the linked rows (Codex R1 #9).
CREATE INDEX IF NOT EXISTS wellness_therapy_notes_checkin_idx
  ON app.wellness_therapy_notes (linked_checkin_id)
  WHERE linked_checkin_id IS NOT NULL;

-- SECURITY INVOKER (the default) — NOT DEFINER. The function owner (jarvis_migration_owner)
-- is NOBYPASSRLS and has no SELECT policy on app.wellness_checkins, so a DEFINER body
-- would see ZERO rows under FORCE RLS and wrongly reject every legitimate same-owner
-- insert. Running as the invoker (jarvis_app_runtime, with the actor's GUC) makes the
-- parent check-in visible IFF the actor owns it — which is exactly the owner-equality
-- predicate we want. A cross-owner attempt sees no parent row (RLS hides it) and is
-- rejected here, layered on top of the RLS INSERT WITH CHECK that already requires
-- owner_user_id = current actor.
CREATE OR REPLACE FUNCTION app.enforce_therapy_note_checkin_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  parent_owner uuid;
BEGIN
  IF NEW.linked_checkin_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT owner_user_id INTO parent_owner
    FROM app.wellness_checkins
   WHERE id = NEW.linked_checkin_id;
  IF parent_owner IS NULL OR parent_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'therapy_note linked_checkin_id must belong to the same owner';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_therapy_note_checkin_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enforce_therapy_note_checkin_owner() TO jarvis_app_runtime;

DROP TRIGGER IF EXISTS therapy_notes_enforce_checkin_owner ON app.wellness_therapy_notes;
CREATE TRIGGER therapy_notes_enforce_checkin_owner
BEFORE INSERT OR UPDATE ON app.wellness_therapy_notes
FOR EACH ROW
EXECUTE FUNCTION app.enforce_therapy_note_checkin_owner();

ALTER TABLE app.wellness_therapy_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.wellness_therapy_notes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wellness_therapy_notes_select ON app.wellness_therapy_notes;
CREATE POLICY wellness_therapy_notes_select ON app.wellness_therapy_notes
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_therapy_notes_insert ON app.wellness_therapy_notes;
CREATE POLICY wellness_therapy_notes_insert ON app.wellness_therapy_notes
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_therapy_notes_update ON app.wellness_therapy_notes;
CREATE POLICY wellness_therapy_notes_update ON app.wellness_therapy_notes
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_therapy_notes_delete ON app.wellness_therapy_notes;
CREATE POLICY wellness_therapy_notes_delete ON app.wellness_therapy_notes
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.wellness_therapy_notes TO jarvis_app_runtime;
