-- 0131: Proton Bridge credential connect + connection health (#641, uses the
-- 'proton-bridge' enum value added in 0130).
--
-- connector_definitions has FORCE ROW LEVEL SECURITY (from 0009). Migrations run as
-- jarvis_migration_owner, which FORCE subjects to RLS as well, so seed the row under a
-- transient migration-owner policy (the 0039 convention) and drop it. The per-file
-- transaction in sql-runner.ts keeps this atomic.
CREATE POLICY connector_definitions_migration_seed ON app.connector_definitions
  TO jarvis_migration_owner USING (true) WITH CHECK (true);

INSERT INTO app.connector_definitions (provider_id, provider_type, display_name, status, default_scopes)
VALUES (
  'proton-bridge',
  'proton-bridge',
  'Proton Mail (Bridge)',
  'available',
  ARRAY[]::text[]
)
ON CONFLICT (provider_id) DO UPDATE SET
  provider_type = excluded.provider_type,
  display_name = excluded.display_name,
  status = excluded.status,
  default_scopes = excluded.default_scopes,
  updated_at = now();

DROP POLICY connector_definitions_migration_seed ON app.connector_definitions;

-- Connection-probe health, distinct from the sync-job health columns added in 0099:
-- set synchronously by a connect/test-connection HTTP request rather than a worker job.
-- jarvis_app_runtime already holds a table-level UPDATE grant on app.connector_accounts
-- (0009), so no additional column-level GRANT is required here.
ALTER TABLE app.connector_accounts
  ADD COLUMN IF NOT EXISTS connection_health_status text,
  ADD COLUMN IF NOT EXISTS connection_health_checked_at timestamptz;

ALTER TABLE app.connector_accounts
  DROP CONSTRAINT IF EXISTS connector_accounts_connection_health_status_check,
  ADD CONSTRAINT connector_accounts_connection_health_status_check
    CHECK (connection_health_status IS NULL OR connection_health_status IN ('bridge_unreachable', 'auth_failed', 'ok'));

-- Extend the admin safe-metadata aggregate with the new connection-health columns. The
-- function's RETURNS TABLE signature changes, so the function must be dropped and
-- recreated rather than CREATE OR REPLACE'd. Applied migration 0100 is left untouched
-- (the runner hash-checks applied files).
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
  last_sync_counts jsonb,
  connection_health_status text,
  connection_health_checked_at timestamptz
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
    accounts.last_sync_counts,
    accounts.connection_health_status,
    accounts.connection_health_checked_at
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
