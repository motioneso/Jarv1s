# Relay Handoff — rfa-538-person-contact-model

**Date:** 2026-06-28
**Branch:** rfa-538-person-contact-model
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-538-person-contact-model
**Spec:** docs/superpowers/specs/2026-06-27-unified-person-contact-model.md
**Coordinator label:** `Coordinator`
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044`

## Status

**No code written yet.** Spent session was in exploration/planning phase and hit compaction at 1%
before plan write completed. Successor picks up from scratch and writes the plan first.

## What Was Done (exploration only)

- pnpm install completed (node_modules present — skip on resume)
- Spec read in full (docs/superpowers/specs/2026-06-27-unified-person-contact-model.md)
- Handoff doc read in full (docs/coordination/handoff-rfa-538-person-contact-model.md)
- Verified spec premises against branch: `PersonContextProvider` absent from module-sdk ✓,
  `packages/people/` absent ✓
- Latest migration: `0126_app_runtime_calendar_events_delete.sql`
- Expected migration slot: **0127** (coordinator confirms before push — use XXXX placeholder)
- Studied: commitments module patterns (manifest, repository, routes, workers, jobs, tools),
  packages/db/src/types.ts (Kysely table types + JarvisDatabase), packages/module-registry/src/index.ts
- foundation.test.ts lines 107-300: toEqual migration list — must add `{ version: "XXXX", name: "XXXX_person_context.sql" }` at end

## Codebase Patterns (critical)

### module-sdk
`packages/module-sdk/src/index.ts` exports all types. Pattern for providers: see
`ProactiveMonitorProvider` (lines ~139-148), `CommitmentExtractionProvider` (lines ~416-423).
To add: `PersonContextProvider`, `PersonContextProviderInput`, `PersonContextSignal`,
`PersonContextSignalBatch`, `PersonContextSource` + extend `JarvisModuleManifest` with
`readonly personContextProvider?: PersonContextProvider`.

### packages/db/src/types.ts
- `TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>`
- `NullableTimestampColumn = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>`
- Tables use `ColumnType<string, string | undefined, never>` for UUID PKs
- Add to end of `JarvisDatabase` interface (line ~851) before closing `}`
- Selectable type aliases go at bottom (line ~893+)

### Package structure (follow commitments pattern)
```
packages/people/
  package.json              # @jarv1s/people, ESM, same deps as commitments + typebox
  tsconfig.json             # extends ../../tsconfig.json
  sql/
    XXXX_person_context.sql # ENUMs + 7 tables + FORCE RLS + policies
  src/
    types.ts                # All TS domain types
    matching.ts             # normalizeIdentity(), matchResult(), candidateSignature()
    repository.ts           # PeopleRepository (full CRUD)
    service.ts              # PersonContextService (resolve, getPerson, listLinks, listMatchCandidates)
    jobs.ts                 # Job payloads + enqueue functions
    workers.ts              # registerPersonIndexWorker(), registerSyncPersonMemoryWorker()
    tools.ts                # assistant tool execute functions
    manifest.ts             # peopleModuleManifest + PEOPLE_MODULE_ID etc.
    routes.ts               # registerPeopleRoutes()
    index.ts                # public exports
```

### Route pattern (from commitments/src/routes.ts)
```ts
export function registerPeopleRoutes(app: FastifyInstance, deps: PeopleRouteDependencies): void
// deps: { resolveAccessContext, dataContext, boss, repository?, service? }
// Always: const ac = await deps.resolveAccessContext(request); then withDataContext(ac, ...)
```

### Worker pattern (from commitments/src/workers.ts)
```ts
import { registerDataContextWorker } from "@jarv1s/jobs";
await registerDataContextWorker<Payload, void>(boss, QUEUE_NAME, dataContext, async (job, scopedDb) => {
  assertMetadataOnlyPayload(job.data);
  // load source_ref from app.person_context_indexing_state under scopedDb
  // call provider.collectPersonSignals()
  // run matching + upsert
});
```

### module-registry wiring
`packages/module-registry/src/index.ts` (1060 lines) — add:
- import people manifest, routes fn, workers fn at top
- add manifest to the module list
- call registerPeopleRoutes() and registerPersonIndexWorker() in the wiring section
Follow exact same pattern as commitments (grep `commitments` in that file)

### Integration test pattern
```ts
import { createDatabase, DataContextRunner } from "@jarv1s/db";
import { resetFoundationDatabase, connectionStrings, ids } from "./test-database.js";
// Use lane DB: JARVIS_PGDATABASE=jarvis_build_538 (set in test:people script)
// DO NOT use shared dev DB — concurrent reset races
```

### foundation.test.ts (CRITICAL — must update or test breaks latently)
File: `tests/integration/foundation.test.ts` line 298-299
After `{ version: "0126", name: "0126_app_runtime_calendar_events_delete.sql" }` add:
`{ version: "XXXX", name: "XXXX_person_context.sql" }` — replace XXXX with actual number before push.

### Web UI placement
Add People & context tab to Settings -> Memory & context pane.
File to modify: `apps/web/src/settings/settings-memory-pane.tsx`
New files: `apps/web/src/settings/settings-people-pane.tsx` + `apps/web/src/api/people-client.ts`
Use existing jds-* primitives (Group, PaneHead, Row from settings-ui.tsx).

## Key Security Rules (MANDATORY — never skip)

- All 7 tables: FORCE RLS + ENABLE RLS, policies for jarvis_app_runtime AND jarvis_worker_runtime
  both scoped to `app.current_actor_user_id()`
- `normalized_value` is private — never return from routes/tools
- `source_ref` is private — never return from routes/tools
- Job payloads: actorUserId, source, sourceRefHash, sourceVersion, reason, idempotencyKey ONLY
- `people.merge` and `people.splitIdentity` tools must be `risk: "destructive"` — these CANNOT
  be trusted-auto. `executionPolicy` must NOT be "auto".
- accepting merge_people or split_identity candidate via `people.acceptMatch` uses same
  destructive/always-confirm floor as direct merge/split tools.
- Never log raw PersonContextSignal objects — log counts, sourceKind, sourceRefHash, error class only.
- memory sync failure must NOT roll back person context writes — keep them in separate transactions.

## SQL Migration Design (XXXX_person_context.sql)

ENUMs to create in app schema:
- `app.person_context_status`: 'active', 'archived', 'merged'
- `app.person_context_identity_kind`: 'email_address', 'source_identity', 'alias', 'display_name'
- `app.person_context_source_kind`: 'email', 'calendar', 'chat', 'note', 'task', 'commitment', 'memory', 'manual'
- `app.person_context_identity_status`: 'active', 'pending', 'ambiguous', 'rejected', 'split'
- `app.person_context_provenance`: 'source', 'inferred', 'user_confirmed', 'imported'
- `app.person_context_link_kind`: 'sender', 'recipient', 'attendee', 'mentioned', 'assigned', 'counterparty', 'related'
- `app.person_context_candidate_kind`: 'create_person', 'link_identity', 'merge_people', 'split_identity'
- `app.person_context_candidate_status`: 'pending', 'accepted', 'rejected', 'suppressed', 'resolved'
- `app.person_context_event_kind`: 'created', 'identity_linked', 'identity_rejected', 'merged', 'split', 'archived', 'candidate_accepted', 'candidate_rejected', 'candidate_reopened'

Tables (all FORCE RLS with jarvis_app_runtime + jarvis_worker_runtime policies):
1. `app.person_context_people` — owner_user_id, display_name (≤160), relationship_summary (≤1000),
   context_summary (≤1000), status, confidence NUMERIC(4,2), memory_entity_id UUID nullable,
   merged_into_person_id UUID FK self nullable, archived_at, merged_at
2. `app.person_context_identities` — owner_user_id, person_id FK nullable (pending/ambiguous/rejected
   may be null), identity_kind, source_kind, normalized_value, display_value, source_ref nullable,
   source_ref_hash nullable, status, confidence, provenance, first_seen_at, last_seen_at
   UNIQUE INDEX on (owner_user_id, identity_kind, source_kind, normalized_value) WHERE status='active'
   AND identity_kind IN ('email_address','source_identity')
3. `app.person_context_links` — owner_user_id, person_id FK NOT NULL, source_kind, source_ref,
   source_ref_hash, source_label (≤200), link_kind, summary (≤500), occurred_at nullable,
   source_updated_at nullable, confidence, provenance
4. `app.person_context_link_sources` — owner_user_id, link_id FK, identity_id FK nullable,
   source_ref_hash, link_kind, confidence (no raw refs)
5. `app.person_context_match_candidates` — owner_user_id, candidate_kind, status DEFAULT 'pending',
   primary_person_id FK nullable, secondary_person_id FK nullable, identity_id FK nullable,
   suggested_display_name nullable, reason_summary nullable, confidence, candidate_signature
   UNIQUE (owner_user_id, candidate_signature)
6. `app.person_context_events` — metadata only: owner_user_id, event_kind, person_id nullable,
   secondary_person_id nullable, identity_id nullable, candidate_id nullable, source_ref_hash nullable
7. `app.person_context_indexing_state` — PRIMARY KEY (owner_user_id, source, source_ref_hash),
   source_ref (private, loaded in worker only), last_indexed_at, last_source_version,
   pending_source_version, last_enqueued_at, last_started_at, last_finished_at, failure_count

## Kysely Types to Add (packages/db/src/types.ts)

Add 7 interfaces (PersonContextPeopleTable etc.) using existing pattern, then add to JarvisDatabase:
```ts
"app.person_context_people": PersonContextPeopleTable;
"app.person_context_identities": PersonContextIdentitiesTable;
"app.person_context_links": PersonContextLinksTable;
"app.person_context_link_sources": PersonContextLinkSourcesTable;
"app.person_context_match_candidates": PersonContextMatchCandidatesTable;
"app.person_context_events": PersonContextEventsTable;
"app.person_context_indexing_state": PersonContextIndexingStateTable;
```
And Selectable aliases at bottom:
```ts
export type PersonContextPerson = Selectable<PersonContextPeopleTable>;
// etc. for all 7
```

## REST Routes (14 total)

```
GET    /api/people                              list + search
GET    /api/people/resolve                      ?q=...
GET    /api/people/:id                          detail
GET    /api/people/:id/links                    ?sourceKind=...&limit=...&cursor=...
PATCH  /api/people/:id                          update display_name/summaries
POST   /api/people/:id/archive                  archive
GET    /api/people/match-candidates             list
POST   /api/people/match-candidates/:id/accept  accept candidate
POST   /api/people/match-candidates/:id/reject  reject
POST   /api/people/match-candidates/:id/suppress suppress
POST   /api/people/:id/merge                    { secondaryPersonId }
POST   /api/people/:id/split-identity           { identityId, targetPersonId?, newPersonDisplayName? }
POST   /api/people/index/refresh                { sources?, sourceRefs? } → 202
```

## Assistant Tools (7 total)

Read tools: `people.resolve`, `people.getContext`, `people.listRecent`
Write tools: `people.acceptMatch` (risk: "write", actionFamilyId: "people_review"),
             `people.rejectMatch` (risk: "write", actionFamilyId: "people_review")
Destructive: `people.merge` (risk: "destructive", executionPolicy should be confirm or absent — NOT "auto"),
             `people.splitIdentity` (risk: "destructive")

`people.getContext` must emit `citationToken = "<sourceKind>:<sourceRefHash>:<linkId>"` per link.
`people.acceptMatch` must check candidate_kind and refuse to auto-run merge_people/split_identity.

## Job Queues

- `PERSON_INDEX_QUEUE = "person-index"` — payload: actorUserId, source, sourceRefHash, sourceVersion?, reason, idempotencyKey
- `SYNC_PERSON_MEMORY_QUEUE = "sync-person-memory"` — payload: actorUserId, personId, personUpdatedAt, reason, idempotencyKey
Cooldown: 15 min per owner, max 50 source refs per refresh request, max 100 pending/running jobs per owner.

## Next Steps for Successor

1. Write plan to `docs/superpowers/plans/2026-06-28-unified-person-contact-model.md` via
   `superpowers:writing-plans` skill — or skip plan write if coordinator already approved it
   (check — coordinator may have received plan approval request that never completed).
   **Message coordinator first: "resuming plan write for #538 — will escalate for approval once done"**
2. Wait for plan approval from coordinator.
3. Implement TDD task by task.
4. Do NOT assume migration number — use XXXX placeholder; wait for coordinator to assign 0127.
5. Use lane DB: `JARVIS_PGDATABASE=jarvis_build_538` for all integration tests.
6. Run `pnpm format:check && pnpm lint && pnpm typecheck` before every push.
