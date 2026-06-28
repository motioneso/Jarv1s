# Build Plan — Unified Person / Contact Model (#538)

**Date:** 2026-06-28
**Branch:** rfa-538-person-contact-model
**Spec:** ~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-person-contact-model.md
**Issue:** #538
**Approval gate:** Coordinator (`5e1a6b62-a480-4b5c-9706-e476cfe77044`) must approve before any code is written.

---

## Overview

Introduce `packages/people` as a new first-class Jarvis module. It stores a **unified person / contact
model** — one `person_context_people` row per real-world person, linked to raw identity signals
ingested from email, calendar, chat, notes, tasks, commitments, and memory. The module exposes:

- A SQL migration (`XXXX_person_context.sql`) — 9 ENUMs + 7 tables, all FORCE RLS
- Kysely table interfaces + Selectable aliases in `packages/db/src/types.ts`
- A `PersonContextProvider` contract in `packages/module-sdk`
- A full `packages/people` package (types, matching, repository, service, jobs, workers, tools, manifest, routes)
- Module-registry wiring so the new routes and workers are registered at server start
- A Settings → Memory & context → People & context tab (`settings-people-pane.tsx`)
- All integration tests run against a lane DB (`JARVIS_PGDATABASE=jarvis_build_538`)

Migration slot: **XXXX** — coordinator assigns actual number (expected 0127) before push. Use
`XXXX` throughout this plan; replace globally before the final push.

---

## Risk Tier — SECURITY

All 7 tables hold personal data.

- FORCE RLS + ENABLE RLS on every table — `jarvis_app_runtime` and `jarvis_worker_runtime`
  both scoped to `app.current_actor_user_id()`.
- `normalized_value` (canonical identity string) is **private** — strip from all REST responses and
  assistant-tool outputs. Return `display_value` only.
- `source_ref` (raw foreign key into a source module) is **private** — never leave the DB layer
  except inside workers loading indexing state.
- `people.merge` and `people.splitIdentity` tools: `risk: "destructive"`, `executionPolicy` must
  NOT be `"auto"` — always requires explicit human confirmation.
- `people.acceptMatch` must detect `candidate_kind in ("merge_people","split_identity")` and
  refuse to auto-execute; escalate to the destructive tools instead.
- Job payloads carry metadata only: `actorUserId, source, sourceRefHash, sourceVersion, reason,
  idempotencyKey`. No content, no raw signals, no `source_ref`.
- Never log raw `PersonContextSignal` objects — log counts, `sourceKind`, `sourceRefHash`, and
  error class only.
- Memory-sync failures must NOT roll back person-context writes — keep them in separate
  transactions.

---

## Task List

| # | Task | Scope |
|---|------|-------|
| 1 | SQL migration: ENUMs + 7 tables + FORCE RLS + policies | DB |
| 2 | Kysely types in `packages/db/src/types.ts` | packages/db |
| 3 | `PersonContextProvider` contract in `packages/module-sdk` | packages/module-sdk |
| 4 | `packages/people` scaffold: `package.json`, `tsconfig.json`, `src/types.ts` | packages/people |
| 5 | `src/matching.ts` — normalizeIdentity, matchResult, candidateSignature | packages/people |
| 6 | `src/repository.ts` — PeopleRepository | packages/people |
| 7 | `src/service.ts` — PersonContextService | packages/people |
| 8 | `src/jobs.ts` + `src/workers.ts` — queues + worker registration | packages/people |
| 9 | `src/tools.ts` — 7 assistant tools | packages/people |
| 10 | `src/manifest.ts` + `src/routes.ts` + `src/index.ts` — manifest, 14 REST routes, public API | packages/people |
| 11 | Module-registry wiring in `packages/module-registry/src/index.ts` | packages/module-registry |
| 12 | Web UI: `settings-people-pane.tsx` + `people-client.ts`, wire into settings-memory-pane | apps/web |
| 13 | Full gate: typecheck + lint + format + integration tests + foundation.test.ts row | all |

---

## Task 1 — SQL Migration: ENUMs + 7 Tables + FORCE RLS

**File:** `packages/people/sql/XXXX_person_context.sql`

### Failing test first

```ts
// tests/integration/people/migration.test.ts
import { resetFoundationDatabase, connectionStrings } from "../test-database.js";
it("migration XXXX creates all person_context tables", async () => {
  await resetFoundationDatabase();
  const db = createDatabase(connectionStrings.lane);
  const tables = await db
    .selectFrom("information_schema.tables")
    .select("table_name")
    .where("table_schema", "=", "app")
    .where("table_name", "like", "person_context_%")
    .execute();
  const names = tables.map((r) => r.table_name).sort();
  expect(names).toEqual([
    "person_context_events",
    "person_context_identities",
    "person_context_indexing_state",
    "person_context_link_sources",
    "person_context_links",
    "person_context_match_candidates",
    "person_context_people",
  ]);
  await db.destroy();
});
it("all person_context tables have RLS enforced", async () => {
  const db = createDatabase(connectionStrings.lane);
  const rows = await db.executeQuery(
    sql`SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid
        WHERE nspname = 'app' AND relname LIKE 'person_context_%'`.compile(db)
  );
  for (const row of rows.rows) {
    expect(row.relrowsecurity).toBe(true);
    expect(row.relforcerowsecurity).toBe(true);
  }
  await db.destroy();
});
```

### Implementation

Create `packages/people/sql/XXXX_person_context.sql`:

1. Create 9 ENUMs in `app` schema:
   - `app.person_context_status` — `'active','archived','merged'`
   - `app.person_context_identity_kind` — `'email_address','source_identity','alias','display_name'`
   - `app.person_context_source_kind` — `'email','calendar','chat','note','task','commitment','memory','manual'`
   - `app.person_context_identity_status` — `'active','pending','ambiguous','rejected','split'`
   - `app.person_context_provenance` — `'source','inferred','user_confirmed','imported'`
   - `app.person_context_link_kind` — `'sender','recipient','attendee','mentioned','assigned','counterparty','related'`
   - `app.person_context_candidate_kind` — `'create_person','link_identity','merge_people','split_identity'`
   - `app.person_context_candidate_status` — `'pending','accepted','rejected','suppressed','resolved'`
   - `app.person_context_event_kind` — `'created','identity_linked','identity_rejected','merged','split','archived','candidate_accepted','candidate_rejected','candidate_reopened'`
2. Create 7 tables (see relay doc for column specs).
3. After each table: `ALTER TABLE app.<name> ENABLE ROW LEVEL SECURITY; ALTER TABLE app.<name> FORCE ROW LEVEL SECURITY;`
4. Add SELECT/INSERT/UPDATE/DELETE policies for `jarvis_app_runtime` and SELECT/INSERT/UPDATE/DELETE
   for `jarvis_worker_runtime`, all gated on `(owner_user_id = app.current_actor_user_id())`.
5. Add unique index on `person_context_identities (owner_user_id, identity_kind, source_kind, normalized_value)
   WHERE status = 'active' AND identity_kind IN ('email_address','source_identity')`.
6. Add unique constraint on `person_context_match_candidates (owner_user_id, candidate_signature)`.

---

## Task 2 — Kysely Types in `packages/db/src/types.ts`

**File:** `packages/db/src/types.ts`

### Failing test first

```ts
// tests/integration/people/db-types.test.ts
it("PersonContextPeopleTable is queryable via JarvisDatabase", async () => {
  const db = createDatabase(connectionStrings.lane);
  // Type check: if the interface is missing this line fails at compile time
  const result = await db
    .selectFrom("app.person_context_people")
    .select(["id", "owner_user_id", "display_name", "status"])
    .limit(1)
    .execute();
  expect(Array.isArray(result)).toBe(true);
  await db.destroy();
});
```

### Implementation

Add 7 interfaces to `packages/db/src/types.ts` (after last existing table interface, before
`JarvisDatabase`). For each table mirror the SQL columns using existing type aliases
(`TimestampColumn`, `NullableTimestampColumn`, `ColumnType<string, string | undefined, never>`
for UUID PKs).

Then add to `JarvisDatabase`:
```ts
"app.person_context_people": PersonContextPeopleTable;
"app.person_context_identities": PersonContextIdentitiesTable;
"app.person_context_links": PersonContextLinksTable;
"app.person_context_link_sources": PersonContextLinkSourcesTable;
"app.person_context_match_candidates": PersonContextMatchCandidatesTable;
"app.person_context_events": PersonContextEventsTable;
"app.person_context_indexing_state": PersonContextIndexingStateTable;
```

Add Selectable aliases at the bottom (line ~893+):
```ts
export type PersonContextPerson = Selectable<PersonContextPeopleTable>;
export type PersonContextIdentity = Selectable<PersonContextIdentitiesTable>;
export type PersonContextLink = Selectable<PersonContextLinksTable>;
export type PersonContextLinkSource = Selectable<PersonContextLinkSourcesTable>;
export type PersonContextMatchCandidate = Selectable<PersonContextMatchCandidatesTable>;
export type PersonContextEvent = Selectable<PersonContextEventsTable>;
export type PersonContextIndexingState = Selectable<PersonContextIndexingStateTable>;
```

---

## Task 3 — `PersonContextProvider` Contract in `packages/module-sdk`

**File:** `packages/module-sdk/src/index.ts`

### Failing test first

```ts
// packages/people/src/__tests__/provider-contract.test.ts
import type { PersonContextProvider, PersonContextSignal } from "@jarv1s/module-sdk";
it("PersonContextProvider type is exported from module-sdk", () => {
  // Compile-time check — if missing, TS errors here
  const _: PersonContextProvider = {
    sourceKind: "email",
    collectPersonSignals: async (_input) => ({ signals: [] }),
  };
  expect(_).toBeDefined();
});
```

### Implementation

Add to `packages/module-sdk/src/index.ts` (follow `ProactiveMonitorProvider` pattern, ~line 139):

```ts
export interface PersonContextSignal {
  readonly identityKind: "email_address" | "source_identity" | "alias" | "display_name";
  readonly displayValue: string;
  readonly normalizedValue: string; // private — never expose outside DB layer
  readonly sourceRef: string;       // private — never expose outside DB layer
  readonly sourceRefHash: string;
  readonly sourceVersion: string;
  readonly linkKind: "sender" | "recipient" | "attendee" | "mentioned" | "assigned" | "counterparty" | "related";
  readonly sourceLabel?: string;
  readonly summary?: string;
  readonly occurredAt?: Date;
  readonly confidence: number;
  readonly provenance: "source" | "inferred" | "user_confirmed" | "imported";
}

export interface PersonContextSignalBatch {
  readonly signals: PersonContextSignal[];
  readonly nextCursor?: string;
}

export interface PersonContextProviderInput {
  readonly actorUserId: string;
  readonly sourceRefHash: string;
  readonly sourceVersion?: string;
  readonly cursor?: string;
}

export type PersonContextSource =
  | "email" | "calendar" | "chat" | "note"
  | "task" | "commitment" | "memory" | "manual";

export interface PersonContextProvider {
  readonly sourceKind: PersonContextSource;
  collectPersonSignals(input: PersonContextProviderInput): Promise<PersonContextSignalBatch>;
}
```

Also extend `JarvisModuleManifest`:
```ts
readonly personContextProvider?: PersonContextProvider;
```

---

## Task 4 — `packages/people` Scaffold: package.json, tsconfig.json, src/types.ts

**Files:** `packages/people/package.json`, `packages/people/tsconfig.json`,
`packages/people/src/types.ts`

### Failing test first

```ts
// packages/people/src/__tests__/types.test.ts
import type { Person, PersonIdentity, PersonLink, MatchCandidate } from "../types.js";
it("domain types are importable", () => {
  const p: Pick<Person, "id" | "displayName" | "status"> = {
    id: "uuid",
    displayName: "Alice",
    status: "active",
  };
  expect(p.displayName).toBe("Alice");
});
```

### Implementation

`package.json` — `@jarv1s/people`, ESM, `"type": "module"`, same peer deps as `@jarv1s/commitments`
plus `@sinclair/typebox`. Declare workspace dependencies: `@jarv1s/db`, `@jarv1s/module-sdk`,
`@jarv1s/jobs`.

`tsconfig.json` — `extends ../../tsconfig.json`, `rootDir: src`, `outDir: dist`.

`src/types.ts` — domain types derived from DB Selectable aliases, with snake_case → camelCase
conversion. Key types:
- `Person` (from `PersonContextPerson`, omitting `normalized_value` / `source_ref` fields)
- `PersonIdentity` (omitting `normalized_value`, `source_ref`)
- `PersonLink` (omitting `source_ref`)
- `PersonLinkSource`
- `MatchCandidate`
- `PersonEvent`
- `PersonIndexingState` (for worker use only — retains `source_ref`)
- `ListPeopleParams`, `ListLinksParams`, `RefreshIndexParams` (request shapes)
- `PersonDetail` (Person + identities + recent links, for GET /api/people/:id response)

---

## Task 5 — `src/matching.ts`

**File:** `packages/people/src/matching.ts`

### Failing test first

```ts
// packages/people/src/__tests__/matching.test.ts
import { normalizeIdentity, matchResult, candidateSignature } from "../matching.js";

describe("normalizeIdentity", () => {
  it("lowercases and trims email addresses", () => {
    expect(normalizeIdentity("email_address", " Alice@Example.COM ")).toBe("alice@example.com");
  });
  it("returns trimmed lowercase for source_identity", () => {
    expect(normalizeIdentity("source_identity", "  SRC:123  ")).toBe("src:123");
  });
});

describe("candidateSignature", () => {
  it("produces stable hash for same inputs regardless of order", () => {
    const a = candidateSignature("merge_people", ["uuid-1", "uuid-2"]);
    const b = candidateSignature("merge_people", ["uuid-2", "uuid-1"]);
    expect(a).toBe(b);
  });
  it("differs for different candidate kinds", () => {
    const a = candidateSignature("link_identity", ["uuid-1"]);
    const b = candidateSignature("create_person", ["uuid-1"]);
    expect(a).not.toBe(b);
  });
});
```

### Implementation

`normalizeIdentity(kind, raw): string` — trim + lowercase for email/source_identity; trim only for
alias/display_name.

`matchResult(signals: PersonContextSignal[]): MatchResultMap` — group signals by normalized
identity, compute confidence aggregate, return candidate actions.

`candidateSignature(kind, ids: string[]): string` — sort ids, join with `|`, prefix with kind,
SHA-256 hex truncated to 32 chars. Use Node `crypto.createHash`.

---

## Task 6 — `src/repository.ts`

**File:** `packages/people/src/repository.ts`

### Failing test first

```ts
// packages/people/src/__tests__/repository.test.ts
import { PeopleRepository } from "../repository.js";
import { createDatabase, withDataContext } from "@jarv1s/db";

const DB_URL = process.env["JARVIS_DATABASE_URL"]!;

it("upsertPerson creates then returns existing on re-upsert", async () => {
  const db = createDatabase(DB_URL);
  const repo = new PeopleRepository();
  await withDataContext({ actorUserId: ids.user1, requestId: "r1" }, db, async (sdb) => {
    const p = await repo.upsertPerson(sdb, {
      ownerUserId: ids.user1,
      displayName: "Bob",
      status: "active",
    });
    expect(p.id).toBeDefined();
    const p2 = await repo.upsertPerson(sdb, { ...same display_name... });
    expect(p2.id).toBe(p.id); // idempotent
  });
  await db.destroy();
});

it("repository enforces RLS — user1 cannot see user2 people", async () => {
  const db = createDatabase(DB_URL);
  const repo = new PeopleRepository();
  // insert as user1, query as user2
  await withDataContext({ actorUserId: ids.user2, requestId: "r2" }, db, async (sdb) => {
    const rows = await repo.listPeople(sdb, ids.user2, {});
    expect(rows.map((r) => r.ownerUserId).every((id) => id === ids.user2)).toBe(true);
  });
  await db.destroy();
});
```

### Implementation

`PeopleRepository` class — receives `DataContextDb` on every method (never stores it).

Methods:
- `upsertPerson(db, params)` — INSERT … ON CONFLICT DO NOTHING, then SELECT
- `findOrCreatePerson(db, displayName, ownerUserId)` — used during matching
- `getPerson(db, ownerUserId, personId)` — throws NotFoundError if missing
- `listPeople(db, ownerUserId, params: ListPeopleParams)` — search by displayName prefix
- `updatePerson(db, ownerUserId, personId, patch)` — PATCH allowed fields only
- `archivePerson(db, ownerUserId, personId)` — set status='archived', archived_at=now
- `upsertIdentity(db, params)` — INSERT … ON CONFLICT (unique index) DO UPDATE
- `listIdentities(db, ownerUserId, personId)` — returns without normalized_value/source_ref
- `upsertLink(db, params)` — INSERT … ON CONFLICT (source_ref_hash+link_kind) DO UPDATE
- `listLinks(db, ownerUserId, personId, params)` — cursor pagination, returns without source_ref
- `upsertLinkSource(db, params)`
- `upsertMatchCandidate(db, params)` — uses candidateSignature for conflict
- `getMatchCandidate(db, ownerUserId, candidateId)`
- `listMatchCandidates(db, ownerUserId, status?)` — pending only by default
- `updateMatchCandidateStatus(db, ownerUserId, candidateId, status)`
- `insertEvent(db, params)` — metadata-only event log
- `getIndexingState(db, ownerUserId, source, sourceRefHash)` — includes source_ref (worker only)
- `upsertIndexingState(db, params)`
- `mergePeople(db, ownerUserId, primaryId, secondaryId)` — transaction: re-link identities/links, set secondary status='merged', merged_into_person_id=primary, merged_at=now; insert event

All SELECT projections must exclude `normalized_value` and `source_ref` except `getIndexingState`.

---

## Task 7 — `src/service.ts`

**File:** `packages/people/src/service.ts`

### Failing test first

```ts
// packages/people/src/__tests__/service.test.ts
import { PersonContextService } from "../service.js";

it("resolve returns existing person for known email", async () => {
  // seed: upsert identity with email alice@example.com → person A
  const svc = new PersonContextService(repo);
  const result = await withDataContext(ac, db, (sdb) =>
    svc.resolve(sdb, ac.actorUserId, "alice@example.com")
  );
  expect(result?.displayName).toBe("Alice");
});

it("getPerson throws NotFoundError for unknown id", async () => {
  const svc = new PersonContextService(repo);
  await expect(
    withDataContext(ac, db, (sdb) => svc.getPerson(sdb, ac.actorUserId, "non-existent-uuid"))
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
```

### Implementation

`PersonContextService` — takes `PeopleRepository` in constructor.

Methods:
- `resolve(db, ownerUserId, query)` — look up by normalized identity (email), return `Person | null`
- `getPerson(db, ownerUserId, personId)` — delegates to repo, enriches with identity list
- `listLinks(db, ownerUserId, personId, params)` — delegates to repo
- `listMatchCandidates(db, ownerUserId)` — pending candidates
- `acceptCandidate(db, ownerUserId, candidateId)` — reads kind; if `link_identity` runs
  upsertIdentity+insertEvent; if `create_person` runs findOrCreatePerson; if `merge_people` or
  `split_identity` throws `RequiresExplicitActionError` — client must call merge/split directly
- `rejectCandidate(db, ownerUserId, candidateId)` — set status='rejected'
- `suppressCandidate(db, ownerUserId, candidateId)` — set status='suppressed'
- `splitIdentity(db, ownerUserId, identityId, targetPersonId?, newPersonDisplayName?)` — transaction:
  detach identity from current person, attach to target or create new, insert events for both persons

---

## Task 8 — `src/jobs.ts` + `src/workers.ts`

**Files:** `packages/people/src/jobs.ts`, `packages/people/src/workers.ts`

### Failing test first

```ts
// packages/people/src/__tests__/jobs.test.ts
import { enqueuePersonIndex, PersonIndexPayload, assertMetadataOnlyPersonPayload } from "../jobs.js";

it("enqueuePersonIndex enqueues with metadata-only payload", async () => {
  const sent: unknown[] = [];
  const mockBoss = { send: async (_q: string, d: unknown) => { sent.push(d); } } as any;
  await enqueuePersonIndex(mockBoss, {
    actorUserId: "u1",
    source: "email",
    sourceRefHash: "abc123",
    reason: "new_message",
    idempotencyKey: "u1:email:abc123",
  });
  expect(sent[0]).not.toHaveProperty("source_ref");
  expect(sent[0]).not.toHaveProperty("normalizedValue");
});

it("assertMetadataOnlyPersonPayload throws if forbidden key present", () => {
  expect(() =>
    assertMetadataOnlyPersonPayload({ actorUserId: "u", source: "email",
      sourceRefHash: "x", reason: "r", idempotencyKey: "k", source_ref: "FORBIDDEN" })
  ).toThrow();
});
```

### Implementation

`jobs.ts`:
- `PERSON_INDEX_QUEUE = "person-index"` — payload type: `PersonIndexPayload`
  (`actorUserId, source, sourceRefHash, sourceVersion?, reason, idempotencyKey`)
- `SYNC_PERSON_MEMORY_QUEUE = "sync-person-memory"` — payload: `SyncPersonMemoryPayload`
  (`actorUserId, personId, personUpdatedAt, reason, idempotencyKey`)
- `assertMetadataOnlyPersonPayload(data)` — throws if any key outside allowed set present
- `enqueuePersonIndex(boss, params)` — validates cooldown (15 min per owner), checks
  pending+running count (max 100 per owner), then `boss.send(PERSON_INDEX_QUEUE, payload, { singletonKey: idempotencyKey })`
- `enqueuePersonIndexBatch(boss, params[])` — max 50 refs per call, loops enqueuePersonIndex

`workers.ts`:
- `registerPersonIndexWorker(boss, dataContext, moduleRegistry)` — uses
  `registerDataContextWorker<PersonIndexPayload, void>`. Worker body:
  1. `assertMetadataOnlyPersonPayload(job.data)` — guard
  2. Load `source_ref` from `person_context_indexing_state` via repo (only place source_ref escapes DB layer into worker memory, never logged)
  3. Find provider via `moduleRegistry.getPersonContextProvider(source)`
  4. Call `provider.collectPersonSignals(input)` — log count+sourceKind only on error
  5. Run matching + upsert identities/links/candidates via repo in a single transaction
  6. Update indexing state (last_indexed_at, last_source_version, failure_count reset)
  7. If memory-entity sync needed: enqueue `SYNC_PERSON_MEMORY_QUEUE` in a SEPARATE transaction
- `registerSyncPersonMemoryWorker(boss, dataContext)` — separate worker for memory entity sync;
  failure must not affect person_context rows
