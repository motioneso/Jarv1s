-- Slice 1e: drop the notes module. Knowledge lives in the vault layer (Slice 2+).
-- Safe on existing databases (drops the table) and fresh databases (no-op via IF EXISTS).
-- packages/notes is removed from the module registry, so 0006/0007 are no longer
-- discovered or applied on fresh databases.

DROP TABLE IF EXISTS app.notes CASCADE;
DROP TYPE IF EXISTS app.note_visibility;
