# JS-02 — owner-scoped KV domain and retention

**Status:** Draft — issue #931; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #930 and #919 `ctx.kv`

## Goal

Implement the complete owner-private persistence model on declared user-scoped `module_kv`
namespaces, with no job-search table or migration.

## Record contract

Every value is a versioned JSON object below 65,536 bytes. Keys contain ids/hashes, never private
prose or raw URLs.

| Namespace     | Records                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| onboarding    | one resumable state record                                                    |
| profile       | active pointer and immutable revisions                                        |
| resume        | active pointer, immutable original `revision/0`, immutable Markdown revisions |
| monitors      | monitor configuration and cursor per id                                       |
| opportunities | job per identity hash and eviction tombstone per identity hash                |
| runs          | run records and latest summary per monitor                                    |
| feed          | rebuildable compact ordered index                                             |

Profile/resume approval changes only the active pointer. Opportunity identity is adapter/external-id,
falling back to canonical-URL hash. Evaluation identity includes the opportunity content hash,
profile revision, and resume revision. No cross-key transaction is assumed: canonical records are
written before derived pointers/indexes, and interrupted derived writes are rebuilt idempotently.

## Fixed limits

- Reject resume input over 48 KB UTF-8 before writing either original or normalized content.
- Retain the original paste unchanged as `revision/0`; one normalized Markdown revision per value.
- Cap stored normalized description text at 16 KB and mark truncation.
- Target at most 500 opportunities/user after evicting every eligible record.
- Never auto-evict active/saved jobs.
- Allow active/saved protected records to overflow the 500-record target rather than refuse a save
  or silently discard user-selected/current data.
- Evict passed/stale after 30 days or oldest-first to enforce the cap.
- Replace evicted jobs with compact identity-hash tombstones expiring after 60 days.
- Per monitor retain the latest 50 runs or 14 days, whichever is smaller.

Tombstones carry only identity hash, adapter id, and expiry—no title, company, URL, or description.
Run records contain safe counts/codes only.

## Lifecycle and errors

Account export includes plain user KV records; credentials remain metadata-only. Account deletion
cascades all user records. Module disable preserves data; explicit purge removes its KV/credentials.
Invalid schema versions, oversize values, missing active pointers, and corrupt indexes return typed,
scrubbed errors. A corrupt derived feed is rebuilt rather than treated as data loss.

## Verification

- Owner-only RLS: user A and admins cannot read user B's private state.
- Exact size-boundary tests, including clear 48 KB rejection copy.
- Immutable revision and active-pointer transition tests.
- Interrupted-write/index-rebuild and idempotent retry tests.
- All retention, tombstone expiry, export/delete, disable, and purge cases.
- No core SQL/migration or direct DB handle in the package.

The UI reports protected overflow and the next retention pass continues evicting newly eligible
passed/stale records toward 500. The target is a retention control, not a data-loss boundary.
