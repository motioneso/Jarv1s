-- Widen source_kind CHECK on memory_chunks and memory_file_index to allow 'notes'.
-- The notes-ingest feature (feat-248) writes chunks with source_kind='notes';
-- without this the INSERT violates the constraint added in 0040.

ALTER TABLE app.memory_chunks DROP CONSTRAINT IF EXISTS memory_chunks_source_kind_check;
ALTER TABLE app.memory_chunks
  ADD CONSTRAINT memory_chunks_source_kind_check
  CHECK (source_kind IN ('vault', 'connector', 'chat', 'notes'));

ALTER TABLE app.memory_file_index DROP CONSTRAINT IF EXISTS memory_file_index_source_kind_check;
ALTER TABLE app.memory_file_index
  ADD CONSTRAINT memory_file_index_source_kind_check
  CHECK (source_kind IN ('vault', 'connector', 'chat', 'notes'));
