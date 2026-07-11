-- infra/postgres/migrations/0156_module_installs.sql
-- Per-module install-state journal (#914 Slice 2, spec Data model section). Instance metadata
-- (which modules are installed, at what status) — not per-user content, so a permissive read
-- policy is correct; still ENABLE+FORCE RLS per the hard invariant "RLS applies to all actors
-- including admins" rather than granting a bypass.
CREATE TABLE app.module_installs (
  module_id           text PRIMARY KEY,
  status              text NOT NULL DEFAULT 'installing'
                        CHECK (status IN ('installing', 'installed', 'failed')),
  table_prefix        text NOT NULL,
  owned_tables        text[] NOT NULL DEFAULT '{}',
  runtime_role        text NOT NULL,
  install_role        text NOT NULL,
  catalog_fingerprint text,
  installed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.module_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.module_installs FORCE ROW LEVEL SECURITY;

CREATE POLICY module_installs_select ON app.module_installs
  FOR SELECT TO jarvis_app_runtime, jarvis_migration_owner
  USING (true);

CREATE POLICY module_installs_write ON app.module_installs
  FOR ALL TO jarvis_migration_owner
  USING (true) WITH CHECK (true);

GRANT SELECT ON app.module_installs TO jarvis_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.module_installs TO jarvis_migration_owner;
