-- Slice B: remove has_resource_grant_level and the stubs created by infra 0056.
--
-- On a fresh DB (resetEmptyFoundationDatabase): runs after 0003 (which created
-- has_resource_grant_level using the stub resource_grants table and created
-- tasks_select/tasks_update policies that reference the stub functions). Drops
-- them so 0019 can recreate the policies using has_share.
--
-- On an incremental DB: has_resource_grant_level was already dropped by infra 0056;
-- DROP IF EXISTS is a no-op. The stub resource_grants table and stub
-- has_resource_grant function (both created by 0056) are removed here.

-- CASCADE removes dependent RLS policies on a fresh DB (where 0003's policies still
-- reference these functions). On an incremental DB 0019 already replaced those policies;
-- CASCADE is a no-op since no live policies depend on the functions.
DROP FUNCTION IF EXISTS app.has_resource_grant_level(text, uuid, uuid, text[]) CASCADE;
DROP TABLE IF EXISTS app.resource_grants;
DROP FUNCTION IF EXISTS app.has_resource_grant(text, uuid, uuid) CASCADE;
