-- Extend the admin safe-metadata aggregate with durable sync-health columns
-- (#254). The function's RETURNS TABLE signature changes, so the function must be
-- dropped and recreated rather than CREATE OR REPLACE'd. Applied migration 0010 is
-- left untouched (the runner hash-checks applied files).
--
-- Health fields stay aggregate-only: bounded status/error labels and a small JSON
-- counts object. No subjects, titles, external IDs, provider bodies, or secrets.
DROP FUNCTION IF EXISTS app.list_connector_account_safe_metadata();

CREATE FUNCTION app.list_connector_account_safe_metadata()
RETURNS TABLE (
  id uuid,
  provider_id text,
  provider_type app.connector_provider_type,
  provider_display_name text,
  provider_status app.connector_provider_status,
  owner_user_id uuid,
  scopes text[],
  status app.connector_account_status,
  has_secret boolean,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_finished_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_counts jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT
    accounts.id,
    accounts.provider_id,
    definitions.provider_type,
    definitions.display_name AS provider_display_name,
    definitions.status AS provider_status,
    accounts.owner_user_id,
    accounts.scopes,
    accounts.status,
    accounts.encrypted_secret IS NOT NULL AS has_secret,
    accounts.revoked_at,
    accounts.created_at,
    accounts.updated_at,
    accounts.last_sync_started_at,
    accounts.last_sync_finished_at,
    accounts.last_sync_status,
    accounts.last_sync_error,
    accounts.last_sync_counts
  FROM app.connector_accounts accounts
  JOIN app.connector_definitions definitions
    ON definitions.provider_id = accounts.provider_id
  WHERE EXISTS (
    SELECT 1
    FROM app.users admin_user
    WHERE admin_user.id = app.current_actor_user_id()
      AND admin_user.is_instance_admin
  )
  ORDER BY accounts.created_at DESC, accounts.id;
$$;

REVOKE ALL ON FUNCTION app.list_connector_account_safe_metadata() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.list_connector_account_safe_metadata()
  TO jarvis_app_runtime;
