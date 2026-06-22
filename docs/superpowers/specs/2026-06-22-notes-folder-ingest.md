# Notes Source: Link Allowed Server Folder and Ingest Markdown into Memory

**Issue:** #248
**Status:** Approved for build
**Date:** 2026-06-22
**Milestone:** Next Roadmap · Post-first-week success

## Problem

The Settings UI shows a Notes source section but it is sample-only. No real folder is linked,
no Markdown is ingested, and the backend memory ingestion primitives (`chunking`, `retrieval`)
are unused by the notes path.

## Scope

- Operator configures one or more allowed notes roots via environment variable or instance
  settings (e.g. `JARVIS_NOTES_ROOTS=~/notes,/srv/docs`). No arbitrary host filesystem
  browsing — user can only select from operator-allowed roots.
- `GET /api/settings/notes-source` returns the user's selected source (path within an allowed
  root) or null.
- `PUT /api/settings/notes-source` body `{ path }` — validates path is within an allowed root,
  stores it.
- `POST /api/notes/sync` enqueues a pg-boss job that walks the selected folder, chunks `.md`
  files, and upserts them into the memory module via the existing ingestion API.
- Sync job: metadata-only payload (user_id, source path, job_id) — file content handled
  inside the worker, never in the pg-boss payload.
- Path traversal protection: symlink-escape check + canonical-path prefix guard before any
  `fs` read.
- All file I/O goes through `VaultContext` or the existing file-read utility — no raw `fs`
  calls from route handlers.

## Out of scope

- Real-time file watching / auto-sync.
- Non-Markdown formats.
- Cloud storage sources (Dropbox, GDrive).

## Data

Migration **0102** (reserve 0102–0103):
```sql
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS
  notes_source_path text DEFAULT NULL;
  -- absolute path within an operator-allowed root, or null
```

## API

```
GET  /api/settings/notes-source           → { path } | null
PUT  /api/settings/notes-source           → body { path: string | null }
POST /api/notes/sync                      → 202 { jobId } — enqueues ingest job
GET  /api/notes/sync/status               → { lastSync, status, count } (optional, best-effort)
```

## Acceptance

- PUT rejects a path outside operator-allowed roots with 400.
- Symlink-escape attempt returns 400.
- Sync job ingests all `.md` files in the selected folder into the memory module.
- File content never appears in the pg-boss job payload.
- `pnpm verify:foundation` passes.
