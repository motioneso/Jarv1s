-- #557: grant jarvis_app_runtime DELETE on calendar_events for calendar.deleteEvent tool.
-- Owner+connector scoped (identical structure to 0113 worker-runtime delete policy).
-- No BYPASSRLS. FORCE RLS remains enabled.

GRANT DELETE ON app.calendar_events TO jarvis_app_runtime;

DROP POLICY IF EXISTS calendar_events_app_runtime_delete ON app.calendar_events;

CREATE POLICY calendar_events_app_runtime_delete
ON app.calendar_events
FOR DELETE
TO jarvis_app_runtime
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
