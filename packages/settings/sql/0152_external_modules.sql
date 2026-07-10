-- External (non-compiled) trusted-operator module enablement state (#917, epic #860).
--
-- Slice 1 of the open module system. The loader reads module packages from a
-- read-only mount (JARVIS_MODULES_DIR) only when JARVIS_ENABLE_EXTERNAL_MODULES=1;
-- THIS table is the single source of truth for whether a discovered module is
-- active. A module is active only when a row here says status='enabled' AND the
-- on-disk package hash still matches `package_hash` captured at enable time.
-- There is deliberately NO 'discovered' status: an undiscovered/never-enabled
-- module simply has no row (virtual 'discovered'), so the fail-closed default is
-- structural, not a value we could forget to check.
--
-- Instance-global, admin-managed (mirrors provider_install_state 0103): readable
-- by all authed actors so the /api/modules resolver can compute active-state under
-- any actor, writable by admins only. NO private data — only module identity,
-- content hashes, and an audit pointer to the enabling admin. All statements
-- idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS app.external_modules (
  -- Module id == its directory name under JARVIS_MODULES_DIR (validated equal at load).
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('enabled', 'disabled')),
  -- SHA-256 of the canonical (sorted-key) jarvis.module.json, captured at enable.
  manifest_hash text NOT NULL,
  -- SHA-256 over the module package (jarvis.module.json + dist/worker.js + dist/web/**),
  -- captured at enable. Drift from the on-disk hash auto-disables the module (#917).
  package_hash text NOT NULL,
  -- Human-readable reason when status='disabled' (e.g. 'package changed since enable',
  -- 'disabled by admin'). NEVER a secret.
  disabled_reason text NULL,
  CONSTRAINT external_modules_disabled_reason_len_ck
    CHECK (disabled_reason IS NULL OR length(disabled_reason) <= 2000),
  -- Admin who last enabled the module (audit pointer). NULL for disabled rows.
  enabled_by uuid NULL,
  enabled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.external_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.external_modules FORCE ROW LEVEL SECURITY;

-- Readable by all authed actors: the /api/modules resolver computes active-state
-- under the requesting actor's context, so every actor must SELECT the instance
-- rows. Never owner-scoped (instance-global).
DROP POLICY IF EXISTS external_modules_select ON app.external_modules;
CREATE POLICY external_modules_select ON app.external_modules
  FOR SELECT TO jarvis_app_runtime, jarvis_worker_runtime
  USING (true);

-- Writes are admin-only (enable/disable and drift auto-disable are instance-level
-- admin actions). RLS applies to admins too — this is the ONLY write path.
DROP POLICY IF EXISTS external_modules_insert ON app.external_modules;
CREATE POLICY external_modules_insert ON app.external_modules
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS external_modules_update ON app.external_modules;
CREATE POLICY external_modules_update ON app.external_modules
  FOR UPDATE TO jarvis_app_runtime
  USING (app.current_actor_is_admin())
  WITH CHECK (app.current_actor_is_admin());

DROP POLICY IF EXISTS external_modules_delete ON app.external_modules;
CREATE POLICY external_modules_delete ON app.external_modules
  FOR DELETE TO jarvis_app_runtime
  USING (app.current_actor_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.external_modules TO jarvis_app_runtime;
GRANT SELECT ON app.external_modules TO jarvis_worker_runtime;
