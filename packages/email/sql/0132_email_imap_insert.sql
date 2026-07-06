-- Widen the email_messages INSERT policy (0068) to also accept provider_type='imap',
-- gated on the account holding the email.read scope (mirrors the 'google' + gmail.modify
-- branch already in 0068). Owner-equality and the calendar/select/update policies are
-- untouched — this migration only replaces the insert policy's EXISTS clause.

DROP POLICY IF EXISTS email_messages_insert ON app.email_messages;

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
        OR (
          definitions.provider_type = 'imap'
          AND 'email.read' = ANY (accounts.scopes)
        )
      )
  )
);
