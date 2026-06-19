-- Notifications V1 metadata size bound (defense-in-depth backstop).
-- The application layer (projectNotificationMetadata in packages/notifications/src/metadata.ts)
-- enforces the structural bounds: ≤16 keys, key names matching ^[a-zA-Z_][a-zA-Z0-9_]{0,63}$,
-- primitive values only, string values ≤256 chars, total serialized size ≤4096 bytes.
-- Those structural rules are not duplicated at the DB layer because encoding them generically
-- requires a PL/pgSQL helper function and adds maintenance surface for V1. The SIZE-only
-- CHECK here is the language-agnostic backstop that catches a producer bug or a backfill
-- that bypasses the repository and writes oversized jsonb straight to the column.
--
-- The CHECK uses octet_length(metadata::text) which is stable across jsonb storage formats
-- and matches the application layer's JSON.stringify-then-utf8-byte-length computation
-- closely enough for a defense-in-depth bound (JSON.stringify omits insignificant whitespace;
-- jsonb::text is canonical with single spaces after ':' and ',', so the DB CHECK may fire
-- a few bytes earlier than the app-side bound on borderline inputs — that is the safe
-- direction for a backstop).
--
-- New file — never edit 0008 / 0024 / 0029 / 0071. RLS is not disabled.

ALTER TABLE app.notifications
  DROP CONSTRAINT IF EXISTS notifications_metadata_size_check;

ALTER TABLE app.notifications
  ADD CONSTRAINT notifications_metadata_size_check
  CHECK (octet_length(metadata::text) <= 4096);
