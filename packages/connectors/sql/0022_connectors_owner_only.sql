-- Slice 1c: convert connector_accounts access from owner + workspace-scoping to
-- plain owner-only. connector_accounts hold AES-encrypted credentials and are NOT
-- shareable (the "secrets never shared" invariant) — no app.has_share arm is added.
-- The workspace_id column remains but is no longer consulted for access; it is
-- dropped in Slice 1f. connector_definitions (catalog) policies are unchanged.

DROP POLICY IF EXISTS connector_accounts_select ON app.connector_accounts;
DROP POLICY IF EXISTS connector_accounts_insert ON app.connector_accounts;
DROP POLICY IF EXISTS connector_accounts_update ON app.connector_accounts;

CREATE POLICY connector_accounts_select
ON app.connector_accounts
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY connector_accounts_insert
ON app.connector_accounts
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY connector_accounts_update
ON app.connector_accounts
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
