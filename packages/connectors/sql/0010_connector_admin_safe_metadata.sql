DROP POLICY IF EXISTS connector_definitions_admin_metadata_select ON app.connector_definitions;
DROP POLICY IF EXISTS connector_accounts_admin_metadata_select ON app.connector_accounts;

CREATE POLICY connector_definitions_admin_metadata_select
ON app.connector_definitions
FOR SELECT
TO jarvis_migration_owner
USING (
  EXISTS (
    SELECT 1
    FROM app.users admin_user
    WHERE admin_user.id = app.current_actor_user_id()
      AND admin_user.is_instance_admin
  )
);

CREATE POLICY connector_accounts_admin_metadata_select
ON app.connector_accounts
FOR SELECT
TO jarvis_migration_owner
USING (
  EXISTS (
    SELECT 1
    FROM app.users admin_user
    WHERE admin_user.id = app.current_actor_user_id()
      AND admin_user.is_instance_admin
  )
);

CREATE OR REPLACE FUNCTION app.list_connector_account_safe_metadata()
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
  updated_at timestamptz
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
    accounts.updated_at
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
