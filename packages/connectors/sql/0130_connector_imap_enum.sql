-- 0130: add the generic 'imap' provider type (#641 Slice B). Postgres forbids using a
-- newly added enum value in the same transaction it was added in, so the seed of the
-- preset connector_definitions rows that use this value lives in a separate migration
-- (0131).
ALTER TYPE app.connector_provider_type ADD VALUE IF NOT EXISTS 'imap';
