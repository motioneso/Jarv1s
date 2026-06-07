-- Slice 1c-1d: convert Chat to owner-or-share (threads) with parent-child inheritance
-- (messages visible iff actor can see the parent thread). visibility/workspace_id
-- columns remain inert (dropped in Slice 1f).

DROP POLICY IF EXISTS chat_threads_select ON app.chat_threads;
DROP POLICY IF EXISTS chat_threads_insert ON app.chat_threads;
DROP POLICY IF EXISTS chat_threads_update ON app.chat_threads;
DROP POLICY IF EXISTS chat_messages_select ON app.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert ON app.chat_messages;

CREATE POLICY chat_threads_select
ON app.chat_threads
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('chat_thread', id, 'view')
  )
);

CREATE POLICY chat_threads_insert
ON app.chat_threads
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY chat_threads_update
ON app.chat_threads
FOR UPDATE
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('chat_thread', id, 'manage')
  )
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('chat_thread', id, 'manage')
  )
);

CREATE POLICY chat_messages_select
ON app.chat_messages
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM app.chat_threads thread
    WHERE thread.id = chat_messages.thread_id
      AND (
        thread.owner_user_id = app.current_actor_user_id()
        OR app.has_share('chat_thread', thread.id, 'view')
      )
  )
);

CREATE POLICY chat_messages_insert
ON app.chat_messages
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1 FROM app.chat_threads thread
    WHERE thread.id = chat_messages.thread_id
      AND (
        thread.owner_user_id = app.current_actor_user_id()
        OR app.has_share('chat_thread', thread.id, 'manage')
      )
  )
);
