-- Track whether a remembered fact was said by the user, inferred, or later confirmed.
DO $$ BEGIN
  CREATE TYPE app.provenance_kind AS ENUM ('volunteered', 'inferred', 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE app.chat_memory_facts
  ADD COLUMN IF NOT EXISTS provenance app.provenance_kind NOT NULL DEFAULT 'inferred';

ALTER TABLE app.chat_memory_facts DISABLE ROW LEVEL SECURITY;

UPDATE app.chat_memory_facts
SET provenance = 'inferred'
WHERE provenance IS NULL;

ALTER TABLE app.chat_memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_memory_facts FORCE ROW LEVEL SECURITY;

ALTER TABLE app.chat_memory_facts
  ALTER COLUMN provenance SET DEFAULT 'inferred',
  ALTER COLUMN provenance SET NOT NULL;
