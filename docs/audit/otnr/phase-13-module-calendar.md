## Phase 13 — Module calendar

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 2
- LOW: 2
- INFO: 3

### Findings

#### [MED] Route error handler swallows ALL errors into a 401, masking real failures
**File:** `packages/calendar/src/routes.ts:89-91`  
**Invariant violated / concern:** Quality smell — swallowed/no-op catch + leaked-internals masking; divergence from the canonical route shape (`packages/tasks/src/routes.ts:598-610`).  
**Detail:** The calendar `handleRouteError` is a one-liner that unconditionally returns `reply.code(401).send({ error: "Session is missing or expired" })` for *every* thrown error and even discards the error (`_error: unknown`). The canonical `handleRouteError` in tasks distinguishes `HttpError`, the literal `"Session is missing or expired"` message, and `"Invalid bearer token"`, then **rethrows** anything else so Fastify's default 500 handler reports it. As written, a Postgres outage, an `assertDataContextDb` brand failure, a serialization bug, or any future repository exception in calendar is reported to the client as `401 Session is missing or expired` and is silently lost from logs/observability. This both misleads clients (a transient DB error looks like an auth problem, prompting a pointless re-login) and hides genuine bugs from operators. It is a behavior divergence from the project's own canonical pattern.  
**Suggested fix:** Reuse the canonical `handleRouteError` (export it from a shared route-utils location, or import the tasks pattern) so non-session errors rethrow and surface as 500s with proper logging, instead of being coerced to 401 and dropped.

#### [MED] `createCachedEventForTest` is test-only code shipped in the production repository, and is the *only* writer in the module
**File:** `packages/calendar/src/repository.ts:42-69`  
**Invariant violated / concern:** Quality smell — test scaffolding leaked into production layer; dead/unjustified write surface in shipped code.  
**Detail:** The repository's sole insert path is named `createCachedEventForTest` and is exercised only by `tests/integration/calendar-email.test.ts`. No production code anywhere writes `app.calendar_events` (confirmed: the only non-calendar reference is the type declaration in `packages/db/src/types.ts:495`; there is no connector-sync writer). Shipping a test-named mutator on the production `CalendarRepository` means: (a) the public API of the module advertises a write capability that has no real caller, (b) any future connector sync may copy this method rather than implement a proper idempotent upsert (the table has `UNIQUE (connector_account_id, external_id)` but this method does a plain `insertInto` with no `onConflict`, so re-sync would throw), and (c) it dilutes the module's "read-only cache surface" contract documented in the manifest. The INSERT RLS policy and the immutability trigger exist to support a writer that does not yet exist in production.  
**Suggested fix:** Move the test-only insert into the integration test's fixture/helper layer (or a clearly-marked `__testHelpers` export) so the production `CalendarRepository` exposes only the read methods it actually has callers for. When the real sync lands (separate spec/milestone), introduce a proper `upsertCachedEvent` with `onConflict` semantics rather than promoting this test helper.

#### [LOW] Assistant tool imports a serializer from the HTTP route layer, coupling the tool surface to the REST layer
**File:** `packages/calendar/src/tools.ts:5`  
**Invariant violated / concern:** Quality smell — layering inversion / wrong-package placement; thin coupling between the assistant-tool path and the Fastify route module.  
**Detail:** `tools.ts` (`calendarListVisibleEventsExecute`, an assistant tool execute) imports `serializeCalendarEvent` from `./routes.js`. `routes.js` is the Fastify HTTP layer (it imports `FastifyInstance`/`FastifyReply` and registers routes). The assistant-tool execution path has no reason to depend on the HTTP route module; the dependency only exists because the DTO-mapping function happens to live there. This pulls the route module (and transitively Fastify typings) into the tool execution graph and makes the serializer's home ambiguous.  
**Suggested fix:** Extract `serializeCalendarEvent`/`toIsoString` into a small `serialize.ts` (pure DTO mapping, no Fastify deps) and have both `routes.ts` and `tools.ts` import from it. Removes the route→tool coupling and gives the serializer a single clear home.

#### [LOW] `external_metadata` is passed verbatim from DB to frontend DTO with no allowlist/redaction
**File:** `packages/calendar/src/routes.ts:79` (and shared contract `packages/shared/src/calendar-api.ts:12`)  
**Invariant violated / concern:** Latent secrets-never-escape / private-by-default exposure risk (currently dormant — no production writer exists).  
**Detail:** `serializeCalendarEvent` copies `event.external_metadata` (typed `Record<string, unknown>` / `JsonColumn`) straight into the `CalendarEventDto` returned to the client and to the assistant tool. The column is an opaque provider blob. Today this is harmless because the only writer is `createCachedEventForTest` and there is no real connector sync. But the moment a real calendar sync populates `external_metadata` from a provider payload, whatever the provider returns (attendee emails, organizer PII, conferencing join URLs/tokens, ETags, raw ICS fragments) will flow unfiltered to the frontend and into AI prompts via the `calendar.listVisibleEvents` tool. The contract enforces only "is a JSON object" (`jsonObjectSchema`), not a field allowlist.  
**Suggested fix:** When the real sync lands, define an explicit allowlisted projection of `external_metadata` for the DTO (and a separate, possibly narrower one for the assistant tool), rather than spreading the raw blob. Track this as a constraint on the future sync spec so the exposure surface is decided deliberately, not by default.

#### [INFO] RLS policies, FORCE RLS, owner-scoping, and immutability trigger reviewed — clean
**File:** `packages/calendar/sql/0011_calendar_module.sql:62-107`, `packages/calendar/sql/0020_calendar_owner_or_share.sql:11-58`  
**Invariant violated / concern:** None — verification note (Invariants 1, 2).  
**Detail:** Table has `ENABLE` + `FORCE ROW LEVEL SECURITY`. SELECT/UPDATE use `owner_user_id = app.current_actor_user_id() OR app.has_share('calendar_event', ...)` (view vs manage action correctly differentiated); all policies first assert `current_actor_user_id() IS NOT NULL`, so a null actor sees nothing. INSERT is owner-pinned and additionally requires the referenced `connector_account` to be owned by the actor AND be of `provider_type = 'calendar'` — a correct data-integrity guard, not a visibility gate (matches the migration's own comment). The immutability trigger blocks changes to `owner_user_id`, `connector_account_id`, `external_id`, `created_at`, preventing post-hoc reparenting. Grants are `SELECT, INSERT, UPDATE` to `jarvis_app_runtime` only (no DELETE, no worker grant — confirmed by the test at `tests/integration/calendar-email.test.ts:77`). No `BYPASSRLS`. This satisfies the no-admin-bypass and private-by-default invariants; the test suite explicitly verifies admin/other-user rows stay hidden and that a view-share opens read access.  
**Suggested fix:** None.

#### [INFO] DataContextDb / VaultContext / AccessContext adherence reviewed — clean
**File:** `packages/calendar/src/repository.ts:21-69`, `packages/calendar/src/routes.ts:33-53`  
**Invariant violated / concern:** None — verification note (Invariants 3, 4, 9).  
**Detail:** Every repository method calls `assertDataContextDb(scopedDb)` and queries only through `scopedDb.db`; no raw Kysely root handle is accepted. All route handlers go through `dependencies.dataContext.withDataContext(accessContext, ...)`. The module never touches the filesystem (no `VaultContext` needed — no vault I/O). `AccessContext` is consumed as an opaque value resolved by the injected `resolveAccessContext`; the module adds no fields to it. Module isolation holds: calendar only references its own `app.calendar_events` plus read-only existence checks against `connector_accounts`/`connector_definitions` *inside an RLS policy* (DB-level integrity, not a cross-module TypeScript import) — no module imports another module's internals, and no other package queries `calendar_events` (only the `packages/db` type registry references the table).  
**Suggested fix:** None.

#### [INFO] No recurring-event mode-flag sprawl, no ICS/email parsing, no pg-boss payloads — N/A dimensions reviewed
**File:** `packages/calendar/src/` (whole module), `packages/calendar/src/manifest.ts:182` behavior (`queueDefinitions: []`)  
**Invariant violated / concern:** None — scope/verification note (Invariants 6, 7; dimensions E, F).  
**Detail:** The module is a pure read cache. There is no recurrence expansion, RRULE handling, or ad-hoc mode-flag branching (the focus-area "recurring-event mode-flag sprawl" concern does not apply — the surface is flat list/get). There is no ICS or email parser in this module, so no parse-injection vector here (raw provider payload handling is deferred to the not-yet-built sync, see the `external_metadata` LOW). The module registers no queues / no pg-boss jobs (`queueDefinitions: []`, asserted in the test), so the metadata-only-payload invariant has no surface to violate. No provider/model is hardcoded. The module is well under the 1000-line limit (largest file `manifest.ts` at 94 lines).  
**Suggested fix:** None.
