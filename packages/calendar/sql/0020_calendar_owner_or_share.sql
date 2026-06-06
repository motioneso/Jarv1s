-- Slice 1c: convert Calendar access from workspace-visibility to the owner-or-share
-- model (app.has_share). The visibility/workspace_id columns remain on
-- app.calendar_events but are no longer consulted for access; they are dropped in
-- Slice 1f. The connector-account integrity EXISTS check in the INSERT policy is a
-- data-integrity guard (not a visibility gate) and is preserved.

DROP POLICY IF EXISTS calendar_events_select ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_insert ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_update ON app.calendar_events;

CREATE POLICY calendar_events_select
ON app.calendar_events
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('calendar_event', id, 'view')
  )
);

CREATE POLICY calendar_events_insert
ON app.calendar_events
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
      AND definitions.provider_type = 'calendar'
  )
);

CREATE POLICY calendar_events_update
ON app.calendar_events
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('calendar_event', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('calendar_event', id, 'manage')
  )
);
