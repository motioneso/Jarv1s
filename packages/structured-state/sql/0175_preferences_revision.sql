-- #1264: optimistic-concurrency support for self-operation preference writes.
-- Assistant-driven settings tools CAS on this column so two concurrent writers
-- (e.g. a user edit racing an assistant tool call) don't silently clobber each other.
ALTER TABLE app.preferences
  ADD COLUMN revision integer NOT NULL DEFAULT 1;
