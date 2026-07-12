-- Per-module applied-migration ledger (#914 Slice 1). Instance bookkeeping only — no per-user
-- data, so no RLS, mirroring app.schema_migrations' posture (see scripts/audit-release-hardening.ts
-- forceRlsExemptions). Composite PK namespaces versions per module so two modules can both apply
-- their own "0001" without colliding.
CREATE TABLE app.module_schema_migrations (
  module_id  text NOT NULL,
  version    text NOT NULL,
  name       text NOT NULL,
  checksum   text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module_id, version)
);
