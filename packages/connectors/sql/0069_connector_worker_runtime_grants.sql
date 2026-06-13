-- Phase 3 connector-sync: the google-sync worker (jarvis_worker_runtime) reads the
-- actor's encrypted Google OAuth bundle (SELECT on connector_accounts), re-encrypts the
-- refreshed token (UPDATE), and joins connector_definitions in the cache INSERT-policy
-- EXISTS check (SELECT). Mirrors the M-A3 precedent: additive role-widen on grants + RLS,
-- owner-scoped USING/WITH CHECK preserved verbatim from 0022/0009. connector_accounts
-- stay OWNER-ONLY (no app.has_share arm — secrets are never shared). No INSERT grant for
-- the worker: connection creation stays app-runtime only.
--
-- Numbered 0069 (the plan's placeholder 0068 was taken by the email worker-grants
-- migration that landed in Task A3; 0069 is the next free global slot).

GRANT SELECT ON app.connector_definitions TO jarvis_worker_runtime;
GRANT SELECT, UPDATE ON app.connector_accounts TO jarvis_worker_runtime;

DROP POLICY IF EXISTS connector_definitions_select ON app.connector_definitions;
CREATE POLICY connector_definitions_select
ON app.connector_definitions
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
);

DROP POLICY IF EXISTS connector_accounts_select ON app.connector_accounts;
CREATE POLICY connector_accounts_select
ON app.connector_accounts
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

DROP POLICY IF EXISTS connector_accounts_update ON app.connector_accounts;
CREATE POLICY connector_accounts_update
ON app.connector_accounts
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
