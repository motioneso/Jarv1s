-- FIN-00 (#1145) — worker-written user-scope credentials (auth.setCredential RPC).
-- jarvis_worker_runtime has been SELECT-only on app.module_credentials since 0157.
-- The new RPC persists runtime-minted secrets (OAuth-style token exchanges) via
-- upsertModuleCredential, which needs INSERT + UPDATE. RLS mirrors 0157's
-- module-binding predicate but is deliberately NARROWER than the SELECT policy:
-- writes are user-scope, owner-bound only — instance-scope credential writes stay
-- impossible for this role at the database itself (spec D1 defense in depth).

CREATE POLICY module_credentials_worker_insert ON app.module_credentials
  FOR INSERT TO jarvis_worker_runtime
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND scope = 'user'
    AND owner_user_id = app.current_actor_user_id()
  );

CREATE POLICY module_credentials_worker_update ON app.module_credentials
  FOR UPDATE TO jarvis_worker_runtime
  USING (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND scope = 'user'
    AND owner_user_id = app.current_actor_user_id()
  )
  WITH CHECK (
    app.current_actor_user_id() IS NOT NULL
    AND module_id = app.current_module_id()
    AND EXISTS (
      SELECT 1 FROM app.external_modules module
      WHERE module.id = module_credentials.module_id
        AND module.status = 'enabled'
    )
    AND scope = 'user'
    AND owner_user_id = app.current_actor_user_id()
  );

GRANT INSERT, UPDATE ON app.module_credentials TO jarvis_worker_runtime;
