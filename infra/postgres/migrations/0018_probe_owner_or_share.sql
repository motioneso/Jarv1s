-- Slice 1b: convert the core RLS probe from workspace-visibility + resource_grants
-- to the owner-or-share model (app.has_share). The visibility and workspace_id
-- columns remain on app.rls_probe_items but are no longer consulted for access;
-- they are dropped in Slice 1f.

DROP POLICY IF EXISTS rls_probe_items_select ON app.rls_probe_items;

CREATE POLICY rls_probe_items_select
ON app.rls_probe_items
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('rls_probe_item', id, 'view')
  )
);
