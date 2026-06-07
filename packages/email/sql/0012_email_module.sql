CREATE TABLE IF NOT EXISTS app.email_messages (
  id uuid PRIMARY KEY,
  connector_account_id uuid NOT NULL REFERENCES app.connector_accounts(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (length(btrim(sender)) > 0),
  recipients text[] NOT NULL DEFAULT ARRAY[]::text[],
  subject text NOT NULL CHECK (length(btrim(subject)) > 0),
  snippet text,
  body_excerpt text,
  received_at timestamptz NOT NULL,
  external_id text NOT NULL CHECK (length(btrim(external_id)) > 0),
  external_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(external_metadata) = 'object'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connector_account_id, external_id)
);

CREATE INDEX IF NOT EXISTS email_messages_owner_user_id_received_at_idx
  ON app.email_messages(owner_user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS email_messages_connector_account_id_idx
  ON app.email_messages(connector_account_id);

CREATE OR REPLACE FUNCTION app.prevent_email_message_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'email message owner_user_id cannot be changed';
  END IF;

  IF NEW.connector_account_id <> OLD.connector_account_id THEN
    RAISE EXCEPTION 'email message connector_account_id cannot be changed';
  END IF;

  IF NEW.external_id <> OLD.external_id THEN
    RAISE EXCEPTION 'email message external_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'email message created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_messages_prevent_identity_change ON app.email_messages;

CREATE TRIGGER email_messages_prevent_identity_change
BEFORE UPDATE OF owner_user_id, connector_account_id, external_id, created_at
ON app.email_messages
FOR EACH ROW
EXECUTE FUNCTION app.prevent_email_message_identity_change();

GRANT SELECT, INSERT, UPDATE ON app.email_messages TO jarvis_app_runtime;

ALTER TABLE app.email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_messages_select ON app.email_messages;
DROP POLICY IF EXISTS email_messages_insert ON app.email_messages;
DROP POLICY IF EXISTS email_messages_update ON app.email_messages;

CREATE POLICY email_messages_select
ON app.email_messages
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY email_messages_insert
ON app.email_messages
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND definitions.provider_type = 'email'
  )
);

CREATE POLICY email_messages_update
ON app.email_messages
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
