-- Provider install/login lifecycle state (#342 in-container CLI chat, RPC contract §9.2).
--
-- ADDITIVE, Phase-2-ready persistence target for the provider state machine
-- (not_installed → installing → installed → needs_login → ready, plus error).
-- Phase 1 (this migration) creates the empty table + RLS + grants ONLY; nothing
-- reads or writes it yet. The install + login services (Phase 2/3, running in the
-- cli-runner) populate it over a Phase-2 control path — NOT the live-chat socket,
-- which is the engine boundary only. Owned by the settings/onboarding module per
-- module isolation: provider lifecycle state lives here, never in @jarv1s/chat or
-- the in-memory token registry (RPC contract §9.2).
--
-- One row per provider (instance-global founder provisioning — there is a single
-- shared CLI tools/auth volume per house, ADR 0007). `state` mirrors the frozen
-- `ProviderInstallState` enum in packages/shared/src/onboarding-api.ts; `message`
-- carries a redacted error string on the `error` state. The table inserts NO rows,
-- so the live surface is byte-for-byte unchanged.
--
-- RLS mirrors instance_settings / module_enablement instance rows (0059 / 0065):
-- readable by all authed actors (so the onboarding resolver sees provisioning
-- state), writes admin-only. All statements idempotent (IF NOT EXISTS / DROP
-- POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS app.provider_install_state (
  provider text PRIMARY KEY
    CHECK (provider IN ('anthropic', 'openai-compatible', 'google')),
  state text NOT NULL DEFAULT 'not_installed'
    CHECK (state IN (
      'not_installed', 'installing', 'installed', 'needs_login', 'ready', 'error'
    )),
  -- The installed CLI version (npm package version), once known. NULL until installed.
  version text NULL,
  -- Redacted human-readable detail for the `error` state (and optionally transient
  -- progress notes). NEVER a secret: any value written here passes through the same
  -- redactSecrets chokepoint the RPC error path uses (RPC contract §6.4).
  message text NULL,
  CONSTRAINT provider_install_state_message_len_ck
    CHECK (message IS NULL OR length(message) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.provider_install_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.provider_install_state FORCE ROW LEVEL SECURITY;

-- Readable by all authed actors (the onboarding founder-status resolver surfaces
-- provisioning state to the wizard); never owner-scoped (instance-global, ADR 0007).
DROP POLICY IF EXISTS provider_install_state_select ON app.provider_install_state;
CREATE POLICY provider_install_state_select ON app.provider_install_state
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (true);

-- Writes are admin-only (founder provisioning is an instance-level action).
DROP POLICY IF EXISTS provider_install_state_insert ON app.provider_install_state;
CREATE POLICY provider_install_state_insert ON app.provider_install_state
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS provider_install_state_update ON app.provider_install_state;
CREATE POLICY provider_install_state_update ON app.provider_install_state
  FOR UPDATE TO jarvis_app_runtime
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS provider_install_state_delete ON app.provider_install_state;
CREATE POLICY provider_install_state_delete ON app.provider_install_state
  FOR DELETE TO jarvis_app_runtime
  USING (app.current_actor_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.provider_install_state TO jarvis_app_runtime;
GRANT SELECT ON app.provider_install_state TO jarvis_worker_runtime;
