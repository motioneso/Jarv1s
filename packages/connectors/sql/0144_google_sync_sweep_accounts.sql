-- #792: recurring Google Calendar sync sweep. The 0069 policy correctly keeps
-- connector_accounts SELECT owner-scoped even for jarvis_worker_runtime, so the periodic
-- sweep worker (packages/connectors/src/google-sync-sweep.ts) — which must legitimately
-- enumerate EVERY connected Google account, not just one actor's — cannot use a plain
-- SELECT. Mirrors the app.list_expired_data_export_jobs precedent (0112/0115): a bounded,
-- no-actor-gate SECURITY DEFINER function that returns only the narrow columns the sweep
-- needs (id + owner_user_id) — never scopes/tokens/secrets. Each returned actor is then
-- re-scoped through the normal per-actor GOOGLE_SYNC_QUEUE job, which continues to run
-- under DataContextDb exactly as it does today for the connect/manual-sync triggers.
--
-- connector_accounts has FORCE ROW LEVEL SECURITY (0009/0069), which applies even to a
-- SECURITY DEFINER function's owning role (jarvis_migration_owner) — a bare SECURITY
-- DEFINER function here would silently see zero rows. The 0112 precedent
-- (data_export_jobs_cleanup_list) solves this with an explicit unrestricted SELECT policy
-- scoped to jarvis_migration_owner alone (never granted to app/worker runtime roles, so it
-- cannot be reached by ordinary request-scoped queries); this migration adds the same
-- narrowly-scoped bypass policy for connector_accounts.
DROP POLICY IF EXISTS connector_accounts_migration_owner_select
  ON app.connector_accounts;

CREATE POLICY connector_accounts_migration_owner_select
ON app.connector_accounts
FOR SELECT
TO jarvis_migration_owner
USING (true);

CREATE FUNCTION app.list_connected_google_calendar_accounts()
RETURNS TABLE(id uuid, "ownerUserId" uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT id, owner_user_id AS "ownerUserId"
  FROM app.connector_accounts
  WHERE provider_id = 'google'
    AND status = 'active'
    AND 'https://www.googleapis.com/auth/calendar' = ANY(scopes)
  ORDER BY id ASC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION app.list_connected_google_calendar_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_connected_google_calendar_accounts()
  TO jarvis_worker_runtime, jarvis_app_runtime;
