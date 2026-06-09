-- 0040: add the unified 'google' provider type. MUST be its own migration file:
-- Postgres forbids USING a newly ALTER-added enum value in the same transaction it
-- was added, so the seed/use lives in 0041 (a separate file = separate transaction).
ALTER TYPE app.connector_provider_type ADD VALUE IF NOT EXISTS 'google';
