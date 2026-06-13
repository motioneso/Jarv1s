-- Phase 3 connector-sync: worker role + RLS for email caches. Mirrors 0066 (calendar)
-- and the M-A3 grant precedent. Owner-or-share USING/WITH CHECK preserved from 0021
-- verbatim; INSERT EXISTS relaxed to provider_type IN ('email','google') with a
-- gmail-scope guard for the 'google' branch. Owner-equality preserved verbatim.

GRANT SELECT, INSERT, UPDATE ON app.email_messages TO jarvis_worker_runtime;

DROP POLICY IF EXISTS email_messages_select ON app.email_messages;
DROP POLICY IF EXISTS email_messages_insert ON app.email_messages;
DROP POLICY IF EXISTS email_messages_update ON app.email_messages;

CREATE POLICY email_messages_select
ON app.email_messages
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
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
TO jarvis_app_runtime, jarvis_worker_runtime
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
      AND (
        definitions.provider_type = 'email'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/gmail.modify' = ANY (accounts.scopes)
        )
      )
  )
);

CREATE POLICY email_messages_update
ON app.email_messages
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
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
