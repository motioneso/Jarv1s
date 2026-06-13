-- Phase 3 connector-sync: the google-sync pg-boss worker runs as jarvis_worker_runtime
-- and must INSERT/UPDATE cached calendar events. Mirrors the M-A3 precedent
-- (packages/chat/sql/0036, packages/ai/sql/0037): additive role-widen on grants + RLS
-- policies, preserving the owner-or-share USING/WITH CHECK from 0020 verbatim.
--
-- Also resolves the M-B1 carried blocker: the only authenticating account is
-- provider_type='google', but the 0011/0020 INSERT WITH CHECK required
-- provider_type='calendar', so google-keyed inserts failed the EXISTS check. We relax
-- the EXISTS to accept provider_type IN ('calendar','google'); the 'google' branch is
-- scope-gated (the account must hold the Google Calendar scope). Owner-equality
-- (owner_user_id = app.current_actor_user_id()) is preserved verbatim.

GRANT SELECT, INSERT, UPDATE ON app.calendar_events TO jarvis_worker_runtime;

DROP POLICY IF EXISTS calendar_events_select ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_insert ON app.calendar_events;
DROP POLICY IF EXISTS calendar_events_update ON app.calendar_events;

CREATE POLICY calendar_events_select
ON app.calendar_events
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
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
        definitions.provider_type = 'calendar'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/calendar' = ANY (accounts.scopes)
        )
      )
  )
);

CREATE POLICY calendar_events_update
ON app.calendar_events
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
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
