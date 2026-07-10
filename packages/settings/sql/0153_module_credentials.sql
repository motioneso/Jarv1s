-- Module credential secrets (#918, Open module system Slice 2).
-- One row per (module, credential id, scope[, owner]). encrypted_secret holds an
-- AES-256-GCM EncryptedSecret envelope (packages/db/src/secret-cipher.ts) produced
-- by ModuleCredentialCipher — never plaintext. Revoke is an UPDATE that scrubs the
-- envelope (encrypted_secret = NULL, revoked_at = now()); jarvis_app_runtime has NO
-- DELETE grant (protected table, mirroring app.connector_accounts' soft-revoke).
-- 'instance' rows are admin-managed with no owner; 'user' rows are owner-managed
-- and cascade-delete with the user (delete-user-data relies on this FK).

CREATE TABLE IF NOT EXISTS app.module_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id text NOT NULL,
  credential_id text NOT NULL,
  scope text NOT NULL CONSTRAINT module_credentials_scope_ck
    CHECK (scope IN ('instance', 'user')),
  owner_user_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  display_name text NOT NULL CONSTRAINT module_credentials_display_name_ck
    CHECK (char_length(display_name) BETWEEN 1 AND 200),
  encrypted_secret jsonb,
  revoked_at timestamptz,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_credentials_scope_owner_ck CHECK (
    (scope = 'instance' AND owner_user_id IS NULL)
    OR (scope = 'user' AND owner_user_id IS NOT NULL)
  )
);

-- Uniqueness is scope-shaped: instance credentials are singletons per
-- (module, credential); user credentials per (module, credential, owner).
-- Partial indexes because owner_user_id is NULL for instance rows.
CREATE UNIQUE INDEX IF NOT EXISTS module_credentials_instance_uq
  ON app.module_credentials (module_id, credential_id)
  WHERE scope = 'instance';
CREATE UNIQUE INDEX IF NOT EXISTS module_credentials_user_uq
  ON app.module_credentials (module_id, credential_id, owner_user_id)
  WHERE scope = 'user';

ALTER TABLE app.module_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_credentials FORCE ROW LEVEL SECURITY;

-- User rows: owner-only. Instance rows: admin-only (configuration power).
-- No DELETE policy and no DELETE grant: revoke = UPDATE scrubbing the envelope.
DROP POLICY IF EXISTS module_credentials_select ON app.module_credentials;
CREATE POLICY module_credentials_select ON app.module_credentials
  FOR SELECT TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_credentials_insert ON app.module_credentials;
CREATE POLICY module_credentials_insert ON app.module_credentials
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

DROP POLICY IF EXISTS module_credentials_update ON app.module_credentials;
CREATE POLICY module_credentials_update ON app.module_credentials
  FOR UPDATE TO jarvis_app_runtime
  USING (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  )
  WITH CHECK (
    (scope = 'user' AND owner_user_id = app.current_actor_user_id())
    OR (scope = 'instance' AND app.current_actor_is_admin())
  );

GRANT SELECT, INSERT, UPDATE ON app.module_credentials TO jarvis_app_runtime;
-- No jarvis_worker_runtime grant: Slice 2 has no worker consumer. Slice 3's RPC
-- seam adds its own migration with the narrowest grant it needs (least privilege).
