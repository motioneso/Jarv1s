-- #964: module distribution & install — staged-download intent, purge marks, and the
-- last install failure on app.external_modules. Written by the admin download/remove
-- routes (app role; the 0152 admin RLS policies gate INSERT/UPDATE) and by the
-- supervisor-plane boot reconcile (bootstrap role, which bypasses nothing: it owns the
-- table). last_install_error mirrors the supervisor-plane app.module_installs journal
-- because that table is FORCE-RLS and unreadable by the app role (spec deviation 1).
-- Single top-level statement (module SQL runner contract).
ALTER TABLE app.external_modules
  ADD COLUMN staged_version text,
  ADD COLUMN staged_package_hash text,
  ADD COLUMN staged_at timestamptz,
  ADD COLUMN staged_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  ADD COLUMN staged_source text CHECK (staged_source IN ('admin-download', 'compose-ensure')),
  ADD COLUMN purge_requested_at timestamptz,
  ADD COLUMN purge_requested_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  ADD COLUMN last_install_error text CHECK (char_length(last_install_error) <= 2000);
