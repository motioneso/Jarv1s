-- Drop workspace subsystem tables and the dead grant-consuming functions.
-- Tables are functionally unused since 0019; deleting eliminates the no-RLS
-- metadata-enumeration surface (#120, #115, #116, #153).
--
-- CASCADE is belt-and-braces ordering only. It does NOT remove $$-body SQL functions
-- (no tracked Postgres dependency). Functions are dropped explicitly below.
--
-- Stub ordering note: on a fresh DB resetEmptyFoundationDatabase replays all infra
-- migrations first, then module migrations. Module 0003_tasks_module.sql creates
-- has_resource_grant_level (body references resource_grants) and a tasks_select
-- policy (calls has_resource_grant). PG17 validates LANGUAGE sql bodies at creation
-- time, so both fail if the table/function are absent. The stubs below satisfy those
-- validation requirements; 0006_tasks_drop_workspace_grants.sql removes them after
-- 0003 runs.

DROP TABLE IF EXISTS app.resource_grants CASCADE;
DROP TABLE IF EXISTS app.workspace_memberships CASCADE;
DROP TABLE IF EXISTS app.workspaces CASCADE;

-- has_resource_grant: SECURITY DEFINER function, de-referenced from live policies at 0019.
-- Actual signature is (text, uuid, uuid) — confirmed at 0002_app_rls.sql:43-47.
DROP FUNCTION IF EXISTS app.has_resource_grant(text, uuid, uuid);

-- has_resource_grant_level: created in packages/tasks/sql/0003_tasks_module.sql:45-90,
-- also queries resource_grants, still EXECUTE-granted to both runtime roles.
-- Placed here (infra/ DROP migration) because it references infra-owned tables.
-- The "module SQL lives in module sql/" rule applies to creation, not to dropping
-- tables/functions whose backing data no longer exists.
DROP FUNCTION IF EXISTS app.has_resource_grant_level(text, uuid, uuid, text[]);

-- Stub resource_grants: minimal schema matching has_resource_grant_level's body.
-- FORCE RLS with no policies → appears empty to all runtime roles.
-- Removed by module migration 0006_tasks_drop_workspace_grants.sql.
CREATE TABLE app.resource_grants (
  resource_type   text NOT NULL,
  resource_id     uuid NOT NULL,
  grantee_user_id uuid NOT NULL,
  grant_level     text NOT NULL
);
REVOKE ALL ON app.resource_grants FROM PUBLIC;
ALTER TABLE app.resource_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.resource_grants FORCE ROW LEVEL SECURITY;

-- Stub has_resource_grant: always returns false (no rows in stub table).
-- Exists so that module 0003's tasks_select policy can reference it by signature.
-- Removed by module migration 0006_tasks_drop_workspace_grants.sql.
CREATE FUNCTION app.has_resource_grant(
  p_resource_type text,
  p_resource_id   uuid,
  p_actor_user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$ SELECT false $$;
