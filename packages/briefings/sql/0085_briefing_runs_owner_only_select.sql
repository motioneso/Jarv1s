-- Lock briefing_runs SELECT to owner-only, before any briefing-definition share-create
-- route exists. Migration 0026 widened the runs SELECT policy to owner-or-share
-- (inheriting the parent definition's `has_share('briefing_definition', id, 'view')`),
-- which would expose grounded RUN CONTENT — the synthesized briefing summary_text and
-- its source_metadata, both derived from the owner's private tasks/email/calendar — to a
-- share-view recipient the moment sharing is wired.
--
-- Sharing the briefing DEFINITION (title, cadence, selected tools) is intentional and
-- stays owner-or-share via 0026's briefing_definitions_select. The RUNS, however, carry
-- the actual personal-data-derived narrative, so their SELECT reverts to the owner-only
-- shape that shipped in 0015. The parent-definition-owner EXISTS guard mirrors the
-- briefing_runs_insert policy for defense-in-depth.
--
-- A future "share briefing runs" capability must arrive with its own spec + migration
-- (e.g. a distinct share level) rather than silently inheriting definition view access.
--
-- Both jarvis_app_runtime and jarvis_worker_runtime grant targets are preserved
-- (matching 0015 / 0026).

DROP POLICY IF EXISTS briefing_runs_select ON app.briefing_runs;

CREATE POLICY briefing_runs_select
ON app.briefing_runs
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1 FROM app.briefing_definitions def
    WHERE def.id = briefing_runs.definition_id
      AND def.owner_user_id = app.current_actor_user_id()
  )
);
