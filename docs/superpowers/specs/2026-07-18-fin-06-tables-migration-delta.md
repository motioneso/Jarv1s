# FIN-06 — Finance KV → module-owned tables (spec delta)

**Status:** Draft — awaiting approval (Ben)
**Parent spec:** `2026-07-18-finance-module-design.md` (epic #1144, "FIN-06" sketch)
**Platform spec:** `2026-07-09-module-data-plane.md` (#914, decisions D1–D6)
**Slice issue:** #1166 (finance), #1167 (platform prerequisite)

## Goal

Move the finance module's high-volume, user-scoped KV namespaces onto module-owned Postgres
tables via the #914 data plane. **No product behavior change**: every screen, tool, and UAT
assertion produces identical output before and after. The KV record shapes were designed for
this (parent spec, "Transaction record"); the migration is a mechanical ETL.

## Grounding (verified against main @ b568fb7a, 2026-07-18)

Shipped by #914 and usable as-is:

- `app.module_schema_migrations` ledger (core migration `0155`), namespaced per-module runner.
- `scripts/module-install.ts` — phased install (bootstrap roles → module DDL on the installer
  connection → generated owner-only RLS/policies/grants → catalog-diff verification → ledger).
- `createModuleStorageRpc` (`packages/db/src/module-storage-rpc.ts`) — parent-side
  `SET LOCAL ROLE jarvis_mod_<slug>_runtime` query helper, already consumed by the derived
  export path (`packages/settings/src/data-export.ts`).

**Not shipped (the prerequisite):** the module-facing `ctx.db.query` RPC. The worker RPC host
(`packages/module-registry/src/external/worker-rpc-host.ts`) exposes only
`fetch` / `ai` / `auth` / `kv.*`; `ModuleContext` (module-sdk) has no `db` member; and
`createModuleStorageRpc` has none of the D5 bounds required before module-authored SQL may
reach it (statement-type allowlist, `SET LOCAL statement_timeout`, row-count and result-byte
caps, cancellation, error redaction). That is platform work, filed separately as #1167 —
FIN-06 is blocked on it and builds nothing platform-side.

## Decisions

### F6-D1. What moves, what stays

Move to tables (prefix `finance_`, all owner-only per #914 D3):

| KV namespace                 | Table                        | Row grain                        |
| ---------------------------- | ---------------------------- | -------------------------------- |
| `finance.connections`        | `finance_items`              | one Plaid item                   |
| `finance.accounts`           | `finance_accounts`           | one account                      |
| `finance.transactions`       | `finance_transactions`       | **one transaction** (un-chunked) |
| `finance.snapshots`          | `finance_balance_snapshots`  | one account-day                  |
| `finance.budgets` `ledger:*` | `finance_budget_assignments` | one owner-month-category         |

Stays in KV, unchanged:

- **`finance.shared` (the FIN-04 household mirror).** Hard constraint: owner-only is the
  _only_ RLS class for external-module tables in v1 (#914 non-goal), and the mirror is by
  definition cross-user-readable instance data. It is derived and rebuildable (share/sync
  reconcile), low-volume, and moves only when a sharing class for module tables exists
  (its own platform spec).
- `finance.rules`, `finance.prefs`, sync cursors — small config blobs; a table buys nothing.
- `finance.budgets` `state:{month}` caches — **deleted, not migrated** (see F6-D3).

### F6-D2. Schema shape

Every table carries the mandatory
`owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE`; RLS, policies, and
grants are platform-generated (never module-authored). Migrations live in
`external-modules/finance/sql/0001_….sql` onward, one DDL statement per file, restricted to
the #914 D3 allowlist. Key columns follow the stored KV shapes verbatim (integer cents,
spending-positive; ISO dates as `date`; ids as `text`). Uniqueness:
`(owner_user_id, id)` for transactions (Plaid `transaction_id` idempotency, replacing
per-chunk dedup), `(owner_user_id, account_id, day)` for snapshots,
`(owner_user_id, month, category_id)` for assignments. Cross-table FKs stay **soft** (plain
columns, indexed, no REFERENCES between module tables) so sync reducer ordering and
at-least-once replay semantics carry over unchanged.

### F6-D3. Reads become SQL; the budget state cache dies

Feed, budget derivation inputs, and reports switch from month-chunk loads to bounded SQL
through `ctx.db.query`. Pure domain functions (transfer pairing, envelope rollover,
`mergeSpendingMonths`, `deriveNetWorth`) are **kept** and fed from SQL rows — aggregation
moves to SQL only where it is a plain GROUP BY; the tested domain math does not get
reimplemented in SQL in this slice. With chunk loads gone, the FIN-03 `state:{YYYY-MM}` cache
(and its write-path-ownership rule) loses its reason to exist: `finance.budget.status`
computes from indexed rows on every call and the cache namespace is deleted in the cutover.
Internal-only change; the tool's output contract is untouched.

### F6-D4. Backfill is module runtime code, per-owner, idempotent

No DML in migrations (#914 non-goal). A new queue handler `finance.storage-migrate`
(job payload: metadata only — the owner id) reads that owner's KV chunks and inserts rows
with `ON CONFLICT DO NOTHING`, verifies counts (KV-derived vs `SELECT count(*)`), writes a
per-owner `storage:migrated` marker to `finance.meta` KV, and only then deletes that owner's
migrated KV chunks. The module's boot reconcile enqueues the job for every owner without the
marker (replay-safe: re-enqueue and crash-mid-run are both absorbed by the conflict-skipping
insert and the marker-last ordering). The storage port consults the cached marker per owner:
unmigrated owners read KV, migrated owners read SQL — the only dual-read point is inside the
port, never in screens/tools/handlers.

### F6-D5. UAT proves the ETL, not just the endpoint

The existing finance UAT seeds keep writing **KV-shaped** fixtures. Post-FIN-06, the module
migrates them at boot reconcile inside the UAT stack itself, and the four existing specs
(feed, budget, shared, reports) must pass **unchanged** — same asserted dollar figures on
migrated storage. That makes every UAT run an end-to-end ETL proof (seed → migrate → SQL
reads → identical UI numbers). One new assertion is added to the reports spec: the migrated
owner's `finance.transactions` KV keys are gone after the run (cutover deletion actually
happened).

## Security & privacy (unchanged invariants, restated for this surface)

- Tables are owner-only FORCE RLS by platform generation; admins get no bypass.
- Plaid tokens stay exclusively in `app.module_credentials` — no credential, token, or
  secret ever appears in module tables, ETL job payloads, or logs.
- `finance.storage-migrate` payloads are metadata-only (owner id, job kind, idempotency key).
- Export/deletion coverage of the new tables is automatic (#914 D6); the ETL removes the
  same data from KV, so no row is ever exported twice from two stores after cutover.

## Slices

1. **#1167 (platform, blocking):** `ctx.db.query` in worker-rpc-host + module-sdk context,
   with the D5 bounds (allowlist, `statement_timeout`, row/byte caps, cancellation,
   redaction) added to `createModuleStorageRpc`. Own task; benefits all modules.
2. **FIN-06a:** `sql/` migrations + manifest `database.ownedTables`; install proven through
   `module-install.ts` in integration tests (catalog diff, RLS generation, purge).
3. **FIN-06b:** storage port dual-read + `finance.storage-migrate` handler + boot-reconcile
   enqueue; unit + integration coverage for replay, crash-mid-run, count-verification.
4. **FIN-06c:** SQL read paths (feed/budget/reports), `state:` cache deletion, KV chunk
   deletion at cutover; all four UAT specs green unchanged + the new KV-gone assertion.

## Non-goals

- Moving the `finance.shared` mirror (needs a module-table sharing class; platform spec).
- New product features, retention policies, multi-currency, or schema beyond the KV shapes.
- Any change to sync semantics, categorization, or the assistant tool contracts.

## Approval state

Drafted 2026-07-18. Awaiting Ben's approval before any code (hard process gate).
