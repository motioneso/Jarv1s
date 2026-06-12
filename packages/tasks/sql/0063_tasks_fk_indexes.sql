-- OTNR #168 P27 (MED): add FK-covering indexes missing from the 0039 foundation migration.
--
-- task_tag_assignments.tag_id FK → app.task_tags has no index; scans grow with tags per user.
-- tasks.list_id FK → app.task_lists has no index; list-scoped task queries do a seqscan.
--
-- Both tables were created in 0039_tasks_foundation.sql.

CREATE INDEX IF NOT EXISTS task_tag_assignments_tag_id_idx ON app.task_tag_assignments (tag_id);
CREATE INDEX IF NOT EXISTS tasks_list_id_idx ON app.tasks (list_id);
