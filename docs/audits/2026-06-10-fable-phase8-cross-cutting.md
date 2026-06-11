## Phase 8 — Cross-Cutting Sweep (module isolation + invariants)

**Model:** claude-sonnet-4-6
**Date:** 2026-06-10
**Scope:** Full packages/ and apps/ tree — module isolation, DataContextDb coverage, console/logger leakage, pg-boss payload hygiene, direct fs access, AccessContext shape, cross-module table queries, and synthesis of findings from Phases 1–7.

---

### CRIT / HIGH / MED / LOW / INFO counts

- HIGH: 2
- MED: 2
- LOW: 3
- INFO: 5

---

### Findings

#### [HIGH] `auth` module writes directly to `settings`-owned tables (`app.workspaces`, `app.workspace_memberships`, `app.admin_audit_events`) without declaring a dependency on `@jarv1s/settings`

**File:** `packages/auth/src/index.ts:269–305` (`bootstrapFirstJarvisUser`)
**Invariant violated / concern:** Module isolation — modules collaborate only through declared public APIs/events; no module imports another module's internals or queries its tables directly.
**Detail:**
`bootstrapFirstJarvisUser` (called from better-auth's `databaseHooks.user.create.after`) directly issues `insertInto("app.workspaces")`, `insertInto("app.workspace_memberships")`, and `insertInto("app.admin_audit_events")` using a raw Kysely transaction. These tables are owned and managed by `@jarv1s/settings` (all CRUD lives in `SettingsRepository`). The `@jarv1s/auth` `package.json` does not declare `@jarv1s/settings` as a dependency — the cross-module write is silent and undeclared at the package level.

This is an architectural bootstrap exception (it runs once, before any AccessContext exists), and the intent is reasonable — the first-user bootstrap must atomically create the workspace and membership. However:

1. The invariant as stated is violated: a module writes to another module's tables directly.
2. The violation is invisible at the package dependency graph level (no `@jarv1s/settings` import).
3. Any future refactor of the workspace table schema (column renames, constraint changes) will not cause a TypeScript compile error in `@jarv1s/auth` unless the types happen to diverge — a silent future breakage risk.
4. The `admin_audit_events` write records a `bootstrap.instance_owner` event but uses hardcoded metadata (`{ workspaceId }`) — not going through `SettingsRepository.recordAdminAuditEvent`, so the audit-event schema is duplicated.

**Suggested fix:**
Two options: (a) Export a `bootstrapFirstWorkspace(tx, userId)` function from `@jarv1s/settings` that encapsulates workspace + membership + audit creation, add `@jarv1s/settings: workspace:*` to auth's `package.json`, and call it from `bootstrapFirstJarvisUser`. (b) Accept the exception as architecturally necessary (the bootstrap call cannot go through module APIs due to timing), and document it with a comment and a TODO to migrate once settings exposes a proper bootstrap API. Either way, add a TypeScript-level type guard so that auth's workspace insert is statically tied to the settings types.

---

#### [HIGH] `memory` and `structured-state` repositories are missing `assertDataContextDb` — fail-fast discipline not enforced cross-cutting

**Files:** `packages/memory/src/repository.ts`, `packages/memory/src/facts-repository.ts`, `packages/structured-state/src/commitments-repository.ts`, `packages/structured-state/src/entities-repository.ts`, `packages/structured-state/src/preferences-repository.ts`
**Invariant violated / concern:** DataContextDb only — repositories must fail loudly when called outside `withDataContext`.
**Detail:**
The sweep confirms the Phase 6 finding: `tasks`, `notifications`, `briefings`, `chat`, `db/sharing`, and `db/probes` all call `assertDataContextDb(scopedDb)` at every public method entry point. `memory` and `structured-state` do not call `assertDataContextDb` anywhere. This means:

1. A caller that passes a plain Kysely transaction (or any non-branded object) to a memory or structured-state repository method will silently proceed with no actor GUC set.
2. Under FORCE RLS, that means every query returns 0 rows (for SELECT) or 0 rows affected (for DML) with no error — data is silently lost or hidden.
3. Since `MemoryRepository` and `ChatMemoryFactsRepository` are also used via dependency injection into `chat/src/jobs.ts` and `chat/src/recall-port.ts`, a misconfiguration in the worker DI chain would be completely invisible.

This is a cross-cutting gap because the pattern is consistently correct in 6 of 8 module repositories but missing in the 2 modules with the most background-worker usage (memory writes happen in pg-boss worker context where debugging silent failures is hardest).

**Suggested fix:**
Add `assertDataContextDb(scopedDb)` as the first line of every public method in `MemoryRepository`, `ChatMemoryFactsRepository`, `CommitmentsRepository`, `EntitiesRepository`, and `PreferencesRepository`. Add "fails loudly without withDataContext" integration tests to `memory.test.ts` and `structured-state.test.ts` (mirroring the existing test in `tasks.test.ts`).

---

#### [MED] `connectors` routes issue raw `Kysely` query on `app.users` for the admin check — cross-module table access bypassing DataContextDb

**File:** `packages/connectors/src/routes.ts:258–262`
**Invariant violated / concern:** DataContextDb only; cross-module table access.
**Detail:**
The `requireAdmin` helper in connectors routes executes:
```ts
const user = await dependencies.appDb
  .selectFrom("app.users")
  .select(["id", "is_instance_admin"])
  .where("id", "=", accessContext.actorUserId)
  .executeTakeFirst();
```
`dependencies.appDb` is an unbranded `Kysely<JarvisDatabase>` — not a `DataContextDb`. The `app.users` table is a foundation-level table (owned by the auth/settings foundation, not the connectors module). This violates two invariants simultaneously: the DataContextDb brand requirement and the principle that modules access cross-module data only through declared APIs.

The Phase 7 audit caught this for the same pattern in `packages/settings/src/routes.ts`. The cross-cutting sweep confirms the same raw-Kysely `app.users` SELECT exists in `packages/connectors/src/routes.ts`. These are two separate call sites of the same anti-pattern.

The practical risk today is low (`app.users` has ENABLE but not FORCE RLS, and the GUC is irrelevant for this SELECT since the `users_app_runtime_select` policy is `USING(true)`). The risk grows when Phase 2 tightens `app.users` RLS policies — this query may silently fail or return wrong results without the GUC set.

**Suggested fix:**
Route the admin check through `DataContextRunner.withDataContext(accessContext, ...)` using a `DataContextDb` scoped query, or extract a shared `requireAdmin(scopedDb, actorUserId)` helper in `packages/db` or `packages/shared` so both connectors and settings routes can call it without raw-Kysely access.

---

#### [MED] `structured-state` `delete` methods filter by `id` only — no application-layer `ownerUserId` guard on `entities`, `commitments`, `preferences`

**Files:** `packages/structured-state/src/entities-repository.ts:84–85`, `packages/structured-state/src/commitments-repository.ts:85–86`, `packages/structured-state/src/preferences-repository.ts:44–45`
**Invariant violated / concern:** Defense-in-depth; application layer should redundantly enforce ownership alongside DB-layer RLS.
**Detail:**
The `delete` method in all three structured-state repositories filters only by `id` (or `key` for preferences), with no `AND owner_user_id` clause:

```ts
// entities
await scopedDb.db.deleteFrom("app.entities").where("id", "=", id).execute();
// commitments
await scopedDb.db.deleteFrom("app.commitments").where("id", "=", id).execute();
// preferences
await scopedDb.db.deleteFrom("app.preferences").where("key", "=", key).execute();
```

The DB-layer RLS `USING (owner_user_id = app.current_actor_user_id())` on each table's DELETE policy provides the first line of defense. However, the application layer provides no redundant check — unlike `insertFact` and `listActiveFacts` in `ChatMemoryFactsRepository` which both include explicit `owner_user_id` filters. The Phase 6 audit identified the same pattern in `ChatMemoryFactsRepository.supersedeFact/deleteFact/updateFactImportance`.

This cross-cutting sweep confirms the pattern is even wider — three separate module repositories have the same gap. If any future caller passes an `id` sourced from a request body without a prior ownership assertion, the only guard is DB-layer RLS.

**Suggested fix:**
Add `AND owner_user_id = ${ownerUserId}::uuid` to each delete method. Thread `ownerUserId: string` into `delete` signatures for `CommitmentsRepository` and `EntitiesRepository`. For `PreferencesRepository.delete`, the key-only delete is partially safe because `UNIQUE(owner_user_id, key)` means a key is scoped per user — but adding `AND owner_user_id` makes the intent explicit and adds a redundant layer.

---

#### [LOW] `memory.vectorSearch` has no application-layer owner filter — RLS-only single layer (cross-cutting amplification of Phase 6 MED)

**File:** `packages/memory/src/repository.ts:72–104`
**Invariant violated / concern:** Defense-in-depth. This is the only method in `MemoryRepository` without an explicit `owner_user_id` clause (every other method has one). The sweep confirms this gap is not replicated elsewhere in the codebase.
**Detail:**
The raw SQL vectorSearch query:
```sql
SELECT id, source_path, line_start, line_end, text,
       1 - (embedding <=> $vectorLiteral::vector) AS similarity
FROM app.memory_chunks
WHERE embedding IS NOT NULL
  AND source_kind = $sourceKind
ORDER BY embedding <=> $vectorLiteral::vector
LIMIT $limit
```
contains no `owner_user_id` filter. All other `MemoryRepository` methods include `WHERE owner_user_id = ${ownerUserId}::uuid` as a dual layer alongside RLS. If the `memory_chunks_select` RLS policy were ever dropped or the executing role changed, this query would return all users' chunk text ranked by vector similarity.

This also means that `RecallService` (in `chat/src/recall-port.ts`) cannot pass an `ownerUserId` to `vectorSearch` because the method signature does not accept one — a structural coupling that makes future hardening harder.

**Suggested fix:**
Add `AND owner_user_id = ${ownerUserId}::uuid` to the `vectorSearch` WHERE clause and add `ownerUserId: string` to its signature. Update `RecallService.recallEpisodic` to forward `actorUserId` (already available) to the call.

---

#### [LOW] `auth` module's `bootstrapFirstJarvisUser` uses raw Kysely for workspace/audit writes without the actor GUC set for those writes

**File:** `packages/auth/src/index.ts:252–305`
**Invariant violated / concern:** Actor GUC coverage; DataContextDb invariant.
**Detail:**
`bootstrapFirstJarvisUser` sets `app.actor_user_id` via `set_config(..., true)` (line 252) before the `UPDATE app.users` call. However the subsequent `insertInto("app.workspaces")`, `insertInto("app.workspace_memberships")`, and `insertInto("app.admin_audit_events")` calls happen inside the same transaction. The GUC IS set at this point (transaction-scoped), so those inserts DO have the actor GUC available.

The remaining concern is that the `app.workspaces`, `app.workspace_memberships`, and `app.admin_audit_events` tables have no RLS policies (Phase 1 MED finding), so the GUC setting is currently irrelevant for them. But the pattern creates a documentation gap: future readers seeing the GUC set at line 252 may assume it only applies to the `UPDATE app.users` that follows, not to the three inserts below.

**Suggested fix:**
Add a comment at line 252 clarifying that the GUC covers the full transaction including the workspace/membership/audit inserts. This is a documentation and correctness-clarity fix, not a security fix.

---

#### [LOW] No Fastify logger `redact` configuration — `Authorization` header in MCP requests could appear in Fastify access logs if request serialization is enabled

**File:** `apps/api/src/server.ts:47–52`
**Invariant violated / concern:** Secrets never escape — tokens should not appear in log output.
**Detail:**
The server is initialized with `logger: options.logger ?? true` and no custom `pino` configuration:
```ts
const server = Fastify({
  logger: options.logger ?? true,
  trustProxy: !!process.env.JARVIS_TRUST_PROXY
});
```
Fastify's default pino request serializer logs `req.method`, `req.url`, `req.hostname`, `req.remoteAddress`, and `req.remotePort` — but NOT `req.headers` by default. So the MCP route's `Authorization: Bearer jst_<uuid>` header is NOT logged in standard access logs.

However: (1) any future Fastify plugin or hook that logs `request.headers` (e.g., a debugging plugin, `fastify-sensible` with verbose mode) would expose the token; (2) if a developer passes `{ logger: { serializers: { req: (req) => ({ ...req, headers: req.headers }) } } }` during local debugging, the token is logged. There is no `redact` rule in place to prevent token logging even if header logging is added.

**Suggested fix:**
Add a `pino` `redact` configuration as a safety net:
```ts
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization", "req.headers.cookie"]
  },
  trustProxy: !!process.env.JARVIS_TRUST_PROXY
});
```
This is a zero-cost defense-in-depth measure that ensures token redaction even if header logging is inadvertently enabled.

---

#### [INFO] Module isolation verdict: no cross-module internals imports found — all cross-module access goes through public package indices

**Detail:**
The full package dependency sweep confirms:
- `@jarv1s/chat` imports `MemoryRepository`, `ChatMemoryFactsRepository`, and `EmbeddingProvider` from `@jarv1s/memory` — all are exported from `packages/memory/src/index.ts`. Public API path. ✓
- `@jarv1s/chat` imports `AiRepository`, `GatewaySessionRecord`, `SessionNotifier`, `AssistantToolGateway`, `GatewayToolResponse`, `SessionTokenRegistry`, `ProviderKind`, `AiConfiguredModelSafeRow`, `createRealTmuxIo`, `parseTranscript`, `transcriptGlobDir`, and `TmuxIo` from `@jarv1s/ai` — all are in `ai/src/index.ts` via `export *` from sub-files or named exports. Public API path. ✓
- `@jarv1s/briefings` imports `findAssistantToolFromManifests` and `listAssistantToolsFromManifests` from `@jarv1s/ai` — exported from `ai/src/assistant-tools.ts` which is re-exported as `export * from "./assistant-tools.js"` in `ai/src/index.ts`. Public API path. ✓
- `@jarv1s/module-registry` imports from all modules but is explicitly the composition root — this is architecturally correct and expected.
- No module imports from another module's `/src/internal/` or uses relative paths that cross package boundaries. ✓
- No module directly queries another module's tables (the auth bootstrap cross-module write is the sole exception, flagged separately as a HIGH finding).

---

#### [INFO] pg-boss payload hygiene is uniformly correct across all modules

**Detail:**
All pg-boss job payloads found in the sweep are metadata-only:
- `EmbedTurnJobPayload = { actorUserId, threadId, messageId }` — metadata only. ✓
- `ExtractFactsJobPayload = { actorUserId, threadId }` — metadata only. ✓
- `DeferredTaskStatusPayload = { actorUserId, taskId, requestedStatus, idempotencyKey }` — metadata only; guarded by `isDeferredTaskStatusPayloadMetadataOnly` before and after send. ✓
- `BriefingRunPayload = { actorUserId, definitionId, briefingRunId, runKind, idempotencyKey? }` — `runKind` is a narrow enum `"manual" | "scheduled"` (no private content); guarded by `isBriefingRunPayloadMetadataOnly`. ✓

No payload schema includes user content, AI prompts, secrets, or vault file content. The invariant is uniformly satisfied across all modules.

---

#### [INFO] `AccessContext` shape is correctly `{ actorUserId, requestId }` everywhere — `workspaceId` is fully removed

**Detail:**
The `AccessContext` interface in `packages/db/src/data-context.ts` declares exactly `{ actorUserId: string; requestId?: string }`. A grep for `workspaceId` in non-settings contexts confirms it appears only in:
- `packages/db/src/types.ts:91` — the DB type for `app.workspace_memberships.workspace_id` (a table column, not AccessContext).
- `packages/auth/src/index.ts:269,274,285,300` — local variable in `bootstrapFirstJarvisUser` for workspace creation (correct usage).
- `packages/shared/src/platform-api.ts:20,268,271` — the workspace membership DTO for the settings API.

No `withDataContext(accessContext, ...)` call anywhere passes a `workspaceId` field. The Slice 1f removal of `workspaceId` from `AccessContext` is complete and consistent. ✓

---

#### [INFO] Direct filesystem access outside vault is scoped correctly — CLI/AI adapters use injected IO interfaces, not bare `fs`

**Detail:**
The sweep found `node:fs/promises` imports in:
- `packages/db/src/migrations/sql-runner.ts` — reads SQL migration files from disk. Not user data. ✓
- `packages/chat/src/live/persona.ts` — writes persona YAML and neutralDir structure. Uses injected `FileIO` interface with `writeFile` (the production implementation delegates to `node:fs/promises`). Content written is the persona config, not user private data. ✓
- `packages/chat/src/live/cli-chat-engine.ts` — uses injected `TmuxIo.writeFile/readFile` interface. No direct `fs` import in the engine itself. ✓
- `packages/ai/src/adapters/tmux-bridge.ts` — implements the `TmuxIo` interface; the concrete `readFile/writeFile` implementations use `node:fs/promises`. This is the IO adapter layer, not a repository. ✓

No module-level repository or route handler uses raw `fs.readFile`/`fs.writeFile` to access user data outside the vault module. The vault module's `VaultContext` brand enforcement is intact. ✓

---

#### [INFO] No `console.log`/`console.error`/`console.warn` calls in packages/ — only in apps/worker/ startup path

**Detail:**
The sweep found zero `console.*` calls in any file under `packages/`. The only `console.*` usage is in `apps/worker/src/worker.ts`:
- Line 38: `console.log("Jarv1s worker listening on ...")` — logs queue name, no private data.
- Line 53: `console.error(JSON.stringify({ level: "fatal", label, err: String(err), msg: "Process crash — exiting" }))` — logs the error stringified via `String(err)`, which could include a stack trace or an error message from a DB query. In a production crash scenario, this message goes to stderr only, not to any user-facing surface. Risk is low (stack traces may include table or function names but not user data).

No package emits private data through console logging. ✓

---

### Cross-Cutting Synthesis

#### Patterns that reinforce earlier-phase findings

1. **SettingsRepository / connectors `requireAdmin` raw Kysely** (Phase 1 HIGH + Phase 7 MED): The cross-cutting sweep confirms the same unbranded `Kysely<JarvisDatabase>` → `app.users` SELECT anti-pattern appears in both `packages/settings/src/repository.ts` (all methods) and `packages/connectors/src/routes.ts` (admin check). These are not isolated incidents — they share a structural root: the admin-check pattern was never routed through the DataContextRunner. One fix point (a `requireAdmin(scopedDb, actorUserId)` helper in `@jarv1s/db`) would resolve both.

2. **`assertDataContextDb` coverage gap** (Phase 6 LOW): The cross-cutting sweep confirms 6 of 8 module repository packages correctly call `assertDataContextDb`, while 2 (memory, structured-state) do not. The gap is non-random: both missing packages were added after the pattern was established in tasks, and neither has the "fails loudly without withDataContext" integration test that tasks has.

3. **Owner filter missing on delete/update paths** (Phase 6 MED): The structured-state delete methods (3 repositories) and `ChatMemoryFactsRepository` mutation methods (3 methods) all share the same pattern — filter by `id` or `key` only, relying entirely on RLS. The cross-cutting sweep finds the pattern is wider than Phase 6 documented. A single code-review checklist item ("every DML WHERE clause must include `owner_user_id` unless the table's FORCE RLS policy is the sole guard and callers are warned") would prevent this class of gap going forward.

4. **No HTTP security headers** (Phase 7 HIGH): Confirmed cross-cutting — no plugin, hook, or route anywhere in `apps/api/src/server.ts` or any `packages/*/routes.ts` sets `Content-Security-Policy`, `X-Frame-Options`, or `X-Content-Type-Options`. This is a gap at the server composition level, not a per-route issue.

5. **Five app-foundation tables without RLS** (Phase 1 MED): The `app.workspaces`, `app.workspace_memberships`, `app.resource_grants`, `app.admin_audit_events`, and `app.instance_settings` tables confirmed to have no `ENABLE ROW LEVEL SECURITY`. This is reinforced by the auth module's direct cross-module INSERT into two of these tables — the absence of RLS on those tables means the cross-module write works without the GUC, but also means any future bug that causes a cross-user workspace query returns all rows.

#### New cross-cutting findings not caught in individual phases

- **Auth module → settings tables cross-module write** (HIGH, above): Phase 1–7 did not flag `bootstrapFirstJarvisUser` as a module isolation violation. The cross-cutting phase identified it as the only case where one module issues `insertInto` on another module's owned tables without going through the owning module's API.
- **Pino logger `redact` absent** (LOW, above): No prior phase audited the Fastify logger configuration for header redaction. The gap is currently unexploited but is a structural risk if header logging is ever enabled.

#### False positives clarified by the cross-cutting sweep

- **`AuthSessionResolver` raw Kysely**: Flagged as a concern in Phase 1 (INFO). The cross-cutting sweep confirms it is architecturally correct — it calls only the SECURITY DEFINER function `app.resolve_auth_session()`, not a direct table SELECT. This is not a DataContextDb violation because the function is not a repository; it is a pre-AccessContext resolver that produces an AccessContext.
- **`chat` module `MemoryRepository/ChatMemoryFactsRepository` imports**: These appear to cross module boundaries but are all going through `@jarv1s/memory`'s public `index.ts`. Not a violation.
- **`preferences.delete` key-only filter**: The `app.preferences` table has `UNIQUE(owner_user_id, key)`, so filtering by `key` does not risk cross-user deletion — the RLS USING clause on the DELETE policy still correctly scopes to the actor. This is a defense-in-depth gap (no application-layer owner check) but not a practical exploit path with the current schema.

---

### Overall Health Summary (All 8 Phases)

Jarv1s has a sound security architecture with genuine defense-in-depth at the DB layer: all runtime roles have `NOBYPASSRLS`, `NOSUPERUSER`, and `NOINHERIT`; FORCE RLS is consistently applied across module tables; pg-boss payloads are uniformly metadata-only; secrets are AES-256-GCM encrypted at rest and never surface in responses, logs, or payloads; module boundaries are respected at the TypeScript package level; and the AccessContext shape invariant (`{ actorUserId, requestId }`) is fully enforced.

The most critical outstanding issues across all 8 phases, in recommended priority order, are:

1. **[Phase 7 HIGH] HTTP security headers absent** — no CSP, X-Frame-Options, or X-Content-Type-Options anywhere; add `@fastify/helmet` before any public network exposure.
2. **[Phase 6 HIGH] `jarvis_worker_runtime` has no RLS policies on `memory_chunks` and `memory_file_index`** — the chat embed worker's memory write path is silently broken in production under FORCE RLS; add worker policies in a new migration immediately.
3. **[Phase 5/Phase 1 HIGH] `app.users` UPDATE has no column-level restriction** — a user can self-escalate `is_instance_admin` at the DB layer; apply `REVOKE UPDATE ON app.users FROM jarvis_app_runtime; GRANT UPDATE (name, email, ...) TO jarvis_app_runtime` before Phase 2 ships any user-update route.
4. **[Phase 6 HIGH] `structured-state` repositories accept caller-supplied `ownerUserId` on INSERT** — replace with `sql\`app.current_actor_user_id()\`` to match the tasks pattern.
5. **[Phase 8 HIGH] Auth module cross-module write to settings tables** — document the bootstrap exception and add a `bootstrapFirstWorkspace` public API in `@jarv1s/settings` to encapsulate the write.
6. **[Phase 8 HIGH / Phase 6 LOW] `assertDataContextDb` missing in memory and structured-state repositories** — add fail-fast guards to match the tasks pattern.
7. **[Phase 2 HIGH] `delete-user-data.ts` does not delete vault filesystem directory** — deleted users' vault content persists on disk indefinitely.
8. **[Phase 5 HIGH] Phase 2 multi-user lifecycle controls absent** — no account approval gate, no status enforcement, no session revocation; the instance is open to any registrant; Phase 2 must ship before any multi-user LAN exposure.

Items 1, 2, 3, and 6 can be addressed in the current phase with small, targeted migrations and server config changes. Items 4, 5, 7, and 8 require new migrations or Phase 2 work. The security posture for a single-user self-hosted instance is adequate; for multi-user LAN deployment, the Phase 2 lifecycle controls (item 8) and HTTP security headers (item 1) are the gating prerequisites.
