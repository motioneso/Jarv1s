-- Fix: add admin-scoped SELECT policy on app.users for jarvis_app_runtime.
--
-- PostgreSQL requires SELECT policies to pass as a visibility filter before UPDATE
-- policies are evaluated. Migration 0050 added users_app_runtime_admin_update but
-- the self-row users_app_runtime_select policy (from 0047) makes non-self rows
-- invisible to jarvis_app_runtime, causing admin UPDATEs to silently return 0 rows.
--
-- This policy mirrors the UPDATE policy: when the actor GUC is set to an active
-- admin, the admin can see all user rows via direct table SELECT.  The admin already
-- has equivalent read access via app.list_all_users() and app.get_user_by_id()
-- SECURITY DEFINER helpers; this policy is needed so those rows are also visible
-- inside UPDATE statements.
DROP POLICY IF EXISTS users_app_runtime_admin_select ON app.users;
CREATE POLICY users_app_runtime_admin_select
  ON app.users
  FOR SELECT
  TO jarvis_app_runtime
  USING (app.current_actor_is_admin());
