-- External module worker RPC access (#919, open module system Slice 3).
-- Child processes receive no DB handle. The trusted API parent opens a
-- jarvis_worker_runtime DataContext transaction for every RPC and SET LOCALs
-- both the invoking actor and the registered module id. RLS enforces both.

CREATE OR REPLACE FUNCTION app.current_module_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_module_id', true), '')
$$;

REVOKE ALL ON FUNCTION app.current_module_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_module_id() TO jarvis_worker_runtime;

CREATE POLICY module_credentials_worker_select ON app.module_credentials
  FOR SELECT TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND (
      scope = 'instance'
      OR (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    )
  );

GRANT SELECT ON app.module_credentials TO jarvis_worker_runtime;

CREATE POLICY module_kv_worker_select ON app.module_kv
  FOR SELECT TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_kv.module_id AND module.status = 'enabled'
    )
    AND (scope = 'instance' OR owner_user_id = app.current_actor_user_id())
  );

CREATE POLICY module_kv_worker_insert ON app.module_kv
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_kv.module_id AND module.status = 'enabled'
    )
    AND (scope = 'instance' OR owner_user_id = app.current_actor_user_id())
  );

CREATE POLICY module_kv_worker_update ON app.module_kv
  FOR UPDATE TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_kv.module_id AND module.status = 'enabled'
    )
    AND (scope = 'instance' OR owner_user_id = app.current_actor_user_id())
  )
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_kv.module_id AND module.status = 'enabled'
    )
    AND (scope = 'instance' OR owner_user_id = app.current_actor_user_id())
  );

CREATE POLICY module_kv_worker_delete ON app.module_kv
  FOR DELETE TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_kv.module_id AND module.status = 'enabled'
    )
    AND (scope = 'instance' OR owner_user_id = app.current_actor_user_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_kv TO jarvis_worker_runtime;
