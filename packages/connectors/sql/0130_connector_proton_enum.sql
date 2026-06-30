-- 0130: add the 'proton-bridge' provider type (#641). MUST be its own migration file:
-- Postgres forbids USING a newly ALTER-added enum value in the same transaction it
-- was added, so the seed/use lives in 0131 (a separate file = separate transaction).
ALTER TYPE app.connector_provider_type ADD VALUE IF NOT EXISTS 'proton-bridge';
