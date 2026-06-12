-- Batch 1 (audit remediation): tighten the task_tag_assignments RLS policy from
-- parent-task *visibility* to parent-task *ownership* (OTNR-P27 #168).
--
-- The 0039 policy gated assignment read/write on whether the parent task is merely
-- VISIBLE (EXISTS a row in app.tasks with the matching id). Under a future read-share,
-- a recipient who can SEE a task would also be able to MUTATE its tag assignments.
-- Tag assignments are owner-private mutation surface, so the predicate must require the
-- parent task to be OWNED by the current actor. app.tasks.owner_user_id is NOT NULL
-- (packages/tasks/sql/0003_tasks_module.sql).

DROP POLICY IF EXISTS task_tag_assignments_rw ON app.task_tag_assignments;
CREATE POLICY task_tag_assignments_rw ON app.task_tag_assignments FOR ALL
  TO jarvis_app_runtime, jarvis_worker_runtime
  USING (
    EXISTS (
      SELECT 1 FROM app.tasks t
      WHERE t.id = task_id
        AND t.owner_user_id = app.current_actor_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app.tasks t
      WHERE t.id = task_id
        AND t.owner_user_id = app.current_actor_user_id()
    )
  );
