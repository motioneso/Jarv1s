CREATE TABLE IF NOT EXISTS app.shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (length(btrim(resource_type)) > 0),
  resource_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  grantee_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('view', 'contribute', 'manage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shares_no_self_grant CHECK (owner_user_id <> grantee_user_id),
  UNIQUE (resource_type, resource_id, grantee_user_id)
);

-- Covering index for app.has_share(): the leading three columns are already
-- indexed by the UNIQUE constraint; this adds level for index-only lookups.
CREATE INDEX IF NOT EXISTS shares_grantee_lookup_idx
  ON app.shares (resource_type, resource_id, grantee_user_id, level);

CREATE INDEX IF NOT EXISTS shares_owner_idx
  ON app.shares (owner_user_id);

CREATE OR REPLACE FUNCTION app.share_level_rank(p_level text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_level
    WHEN 'view' THEN 1
    WHEN 'contribute' THEN 2
    WHEN 'manage' THEN 3
    ELSE 0
  END;
$$;

-- Answers only the SHARE half of access ("does a qualifying share exist for the
-- current actor at >= the requested level?"). It deliberately does NOT consult
-- ownership — callers OR this with `owner_user_id = app.current_actor_user_id()`
-- in their RLS policy, exactly like app.has_resource_grant.
CREATE OR REPLACE FUNCTION app.has_share(
  p_resource_type text,
  p_resource_id uuid,
  p_level text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT app.current_actor_user_id() IS NOT NULL
    AND app.share_level_rank(p_level) > 0
    AND EXISTS (
      SELECT 1
      FROM shares s
      WHERE s.resource_type = p_resource_type
        AND s.resource_id = p_resource_id
        AND s.grantee_user_id = app.current_actor_user_id()
        AND app.share_level_rank(s.level) >= app.share_level_rank(p_level)
    );
$$;

REVOKE ALL ON FUNCTION app.share_level_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.has_share(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.share_level_rank(text)
  TO jarvis_app_runtime, jarvis_worker_runtime;
GRANT EXECUTE ON FUNCTION app.has_share(text, uuid, text)
  TO jarvis_app_runtime, jarvis_worker_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON app.shares TO jarvis_app_runtime;

ALTER TABLE app.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.shares FORCE ROW LEVEL SECURITY;

-- Allow SECURITY DEFINER helpers (owned by jarvis_migration_owner) to read all shares.
DROP POLICY IF EXISTS shares_internal_select ON app.shares;
CREATE POLICY shares_internal_select ON app.shares
FOR SELECT
TO jarvis_migration_owner
USING (true);

DROP POLICY IF EXISTS shares_select ON app.shares;
CREATE POLICY shares_select ON app.shares
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR grantee_user_id = app.current_actor_user_id()
  )
);

DROP POLICY IF EXISTS shares_insert ON app.shares;
CREATE POLICY shares_insert ON app.shares
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS shares_update ON app.shares;
CREATE POLICY shares_update ON app.shares
FOR UPDATE
TO jarvis_app_runtime
USING (owner_user_id = app.current_actor_user_id())
WITH CHECK (owner_user_id = app.current_actor_user_id());

DROP POLICY IF EXISTS shares_delete ON app.shares;
CREATE POLICY shares_delete ON app.shares
FOR DELETE
TO jarvis_app_runtime
USING (owner_user_id = app.current_actor_user_id());
