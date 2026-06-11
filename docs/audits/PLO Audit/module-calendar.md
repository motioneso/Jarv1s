# Calendar Module — Thermo-Nuclear Code Quality Review

**Scope:** `packages/calendar/src/`, `packages/calendar/sql/`
**Files reviewed:**
- `packages/calendar/sql/0011_calendar_module.sql`
- `packages/calendar/sql/0020_calendar_owner_or_share.sql`
- `packages/calendar/src/index.ts`
- `packages/calendar/src/manifest.ts`
- `packages/calendar/src/repository.ts`
- `packages/calendar/src/routes.ts`
- `packages/calendar/src/tools.ts`
- `tests/integration/calendar-email.test.ts` (test quality review)
- Cross-module references in `packages/briefings/src/repository.ts`

---

## Summary

The calendar module is the smallest and most disciplined module in the codebase. It is a read surface over a connector-backed cache — there is no sync logic, no ICS parsing, and no recurring-event complexity in this package. The hard invariants are substantially respected: FORCE RLS is on, DataContextDb is enforced, AccessContext shape is correct, module isolation holds, and the integration test suite is meaningful. Three findings warrant attention, one at HIGH severity.

---

## Findings

### [HIGH] Production method named `createCachedEventForTest` is exported on the public API

- **File:** `packages/calendar/src/repository.ts:42–69`, `packages/calendar/src/index.ts:2`
- **Category:** Architecture / Security
- **Finding:** `CalendarRepository.createCachedEventForTest` is a write method that inserts rows directly into `app.calendar_events`. It is exported from `src/index.ts` (which re-exports everything from `repository.ts`) and is therefore part of the public module API accessible to any consumer. The name signals it is for tests only, but there is no compile-time or runtime enforcement of that constraint. Any code path that imports `@jarv1s/calendar` and calls this method on a live DataContextDb will write to the production table. Because INSERT is RLS-enforced, the direct damage is limited to the calling actor's own rows — but the method bypasses any future sync-layer validation, idempotency checks, or conflict handling that a proper upsert path would apply. It is also misleading: callers reading the public API surface have no way to know this method is not sanctioned for production use.
- **Evidence:**
  ```ts
  // repository.ts:42
  async createCachedEventForTest(
    scopedDb: DataContextDb,
    input: CreateCachedCalendarEventInput
  ): Promise<CalendarEvent> {
  ```
  ```ts
  // index.ts:2
  export * from "./repository.js";
  ```
- **Impact:** Test-only write path is on the production API surface. If a future consumer (e.g., a sync adapter or a third-party module) calls this method, it sidesteps all future sync-layer invariants. The blanket `export *` from `index.ts` makes this automatic for any new method added to the repository.
- **Recommendation:** Move `createCachedEventForTest` to a separate `repository.test-helpers.ts` file that is NOT re-exported from `index.ts`. Replace the blanket `export * from "./repository.js"` with named exports that explicitly list the public surface: `CalendarRepository`, `CreateCachedCalendarEventInput`. Alternatively, if the method must stay on the repository class, mark it with a JSDoc `@internal` tag and add a runtime guard: `if (process.env.NODE_ENV === "production") throw new Error(...)`.

---

### [MEDIUM] `handleRouteError` swallows all errors as 401, masking internal failures

- **File:** `packages/calendar/src/routes.ts:89–91`
- **Category:** Error Handling
- **Finding:** Every thrown error from `resolveAccessContext`, `withDataContext`, or `repository.listVisible` / `repository.getById` is caught and unconditionally returned as `401 Session is missing or expired`. This means database connectivity failures, unexpected RLS violations, Kysely query errors, and programming bugs in the repository are all silently swallowed and reported to the client as an authentication error. The error object is never logged, so there is no observability into what actually went wrong.
- **Evidence:**
  ```ts
  function handleRouteError(_error: unknown, reply: FastifyReply) {
    return reply.code(401).send({ error: "Session is missing or expired" });
  }
  ```
  The parameter is named `_error`, confirming it is intentionally discarded.
- **Impact:** Operational blind spot: a broken database connection or a migration rollback would appear to every client as an auth failure with no server-side trace. Debugging production incidents requires logs, not just client responses.
- **Recommendation:** Inspect the error type. Throw or re-throw known Fastify auth errors as 401; log and return 500 (or rethrow to Fastify's error handler) for unexpected errors. At minimum, pass the error to the Fastify logger before responding: `request.log.error({ err: error }, "calendar route error")`. Follow the pattern used in other modules (e.g., tasks) if one exists.

---

### [MEDIUM] No DELETE RLS policy; DELETE not granted but absence is undocumented

- **File:** `packages/calendar/sql/0011_calendar_module.sql:60`, `packages/calendar/sql/0020_calendar_owner_or_share.sql`
- **Category:** Security / Architecture
- **Finding:** The table grant is `GRANT SELECT, INSERT, UPDATE` — DELETE is intentionally omitted, which is correct for a connector-backed read cache (rows should be deleted by the cascade on `connector_accounts` deletion, not by application code). However, there is no RLS policy for DELETE and no comment documenting that this is a deliberate decision. The trigger `prevent_calendar_event_identity_change` protects against UPDATE-based re-ownership but there is no analogous defense against a future migration or grant accidentally adding DELETE access without a corresponding policy.
- **Evidence:**
  ```sql
  GRANT SELECT, INSERT, UPDATE ON app.calendar_events TO jarvis_app_runtime;
  -- No GRANT DELETE; no DELETE policy; no comment stating this is intentional
  ```
  The cascade `ON DELETE CASCADE` on `connector_account_id` handles row removal at the DB level.
- **Impact:** Low immediate risk (no DELETE grant exists), but the invariant is undocumented. A future grant addition or a test-helper that uses a migration-owner connection could delete rows without any RLS gate.
- **Recommendation:** Add a SQL comment above the GRANT line stating: `-- DELETE is intentionally omitted: rows are removed only via ON DELETE CASCADE from connector_accounts.` This is a single-line documentation fix that prevents future confusion.

---

### [MEDIUM] `externalMetadata` is passed through to the DTO with `additionalProperties: true` — no schema enforcement

- **File:** `packages/calendar/src/routes.ts:79`, `packages/shared/src/calendar-api.ts:30–33`
- **Category:** Security / Code Quality
- **Finding:** The `external_metadata` column (sourced from an external calendar provider via the connector sync path) is passed verbatim from the DB row to the `CalendarEventDto` with the Fastify response schema declaring `additionalProperties: true`. This means any arbitrary JSON from the external calendar provider is serialized and returned to the frontend without filtering. If the sync path ever stores sensitive data in this field (attendee email lists, private meeting URLs, encryption keys from the provider response), it leaks to the client unredacted.
- **Evidence:**
  ```ts
  // calendar-api.ts:30–33
  const jsonObjectSchema = {
    type: "object",
    additionalProperties: true   // no field filtering
  } as const;
  ```
  ```ts
  // routes.ts:79
  externalMetadata: event.external_metadata,
  ```
- **Impact:** No sync path is implemented in this module today, so the column is populated only by test seeds and future connectors. But the "secrets never escape" invariant requires that connector sync code never store credential-adjacent data in `external_metadata`. Without a schema or allowlist enforced at the serialization layer, this is a latent risk as connectors are built out.
- **Recommendation:** Either (a) enumerate the expected `external_metadata` fields in `calendarEventDtoSchema` and set `additionalProperties: false`, rejecting fields the frontend does not need; or (b) add an explicit stripping function in `serializeCalendarEvent` that only passes through known-safe keys. The exact field set should be determined when the first real connector sync is implemented, but documenting the invariant now prevents future leakage.

---

### [LOW] Repository `listVisible` has no time-range filter — unbounded query

- **File:** `packages/calendar/src/repository.ts:21–30`
- **Category:** Code Quality / Architecture
- **Finding:** `listVisible` selects all calendar events for the actor with no date range predicate. For a personal calendar with years of sync history this will return the entire visible event set in a single query. The `starts_at` index exists and would make a bounded query efficient, but the current implementation does not use it for filtering, only for ordering.
- **Evidence:**
  ```ts
  return scopedDb.db
    .selectFrom("app.calendar_events")
    .selectAll()
    .orderBy("starts_at", "asc")
    .orderBy("id")
    .execute();
  ```
- **Impact:** As the connector sync cache grows, this query becomes a performance and memory problem. For the assistant tool `calendar.listVisibleEvents`, returning thousands of events to an AI context window is wasteful and may exceed context limits.
- **Recommendation:** Add optional `startsAfter` / `startsBefore` parameters to `listVisible` (and the tool's `inputSchema`). Default to a reasonable window (e.g., ±30 days from now) when no range is specified. This is not urgent while the module is a stub without a live sync path, but should be addressed before connector sync goes live.

---

### [LOW] `tools.ts` imports `serializeCalendarEvent` from `routes.ts` — wrong dependency direction

- **File:** `packages/calendar/src/tools.ts:5`
- **Category:** Architecture / Code Quality
- **Finding:** `tools.ts` imports `serializeCalendarEvent` from `routes.ts`. The serializer is a pure data-mapping function with no dependency on Fastify, but it lives in the routes file. This creates a dependency from the AI tools layer into the HTTP routes layer, which is an inverted coupling: tools should be agnostic of transport.
- **Evidence:**
  ```ts
  // tools.ts:5
  import { serializeCalendarEvent } from "./routes.js";
  ```
- **Impact:** If routes.ts ever imports a Fastify-specific type or gains a Fastify dependency, the AI tool executor is implicitly coupled to HTTP infrastructure. Minor today but sets a bad precedent as the module grows.
- **Recommendation:** Extract `serializeCalendarEvent` (and `toIsoString`) into a `serializers.ts` file. Both `routes.ts` and `tools.ts` import from there. This is a two-minute refactor.

---

### [LOW] `CalendarEventDto` exposes `ownerUserId` and `connectorAccountId` to all authorized readers including share grantees

- **File:** `packages/calendar/src/routes.ts:70–71`, `packages/shared/src/calendar-api.ts:3–4`
- **Category:** Security
- **Finding:** The DTO includes `ownerUserId` and `connectorAccountId`. Under the owner-or-share model, a user who receives a `view` share on a calendar event can read these fields. `connectorAccountId` is an internal infrastructure identifier — sharing it with grantees is unnecessary information leakage, and could be used to enumerate a user's connector accounts if shares are granted broadly.
- **Evidence:**
  ```ts
  export interface CalendarEventDto {
    readonly connectorAccountId: string;  // internal infra ID
    readonly ownerUserId: string;         // owner's user ID visible to grantee
  ```
- **Impact:** Low risk today (shares are explicitly granted; no public sharing), but principle of least exposure suggests grantees should not receive the owner's internal identifiers. `ownerUserId` might be needed for UI rendering ("shared by X") but `connectorAccountId` has no consumer-visible purpose.
- **Recommendation:** Remove `connectorAccountId` from `CalendarEventDto`. For `ownerUserId`, evaluate whether any UI component actually consumes it — if not, remove it. If it is needed for "shared by" attribution, keep it but document the decision.

---

### [INFO] Test variable `bWorkspace` is a semantic holdover from the old workspace model

- **File:** `tests/integration/calendar-email.test.ts:36, 43`
- **Category:** Code Quality / Tests
- **Finding:** The test seed uses the names `bWorkspace` / `aPrivate` to distinguish row visibility scenarios. Under the current owner-or-share model, `bWorkspace` simply means "another user's row that will be explicitly shared." The `Workspace` naming is a remnant of the old workspace-based visibility model that was removed. The comment in the test (line 297) acknowledges this: "Under owner-or-share RLS, bWorkspace rows ... are NOT visible to userA via workspace membership alone — a share is required." The naming is now misleading.
- **Evidence:**
  ```ts
  const calendarEventIds = {
    aPrivate: "...",
    bPrivate: "...",
    bWorkspace: "..."   // actually just "b's event that will be explicitly shared"
  } as const;
  ```
- **Impact:** No functional impact, but future maintainers may be confused about what `bWorkspace` means and whether workspace-based visibility is still a thing.
- **Recommendation:** Rename `bWorkspace` to `bShared` (or `bShareable`) in both `calendarEventIds` and `emailMessageIds` in the same test file, with a comment: "b's event that is explicitly share-granted to userA in the share tests." Per the CLAUDE.md "No Stale Concepts" standard, dead vocabulary should be removed in the same pass.

---

### [INFO] `manifest.ts` references `sql/0011_calendar_module.sql` in both `migrations` and `migrationDirectories` — potential duplication

- **File:** `packages/calendar/src/manifest.ts:27–29`
- **Category:** Architecture / Code Quality
- **Finding:** The manifest declares both `migrations: ["sql/0011_calendar_module.sql"]` (a single-file list) and `migrationDirectories: ["packages/calendar/sql"]` (the whole SQL directory). This means 0020 is only picked up via the directory scan, while 0011 is listed explicitly. The semantics of these two fields — and whether having both causes the runner to apply 0011 twice — depends entirely on the module registry's migration runner implementation. If the runner deduplicates by filename hash this is harmless; if not, 0011 could be applied twice.
- **Evidence:**
  ```ts
  database: {
    migrations: ["sql/0011_calendar_module.sql"],
    migrationDirectories: ["packages/calendar/sql"],
    ownedTables: ["app.calendar_events"]
  },
  ```
- **Impact:** Depends on runner implementation. If the module registry applies both `migrations` and `migrationDirectories` without deduplication, 0011 is applied twice. The integration test `"applies Calendar and Email migrations with forced RLS and no worker table grant"` passes, suggesting the runner handles it, but the dual specification is confusing.
- **Recommendation:** Review the module registry's migration runner. If `migrationDirectories` is the canonical mechanism, remove the `migrations` field from the manifest. If `migrations` is the mechanism, remove `migrationDirectories`. One field should be the source of truth.

---

## Positive Observations

These patterns are correct and should be preserved:

- **FORCE RLS is set** on `app.calendar_events` in the initial migration (line 63) and the policy replacement migration correctly drops and recreates all three policies atomically.
- **No DELETE grant, no DELETE policy** — cascade-only deletion is the correct design for a connector-backed read cache.
- **`assertDataContextDb` is called** at the entry of every repository method, including the tool executor in `tools.ts`.
- **AccessContext shape is correct** — `{ actorUserId, requestId }` with no workspaceId anywhere in the calendar module.
- **Module isolation holds** — the calendar module does not import any internal from another module. The briefings module references calendar only via the tool name string `"calendar.listVisibleEvents"`, not by importing calendar internals.
- **`owner_user_id` set from `app.current_actor_user_id()`** in the repository INSERT — the actor cannot inject a different owner via input.
- **Identity-change trigger** prevents UPDATE-based re-ownership of events.
- **Integration tests are meaningful** — they test against a real database, verify RLS denials, verify share grants grant access, and verify that admin context is still restricted to their own rows.
- **No ICS/email parsing** in this module — the injection risk area is deferred to connector sync (not yet implemented), keeping the attack surface minimal.
- **No pg-boss job payloads** — this module has no queues and emits no job payloads.
- **No provider/model hardcoding** — this module has no AI calls.
