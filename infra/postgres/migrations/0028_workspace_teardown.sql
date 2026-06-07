-- Slice 1f: drop all workspace_id/visibility columns from product tables, drop
-- workspace enum types, drop workspace SQL functions, and update the probe table
-- SELECT policy to remove its now-dead workspace arm.
-- connector_accounts.workspace_id and ai_assistant_action_requests.workspace_id
-- are also dropped (their policies no longer reference them).

-- Drop and recreate triggers that reference workspace_id/visibility columns
-- so the column drops below succeed.
-- Guard with table-existence checks because module tables (chat, briefings) may not
-- exist yet when this migration runs on a fresh database (module SQL runs after app SQL).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'chat_messages'
  ) THEN
    DROP TRIGGER IF EXISTS chat_messages_enforce_thread_context ON app.chat_messages;

    CREATE OR REPLACE FUNCTION app.enforce_chat_message_thread_context()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM app.chat_threads WHERE id = NEW.thread_id
      ) THEN
        RAISE EXCEPTION 'chat message thread does not exist';
      END IF;
      RETURN NEW;
    END;
    $fn$;

    CREATE TRIGGER chat_messages_enforce_thread_context
    BEFORE INSERT OR UPDATE OF thread_id ON app.chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION app.enforce_chat_message_thread_context();
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'briefing_runs'
  ) THEN
    DROP TRIGGER IF EXISTS briefing_runs_enforce_definition_context ON app.briefing_runs;

    CREATE OR REPLACE FUNCTION app.enforce_briefing_run_definition_context()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    DECLARE
      definition_owner_user_id uuid;
    BEGIN
      SELECT owner_user_id
      INTO definition_owner_user_id
      FROM app.briefing_definitions
      WHERE id = NEW.definition_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'briefing run definition does not exist';
      END IF;

      IF NEW.owner_user_id <> definition_owner_user_id THEN
        RAISE EXCEPTION 'briefing run owner_user_id must match its definition';
      END IF;

      RETURN NEW;
    END;
    $fn$;

    CREATE TRIGGER briefing_runs_enforce_definition_context
    BEFORE INSERT OR UPDATE OF definition_id, owner_user_id ON app.briefing_runs
    FOR EACH ROW
    EXECUTE FUNCTION app.enforce_briefing_run_definition_context();
  END IF;
END;
$$;

-- Drop workspace_id and visibility from product tables
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'tasks'
  ) THEN
    ALTER TABLE app.tasks
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'notifications'
  ) THEN
    ALTER TABLE app.notifications
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'calendar_events'
  ) THEN
    ALTER TABLE app.calendar_events
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'email_messages'
  ) THEN
    ALTER TABLE app.email_messages
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'connector_accounts'
  ) THEN
    ALTER TABLE app.connector_accounts
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'ai_assistant_action_requests'
  ) THEN
    ALTER TABLE app.ai_assistant_action_requests
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'chat_threads'
  ) THEN
    ALTER TABLE app.chat_threads
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'chat_messages'
  ) THEN
    ALTER TABLE app.chat_messages
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'briefing_definitions'
  ) THEN
    ALTER TABLE app.briefing_definitions
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'app' AND table_name = 'briefing_runs'
  ) THEN
    ALTER TABLE app.briefing_runs
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS workspace_id;
  END IF;
END;
$$;

-- Drop visibility enum types (columns referencing them are already dropped above)
DROP TYPE IF EXISTS app.task_visibility;
DROP TYPE IF EXISTS app.notification_visibility;
DROP TYPE IF EXISTS app.calendar_event_visibility;
DROP TYPE IF EXISTS app.email_message_visibility;
DROP TYPE IF EXISTS app.chat_visibility;
DROP TYPE IF EXISTS app.briefing_visibility;

-- Update the probe table SELECT policy to remove the workspace arm (it was
-- left inert since Slice 1a but must be cleaned up before dropping the functions).
DROP POLICY IF EXISTS rls_probe_items_select ON app.rls_probe_items;

CREATE POLICY rls_probe_items_select
ON app.rls_probe_items
FOR SELECT
TO jarvis_app_runtime, jarvis_worker_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND (
    owner_user_id = app.current_actor_user_id()
    OR app.has_share('rls_probe_item', id, 'view')
  )
);

-- Also drop workspace_id from probe items if present
ALTER TABLE app.rls_probe_items
  DROP COLUMN IF EXISTS visibility,
  DROP COLUMN IF EXISTS workspace_id;

-- Drop workspace SQL infrastructure (no policies reference these functions anymore)
DROP FUNCTION IF EXISTS app.is_workspace_member(uuid, uuid);
DROP FUNCTION IF EXISTS app.current_workspace_id();
