-- Drop workspace subsystem tables and the dead grant-consuming functions.
-- Tables are functionally unused since 0019; deleting eliminates the no-RLS
-- metadata-enumeration surface (#120, #115, #116, #153).
--
-- CASCADE is belt-and-braces ordering only. It does NOT remove $$-body SQL functions
-- (no tracked Postgres dependency). Functions are dropped explicitly below.

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
