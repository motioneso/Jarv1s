DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'chat_message_role'
  ) THEN
    CREATE TYPE app.chat_message_role AS ENUM ('user', 'assistant');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'chat_message_status'
  ) THEN
    CREATE TYPE app.chat_message_status AS ENUM ('stored', 'pending', 'blocked', 'no_model');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.chat_threads (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.chat_messages (
  id uuid PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES app.chat_threads(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role app.chat_message_role NOT NULL,
  status app.chat_message_status NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_metadata) = 'object'),
  tool_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(tool_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_threads_owner_user_id_updated_at_idx
  ON app.chat_threads(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS chat_messages_thread_id_created_at_idx
  ON app.chat_messages(thread_id, created_at, id);

CREATE INDEX IF NOT EXISTS chat_messages_owner_user_id_created_at_idx
  ON app.chat_messages(owner_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.prevent_chat_thread_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'chat thread id cannot be changed';
  END IF;

  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'chat thread owner_user_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'chat thread created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_chat_thread_update_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.owner_user_id = app.current_actor_user_id() THEN
    RETURN NEW;
  END IF;

  IF NEW.title <> OLD.title THEN
    RAISE EXCEPTION 'workspace chat participants cannot change chat thread title';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'workspace chat participants cannot move chat thread updated_at backwards';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.prevent_chat_message_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.thread_id <> OLD.thread_id THEN
    RAISE EXCEPTION 'chat message thread_id cannot be changed';
  END IF;

  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'chat message owner_user_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'chat message created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_chat_message_thread_context()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.chat_threads WHERE id = NEW.thread_id
  ) THEN
    RAISE EXCEPTION 'chat message thread does not exist';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_threads_prevent_identity_change
  ON app.chat_threads;

CREATE TRIGGER chat_threads_prevent_identity_change
BEFORE UPDATE OF id, owner_user_id, created_at ON app.chat_threads
FOR EACH ROW
EXECUTE FUNCTION app.prevent_chat_thread_identity_change();

DROP TRIGGER IF EXISTS chat_threads_enforce_update_scope
  ON app.chat_threads;

CREATE TRIGGER chat_threads_enforce_update_scope
BEFORE UPDATE ON app.chat_threads
FOR EACH ROW
EXECUTE FUNCTION app.enforce_chat_thread_update_scope();

DROP TRIGGER IF EXISTS chat_messages_prevent_identity_change
  ON app.chat_messages;

CREATE TRIGGER chat_messages_prevent_identity_change
BEFORE UPDATE OF thread_id, owner_user_id, created_at ON app.chat_messages
FOR EACH ROW
EXECUTE FUNCTION app.prevent_chat_message_identity_change();

DROP TRIGGER IF EXISTS chat_messages_enforce_thread_context
  ON app.chat_messages;

CREATE TRIGGER chat_messages_enforce_thread_context
BEFORE INSERT OR UPDATE OF thread_id ON app.chat_messages
FOR EACH ROW
EXECUTE FUNCTION app.enforce_chat_message_thread_context();

GRANT SELECT, INSERT, UPDATE ON app.chat_threads TO jarvis_app_runtime;
GRANT SELECT, INSERT ON app.chat_messages TO jarvis_app_runtime;

ALTER TABLE app.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_threads FORCE ROW LEVEL SECURITY;

ALTER TABLE app.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_messages FORCE ROW LEVEL SECURITY;

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
  AND owner_user_id = app.current_actor_user_id()
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
  AND owner_user_id = app.current_actor_user_id()
)
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY chat_messages_select
ON app.chat_messages
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY chat_messages_insert
ON app.chat_messages
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.chat_threads thread
    WHERE thread.id = chat_messages.thread_id
      AND thread.owner_user_id = app.current_actor_user_id()
  )
);
