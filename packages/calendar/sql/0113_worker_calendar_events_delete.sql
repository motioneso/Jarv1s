-- #473: google-sync reconciliation deletes stale/cancelled cached calendar events.
-- Worker remains owner-scoped by RLS; no admin/private-data bypass.

GRANT DELETE ON app.calendar_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS calendar_events_delete ON app.calendar_events;

CREATE POLICY calendar_events_delete
ON app.calendar_events
FOR DELETE
TO jarvis_worker_runtime
USING (
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
        definitions.provider_type = 'calendar'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/calendar' = ANY (accounts.scopes)
        )
      )
  )
);
