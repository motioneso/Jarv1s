-- Phase 3 task-verticals: make the worker's recurrence-materialization capability
-- explicit and self-documenting. The scheduled cron worker runs rollForwardOwnedSeries,
-- which UPDATEs app.tasks in place (and INSERT covers the completion-style generateNext
-- path should it ever run in a worker). jarvis_worker_runtime already received
-- SELECT, INSERT, UPDATE on app.tasks in 0003_tasks_module.sql and no migration has
-- revoked it; re-granting is an idempotent no-op. The app.tasks RLS policies
-- (0019_tasks_owner_or_share.sql) already list jarvis_worker_runtime in their TO clause,
-- so the worker's writes are RLS-scoped to the job's actor automatically. No new policy.
GRANT INSERT, UPDATE ON app.tasks TO jarvis_worker_runtime;
