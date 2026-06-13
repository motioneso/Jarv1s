-- Phase 3 real-briefings (F14): enable the pg-boss per-definition cron engine.
--
-- 0001_pgboss_runtime_grants.sql deliberately granted NO privileges on
-- pgboss.schedule because both client roles ran schedule:false. The briefings
-- slice flips the WORKER process to `{ schedule: true }` (one-cron-owner), and
-- the API process reconciles schedule rows on definition create/update. So:
--
--  * jarvis_worker_runtime now RUNS the cron engine (pg-boss Timekeeper):
--      - reads schedules               -> SELECT pgboss.schedule
--      - cron monitor stamps run time  -> UPDATE pgboss.schedule
--      - boss.schedule / boss.unschedule (worker self-heal) -> INSERT/UPDATE/DELETE
--      - Timekeeper.start creates its internal SEND_IT queue
--                                      -> EXECUTE pgboss.create_queue / delete_queue
--  * jarvis_app_runtime reconciles schedule rows from the API routes:
--      - boss.schedule / boss.unschedule -> SELECT/INSERT/UPDATE/DELETE pgboss.schedule
--    (the API stays schedule:false, so it never runs the engine and needs no
--     create_queue/delete_queue grant.)
--
-- RLS does not apply to the pgboss schema (internal infra, owned by
-- jarvis_migration_owner). These grants are idempotent (re-run by runSqlFiles on
-- every `pnpm db:migrate`); this file lives in infra/postgres/grants, never in a
-- hash-checked migration directory.

GRANT SELECT, INSERT, UPDATE, DELETE ON pgboss.schedule
  TO jarvis_app_runtime, jarvis_worker_runtime;

-- The Timekeeper (cron engine, worker only) creates its internal non-partitioned
-- SEND_IT maintenance queue on start. pgboss.create_queue is SECURITY INVOKER and
-- runs `INSERT INTO pgboss.queue ... ON CONFLICT DO NOTHING` as the worker role, so
-- the worker needs EXECUTE on the function AND INSERT on pgboss.queue. SEND_IT is
-- non-partitioned (backed by job_common, which the worker already has) so no DDL
-- privilege is required.
GRANT EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) TO jarvis_worker_runtime;
GRANT EXECUTE ON FUNCTION pgboss.delete_queue(text) TO jarvis_worker_runtime;
GRANT INSERT ON pgboss.queue TO jarvis_worker_runtime;

-- The cron monitor stamps pgboss.version.cron_on (`UPDATE pgboss.version SET
-- cron_on = now()`) each tick so concurrent workers don't double-fire schedules.
-- 0001 granted SELECT on version to both roles; the cron engine (worker) also
-- needs UPDATE.
GRANT UPDATE ON pgboss.version TO jarvis_worker_runtime;
