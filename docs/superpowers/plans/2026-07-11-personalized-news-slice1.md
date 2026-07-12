# Personalized News — Slice 1 Implementation Plan

> **For the coordinated build agent:** REQUIRED SUB-SKILLS: use `coordinated-build` and
> test-driven development. Execute the tasks in order and stage only explicit files.

**Goal:** Establish the owner-private personalization model, availability surface, domain
exclusions, latest-snapshot storage, Settings foundation, and account lifecycle required by later
personalized News slices—without admitting an unvalidated source or topic.

**Architecture:** Keep shipped V1 preferences in `app.news_prefs`. Add explicit News-owned tables
for verified custom sources, verified freeform topics, excluded domains, and one atomic latest
snapshot per owner. Slice 1 exposes read models plus functional domain-exclusion writes; custom
source/topic writes stay closed until Slice 2 can perform safe discovery and provider-policy
validation. The composition root injects two boolean availability probes, preserving module
isolation and provider-agnostic AI.

**Grounded on:** `origin/main@6b37bc01333f` (2026-07-11). Re-ground and assign the next global
migration number immediately before implementation.

**Governing spec:**
`docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md` (Implementation slices →
Slice 1).

**Risk tier:** `security` — new owner-private tables, FORCE RLS policies, data export/deletion, and
cross-module availability ports. Merge requires unanimous GREEN from a 3-provider review council:
Opus + Codex + Gemini, including at least one non-Claude provider, with each verdict posted durably
to the PR. Any dissent or unreachable provider holds this News merge for Ben's manual decision.

## Locked scope

Slice 1 includes:

- explicit owner-only persistence for custom sources, freeform topics, excluded domains, and one
  latest compilation snapshot;
- Kysely typing, repository read methods, snapshot replace/read methods, and exclusion create/delete;
- a browser-safe personalization contract and route returning prerequisites plus stored state;
- a domain-exclusion API that immediately removes matching curated V1 publishers from overview
  composition;
- Settings sections for prerequisite status, custom source/topic state, and excluded-domain
  management;
- News-owned account export plus cascade deletion declarations; and
- limits and validation at every trust boundary.

Slice 1 deliberately excludes:

- custom source/topic create or edit APIs;
- publication resolution, web search, scraping, robots handling, LLM calls, and policy decisions;
- refresh jobs, compilation, notifications, chat actions, and image proxying; and
- changes to article cards beyond applying stored domain exclusions to V1 results.

An empty source/topic list is expected in production until Slice 2. Do not add seed records, hidden
backdoors, or `pending` creation routes to make the UI look populated.

## Global constraints

- Never modify applied migration `packages/news/sql/0151_news_prefs.sql`.
- Add the next global migration under `packages/news/sql/`; compute the number at build time.
- Every new table is owner-only with ENABLE + FORCE RLS. App-runtime policies compare
  `owner_user_id` to `app.current_actor_user_id()` for SELECT/INSERT/UPDATE/DELETE.
- Do not grant worker-runtime access in Slice 1; Slice 2 adds only the worker access it proves it
  needs.
- Repositories accept `DataContextDb` and call `assertDataContextDb`; never accept root Kysely.
- `AccessContext` remains `{ actorUserId, requestId }`.
- No source URL, topic guidance, snapshot payload, provider identifier, or private preference enters
  logs, job payloads, notifications, or unrelated module tables.
- News imports no AI, Settings, Web Research, or Notifications internals. The composition root
  injects narrow callbacks.
- Shared contracts remain browser-safe plain TypeScript and Fastify JSON schemas.
- Use existing `jds-*`, `nw-*`, `PaneHead`, and `Note` patterns; no dependency or design-system
  additions.
- The new snapshot is derived/transient: delete it with the user but omit it from account export.
- Account export includes custom sources, freeform topics, and excluded domains only.
- Limits: 10 custom sources, 10 freeform topics, 100 excluded domains. Enforce in repository writes
  and tests even though source/topic public writes arrive in Slice 2.
- Domain exclusions match the stored canonical domain and its subdomains. They do not infer
  publisher ownership or syndicated copies.
- Release notes must say this slice adds News personalization controls/foundation; do not claim
  custom discovery is live.

## Data model

Use four explicit tables; do not add heterogeneous kinds or payloads to `app.news_prefs`.

### `app.news_custom_sources`

- `id uuid` primary key
- `owner_user_id uuid` → `app.users(id) ON DELETE CASCADE`
- `label text` (1–120 characters)
- `canonical_domain text` (lowercase hostname, max 253)
- `homepage_url text` (HTTPS URL, max 2048)
- `feed_url text NULL` (HTTPS URL, max 2048)
- `retrieval_method text` CHECK `feed | scrape`
- `validation_status text` CHECK `approved | needs_revalidation | rejected`
- `health_status text` CHECK `available | unavailable`
- `validation_fingerprint text` (opaque, max 255; not a foreign key to AI tables)
- `validated_at timestamptz`
- `created_at`, `updated_at`
- unique `(owner_user_id, canonical_domain)`

Only Slice 2 will create/update these rows after a successful preview/confirmation. Slice 1
repository methods list and count them for contracts, export, and future validation tests.

### `app.news_custom_topics`

- `id uuid` primary key
- `owner_user_id uuid` → users cascade
- `label text` (1–80 characters)
- `guidance text NULL` (max 1000)
- `validation_status text` CHECK `approved | needs_revalidation | rejected`
- `validation_fingerprint text` (opaque, max 255)
- `validated_at`, `created_at`, `updated_at`
- unique owner + case-insensitive label via an expression index

Only Slice 2 will create/update these rows. Slice 1 exposes read/export support.

### `app.news_source_exclusions`

- `id uuid` primary key
- `owner_user_id uuid` → users cascade
- `canonical_domain text` (lowercase hostname, max 253)
- `created_at`
- unique `(owner_user_id, canonical_domain)`

Slice 1 exposes idempotent create and owner-scoped delete. Accept a hostname or HTTPS URL, parse it
with the platform URL parser, reject credentials/ports/IP literals/non-HTTPS schemes, lowercase the
hostname, and remove a trailing dot. Do not blindly strip `www.`.

### `app.news_compilation_snapshots`

- `owner_user_id uuid` primary key → users cascade
- `compiled_at timestamptz`
- `expires_at timestamptz`
- `payload jsonb`
- `created_at`, `updated_at`

The repository calls a small News-owned `assertSnapshotPayload` before an atomic upsert. Slice 1
does not freeze the final article-card schema: the assertion requires a JSON object with an
`articles` array of at most 40 objects, bounds every string and total serialized bytes, and rejects
excessive nesting/non-JSON values. Slice 2 replaces this provisional storage guard with its exact
compilation contract before adding a production writer. Focused repository tests prove replace/read
isolation. Never export snapshots.

## Task overview

1. Migration, DB types, manifest ownership, and RLS/cascade tests.
2. Shared personalization contracts and pure domain normalization.
3. News personalization repository and owner-isolation tests.
4. Routes, availability ports, overview exclusion, and composition-root wiring.
5. Settings UI, web client/query keys, and focused UI/planner tests.
6. News account export, lifecycle parity, and full verification.

---

### Task 1: Add the owner-private persistence boundary

**Files:**

- Create: `packages/news/sql/<next>_news_personalization.sql`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/news/src/manifest.ts`
- Modify: `tests/integration/foundation.test.ts`
- Create: `tests/integration/foundation-schema-catalog.test.ts`
- Modify: `tests/integration/module-data-lifecycle-cascade.test.ts`
- Create: `tests/integration/news-personalization-repository.test.ts` (migration/RLS assertions
  begin here and are completed in Task 3)

- [ ] Compute the highest migration prefix across all module and infra SQL on fresh `origin/main`
      **and inspect open PRs for claimed migration numbers**; reserve the next unclaimed value
      everywhere. Never trust the plan-authoring maximum (`0158`).
- [ ] Before adding assertions, split the migration-ledger and security-catalog assertions out of
      the exactly-1000-line `foundation.test.ts` into
      `foundation-schema-catalog.test.ts`. Preserve behavior byte-for-byte, then run the focused
      tests and `pnpm check:file-size` green before adding new rows.
- [ ] Write failing foundation and lifecycle tests for all four table names.
- [ ] Add the four tables, bounds/checks/indexes, standard owner-only FORCE RLS policies, and
      app-runtime grants. Add no worker grants.
- [ ] Add Kysely table interfaces/map keys/row aliases in `@jarv1s/db`.
- [ ] Extend `newsModuleManifest.database.migrations`, `ownedTables`, and cascade deletion tables.
- [ ] Run `pnpm db:migrate`, both focused foundation tests, the cascade test,
      `pnpm check:file-size`, and DB typecheck.
- [ ] Commit only Task 1 files.

### Task 2: Define browser-safe contracts and domain normalization

**Files:**

- Modify: `packages/shared/src/news-api.ts`
- Create: `packages/news/src/personalization-domain.ts`
- Test: `tests/unit/news-personalization-domain.test.ts`

**Contracts:**

- `NewsPersonalizationAvailabilityDto`: `aiConfigured`, `webSearchConfigured`,
  `customSourceByUrlEnabled`, `customSourceByNameEnabled`, `freeformTopicsEnabled`.
- `NewsCustomSourceDto`, `NewsCustomTopicDto`, `NewsSourceExclusionDto` with no secrets or prompt
  material beyond the user's own saved label/guidance/URLs. Source/topic DTOs explicitly omit
  `validation_fingerprint` and every provider/model identity field.
- `GetNewsPersonalizationResponse`: availability, three stored-state lists, and snapshot metadata
  (`compiledAt`, `expiresAt`, `articleCount`) but not the snapshot payload.
- `CreateNewsSourceExclusionRequest`: one `source` string, max 2048.
- Create/delete exclusion response contracts.

- [ ] Write failing type/schema and table-driven domain-normalization tests.
- [ ] Add DTOs plus request/response schemas with `additionalProperties: false`, string/array caps,
      and exact required fields.
- [ ] Implement one pure `normalizePublisherDomain` path. Accept bare hostname or HTTPS URL; reject
      URL credentials, explicit ports, IP literals, invalid IDNA/hostname, non-HTTPS schemes, and
      overlong values. Return lowercase ASCII hostname without trailing dot. Include non-ASCII IDN →
      punycode cases.
- [ ] Add `publisherDomainMatches(excluded, candidate)` using exact match or
      `candidate.endsWith('.' + excluded)`; test boundary cases such as `notexample.com`.
- [ ] Add a hand-written, dependency-free `assertSnapshotPayload` with provisional Slice 1 caps:
      40 article objects, bounded strings, bounded nesting, JSON-only values, and bounded total
      `JSON.stringify` bytes. Do not add AJV or publish the provisional article shape.
- [ ] Run focused unit tests and shared/news typechecks.
- [ ] Commit only Task 2 files.

### Task 3: Implement the DataContext-only repository

**Files:**

- Create: `packages/news/src/personalization-repository.ts`
- Modify: `packages/news/src/index.ts` only if the composition root needs exported types/classes
- Complete: `tests/integration/news-personalization-repository.test.ts`
- Test: `tests/unit/news-personalization-repository.test.ts` only for pure limit/error branches that
  do not require Postgres

**Repository surface:**

- `listCustomSources`, `countCustomSources`
- `listCustomTopics`, `countCustomTopics`
- `listExclusions`, `createExclusion`, `removeExclusion`
- `readLatestSnapshot`, `replaceLatestSnapshot`

- [ ] Write failing tests proving owner A cannot list/read/update/delete owner B's rows across every
      table, including admin actors.
- [ ] Prove duplicate exclusions are idempotent and the 101st exclusion fails with a typed domain
      limit error. Enforce the cap atomically in SQL rather than count-then-insert.
- [ ] Prove snapshot replace is atomic, returns only the actor's latest row, and calls
      `assertSnapshotPayload` before SQL.
- [ ] Implement the minimum methods above; no generic repository, unit-of-work wrapper, or public
      custom source/topic writer.
- [ ] Run focused unit/integration tests and `@jarv1s/news` typecheck.
- [ ] Commit only Task 3 files.

### Task 4: Expose availability/state and make exclusions effective

**Files:**

- Modify: `packages/news/src/routes.ts`
- Modify: `packages/news/src/news-service.ts`
- Modify: `packages/news/src/manifest.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/news/package.json` only if an existing public package dependency is required
- Modify/Test: `tests/unit/news-routes.test.ts`
- Modify/Test: `tests/unit/news-service.test.ts`
- Modify/Test: `tests/integration/module-registry.test.ts`

**Injected ports:**

```ts
interface NewsPersonalizationAvailabilityPort {
  hasJsonModel(scopedDb: DataContextDb): Promise<boolean>;
  hasWebSearch(scopedDb: DataContextDb): Promise<boolean>;
}
```

The composition root may construct these callbacks from existing public AI and Settings/Web
Research APIs. News receives booleans only and imports no foreign internals. `hasJsonModel` uses
`AiRepository.resolveModelForCapability(scopedDb, 'json')`; `hasWebSearch` checks the configured
instance Brave key or environment fallback without exposing either value.

- [ ] Write failing `app.inject` tests for `GET /api/news/personalization`, exclusion POST/DELETE,
      schema field survival, auth failure, invalid domains, idempotency, and limit errors. Seed
      source/topic rows with fingerprints and prove declared fields survive while fingerprints and
      provider identity are absent from serialized output.
- [ ] Add manifest declarations and routes:
  - `GET /api/news/personalization`
  - `POST /api/news/source-exclusions`
  - `DELETE /api/news/source-exclusions/:id`
    Use `news.view` for GET and `news.prefs` for exclusion writes.
- [ ] Compute availability under the actor's `DataContextDb`; return custom-source-by-URL enabled
      with JSON AI, and name/topic enabled only with JSON AI + web search.
- [ ] Extend `NewsService` to read exclusions with V1 prefs. Filter curated sources by canonical
      homepage domain before feed planning, then also drop any composed headline whose article hostname
      matches an exclusion; an excluded domain must never appear through a different curated feed.
- [ ] Preserve existing source-key `source_exclude` semantics and all V1 route payloads.
- [ ] Wire the narrow availability callbacks and repository at the module-registry composition
      root. Do not move feature logic into the registry.
- [ ] Run focused route/service/registry tests, package-dependency check, and typechecks.
- [ ] Commit only Task 4 files.

### Task 5: Extend News Settings without false affordances

**Files:**

- Modify: `packages/news/src/web/news-client.ts`
- Modify: `packages/news/src/web/query-keys.ts`
- Modify: `packages/news/src/settings/index.tsx`
- Modify: `packages/news/src/settings/news-settings.css`
- Modify/Test: `tests/unit/news-settings-planner.test.ts`
- Test: add the smallest existing React render test pattern only if planner tests cannot prove
  accessibility/disabled-state behavior

- [ ] Add web-client methods and query keys for personalization plus exclusion create/delete.
- [ ] Keep existing curated Sources and canonical Topics controls unchanged.
- [ ] Add a `Personalized sources` section showing prerequisite status and any stored verified
      sources. Do not render an enabled Add/Edit button until Slice 2 supplies preview/confirm APIs.
- [ ] Add a `Topics you describe` section showing stored verified topics with the same closed-write
      posture.
- [ ] Add an `Excluded publishers` section with hostname/HTTPS URL input, explicit Add, list, and
      Remove actions. Explain that exclusions apply everywhere and deletion returns a publisher to
      neutral.
- [ ] Make the dual vocabulary truthful: if a curated toggle remains V1-On while its domain is
      excluded, render it as excluded/not contributing (or explain the override beside it). Pin the
      planner/render behavior in a focused test.
- [ ] Disable only affected controls while mutations run; preserve keyboard/focus and authored
      loading/error states.
- [ ] Invalidate personalization and overview query keys after exclusion changes so removed
      publishers disappear immediately.
- [ ] Run focused tests, web/news typechecks, design-token check, and file-size check.
- [ ] Commit only Task 5 files.

### Task 6: Export preferences and close lifecycle gaps

**Files:**

- Create: `packages/news/src/data-lifecycle.ts`
- Modify: `packages/news/src/manifest.ts`
- Modify: `packages/settings/src/data-export.ts`
- Modify/Test: `tests/integration/data-export.test.ts`
- Modify/Test: `tests/unit/news-manifest.test.ts` if present; otherwise add the focused manifest
  assertion to the nearest News manifest/registry test

- [ ] Write failing export tests proving custom sources/topics/exclusions are present while
      snapshots and validation fingerprints are absent; prove actor isolation. Seed a real snapshot so
      omission is non-vacuous.
- [ ] Implement `collectNewsExportSection(scopedDb)` inside `@jarv1s/news`, asserting
      `DataContextDb` and returning only user-authored preference fields.
- [ ] Declare the `news` export section in the News manifest and collect it through the existing
      module lifecycle seam in Settings data export. Do not import News from Settings.
- [ ] Preserve the existing archive shape and add one explicit `newsPersonalization` table/section
      field; do not generalize the entire exporter in this slice.
- [ ] Re-run cascade parity, account export, route-schema, and repository RLS tests.
- [ ] Run `pnpm verify:foundation` and full integration tests. Record exact exit codes in the PR.
- [ ] Commit Task 6, ensure the tree is clean, push, and open the PR through
      `coordinated-wrap-up`.

## Exit criteria

- All four new tables exist under the News module migration directory and are owner-isolated under
  FORCE RLS, including against admins.
- Existing curated News behavior is unchanged except that explicit domain exclusions suppress
  matching sources before fetch.
- No public route can create or edit an unvalidated custom source/topic.
- Settings truthfully reports AI/web-search prerequisites and manages exclusions.
- Account export includes authored News personalization preferences and omits snapshots/fingerprints.
- Deletion declarations cover every News-owned table and cascade tests pass.
- No private preference value or snapshot content appears in logs or job payloads.
- Focused tests, `pnpm verify:foundation`, and the full integration suite are green.
- Security-tier QA posts durable Opus, Codex, and Gemini verdicts to the PR. Merge proceeds only on
  unanimous 3-provider GREEN; dissent or an unreachable provider holds the merge for Ben.
