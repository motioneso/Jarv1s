-- Slice 1c-1d: convert Briefings to owner-or-share (definitions) with parent-child
-- inheritance (runs visible iff actor can see the parent definition).
-- visibility/workspace_id columns remain inert (dropped in Slice 1f).
-- Both jarvis_app_runtime and jarvis_worker_runtime grant targets are preserved for
-- definitions_select, definitions_update, runs_select, and runs_insert (matching 0015).

DROP POLICY IF EXISTS briefing_definitions_select ON app.briefing_definitions;
DROP POLICY IF EXISTS briefing_definitions_insert ON app.briefing_definitions;
DROP POLICY IF EXISTS briefing_definitions_update ON app.briefing_definitions;
DROP POLICY IF EXISTS briefing_runs_select ON app.briefing_runs;
DROP POLICY IF EXISTS briefing_runs_insert ON app.briefing_runs;

CREATE POLICY briefing_definitions_select
ON app.briefing_definitions
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('briefing_definition', id, 'view')
  )
);

CREATE POLICY briefing_definitions_insert
ON app.briefing_definitions
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY briefing_definitions_update
ON app.briefing_definitions
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('briefing_definition', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('briefing_definition', id, 'manage')
  )
);

CREATE POLICY briefing_runs_select
ON app.briefing_runs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM app.briefing_definitions def
    WHERE def.id = briefing_runs.definition_id
      AND (
        def.owner_user_id = app.current_actor_user_id()
        OR app.has_share('briefing_definition', def.id, 'view')
      )
  )
);

CREATE POLICY briefing_runs_insert
ON app.briefing_runs
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1 FROM app.briefing_definitions def
    WHERE def.id = briefing_runs.definition_id
      AND def.owner_user_id = app.current_actor_user_id()
  )
);
