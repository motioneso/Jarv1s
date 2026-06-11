# Briefings Module — Thermo-Nuclear Code Quality Audit

**Scope:** `packages/briefings/src/`, `packages/briefings/sql/`
**Date:** 2026-06-10
**Reviewer:** PLO Audit subagent

---

## Summary

The briefings module is one of the better-constructed modules in the codebase. RLS is correctly applied with `FORCE ROW LEVEL SECURITY`, job payloads are metadata-only with a runtime guard, and the tool-execute path enforces read-only tools. However, several real findings exist — ranging from a security-significant authorization bypass on update, a non-trivial AccessContext contract violation, a dead-code branch, and a quality issue in `getOwnedDefinitionById` redundancy.

---

## Findings

---

### [HIGH] PATCH /definitions/:id authorizes via RLS only — no ownership gate at the route layer

- **File:** `packages/briefings/src/routes.ts:84–105`
- **Category:** Security / Architecture
- **Finding:** The `PATCH /api/briefings/definitions/:id` route does not check `definition.owner_user_id !== accessContext.actorUserId` before calling `repository.updateDefinition`. In contrast, the `POST /definitions/:id/run` route (line 119) does perform an explicit ownership check. The update route relies solely on RLS to block cross-user writes. This is technically safe because the UPDATE policy enforces ownership (or `has_share('briefing_definition', id, 'manage')`), but the asymmetry means a share grantee with `manage` level CAN update a definition they do not own — this may or may not be intended, and it is not documented. The `GET /definitions/:id/runs` route (line 149–178) also does not check ownership before calling `listRuns`, meaning a share grantee can list runs of a shared definition. Since the `briefing_runs_select` policy uses a subquery on `briefing_definitions`, this is correctly scoped — but the discrepancy between routes that do explicit ownership checks and routes that do not creates an inconsistent and fragile pattern.
- **Evidence:**
  ```ts
  // routes.ts:84–105 — no explicit ownership check before update:
  const definition = await dependencies.dataContext.withDataContext(
    accessContext,
    (scopedDb) => repository.updateDefinition(scopedDb, request.params.id, input)
  );
  if (!definition) {
    return reply.code(404).send({ error: "Briefing definition not found" });
  }

  // routes.ts:119 — run route does an explicit check:
  if (!definition || definition.owner_user_id !== accessContext.actorUserId) {
    return reply.code(404).send({ error: "Briefing definition not found" });
  }
  ```
- **Impact:** Share grantees with `manage` level can silently update definitions they do not own. The intent of `briefings.update` permission is "Update briefing definitions owned by the active actor" (manifest line 68–72), yet the route permits manage-level grantees to update. This is a permission/intent mismatch. If share management is not fully spec-gated, this may violate "Private by default" for definition mutations.
- **Recommendation:** Add an explicit ownership check in the PATCH route handler (same pattern as the run route: fetch first, check `owner_user_id`), or document in the manifest that `manage` grantees may also update. Align the stated permission description with actual behavior.

---

### [HIGH] Tool execute called with fabricated ToolContext (empty actorUserId, requestId, chatSessionId)

- **File:** `packages/briefings/src/repository.ts:254–262`
- **Category:** Security / Architecture
- **Finding:** `generateSummary` calls `manifestTool.execute(scopedDb, {}, { actorUserId: "", requestId: "", chatSessionId: "" })`. The `ToolContext` is entirely fabricated with empty strings. Since `ToolExecute` receives `scopedDb` (which is already actor-scoped through `withDataContext`), the empty `actorUserId` in `ToolContext` should not bypass RLS — but any tool that inspects `ctx.actorUserId` for secondary authorization decisions will receive an empty string rather than the real actor. This is an implicit contract violation: `ToolContext.actorUserId` is expected to identify the acting user (see module-sdk/src/index.ts:12–16).
- **Evidence:**
  ```ts
  // repository.ts:253–262
  const toolResult = await manifestTool.execute(
    scopedDb,
    {},
    {
      actorUserId: "",
      requestId: "",
      chatSessionId: ""
    }
  );
  ```
- **Impact:** Any tool that uses `ctx.actorUserId` for logging, auditing, or secondary access decisions will receive `""` instead of the real actor. This is a silent correctness bug and a potential security gap if any future tool adds ctx-based logic. It also means the `ToolContext` contract is broken for briefing-initiated tool calls.
- **Recommendation:** Pass the real actor values. The `actorUserId` is available on `definition.owner_user_id` (the definition owner whose briefing is being generated). The `requestId` can be derived from the job or a `randomUUID()`. The `chatSessionId` can be `""` as a documented briefing-context convention, or a dedicated sentinel. At minimum, `actorUserId` must not be `""`.

---

### [MEDIUM] `getOwnedDefinitionById` is a private method that duplicates `getDefinitionById` with an added owner filter — but the owner filter is already enforced by RLS

- **File:** `packages/briefings/src/repository.ts:197–207`
- **Category:** Code Quality / Architecture
- **Finding:** `getOwnedDefinitionById` is a private method used only in `generateRun` (line 162). It adds `AND owner_user_id = app.current_actor_user_id()` to the WHERE clause on top of what RLS already enforces. The public `getDefinitionById` already returns `undefined` for any definition the actor cannot see (enforced by `briefing_definitions_select` policy). The private method is an identity abstraction that adds no real invariant — it just duplicates the filtering that RLS already performs. Moreover, the rationale is that the run can only be generated for an owned definition (not a shared one), but this comment is absent, and the method name does not distinguish "owned" from "visible".
- **Evidence:**
  ```ts
  // repository.ts:197–207
  private async getOwnedDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .where("id", "=", definitionId)
      .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
      .executeTakeFirst();
  }
  ```
- **Impact:** The extra filter is redundant with RLS. It adds incidental complexity without a documented invariant. If the intention is to prevent share grantees from triggering a run generation in the worker (worker generates runs only for owners), this should be a documented business rule — not a silent DB filter. The filter is also applied only in the worker path (`generateRun`), not in the route path, creating inconsistency.
- **Recommendation:** If the rule is "only the owner can generate a run" (not grantees), document that explicitly in a comment and consider enforcing it at the route or job level instead of hiding it in a private DB filter. If the RLS policy already guarantees this (runs INSERT policy requires owner match), the private method can be collapsed into `getDefinitionById` with an explicit post-fetch ownership check.

---

### [MEDIUM] `updateDefinition` in the repository does not assert `assertDataContextDb` in `getOwnedDefinitionById`

- **File:** `packages/briefings/src/repository.ts:197–207`
- **Category:** Architecture / Security
- **Finding:** The private method `getOwnedDefinitionById` does not call `assertDataContextDb(scopedDb)` before querying, whereas all public methods do. Since this is only called from `generateRun` (which does call `assertDataContextDb` at line 160), the missing assertion is not an immediate vulnerability, but it violates the consistent pattern established in every public method and could become a gap if `getOwnedDefinitionById` is ever called from a different code path that skips the outer assertion.
- **Evidence:**
  ```ts
  // repository.ts:197 — no assertDataContextDb call here
  private async getOwnedDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
    return scopedDb.db  // no assertDataContextDb before use
  ```
- **Impact:** If the private method is ever surfaced, refactored, or called from a different entry point, the missing guard means a bare Kysely instance could be passed without error.
- **Recommendation:** Add `assertDataContextDb(scopedDb)` at the top of `getOwnedDefinitionById` to maintain the consistent invariant pattern.

---

### [MEDIUM] `isBriefingRunPayloadMetadataOnly` used as a runtime guard but cannot be trusted as a security assertion

- **File:** `packages/briefings/src/routes.ts:132–134`, `packages/briefings/src/jobs.ts:55–59`
- **Category:** Security / Code Quality
- **Finding:** The function `isBriefingRunPayloadMetadataOnly` checks that `Object.keys(payload).every(key => allowedKeys.has(key))`. In `routes.ts` line 132, the payload is cast via `payload as unknown as Record<string, unknown>` to pass it to this function. The cast is required because TypeScript already knows `payload` is `BriefingRunPayload`, meaning the check is a tautology at the type level — the types already guarantee the fields. The runtime check cannot detect if someone extends `BriefingRunPayload` with additional properties and also extends `BRIEFING_RUN_PAYLOAD_KEYS`. The guard gives false confidence as a security assertion.
- **Evidence:**
  ```ts
  // routes.ts:132–134
  if (!isBriefingRunPayloadMetadataOnly(payload as unknown as Record<string, unknown>)) {
    throw new HttpError(500, "Briefing job payload contains non-metadata fields");
  }
  // jobs.ts:72
  if (!isBriefingRunPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)) {
  ```
- **Impact:** The double-cast (`as unknown as Record<string, unknown>`) is a type smell indicating the check is fighting the type system. The function provides a false sense of security. A real runtime guard here would need to serialize and inspect the actual pg-boss payload after it has been enqueued, not before.
- **Recommendation:** Either remove the runtime guard (relying on TypeScript + the strict interface + integration tests instead) or rethink it as a schema validation step using the `briefingRunPayloadSchema` from `@jarv1s/shared`, which can detect extra fields if configured with `additionalProperties: false`. The in-band cast should be removed.

---

### [LOW] Dead variable: `visibleLabel` in `formatToolSummary` always produces `"visible"` regardless of count

- **File:** `packages/briefings/src/repository.ts:386`
- **Category:** Code Quality
- **Finding:** The variable `visibleLabel` is defined as `tool.itemCount === 1 ? "visible" : "visible"` — both branches return the identical string `"visible"`. This is a ternary that does nothing; it was likely intended to be `"item" : "items"` or similar for pluralization.
- **Evidence:**
  ```ts
  // repository.ts:386
  const visibleLabel = tool.itemCount === 1 ? "visible" : "visible";
  ```
- **Impact:** Minor cosmetic bug — the summary output is always `"N visible"` regardless of count. No security or correctness impact beyond misleading summaries.
- **Recommendation:** Fix the dead ternary. If pluralization was intended: `tool.itemCount === 1 ? "item visible" : "items visible"`. If the label is intentional, replace the ternary with a constant `"visible"`.

---

### [LOW] `requiredString` rejects empty-after-trim strings but treats them as "required field missing" rather than "invalid format"

- **File:** `packages/briefings/src/routes.ts:263–271`
- **Category:** Error Handling
- **Finding:** `requiredString` calls `optionalString` and then checks `!parsed` — meaning both `undefined` and `""` (after trimming) yield the same error `"${fieldName} is required"`. A client sending `title: "   "` (whitespace only) gets the message `"title is required"` rather than `"title must not be empty"`, which is confusing because the field was provided. The Fastify JSON schema (`createBriefingDefinitionRouteSchema`) may or may not validate this before reaching the route handler, but if schema validation is incomplete, the misleading message reaches the client.
- **Evidence:**
  ```ts
  // routes.ts:263–271
  function requiredString(value: unknown, fieldName: string): string {
    const parsed = optionalString(value, fieldName);
    if (!parsed) {
      throw new HttpError(400, `${fieldName} is required`);  // fires for whitespace-only too
    }
    return parsed;
  }
  ```
- **Impact:** Minor UX/developer confusion. No security impact.
- **Recommendation:** Distinguish between the missing and whitespace-only cases. Return `"${fieldName} must not be empty"` when `value` is a string but trims to empty.

---

### [LOW] No DELETE policy on `briefing_definitions` — worker has UPDATE but no explicit DELETE grant

- **File:** `packages/briefings/sql/0015_briefings_module.sql:134–138`
- **Category:** Security / Architecture
- **Finding:** Neither `jarvis_app_runtime` nor `jarvis_worker_runtime` has a GRANT DELETE on `briefing_definitions` or `briefing_runs`. This means there is no soft-delete or hard-delete path in the current module — deletion is only via `ON DELETE CASCADE` from the parent `app.users` table. There is no DELETE policy, and no route for deleting a definition. This is a design decision (likely deliberate), but the absence is total: users cannot delete their own briefing definitions through the API, which may surprise users who create many manual definitions.
- **Evidence:**
  ```sql
  -- 0015_briefings_module.sql:134–138
  GRANT SELECT, INSERT, UPDATE ON app.briefing_definitions TO jarvis_app_runtime;
  GRANT SELECT, INSERT ON app.briefing_runs TO jarvis_app_runtime;
  GRANT SELECT, UPDATE ON app.briefing_definitions TO jarvis_worker_runtime;
  GRANT SELECT, INSERT ON app.briefing_runs TO jarvis_worker_runtime;
  -- No DELETE grant; no DELETE policy; no DELETE route
  ```
- **Impact:** Users cannot self-service remove stale definitions. Over time, the `briefing_definitions` table may accumulate unused rows with no cleanup path. Not a security issue, but a completeness gap that should be acknowledged in the spec.
- **Recommendation:** Either add a DELETE route + policy + grant for owners, or add a comment in the SQL and manifest documenting that deletion is intentionally absent and why (e.g., audit trail retention).

---

### [LOW] `summarizeUnknownResult` silently succeeds for any unrecognized tool name

- **File:** `packages/briefings/src/repository.ts:367–377`
- **Category:** Code Quality / Error Handling
- **Finding:** The `default` branch in `summarizeToolResult` calls `summarizeUnknownResult`, which returns a `ToolSummary` with `status: "succeeded"` and zero excerpts. This means any tool not explicitly handled in the switch (e.g., a new tool added to a module) will produce a "succeeded" summary with no content, silently hiding the fact that briefing content was not generated. The tool name validation at the route layer allows any `risk: "read"` tool, so new modules can register read tools that get silently no-op summarized.
- **Evidence:**
  ```ts
  // repository.ts:347–349
  default:
    return summarizeUnknownResult(tool.name, result);
  // repository.ts:367–377
  function summarizeUnknownResult(toolName: string, result: Record<string, unknown>): ToolSummary {
    const firstArray = Object.values(result).find((value) => Array.isArray(value));
    const itemCount = Array.isArray(firstArray) ? firstArray.length : 0;
    return { name: toolName, status: "succeeded", itemCount, excerpts: [] };
  }
  ```
- **Impact:** Briefings for unrecognized tools silently produce empty summaries without signaling to the user that the content is missing. Could mislead users into thinking a briefing ran successfully when it produced no useful output.
- **Recommendation:** Change `summarizeUnknownResult` to return `status: "blocked"` with `blockedReason: "unsupported_tool"` instead of `status: "succeeded"`. This surfaces the gap to users and is consistent with the existing `"unsupported_tool"` block path (line 248).

---

### [INFO] Integration test coverage is strong and exercises the key invariants

- **File:** `tests/integration/briefings.test.ts`
- **Category:** Tests
- **Finding:** The integration test suite is thorough. It covers: RLS enforcement (user B cannot read user A's definitions), admin private-data bypass denial, share grantee visibility (definitions and runs), metadata-only payload assertion against the actual pg-boss table, worker job isolation (User A job cannot generate User B's run), and the `assertDataContextDb` guard. These are exactly the right invariants to test. The tests use real Postgres with per-user connections, not mocks.
- **Impact:** No action needed. Documenting for completeness.
- **Recommendation:** Consider adding a test that `generateRun` via the worker passes a non-empty `actorUserId` in `ToolContext` when calling tool execute (to catch regression from the HIGH finding above).

---

### [INFO] `scheduleMetadata` is stored as JSONB but no scheduled trigger or cadence execution engine exists

- **File:** `packages/briefings/src/manifest.ts:36–38`, `packages/briefings/sql/0015_briefings_module.sql:37–38`
- **Category:** Architecture / Info
- **Finding:** The `briefing_definitions` table stores `cadence` (`manual | daily | weekly`) and `schedule_metadata` (JSONB). The manifest declares cadences and the schema enforces the JSONB shape. However, there is no cron trigger, pg-boss schedule, or worker loop that reads `cadence` and dispatches scheduled briefing runs. All runs are effectively manual. The scheduled cadence is entirely inert infrastructure.
- **Impact:** Not a bug — this is likely intentional forward-compat scaffolding. However, the `enabled` field (line 99 of repository.ts, line 129 of routes.ts) is stored and returned but never consulted by any scheduling logic. If a scheduler is added later, the `enabled` flag must be respected; the current code never checks it.
- **Recommendation:** Add a `TODO` comment in the repository or manifest noting that `cadence`, `scheduleMetadata`, and `enabled` are forward-compat only and require a scheduler to become functional. This prevents a future developer from assuming the scheduling is wired up.

---

## File Size

All source files are well under the 1000-line limit: `repository.ts` (414 lines), `routes.ts` (413 lines), `jobs.ts` (97 lines), `manifest.ts` (133 lines), `index.ts` (4 lines). No violations.

---

## Hard Invariant Compliance

| Invariant | Status |
|-----------|--------|
| No admin private-data bypass | PASS — RLS FORCE on both tables; test confirms admin blocked |
| Private by default | PASS — owner-only insert/update; share requires explicit grant |
| DataContextDb only | PASS — `assertDataContextDb` called in all public methods |
| AccessContext shape | VIOLATION (HIGH) — ToolContext passed with `actorUserId: ""` |
| Secrets never escape | PASS — summary_text contains counts/titles, not credentials |
| Metadata-only job payloads | PASS — `BriefingRunPayload` is IDs + kind + idempotency key only |
| Provider-agnostic AI | N/A — no AI provider calls in this module |
| Spec before build | NOT VERIFIED — no spec file found in docs/superpowers/specs/ for briefings |
| Module isolation | PASS — only uses declared `@jarv1s/ai` helpers, not module internals |
| pgvector image | N/A |
| Never edit applied migrations | PASS — two separate migration files, no edits to applied |
