# Real data export — server-built personal archive with owner-scoped download

**Status:** Approved design — ready to build
**Date:** 2026-06-22
**Owner:** Ben
**GitHub:** #238
**Grounded on:** `origin/main` @ `15448ba` (current branch `docs/update-stale-documentation`,
docs-only ahead, source tree unchanged).
**Ordering:** after #237 (active sessions), before #239 (account deletion).

---

## Goal

Replace the client-side export simulation (fake progress bar, fixed JSON manifest) with a real
server-built archive. The archive covers all user-owned data modules, excludes secrets and other
users' data, and is downloadable via an owner-scoped token.

Success = in Settings on the deployed instance: clicking "Export my data" triggers a real
server job → progress indicator reflects actual status → download button produces a real
`jarvis-archive/v1` JSON archive containing the actor's personal data → `pnpm
verify:foundation` green.

---

## Architecture

### New table: `app.data_export_jobs` (migration `0099`)

Owned by `packages/settings`. Persists job state so the status endpoint doesn't need to
poll pg-boss directly.

```sql
CREATE TABLE IF NOT EXISTS app.data_export_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'building', 'ready', 'failed', 'expired')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  expires_at        timestamptz,          -- set when status = 'ready'; download expires here
  error_message     text                  -- non-null only on 'failed'
);
```

RLS: owner-only (`ENABLE`, `FORCE`; all operations scoped to `current_actor_user_id()`).
Grants: `SELECT, INSERT, UPDATE` to `jarvis_app_runtime`; `UPDATE` to `jarvis_worker_runtime`
(worker updates status rows it owns by `owner_user_id`).

Migration file: `packages/settings/sql/0099_data_export_jobs.sql`.

### Archive storage

Completed archives are written to the actor's vault subtree under a dedicated path:

```
{vaultBase}/{userId}/exports/{jobId}.json
```

The vault path is derived in the worker; the download route reads it via `VaultContext`.
Archives older than 24 hours are expired (status set to `expired`; vault file deleted on
next GC pass or immediately on expiry check — see worker below).

### API endpoints (in `packages/settings/src/routes.ts`)

#### `POST /api/me/export`

Creates a new export job and enqueues a worker job. If the actor already has a `pending` or
`building` job, return it instead of creating a duplicate.

Request: no body.

Response `202`:

```typescript
{
  jobId: string;
  status: "pending" | "building";
}
```

pg-boss payload (metadata-only, no personal data):

```typescript
{
  kind: "export.build";
  jobId: string;
  actorUserId: string;
}
```

#### `GET /api/me/export/status/:jobId`

Returns the current status of an export job.

Response `200`:

```typescript
{
  jobId: string;
  status: "pending" | "building" | "ready" | "failed" | "expired";
  expiresAt?: string; // ISO, present when status = "ready"
  errorMessage?: string; // present when status = "failed"
}
```

Returns `404` if the job does not belong to the actor.

#### `GET /api/me/export/download/:jobId`

Streams the archive file directly to the client as `application/json` with
`Content-Disposition: attachment; filename="jarvis-export-{date}.json"`.

Returns `404` if no `ready` job with this ID belongs to the actor.
Returns `410 Gone` if the job status is `expired`.

No separate signed URL is needed — the authenticated session cookie scopes the download.

### Worker job (`packages/settings/src/jobs.ts`)

Job kind: `export.build`. Registered in the settings module manifest.

Steps:

1. Update job status → `building`.
2. Open a `DataContextDb` scoped to `actorUserId` (uses the app pool, RLS active).
3. Build archive sections in sequence (see §Archive format below).
4. Write the JSON to `{vaultBase}/{userId}/exports/{jobId}.json` via `VaultContext`.
5. Update job status → `ready`, set `expires_at = now() + 24h`, set `completed_at`.

On any unhandled error: update status → `failed`, set `error_message` (single-line, no
stack, no personal data content).

**pg-boss payload invariant:** payload contains only `kind`, `jobId`, and `actorUserId`.
No personal data, no prompts, no secrets.

### Archive format (`jarvis-archive/v1`)

```json
{
  "format": "jarvis-archive/v1",
  "exportedAt": "<ISO timestamp>",
  "userId": "<uuid>",
  "sections": {
    "profile": { ... },
    "preferences": [ ... ],
    "tasks": [ ... ],
    "memory": { "chunks": [...], "links": [...], "facts": [...] },
    "structured_state": { "commitments": [...], "entities": [...], "medications": [...], "medication_logs": [...] },
    "wellness": { "checkins": [...], "therapy_notes": [...] },
    "connector_metadata": [ ... ],
    "calendar_cache": [ ... ],
    "email_cache": [ ... ],
    "ai_metadata": { "providers": [...], "models": [...] },
    "chat": { "threads": [...], "messages": [...] },
    "briefings": { "definitions": [...], "runs": [...] },
    "vault_files": [ ... ]
  }
}
```

#### Section exclusions (security-critical)

| Section                 | Excluded fields                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `profile`               | `password_hash`, `is_instance_admin`                                                           |
| `connector_metadata`    | `encrypted_credential`, `oauth_tokens`                                                         |
| `ai_metadata.providers` | `encrypted_credential`                                                                         |
| All sections            | embeddings (`vector` columns), pg-boss job payloads, internal audit rows scoped to other users |

The exclusion is **structural** — each section query selects only the columns the archive
wants. It never selects `encrypted_*` or `*_hash` columns and never spreads raw query rows.

**Wellness data must be included.** The v0.1.0 security audit (HIGH finding) identified
that the current delete path purges wellness while the export omits it — this spec closes
that gap. `wellness_checkins`, `wellness_therapy_notes`, and `medication_logs` are required
sections.

### UI changes (`apps/web/src/settings/settings-profile-subviews.tsx`)

Replace the client-side simulation with:

1. **"Export my data" button** → `POST /api/me/export` → poll `GET .../status/:jobId` every
   3 seconds while status is `pending` or `building`.
2. **Progress indicator** reflects status transitions (pending → building → ready/failed).
3. **Download button** appears when status = `ready` → navigates to
   `GET /api/me/export/download/:jobId`.
4. **Error state** if status = `failed` — shows "Export failed. Try again." with a retry button.
5. Remove the `BACKEND-TODO` comment and `NotWired` wrapper.

The client does not need the vault path — it always goes through the download endpoint.

---

## Migration

`packages/settings/sql/0099_data_export_jobs.sql`:

- Creates `app.data_export_jobs` table with schema above
- Enables + forces RLS with owner-only policies
- Grants to `jarvis_app_runtime` and `jarvis_worker_runtime`

Settings module manifest updated to include the migration path.

---

## Out of scope

- Scheduled/recurring exports
- Multiple simultaneous outstanding export jobs (one-at-a-time enforced by the dedup check
  in `POST /api/me/export`)
- Compressed archive (`.gz`) — plain JSON first; compression deferred
- Partial-section export selection (user picks which modules to include)
- Export of pg-boss job history

---

## Acceptance criteria

- [ ] `POST /api/me/export` creates a `data_export_jobs` row and enqueues a pg-boss job;
      returns `202` with `{ jobId, status: "pending" }`
- [ ] `GET /api/me/export/status/:jobId` returns the correct status at each stage
- [ ] After the worker completes, the archive file exists in the vault at the expected path
- [ ] `GET /api/me/export/download/:jobId` streams a valid `jarvis-archive/v1` JSON file
- [ ] Archive includes wellness sections (`checkins`, `therapy_notes`); these were omitted in
      the simulated export (closes v0.1.0 HIGH finding)
- [ ] Archive does not contain `encrypted_*` columns, `password_hash`, oauth tokens, or
      embeddings in any section
- [ ] User A cannot poll or download User B's export job (RLS enforced; returns 404)
- [ ] Status shows `expired` and download returns `410` after the 24-hour window
- [ ] `NotWired` wrapper and `BACKEND-TODO` comment removed from the UI
- [ ] `pnpm verify:foundation` green
