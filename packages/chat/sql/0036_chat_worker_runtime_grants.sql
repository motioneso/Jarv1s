-- M-A3 fix: the chat-execution pg-boss worker runs as jarvis_worker_runtime and
-- must read thread history and transition assistant messages through
-- pending -> working -> stored | error (see packages/chat/src/jobs.ts).
--
-- The original chat grants/policies (0014_chat_module, 0035_chat_messages_update_grant)
-- targeted jarvis_app_runtime ONLY, so the worker failed with
-- "permission denied for table chat_messages" (SQLSTATE 42501) and every chat turn
-- hung at `pending`. Mirror the tasks-module pattern: grant the worker role and
-- include it in the RLS policies it must satisfy.
--
-- The worker reads chat_messages (history) and updates them (status/body/activity).
-- The chat_messages_select policy joins app.chat_threads, so the worker also needs
-- SELECT on chat_threads for that subquery to evaluate. The owner-scoped USING/CHECK
-- expressions are preserved verbatim from 0014/0035 — this only widens the role list.

GRANT SELECT ON app.chat_threads TO jarvis_worker_runtime;
GRANT SELECT, UPDATE ON app.chat_messages TO jarvis_worker_runtime;

-- chat_threads SELECT (consumed by the chat_messages_select RLS subquery)
DROP POLICY IF EXISTS chat_threads_select ON app.chat_threads;
CREATE POLICY chat_threads_select
ON app.chat_threads
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('chat_thread', id, 'view')
  )
);

-- chat_messages SELECT (thread history load)
DROP POLICY IF EXISTS chat_messages_select ON app.chat_messages;
CREATE POLICY chat_messages_select
ON app.chat_messages
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM app.chat_threads thread
    WHERE thread.id = chat_messages.thread_id
      AND (
        thread.owner_user_id = app.current_actor_user_id()
        OR app.has_share('chat_thread', thread.id, 'view')
      )
  )
);

-- chat_messages UPDATE (pending -> working -> stored | error, + activity metadata)
DROP POLICY IF EXISTS chat_messages_update ON app.chat_messages;
CREATE POLICY chat_messages_update
ON app.chat_messages
FOR UPDATE
TO jarvis_app_runtime, jarvis_worker_runtime
USING (owner_user_id = app.current_actor_user_id())
WITH CHECK (owner_user_id = app.current_actor_user_id());
