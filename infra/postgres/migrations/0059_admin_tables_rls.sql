-- Batch 1 (audit remediation): enable RLS on the two instance-wide admin tables that
-- previously had grants but NO row-level security (OTNR-P1 #117, originally audit-P1 #104).
--
-- These tables have no owner_user_id (they are instance-global), so RLS gates on admin status
-- for writes / reads rather than per-row ownership.
--
-- Design notes (verified against 639e8cb):
--   * app.instance_settings is read in a PRE-AUTH context by the registration gate
--     (packages/auth/src/index.ts readBooleanSetting -> "registration.enabled"), running as
--     jarvis_app_runtime with NO actor GUC set. SELECT must therefore stay permissive
--     (USING (true)) or registration breaks. Instance settings are non-secret config only —
--     secrets live in the AES-256-GCM credential store, never here. The security value is
--     gating WRITES to admins.
--   * app.admin_audit_events SELECT is admin-only (the confidentiality finding). INSERT is
--     left permissive (WITH CHECK (true)) on purpose: gating INSERT on current_actor_is_admin()
--     would break self-demote, where the actor's is_instance_admin flag is flipped earlier in
--     the same transaction before the audit row is written. The log is append-only — there is
--     no UPDATE/DELETE grant, and no permissive UPDATE/DELETE policy, so writes other than
--     INSERT are denied.

-- ---------------------------------------------------------------------------
-- app.instance_settings
-- ---------------------------------------------------------------------------
ALTER TABLE app.instance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.instance_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instance_settings_select ON app.instance_settings;
CREATE POLICY instance_settings_select ON app.instance_settings
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (true);

DROP POLICY IF EXISTS instance_settings_insert ON app.instance_settings;
CREATE POLICY instance_settings_insert ON app.instance_settings
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS instance_settings_update ON app.instance_settings;
CREATE POLICY instance_settings_update ON app.instance_settings
  FOR UPDATE TO jarvis_app_runtime
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS instance_settings_delete ON app.instance_settings;
CREATE POLICY instance_settings_delete ON app.instance_settings
  FOR DELETE TO jarvis_app_runtime
  USING (app.current_actor_is_admin());

-- ---------------------------------------------------------------------------
-- app.admin_audit_events
-- ---------------------------------------------------------------------------
ALTER TABLE app.admin_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.admin_audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_audit_events_select ON app.admin_audit_events;
CREATE POLICY admin_audit_events_select ON app.admin_audit_events
  FOR SELECT TO jarvis_app_runtime
  USING (app.current_actor_is_admin());

DROP POLICY IF EXISTS admin_audit_events_insert ON app.admin_audit_events;
CREATE POLICY admin_audit_events_insert ON app.admin_audit_events
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (true);
-- No UPDATE/DELETE policy: the audit log is append-only.
