-- #1077: export.build reads app.entities as jarvis_worker_runtime but the role has never had
-- SELECT here. Mirror the existing jarvis_app_runtime entities_select predicate exactly
-- (owner-or-share, not narrowed to owner-only) — SELECT only, no writes.

GRANT SELECT ON app.entities TO jarvis_worker_runtime;

DROP POLICY IF EXISTS entities_select ON app.entities;
CREATE POLICY entities_select ON app.entities
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('entity', id, 'view')
  );
