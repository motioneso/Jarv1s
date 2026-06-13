-- Branch-review LOW (calendar/sql/0066:54): the calendar_events UPDATE policy's
-- WITH CHECK lacked the connector-account/scope EXISTS guard that the INSERT policy
-- (0066) enforces. Owner-equality alone meant the post-UPDATE row state was not
-- re-validated against a connector account the actor actually owns and that holds the
-- Google Calendar scope — the same provenance guarantee the INSERT path requires.
-- No cross-user leak exists today (owner-equality is preserved and the
-- prevent-identity-change trigger forbids re-pointing connector_account_id /
-- owner_user_id on UPDATE), so this is defense-in-depth: bring UPDATE to parity with
-- INSERT so a cached event can only ever land/persist behind a scoped connector account.
--
-- The guard is scoped to the OWNER branch only (mirroring INSERT, which is owner-only).
-- The owner-or-share('manage') recipient branch is preserved verbatim: a share
-- recipient does not own the connector account, so it must not be subjected to the
-- owner's connector-scope EXISTS check. Owner-equality and the share path from 0066
-- are otherwise unchanged. Re-runnable: DROP ... IF EXISTS then CREATE.

DROP POLICY IF EXISTS calendar_events_update ON app.calendar_events;

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
    (
      owner_user_id = app.current_actor_user_id()
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
    )
    OR app.has_share('calendar_event', id, 'manage')
  )
);
