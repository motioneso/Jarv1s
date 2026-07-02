-- #671: the wellness-export pg-boss worker (jarvis_worker_runtime) calls
-- DataExportRepository.updateJobStatus/completeJob/failJob, each an
-- UPDATE ... WHERE id = $1. Postgres requires SELECT privilege on any column
-- referenced in an UPDATE's WHERE clause (and the RLS USING clause), not just
-- UPDATE on the SET columns. 0108_data_export_jobs.sql granted UPDATE only,
-- so every worker-side status transition failed with
-- "permission denied for table data_export_jobs" in production. The owner-only
-- RLS policy from 0108 already has no TO restriction, so it already covers
-- jarvis_worker_runtime once SELECT is granted — no policy change needed.
GRANT SELECT ON app.data_export_jobs TO jarvis_worker_runtime;
