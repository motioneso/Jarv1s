-- connector_definitions is FORCE ROW LEVEL SECURITY; seed under a transient migration-owner policy.
CREATE POLICY connector_definitions_imap_seed ON app.connector_definitions
  TO jarvis_migration_owner USING (true) WITH CHECK (true);

INSERT INTO app.connector_definitions (provider_id, provider_type, display_name, status, default_scopes)
VALUES
  ('imap-yahoo',    'imap', 'Yahoo Mail',            'available', ARRAY['email.read']::text[]),
  ('imap-proton',   'imap', 'Proton Mail (Bridge)',  'available', ARRAY['email.read']::text[]),
  ('imap-icloud',   'imap', 'iCloud Mail',           'available', ARRAY['email.read']::text[]),
  ('imap-fastmail', 'imap', 'Fastmail',              'available', ARRAY['email.read']::text[])
ON CONFLICT (provider_id) DO UPDATE SET
  provider_type = EXCLUDED.provider_type,
  display_name  = EXCLUDED.display_name,
  status        = EXCLUDED.status,
  default_scopes = EXCLUDED.default_scopes;

DROP POLICY connector_definitions_imap_seed ON app.connector_definitions;
