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

-- pgboss.schedule, pgboss.bam, pgboss.warning: no runtime grant.
-- Both client roles run schedule:false/supervise:false; these tables are internal/maintenance only.

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC;
