-- Phase 3 real-briefings: the briefings pg-boss worker runs as jarvis_worker_runtime
-- and must read commitments through the commitments.listVisible read tool. Migration
-- 0031 granted SELECT and a SELECT policy to jarvis_app_runtime only. Add the worker
-- role to both. RLS still scopes to the owner OR an explicit share (mirroring 0031
-- EXACTLY — do not weaken it to owner-only, which would drop shared-commitment
-- visibility for a briefing). New file — never edit the applied 0031.

GRANT SELECT ON app.commitments TO jarvis_worker_runtime;

DROP POLICY IF EXISTS commitments_select_worker ON app.commitments;
CREATE POLICY commitments_select_worker ON app.commitments
  FOR SELECT TO jarvis_worker_runtime
  USING (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('commitment', id, 'view')
  );
