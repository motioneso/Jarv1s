# Plan Review Log: Wellness design + taxonomy + insights/therapy-notes

Acts: grill delegated to Claude (decisions in spec). Codex review runs in the Herdr Codex tab. MAX_ROUNDS=5.

## Round 1 — Codex (grounded on da992f1; ran audit:preflight + codegraph + repo grep)

1. HIGH — enum migration not re-run safe (USING CASE ... ELSE 'happy' remaps already-migrated rows on re-run; bare DROP TYPE fails once type is gone). Fix: guard ALTER on atttypid='app.wellness_feeling_core'::regtype, DROP TYPE IF EXISTS.
2. HIGH — therapy_notes.linked_checkin_id can point at another user's check-in (FK ≠ ownership; owner-only RLS on the notes table doesn't prove the parent's owner matches). Fix: SECURITY INVOKER trigger like 0084 enforce_medication_log_owner.
3. MED/HIGH — scope contradiction: goal says apps/web/src/wellness/\* + CSS but plan also edits api/client.ts, api/query-keys.ts, styles/index.css. Fix: expand stated scope or keep helpers local.
4. MED — manifest.database.ownedTables not updated for the new table (currently 3 tables). Fix: add app.wellness_therapy_notes + update manifest assertions.
   VERDICT: REVISE

### Claude's response (final arbiter — accepted all four)

1. ACCEPTED + simplified: Ben confirmed NO data (Wellness not installed for any user) → clean no-row swap, no CASE remap. Still re-run-safe via to_regtype/atttypid guard + DROP TYPE IF EXISTS.
2. ACCEPTED: added SECURITY INVOKER BEFORE INSERT/UPDATE trigger mirroring enforce_medication_log_owner; rejects a linked_checkin_id invisible under the invoker's RLS.
3. ACCEPTED: PLAN goal now names api/client.ts + api/query-keys.ts + styles/index.css as in-scope integration points.
4. ACCEPTED: manifest adds new SQL to database.migrations, the table to ownedTables, new routes to routes[], and a new wellness.delete permission for therapy-notes DELETE.

### Correction — Round 1 actually had 9 findings (initial capture truncated at 4). Findings 5-9 + responses:

5. MED — foundation.test.ts:180 hard-codes global migration assertions through 0087; 2 new migrations break it. ACCEPTED: foundation.test.ts in scope, bump to 0088/0089.
6. MED — old-taxonomy refs broader than test list (wellness-medications.test.ts, e2e wellness.spec.ts, feelings-picker.tsx, wellness.test.ts). ACCEPTED: rg cleanup gate over source+tests+mocks must be zero.
7. MED — focus-signal/recall "unchanged" only functionally true; their test fixtures/privacy assertions seed old cores (scared). ACCEPTED: production energy logic unchanged; update fixtures to new cores; privacy assertion uses new words.
8. MED — listLogsRange would repeat the logged_at mis-bucketing bug; schedule uses scheduled_for. ACCEPTED: listLogsRange buckets by scheduled_for, explicit PRN handling.
9. LOW — therapy_notes lacks index on linked_checkin_id (ON DELETE SET NULL scans). ACCEPTED: partial index on linked_checkin_id WHERE NOT NULL.

## Round 2 — Codex (confirmed #2-#9 addressed; 3 residual findings on the enum migration)

1. HIGH — re-run guard still unsafe: bare 'app.wellness_feeling_core'::regtype cast errors on re-run after the type is dropped. Fix: capture old_oid := to_regtype(...) in PL/pgSQL, compare atttypid = old_oid.
2. MED — zero-rows assumption is load-bearing but not DB-enforced; a stray row aborts mid-migration. Fix: assert NOT EXISTS (SELECT 1 FROM wellness_checkins) and RAISE before the ALTER.
3. LOW — stale "lossy remap of existing dev rows" sentence (PLAN.md:103) contradicts no-data strategy. Fix: delete/rewrite.
   VERDICT: REVISE

### Claude's response (accepted all three)

1. ACCEPTED: migration now a PL/pgSQL DO block — old_oid := to_regtype('app.wellness_feeling_core'); proceed only if old_oid IS NOT NULL AND feeling_core atttypid = old_oid; no bare ::regtype cast anywhere.
2. ACCEPTED: block RAISEs a clear exception if wellness_checkins is non-empty, BEFORE any ALTER.
3. ACCEPTED: stale sentence rewritten to "verified-empty table, no remap".

## Round 3 — Codex

Re-read PLAN.md; confirmed all three Round-2 fixes reflected (PL/pgSQL old_oid guard, empty-table assertion, stale sentence removed).
VERDICT: APPROVED

## Resolution: APPROVED after 3 rounds (9 findings → 3 → 0). Plan locked. Proceeding to build (user delegated; no manual gate).
