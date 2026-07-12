-- External worker schedule fan-out needs the ids of active users for one enabled
-- external module. Runtime roles cannot enumerate app.users directly; expose only
-- this bounded metadata query through a locked-down SECURITY DEFINER function.
--
-- Uses the proven 0112/0137/0144 jarvis_migration_owner pattern because module
-- migrations run as a NOCREATEROLE role and therefore cannot create a bespoke
-- NOLOGIN function owner. FORCE RLS still applies to external_modules and
-- module_enablement, so grant the owner only the two narrow policies this query needs.

DROP POLICY IF EXISTS external_modules_scheduler_owner_select
  ON app.external_modules;
CREATE POLICY external_modules_scheduler_owner_select
ON app.external_modules
FOR SELECT
TO jarvis_migration_owner
USING (status = 'enabled');

DROP POLICY IF EXISTS module_enablement_scheduler_owner_select
  ON app.module_enablement;
CREATE POLICY module_enablement_scheduler_owner_select
ON app.module_enablement
FOR SELECT
TO jarvis_migration_owner
USING (scope IN ('instance', 'user'));

CREATE FUNCTION app.list_active_external_module_users(target_module_id text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
  SELECT users.id
  FROM app.users AS users
  WHERE users.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM app.external_modules AS modules
      WHERE modules.id = target_module_id
        AND modules.status = 'enabled'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM app.module_enablement AS denied
      WHERE denied.module_id = target_module_id
        AND (
          denied.scope = 'instance'
          OR (denied.scope = 'user' AND denied.user_id = users.id)
        )
    )
  ORDER BY users.id
$$;

REVOKE ALL ON FUNCTION app.list_active_external_module_users(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_active_external_module_users(text)
  TO jarvis_worker_runtime;
