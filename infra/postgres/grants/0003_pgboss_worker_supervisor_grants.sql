-- #650: the worker is the sole pg-boss supervisor owner (`supervise: true`).
--
-- pg-boss supervision reaps expired active jobs by:
--   - stamping monitor/maintenance fields on pgboss.queue
--   - deleting timed-out rows from pgboss.job, then reinserting retry/failed rows
--
-- Keep this scoped to jarvis_worker_runtime. The API runtime stays supervise:false
-- and must not gain maintenance ownership.

GRANT UPDATE ON pgboss.queue TO jarvis_worker_runtime;
GRANT DELETE ON pgboss.job, pgboss.job_common TO jarvis_worker_runtime;
