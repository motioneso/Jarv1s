-- Dose events. owner_user_id is denormalized for a simple owner-only RLS predicate;
-- a trigger enforces it equals the parent medication's owner.

CREATE TABLE IF NOT EXISTS app.medication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_id uuid NOT NULL REFERENCES app.medications(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('taken', 'skipped', 'prn')),
  dose text,
  prn_reason text,
  scheduled_for timestamptz,
  logged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- PRN doses must record a reason; scheduled doses must not masquerade as PRN.
  CONSTRAINT medication_logs_prn_reason
    CHECK (status <> 'prn' OR (prn_reason IS NOT NULL AND length(btrim(prn_reason)) > 0)),
  -- A scheduled (non-PRN) log must reference the slot it satisfies.
  CONSTRAINT medication_logs_scheduled_for_present
    CHECK (status = 'prn' OR scheduled_for IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS medication_logs_owner_time_idx
  ON app.medication_logs (owner_user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS medication_logs_med_idx
  ON app.medication_logs (medication_id);

-- Idempotency: at most ONE scheduled log per (medication, slot instant). PRN logs
-- (scheduled_for IS NULL) are unconstrained. A double-submit of the same slot hits this
-- unique index and the route maps it to 409 (Codex R1: dose-log double-submit race).
CREATE UNIQUE INDEX IF NOT EXISTS medication_logs_scheduled_unique
  ON app.medication_logs (medication_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

-- SECURITY INVOKER (the default) — NOT DEFINER. The function owner (jarvis_migration_owner)
-- is NOBYPASSRLS and has no SELECT policy on app.medications, so a DEFINER body would see
-- ZERO rows under FORCE RLS and wrongly reject every legitimate same-owner insert. Running as
-- the invoker (jarvis_app_runtime, with the actor's GUC) makes the parent medication visible
-- IFF the actor owns it — which is exactly the owner-equality predicate we want. A cross-owner
-- attempt sees no parent row (RLS hides it) and is rejected here, layered on top of the RLS
-- INSERT WITH CHECK that already requires owner_user_id = current actor.
CREATE OR REPLACE FUNCTION app.enforce_medication_log_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_temp
AS $$
DECLARE
  parent_owner uuid;
BEGIN
  SELECT owner_user_id INTO parent_owner FROM app.medications WHERE id = NEW.medication_id;
  IF parent_owner IS NULL OR parent_owner <> NEW.owner_user_id THEN
    RAISE EXCEPTION 'medication_log owner_user_id must equal the parent medication owner';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_medication_log_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enforce_medication_log_owner() TO jarvis_app_runtime;

DROP TRIGGER IF EXISTS medication_logs_enforce_owner ON app.medication_logs;
CREATE TRIGGER medication_logs_enforce_owner
BEFORE INSERT OR UPDATE ON app.medication_logs
FOR EACH ROW
EXECUTE FUNCTION app.enforce_medication_log_owner();

ALTER TABLE app.medication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.medication_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS medication_logs_select ON app.medication_logs;
CREATE POLICY medication_logs_select ON app.medication_logs
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medication_logs_insert ON app.medication_logs;
CREATE POLICY medication_logs_insert ON app.medication_logs
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medication_logs_update ON app.medication_logs;
CREATE POLICY medication_logs_update ON app.medication_logs
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medication_logs_delete ON app.medication_logs;
CREATE POLICY medication_logs_delete ON app.medication_logs
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.medication_logs TO jarvis_app_runtime;
