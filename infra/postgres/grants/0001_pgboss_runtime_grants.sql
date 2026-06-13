GRANT USAGE ON SCHEMA pgboss TO jarvis_app_runtime, jarvis_worker_runtime;

GRANT USAGE ON TYPE pgboss.job_state TO jarvis_app_runtime, jarvis_worker_runtime;

-- Revoke the blanket ALL TABLES grant before applying narrowed per-table grants.
REVOKE ALL ON ALL TABLES IN SCHEMA pgboss FROM jarvis_app_runtime, jarvis_worker_runtime;

-- pgboss.job: app_runtime sends (SELECT+INSERT); worker_runtime processes (SELECT+INSERT+UPDATE).
-- NOTE: pgboss.job is a partitioned table — granting on the parent cascades to partitions.
GRANT SELECT, INSERT ON pgboss.job TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE ON pgboss.job TO jarvis_worker_runtime;

-- pgboss.queue: both roles need SELECT (pg-boss v12 reads queue on every send/work call)
GRANT SELECT ON pgboss.queue TO jarvis_app_runtime, jarvis_worker_runtime;

-- pgboss.subscription: both roles need SELECT
GRANT SELECT ON pgboss.subscription TO jarvis_app_runtime, jarvis_worker_runtime;

-- pgboss.version: both roles need SELECT (version handshake)
GRANT SELECT ON pgboss.version TO jarvis_app_runtime, jarvis_worker_runtime;

-- pgboss.job_common: the actual backing store for the partitioned job table.
-- pg-boss v12 routes inserts from pgboss.job -> pgboss.job_common; both roles need SELECT+INSERT.
-- Worker also needs UPDATE to mark jobs complete/failed.
GRANT SELECT, INSERT ON pgboss.job_common TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE ON pgboss.job_common TO jarvis_worker_runtime;

-- pgboss.schedule: the recurrence cron foundation (Phase 3 task-verticals) needs runtime access.
-- The API server upserts a per-actor daily schedule via boss.schedule() on the REQUEST path
-- (reconcileRecurrenceSchedule — POST /api/tasks create + GET /api/tasks/lists self-heal), which is
-- `INSERT ... ON CONFLICT (name,key) DO UPDATE` and so needs SELECT+INSERT+UPDATE. The worker
-- process runs the cron engine (schedule:true); pg-boss's timekeeper reads schedules (SELECT),
-- maintains them (INSERT/UPDATE), and removes them on unschedule (DELETE).
-- NOTE: every reconcile is failure-isolated (errors are swallowed), so a MISSING grant would
-- silently disable recurrence cron entirely — these grants are load-bearing, not defensive.
GRANT SELECT, INSERT, UPDATE ON pgboss.schedule TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.schedule TO jarvis_worker_runtime;

-- pgboss.bam, pgboss.warning: no runtime grant.
-- Both client roles run supervise:false; these tables are internal/maintenance only.

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;
