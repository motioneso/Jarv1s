# Standards Compliance Sweep — Cross-Repository Audit

**Auditor:** PLO agent (cross-standards sweep)
**Date:** 2026-06-10
**Scope:** All TypeScript/TSX source under `~/Jarv1s`, excluding `node_modules`, `dist`, `spikes/`, and generated `.d.ts` files.
**Methods:** `wc -l`, `grep` pattern sweeps, manual code inspection at flagged sites.

---

## 1. File Size Violations

The hard limit is **1 000 lines** per source file. Test files are included because oversized test files are a known maintenance debt signal.

### [LOW] tasks.test.ts approaching the 1000-line limit
- **File:** `tests/integration/tasks.test.ts` — 950 lines
- **Category:** Code Quality
- **Finding:** The integration test file for tasks is at 95 % of the enforced limit. A single new test block will trigger the `pnpm check:file-size` gate.
- **Evidence:** `wc -l` output: `950 tests/integration/tasks.test.ts`
- **Impact:** One more test and the CI gate breaks; the author will be forced to decompose under time pressure rather than by design.
- **Recommendation:** Split proactively now — e.g. `tasks-foundation.test.ts`, `tasks-jobs.test.ts`, `tasks-ui-contract.test.ts` — following the pattern already used in `tasks-web-contract.test.ts`.

### [LOW] mock-api.ts approaching the 1000-line limit
- **File:** `tests/e2e/mock-api.ts` — 918 lines
- **Category:** Code Quality
- **Finding:** The e2e mock API file is at 91.8 % of the limit.
- **Evidence:** `wc -l` output: `918 tests/e2e/mock-api.ts`
- **Impact:** Same gate-break risk as above; mock modules tend to grow with every new endpoint.
- **Recommendation:** Extract per-module mock handlers into `tests/e2e/mocks/` sub-files and re-export from a barrel.

---

## 2. Forbidden Patterns

### 2a. BYPASSRLS

**Result: PASS.** No `BYPASSRLS` token appears in any non-spike source file. All occurrences found are `NOBYPASSRLS` declarations in bootstrap SQL, confirming the invariant is enforced at the role level.

### 2b. `as any` type assertions

**Result: PASS.** Zero `as any` occurrences were found in production TypeScript source files. Type safety discipline is intact across the codebase.

### 2c. `@ts-ignore` / `@ts-expect-error`

**Result: PASS (with note).** One occurrence found:

- **File:** `tests/integration/tasks-web-contract.test.ts:12`
- `// @ts-expect-error — in_progress is no longer assignable to TaskApiStatus`
- This is a legitimate, justified suppression: it exists to prove the old status string is no longer accepted. Justified on the same line.

### 2d. `console.log` / `console.error` in production source

### [MEDIUM] Raw console calls in worker process instead of structured logging
- **File:** `apps/worker/src/worker.ts:38,53`
- **Category:** Code Quality
- **Finding:** The worker process uses `console.log` for its startup banner and `console.error` for the crash handler, while the API server uses Fastify's structured logger (pino). This is an inconsistency that makes log aggregation and filtering harder.
- **Evidence:**
  ```ts
  console.log(`Jarv1s worker listening on ${RLS_PROBE_QUEUE} and built-in module queues`);
  // ...
  console.error(JSON.stringify({ level: "fatal", label, err: String(err), ... }));
  ```
- **Impact:** The startup log is unstructured and will not be parsed correctly by log shippers. The crash log attempts structure via manual `JSON.stringify` but is inconsistent with Fastify's format.
- **Recommendation:** Create a shared `packages/logger` (or expose a `createPinoLogger()` factory from an existing package) and use it in both the API and worker. The crash log is the higher priority since it appears at production failure time.

### 2e. Raw `require()` in TypeScript source

**Result: PASS.** No raw `require()` calls were found in production TypeScript files.

### 2f. `process.env` accessed outside config/env modules

### [MEDIUM] Duplicate `JARVIS_CHAT_HOME` env read in two sibling files
- **File:** `packages/chat/src/live/persona.ts:46` and `packages/chat/src/live/runtime.ts:105`
- **Category:** Code Quality / Architecture
- **Finding:** Both `persona.ts` and `runtime.ts` contain an identical private `resolveBaseDir` / `resolveNeutralBase` function that reads `process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat")`. The comment in `runtime.ts` even acknowledges this: "mirrors renderPersona's own default."
- **Evidence:**
  ```ts
  // persona.ts:44
  function resolveBaseDir(override?: string): string {
    if (override !== undefined) return override;
    return process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat");
  }

  // runtime.ts:104
  function resolveNeutralBase(): string {
    return process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat");
  }
  ```
- **Impact:** If the default path ever changes, both files must be updated. The comment "mirrors" signals the author knew this was duplication.
- **Recommendation:** Export a single `resolveJarvisChatHome(override?: string): string` from a shared location (e.g. `packages/chat/src/live/paths.ts`) and import it in both files.

### [LOW] `process.env.PORT` accessed directly in module-registry
- **File:** `packages/module-registry/src/index.ts:149`
- **Category:** Architecture
- **Finding:** The module-registry reads `process.env.PORT` to construct the MCP server URL, bypassing the config module pattern used by `apps/api/src/server.ts`.
- **Evidence:**
  ```ts
  mcpServerUrl: `http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`,
  ```
- **Impact:** The port is already known at server startup in `server.ts`. The module-registry should receive it as an injected dependency, not re-derive it from the environment.
- **Recommendation:** Add `mcpServerPort?: number` to the registry-construction options and pass it from `server.ts`.

### [LOW] `process.env.JARVIS_RL_OAUTH_MAX` read inside route-registration function
- **File:** `packages/connectors/src/routes.ts:79`
- **Category:** Architecture
- **Finding:** The rate-limit max for the Google OAuth complete endpoint is read from `process.env` each time `registerConnectorsRoutes` is called, rather than being injected or read in a config module.
- **Evidence:**
  ```ts
  const oauthMax = Number(process.env.JARVIS_RL_OAUTH_MAX ?? 5);
  ```
- **Impact:** Minor: this is called once at startup. However it is inconsistent with the injected-dependency pattern the rest of the routes module uses and the authorized pattern for env-reading.
- **Recommendation:** Move to `ConnectorsRoutesDependencies` or read in a config module.

---

## 3. Architecture Violations

### [HIGH] `SettingsRepository` accepts raw `Kysely<JarvisDatabase>` — violates DataContextDb invariant
- **File:** `packages/settings/src/repository.ts:63-64`
- **Category:** Architecture / Security
- **Finding:** `SettingsRepository` is constructed with a bare `Kysely<JarvisDatabase>` instance, not the branded `DataContextDb`. The hard invariant states: *"Repositories accept only a branded `DataContextDb` handle, never a root Kysely instance."* This repository is re-exported from `packages/settings/src/index.ts` as public API.
- **Evidence:**
  ```ts
  export class SettingsRepository {
    constructor(private readonly db: Kysely<JarvisDatabase>) {}

    async getUserById(userId: string): Promise<User | undefined> {
      return this.db.selectFrom("app.users").selectAll()... // no RLS context set
    }
  }
  ```
  Used in `routes.ts`: `new SettingsRepository(dependencies.appDb)` — `appDb` is the root pool-level Kysely instance.
- **Impact:** Queries run without the `app.actor_user_id` GUC set, so RLS policies on `app.users` that check `app.current_actor_user_id()` are evaluated with a NULL actor. The `app.users` table has `ENABLE ROW LEVEL SECURITY` (not FORCE) and has a `users_app_runtime_select` policy allowing all rows on SELECT — so reads currently succeed. But INSERT and UPDATE policies (`USING (id = app.current_actor_user_id())`) would fail if the repo ever issues those operations outside the admin path. The deeper concern: this pattern normalises bypassing `DataContextDb` and makes it easy to introduce RLS gaps.
- **Recommendation:** Convert `SettingsRepository` to accept `DataContextDb` for user-facing read operations. For admin-only mutations that must reach rows the actor does not own (e.g. admin lifecycle writes planned in P2 multi-user), use explicit SECURITY DEFINER helpers as already planned, not naked Kysely. The `countUsers()` method — which is legitimately non-actor-scoped — should be separated into a bootstrap-level helper that clearly documents its special status.

### [HIGH] `ConnectorsRoutesDependencies.appDb` used to query `app.users` without DataContext
- **File:** `packages/connectors/src/routes.ts:258-267`
- **Category:** Architecture / Security
- **Finding:** The connector admin-check function queries `app.users` via a raw `Kysely<JarvisDatabase>` dependency, not through `DataContextRunner.withDataContext`.
- **Evidence:**
  ```ts
  const user = await dependencies.appDb
    .selectFrom("app.users")
    .select(["id", "is_instance_admin"])
    .where("id", "=", accessContext.actorUserId)
    .executeTakeFirst();
  ```
- **Impact:** Same class of violation as the settings repository: the query executes without the RLS `app.actor_user_id` GUC set. Because `app.users` SELECT policy allows all rows currently, this does not cause an RLS bypass in the strict sense, but it is an inconsistency with the enforced pattern. More critically, if the users SELECT policy is ever tightened (e.g. owner-only for privacy), this query silently starts returning `undefined`, causing the admin check to throw 401 for every request.
- **Recommendation:** Use `DataContextRunner.withDataContext` for this lookup, identical to how other modules resolve the current user.

### [MEDIUM] `handleExtractFactsJob` is a registered no-op (worker slot wired but handler empty)
- **File:** `packages/chat/src/jobs.ts:104-112`
- **Category:** Architecture / Code Quality
- **Finding:** `handleExtractFactsJob` is a registered worker queue handler that does nothing. It is wired through `registerChatJobWorkers`, receives real pg-boss jobs for every completed chat turn, and silently discards them. The TODO comment marks it as deferred to phase 3.
- **Evidence:**
  ```ts
  export async function handleExtractFactsJob(
    _scopedDb: DataContextDb,
    _ownerUserId: string,
    _threadId: string
  ): Promise<void> {
    // TODO(phase3-facts): call capability router to extract structured facts
  }
  ```
- **Impact:** Workers consume jobs from the queue and report success for every turn, even though no facts are extracted. This masks future failures (the queue will appear healthy) and creates invisible technical debt. The `deleteAfterSeconds: 600` on the queue means any real job data is discarded before phase 3 arrives.
- **Recommendation:** Two options: (1) Do not register the extract-facts worker until the handler is implemented — remove the queue registration entirely for now; or (2) keep the registration but emit a structured log event (`logger.warn`) so monitoring surfaces the no-op. Option 1 is cleaner and matches the "spec before build" ethos.

### [MEDIUM] Dead error-handler branches for retired "Workspace context" vocabulary
- **Files:**
  - `packages/connectors/src/routes.ts:407`
  - `packages/ai/src/routes.ts:777`
  - `packages/settings/src/routes.ts:526`
- **Category:** Code Quality (Dead Code / Stale Vocabulary)
- **Finding:** Three separate error-handler functions contain `if (error.message === "Workspace context is unavailable")` branches. No code in the current codebase throws this error string — `grep` across all packages returns no throw site. The workspace teardown (migration 0028) and Slice 1f removed the concept.
- **Evidence:**
  ```ts
  if (error.message === "Workspace context is unavailable") {
    return reply.code(403).send({ error: error.message });
  }
  ```
  (Same pattern in all three files.)
- **Impact:** Dead branches obscure the error-handling contract and represent exactly the "stale vocabulary" the DEVELOPMENT_STANDARDS prohibit. The CLAUDE.md invariant "remove dead vocabulary in the same pass" was not followed here.
- **Recommendation:** Delete all three branches. If a workspace-context concept is reintroduced in P2 multi-user, it should get a new, purpose-specific error type.

### [MEDIUM] `app.current_workspace_id()` SQL function still present in migration 0002
- **File:** `infra/postgres/migrations/0002_app_rls.sql` — lines 22–44 and 86–91
- **Category:** Code Quality / Architecture
- **Finding:** Migration 0002 creates `app.current_workspace_id()` and grants `EXECUTE` to the runtime roles. Migration 0028 (`workspace_teardown`) later drops this function via `DROP FUNCTION IF EXISTS app.current_workspace_id()`. On a fresh database the function exists between migration steps 0002 and 0028. On existing databases it was already dropped by 0028. The function itself is harmless, but the `CREATE OR REPLACE` and `REVOKE`/`GRANT` surface in 0002 is dead weight that contradicts the workspace-teardown narrative.
- **Evidence:**
  ```sql
  -- 0002_app_rls.sql:22-44
  CREATE OR REPLACE FUNCTION app.current_workspace_id() ...
  GRANT EXECUTE ON FUNCTION app.current_workspace_id() TO jarvis_app_runtime, jarvis_worker_runtime;
  ```
  `grep -rn "current_workspace_id"` in packages and apps TypeScript returns zero hits — no code calls this function.
- **Impact:** Low risk (never called). But it confuses future readers of the migration sequence and creates a misleading gap between "workspaces are gone" (0028 comment) and "but they were also created in 0002".
- **Recommendation:** Do not edit 0002 (hash-checked). Add a note to 0028 explicitly linking these. Accept as INFO-level debt unless a 0002-replacement migration becomes warranted for other reasons.

---

## 4. Module Isolation Check

All cross-package imports reviewed use the `@jarv1s/<package>` workspace alias. No direct `../../../` relative paths crossing package boundaries were found. The following legitimate cross-module imports were confirmed:

- `@jarv1s/chat` imports from `@jarv1s/ai` (gateway session types) and `@jarv1s/memory` (fact repo) — acceptable as `@jarv1s/ai` and `@jarv1s/memory` export these via their public `index.ts`.
- `@jarv1s/memory` imports from `@jarv1s/vault` (list/read functions) — acceptable via public export.

**One concern noted** (tracked under Architecture finding #3.2 above): `packages/connectors/src/routes.ts` imports the raw `Kysely` type from its dependencies rather than going through the DataContext abstraction. This is a layering issue, not a module-isolation issue per se.

---

## 5. Dead Exports

Spot-check of the most-likely-dead exports:

### [LOW] `SettingsRepository` is exported from `packages/settings/src/index.ts` and used only by `packages/module-registry`
- **File:** `packages/settings/src/index.ts:2`
- **Category:** Architecture
- **Finding:** `SettingsRepository` is re-exported as public API despite being a raw-Kysely repository whose exposure encourages the pattern flagged in finding 3.1. No external package other than `module-registry` uses it, and `module-registry` only passes it to `registerSettingsRoutes`. It is not used by any module directly.
- **Evidence:** `grep -rn "from '@jarv1s/settings'"` returns only `module-registry/src/index.ts:54`.
- **Impact:** The public export creates implied API compatibility promises for a class that violates the hard invariant. The TypeScript surface should not advertise it.
- **Recommendation:** Remove `export * from "./repository.js"` from the settings package index and export only `registerSettingsRoutes` and `settingsModuleManifest`. If other code needs workspace/resource-grant operations, expose intent-driven functions, not the raw repository class.

---

## 6. TODO / FIXME / HACK Comments

All found in production source (not tests):

| File | Line | Comment |
|------|------|---------|
| `packages/chat/src/jobs.ts` | 109 | `// TODO(phase3-facts): call capability router to extract structured facts from the most recent turn and upsert them into chat_memory_facts.` |

**Assessment:** Only one TODO exists in production source code. This is remarkable hygiene for a project of this size. The TODO is tracked under finding 3.3 above — the concern is that the worker is *registered and running* as a no-op, not merely that the comment exists.

---

## 7. TypeScript Discipline

### [INFO] `@ts-expect-error` with justification — acceptable
- **File:** `tests/integration/tasks-web-contract.test.ts:12`
- The suppression documents a deliberate type regression test. Acceptable.

### [MEDIUM] Non-null assertions without structural guarantee in chat routes
- **File:** `packages/chat/src/routes.ts:93, 96, 126`
- **Category:** TypeScript
- **Finding:** Three `!` non-null assertions are used on `tokens` and `gateway` variables that are `let … | undefined` and conditionally assigned based on whether the AI gateway is configured.
- **Evidence:**
  ```ts
  let tokens: SessionTokenRegistry | undefined;
  let gateway: AssistantToolGateway | undefined;
  // ...
  token: tokens!.mint({ actorUserId, chatSessionId: actorUserId }),  // line 93
  revoke: (chatSessionId: string) => tokens!.revokeBySessionId(chatSessionId),  // line 96
  await gateway!.resolveActionRequest(...);  // line 126
  ```
- **Impact:** The assertions are used inside blocks that are guarded by `tokens && mcpServerUrl` (lines 90-91) and `if (gateway && tokens)` (line 104), so at runtime these are safe. However, the assertions cross a closure boundary: the route handler registered at line 125 fires on HTTP requests, not during the guarded registration block. If the gateway is unconfigured, `gateway` is `undefined` and line 126 throws an unguarded `TypeError`. The outer try/catch at line 128 catches it and returns 400, so the surface impact is limited — but the assertion is structurally incorrect.
- **Recommendation:** Extract the gateway-action route registration into the `if (gateway && tokens)` block so the types are narrowed rather than asserted. This matches the pattern already used for MCP transport registration at line 104.

---

## 8. Error Handling

### [LOW] Swallowed error in `vault-ops.ts`
- **File:** `packages/vault/src/vault-ops.ts:39-41`
- **Category:** Error Handling
- **Finding:** A catch block returns `false` without logging or surfacing which vault operation failed or why.
- **Evidence:**
  ```ts
  } catch {
    return false;
  }
  ```
- **Impact:** Silent `false` returns make vault-operation failures invisible to diagnostics. If the vault root is misconfigured or a permission error occurs, callers see `false` and may continue with degraded behaviour.
- **Recommendation:** At minimum, emit a structured log entry with the error before returning `false`.

---

## 9. Job / Event Payloads

All job payload types reviewed conform to the metadata-only rule:

| Queue | Payload fields | Verdict |
|-------|---------------|---------|
| `chat.embed-turn` (`EmbedTurnJobPayload`) | `actorUserId`, `threadId`, `messageId` | PASS |
| `chat.extract-facts` (`ExtractFactsJobPayload`) | `actorUserId`, `threadId` | PASS |
| `briefings.run` (`BriefingRunPayload`) | `actorUserId`, `definitionId`, `briefingRunId`, `runKind`, `idempotencyKey` | PASS |
| `tasks.deferred-status` (`DeferredTaskStatusPayload`) | `actorUserId` + task IDs | PASS |

No content, prompts, or secrets were found in any pg-boss payload type.

---

## 10. pgvector Image Invariant

**Result: PASS.** `infra/docker-compose.yml` uses `pgvector/pgvector:pg17`. The `postgres:17-alpine` image is not present anywhere in the repository.

---

## 11. Migration Discipline

**Result: PASS.**

- All module SQL lives under `packages/<module>/sql/` — none was found in `infra/postgres/migrations/`.
- The `infra/postgres/migrations/` directory contains only app-schema and cross-cutting migrations.
- No evidence of applied migration content having been edited (content is as-committed).

---

## Summary Table

| Severity | Count | Categories |
|----------|-------|-----------|
| HIGH | 2 | Architecture (DataContextDb violation in settings repo and connectors admin check) |
| MEDIUM | 5 | Architecture (no-op worker), Code Quality (dead vocabulary × 3, duplicate env read), TypeScript (non-null assertion) |
| LOW | 6 | File size proximity (× 2), env-read location (× 2), dead export, swallowed error |
| INFO | 1 | `current_workspace_id()` SQL dead weight |

**Most urgent issues for the next PR review cycle:**
1. `packages/settings/src/repository.ts` — raw Kysely, exported publicly, used for all admin and some non-admin queries. This is the single biggest deviation from the DataContextDb hard invariant in the production codebase.
2. Dead "Workspace context is unavailable" branches in three route modules — straightforward 3-line deletions.
3. `handleExtractFactsJob` no-op — decide now whether to unregister or instrument; leaving it silent is misleading.
