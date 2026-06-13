-- Phase 4 — per-user (member) onboarding state, stored in a DEDICATED OWNER-ONLY table.
--
-- One row per household MEMBER recording when they finished (or skipped — terminal
-- "onboarded") the member onboarding wizard. completed_at NULL / no row = not-yet-onboarded.
-- The founder's completion stays INSTANCE-GLOBAL (instance_settings onboarding.completed/
-- skipped) and never uses this table.
--
-- WHY A NEW TABLE INSTEAD OF an app.users column (security-critical):
--   app.users carries an ADMIN-WIDE SELECT policy (users_app_runtime_admin_select, 0052)
--   and an ADMIN-WIDE UPDATE policy (users_app_runtime_admin_update, 0050), both
--   USING app.current_actor_is_admin(). A column on app.users would therefore be
--   cross-user READABLE and WRITABLE by any admin through jarvis_app_runtime, breaking
--   the no-admin-private-data-bypass invariant. Member onboarding state is private to the
--   member, so it lives in its own table whose RLS has NO admin policy — modelled on
--   app.chat_memory_facts (packages/memory/sql/0041_memory_facts.sql).
--
-- RLS: ENABLE + FORCE; self-row SELECT/INSERT/UPDATE keyed on user_id =
-- app.current_actor_user_id(). No DELETE policy (rows are never deleted in this slice;
-- ON DELETE CASCADE removes the row when the user is deleted). NO admin policy of any kind.

CREATE TABLE IF NOT EXISTS app.member_onboarding (
  user_id      uuid        PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.member_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.member_onboarding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_onboarding_select ON app.member_onboarding;
CREATE POLICY member_onboarding_select ON app.member_onboarding
  FOR SELECT USING (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS member_onboarding_insert ON app.member_onboarding;
CREATE POLICY member_onboarding_insert ON app.member_onboarding
  FOR INSERT WITH CHECK (user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS member_onboarding_update ON app.member_onboarding;
CREATE POLICY member_onboarding_update ON app.member_onboarding
  FOR UPDATE USING (user_id = app.current_actor_user_id())
            WITH CHECK (user_id = app.current_actor_user_id());

-- Least privilege: ONLY jarvis_app_runtime gets row-level CRUD (the self-row policies above
-- constrain visibility). No worker path touches member onboarding, so jarvis_worker_runtime gets
-- NO grant. No admin grant beyond the self-row policies either — an admin is just another actor here.
GRANT SELECT, INSERT, UPDATE ON app.member_onboarding TO jarvis_app_runtime;
