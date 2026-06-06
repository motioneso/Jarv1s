-- Slice 1c: convert Email access from workspace-visibility to the owner-or-share
-- model (app.has_share). visibility/workspace_id columns remain but are no longer
-- consulted (dropped in Slice 1f). The connector-account integrity EXISTS check in
-- INSERT is preserved.

DROP POLICY IF EXISTS email_messages_select ON app.email_messages;
DROP POLICY IF EXISTS email_messages_insert ON app.email_messages;
DROP POLICY IF EXISTS email_messages_update ON app.email_messages;

CREATE POLICY email_messages_select
ON app.email_messages
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('email_message', id, 'view')
  )
);

CREATE POLICY email_messages_insert
ON app.email_messages
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND definitions.provider_type = 'email'
  )
);

CREATE POLICY email_messages_update
ON app.email_messages
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('email_message', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('email_message', id, 'manage')
  )
);
