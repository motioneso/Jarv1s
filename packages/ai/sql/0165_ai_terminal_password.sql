-- #1059 owner-terminal step-up password. Singleton (at most one row). Stores ONLY the better-auth
-- scrypt HASH, never plaintext (Hard Invariant: secrets never escape). Admin-only via FORCE RLS.
CREATE TABLE IF NOT EXISTS app.ai_terminal_password (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users (id) ON DELETE SET NULL
);

-- Base privilege for the runtime role BEFORE RLS — without this, RLS denies every access (#1059).
GRANT SELECT, INSERT, UPDATE ON app.ai_terminal_password TO jarvis_app_runtime;

ALTER TABLE app.ai_terminal_password ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_terminal_password FORCE ROW LEVEL SECURITY;

-- Admin-only for EVERY verb (read included: only an admin ever needs the hash, to verify a step-up).
CREATE POLICY ai_terminal_password_admin_all ON app.ai_terminal_password
  FOR ALL
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());
