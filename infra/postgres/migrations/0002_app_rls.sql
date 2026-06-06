CREATE OR REPLACE FUNCTION app.current_actor_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw_value text;
BEGIN
  raw_value := current_setting('app.actor_user_id', true);

  IF raw_value IS NULL OR raw_value = '' THEN
    RETURN NULL;
  END IF;

  RETURN raw_value::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.current_workspace_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw_value text;
BEGIN
  raw_value := current_setting('app.workspace_id', true);

  IF raw_value IS NULL OR raw_value = '' THEN
    RETURN NULL;
  END IF;

  RETURN raw_value::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.has_resource_grant(
  p_resource_type text,
  p_resource_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT p_actor_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM resource_grants grants
      WHERE grants.resource_type = p_resource_type
        AND grants.resource_id = p_resource_id
        AND grants.grantee_user_id = p_actor_user_id
        AND grants.grant_level IN ('view', 'contribute', 'manage')
    );
$$;

CREATE OR REPLACE FUNCTION app.is_workspace_member(
  p_workspace_id uuid,
  p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT p_workspace_id IS NOT NULL
    AND p_actor_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM workspace_memberships memberships
      WHERE memberships.workspace_id = p_workspace_id
        AND memberships.user_id = p_actor_user_id
    );
$$;

REVOKE ALL ON FUNCTION app.current_actor_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_workspace_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.has_resource_grant(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_workspace_member(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.current_actor_user_id() TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT EXECUTE ON FUNCTION app.current_workspace_id() TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT EXECUTE ON FUNCTION app.has_resource_grant(text, uuid, uuid) TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT EXECUTE ON FUNCTION app.is_workspace_member(uuid, uuid) TO jarvis_app_runtime, jarvis_worker_runtime;

ALTER TABLE app.rls_probe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rls_probe_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_probe_items_select ON app.rls_probe_items;

CREATE POLICY rls_probe_items_select
ON app.rls_probe_items
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_resource_grant('rls_probe_item', id, app.current_actor_user_id())
    OR (
      visibility = 'workspace'
      AND workspace_id IS NOT NULL
      AND workspace_id = app.current_workspace_id()
      AND app.is_workspace_member(workspace_id, app.current_actor_user_id())
    )
  )
);
