-- #870 (epic #869) / Fable HIGH-1: the H3 worker observability log was dead on arrival.
--
-- resolveModelForCapability()'s logNeedsConfig()->recordError() INSERTs into app.jarvis_error_log so
-- a mis-provisioned instance's silently-skipped worker distillation/briefings are observable. But
-- 0145 granted INSERT + the INSERT policy ONLY to jarvis_app_runtime. Worker capabilities resolve
-- from code running as jarvis_worker_runtime (packages/commitments/src/workers.ts, packages/chat/
-- src/jobs.ts) -> "permission denied for table jarvis_error_log", swallowed by recordError's caller
-- try/catch -> the log never records. Grant the worker role the same narrow INSERT capability.
--
-- Shape mirrors 0145's jarvis_error_log_insert exactly: recordError() writes
-- owner_user_id = app.current_actor_user_id() inside withDataContext (SET LOCAL app.actor_user_id),
-- so the WITH CHECK is identical. No SELECT grant — workers only write, never read, the log.

GRANT INSERT ON app.jarvis_error_log TO jarvis_worker_runtime;

DROP POLICY IF EXISTS jarvis_error_log_worker_insert
  ON app.jarvis_error_log;

CREATE POLICY jarvis_error_log_worker_insert
ON app.jarvis_error_log
FOR INSERT TO jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);
