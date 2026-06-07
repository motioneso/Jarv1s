DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'ai_assistant_action_status'
  ) THEN
    CREATE TYPE app.ai_assistant_action_status AS ENUM (
      'pending',
      'confirmed',
      'rejected',
      'cancelled'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.ai_assistant_action_requests (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  tool_module_id text NOT NULL CHECK (length(btrim(tool_module_id)) > 0),
  tool_module_name text NOT NULL CHECK (length(btrim(tool_module_name)) > 0),
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) > 0),
  permission_id text NOT NULL CHECK (length(btrim(permission_id)) > 0),
  risk text NOT NULL CHECK (risk IN ('write', 'destructive')),
  status app.ai_assistant_action_status NOT NULL DEFAULT 'pending',
  input_summary jsonb NOT NULL CHECK (jsonb_typeof(input_summary) = 'object'),
  request_id text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_assistant_action_requests_owner_status_idx
  ON app.ai_assistant_action_requests(owner_user_id, status, requested_at DESC);

CREATE OR REPLACE FUNCTION app.enforce_ai_assistant_action_update_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'AI assistant action owner_user_id cannot be changed';
  END IF;

  IF NEW.tool_module_id <> OLD.tool_module_id THEN
    RAISE EXCEPTION 'AI assistant action tool_module_id cannot be changed';
  END IF;

  IF NEW.tool_module_name <> OLD.tool_module_name THEN
    RAISE EXCEPTION 'AI assistant action tool_module_name cannot be changed';
  END IF;

  IF NEW.tool_name <> OLD.tool_name THEN
    RAISE EXCEPTION 'AI assistant action tool_name cannot be changed';
  END IF;

  IF NEW.permission_id <> OLD.permission_id THEN
    RAISE EXCEPTION 'AI assistant action permission_id cannot be changed';
  END IF;

  IF NEW.risk <> OLD.risk THEN
    RAISE EXCEPTION 'AI assistant action risk cannot be changed';
  END IF;

  IF NEW.input_summary IS DISTINCT FROM OLD.input_summary THEN
    RAISE EXCEPTION 'AI assistant action input_summary cannot be changed';
  END IF;

  IF NEW.request_id IS DISTINCT FROM OLD.request_id THEN
    RAISE EXCEPTION 'AI assistant action request_id cannot be changed';
  END IF;

  IF NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'AI assistant action requested_at cannot be changed';
  END IF;

  IF OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'AI assistant action is already resolved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_assistant_action_requests_enforce_update_scope
  ON app.ai_assistant_action_requests;

CREATE TRIGGER ai_assistant_action_requests_enforce_update_scope
BEFORE UPDATE ON app.ai_assistant_action_requests
FOR EACH ROW
EXECUTE FUNCTION app.enforce_ai_assistant_action_update_scope();

GRANT SELECT, INSERT, UPDATE ON app.ai_assistant_action_requests TO jarvis_app_runtime;

ALTER TABLE app.ai_assistant_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_assistant_action_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_assistant_action_requests_select
  ON app.ai_assistant_action_requests;
DROP POLICY IF EXISTS ai_assistant_action_requests_insert
  ON app.ai_assistant_action_requests;
DROP POLICY IF EXISTS ai_assistant_action_requests_update
  ON app.ai_assistant_action_requests;

CREATE POLICY ai_assistant_action_requests_select
ON app.ai_assistant_action_requests
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY ai_assistant_action_requests_insert
ON app.ai_assistant_action_requests
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY ai_assistant_action_requests_update
ON app.ai_assistant_action_requests
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
