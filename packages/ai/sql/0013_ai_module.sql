DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'ai_provider_kind'
  ) THEN
    CREATE TYPE app.ai_provider_kind AS ENUM (
      'openai-compatible',
      'anthropic',
      'google',
      'ollama',
      'custom'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'ai_provider_status'
  ) THEN
    CREATE TYPE app.ai_provider_status AS ENUM ('active', 'error', 'disabled', 'revoked');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typnamespace = 'app'::regnamespace
      AND typname = 'ai_model_status'
  ) THEN
    CREATE TYPE app.ai_model_status AS ENUM ('active', 'disabled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.ai_provider_configs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  provider_kind app.ai_provider_kind NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  base_url text CHECK (base_url IS NULL OR length(btrim(base_url)) > 0),
  status app.ai_provider_status NOT NULL DEFAULT 'active',
  encrypted_credential jsonb NOT NULL CHECK (jsonb_typeof(encrypted_credential) = 'object'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_user_id),
  CHECK (
    (status = 'revoked' AND revoked_at IS NOT NULL)
    OR (status <> 'revoked' AND revoked_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS app.ai_configured_models (
  id uuid PRIMARY KEY,
  provider_config_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  provider_model_id text NOT NULL CHECK (length(btrim(provider_model_id)) > 0),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  capabilities text[] NOT NULL CHECK (
    cardinality(capabilities) > 0
    AND array_position(capabilities, '') IS NULL
  ),
  status app.ai_model_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, provider_config_id, provider_model_id),
  FOREIGN KEY (provider_config_id, owner_user_id)
    REFERENCES app.ai_provider_configs(id, owner_user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_provider_configs_owner_user_id_idx
  ON app.ai_provider_configs(owner_user_id);

CREATE INDEX IF NOT EXISTS ai_provider_configs_status_idx
  ON app.ai_provider_configs(owner_user_id, status);

CREATE INDEX IF NOT EXISTS ai_configured_models_owner_user_id_idx
  ON app.ai_configured_models(owner_user_id);

CREATE INDEX IF NOT EXISTS ai_configured_models_provider_config_id_idx
  ON app.ai_configured_models(provider_config_id);

CREATE INDEX IF NOT EXISTS ai_configured_models_capabilities_idx
  ON app.ai_configured_models USING gin(capabilities);

CREATE OR REPLACE FUNCTION app.prevent_ai_provider_config_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'AI provider owner_user_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'AI provider created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.prevent_ai_configured_model_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_user_id <> OLD.owner_user_id THEN
    RAISE EXCEPTION 'AI model owner_user_id cannot be changed';
  END IF;

  IF NEW.provider_config_id <> OLD.provider_config_id THEN
    RAISE EXCEPTION 'AI model provider_config_id cannot be changed';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'AI model created_at cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_provider_configs_prevent_identity_change
  ON app.ai_provider_configs;

CREATE TRIGGER ai_provider_configs_prevent_identity_change
BEFORE UPDATE OF owner_user_id, created_at ON app.ai_provider_configs
FOR EACH ROW
EXECUTE FUNCTION app.prevent_ai_provider_config_identity_change();

DROP TRIGGER IF EXISTS ai_configured_models_prevent_identity_change
  ON app.ai_configured_models;

CREATE TRIGGER ai_configured_models_prevent_identity_change
BEFORE UPDATE OF owner_user_id, provider_config_id, created_at ON app.ai_configured_models
FOR EACH ROW
EXECUTE FUNCTION app.prevent_ai_configured_model_identity_change();

GRANT SELECT, INSERT, UPDATE ON app.ai_provider_configs TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.ai_configured_models TO jarvis_app_runtime;

ALTER TABLE app.ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_provider_configs FORCE ROW LEVEL SECURITY;

ALTER TABLE app.ai_configured_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_configured_models FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_provider_configs_select ON app.ai_provider_configs;
DROP POLICY IF EXISTS ai_provider_configs_insert ON app.ai_provider_configs;
DROP POLICY IF EXISTS ai_provider_configs_update ON app.ai_provider_configs;
DROP POLICY IF EXISTS ai_configured_models_select ON app.ai_configured_models;
DROP POLICY IF EXISTS ai_configured_models_insert ON app.ai_configured_models;
DROP POLICY IF EXISTS ai_configured_models_update ON app.ai_configured_models;

CREATE POLICY ai_provider_configs_select
ON app.ai_provider_configs
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY ai_provider_configs_insert
ON app.ai_provider_configs
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY ai_provider_configs_update
ON app.ai_provider_configs
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

CREATE POLICY ai_configured_models_select
ON app.ai_configured_models
FOR SELECT
TO jarvis_app_runtime
USING (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY ai_configured_models_insert
ON app.ai_configured_models
FOR INSERT
TO jarvis_app_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
);

CREATE POLICY ai_configured_models_update
ON app.ai_configured_models
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
