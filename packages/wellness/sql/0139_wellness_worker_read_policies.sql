-- #672: 0135 granted jarvis_worker_runtime table-level SELECT on these 4 tables but no RLS
-- policy. Under FORCE RLS that means the worker role's reads silently return zero rows instead
-- of erroring, so a wellness export can omit owner data while still reporting success. Add an
-- additional permissive SELECT policy per table for jarvis_worker_runtime, using the exact same
-- owner-only predicate already enforced for jarvis_app_runtime (Postgres ORs multiple permissive
-- policies together, so this does not widen what any row is visible to beyond its owner).

DROP POLICY IF EXISTS wellness_checkins_worker_select ON app.wellness_checkins;
CREATE POLICY wellness_checkins_worker_select ON app.wellness_checkins
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medications_worker_select ON app.medications;
CREATE POLICY medications_worker_select ON app.medications
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS medication_logs_worker_select ON app.medication_logs;
CREATE POLICY medication_logs_worker_select ON app.medication_logs
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS wellness_therapy_notes_worker_select ON app.wellness_therapy_notes;
CREATE POLICY wellness_therapy_notes_worker_select ON app.wellness_therapy_notes
  FOR SELECT TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id());
