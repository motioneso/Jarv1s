# `packages/ai` — Thermo-Nuclear Code Quality Audit

**Auditor:** Claude (subagent)
**Date:** 2026-06-10
**Scope:** All source files under `packages/ai/src/` and `packages/ai/sql/`
**Files reviewed:**
- `src/index.ts`, `src/manifest.ts`, `src/crypto.ts`, `src/repository.ts`, `src/routes.ts`
- `src/assistant-tools.ts`, `src/chat-adapter.ts`, `src/cli-availability.ts`
- `src/adapters/http-api.ts`, `src/adapters/tmux-bridge.ts`, `src/adapters/transcript-reader.ts`
- `src/gateway/gateway.ts`, `src/gateway/confirmation-registry.ts`, `src/gateway/input-validation.ts`
- `src/gateway/policy.ts`, `src/gateway/session-tokens.ts`, `src/gateway/types.ts`, `src/gateway/index.ts`
- `sql/0013_ai_module.sql`, `sql/0016_ai_assistant_actions.sql`, `sql/0023_ai_action_requests_owner_only.sql`
- `sql/0033_ai_auth_method.sql`, `sql/0037_ai_worker_read_grants.sql`
- `tests/integration/ai.test.ts`, `tests/integration/ai-tools.test.ts`
- `tests/unit/ai-http-api.test.ts`, `tests/unit/ai-cli-availability.test.ts`, `tests/unit/ai-tmux-bridge.test.ts`

---

## Summary

The `packages/ai` module is architecturally sound for its stated phase (metadata-only capability router + MCP gateway with confirmation bridge). The critical invariants — no credential escape, DataContextDb-only access, RLS enforced on all tables, metadata-only job payloads — are upheld correctly throughout. No CRITICAL findings were identified.

The findings below range from HIGH to LOW and primarily concern a race condition in the confirmation bridge, a credential exposure vector via HTTP request logs for Google, a stale error-handling branch referencing a removed concept, code duplication of a helper function, weak tool input validation, and several test coverage gaps.

---

## Findings

### [HIGH] Google API key embedded in URL — exposed in HTTP access logs and error messages

- **File:** `packages/ai/src/adapters/http-api.ts:100`
- **Category:** Security
- **Finding:** The Google Generative Language API key is appended as a plain query parameter (`?key=<apikey>`) in the constructed URL. HTTP access logs (reverse proxies, CDN, load balancers, application-level request loggers) record the full URL including query parameters by default. If Fastify's HTTP client or any middleware logs outbound request URLs, the API key leaks.
- **Evidence:**
  ```typescript
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${this.apiKey}`;
  ```
  Contrast with Anthropic (key in `x-api-key` header) and OpenAI (key in `Authorization: Bearer` header) — both headers are typically redacted from logs while URL query strings are not.
- **Impact:** The user's Google AI API key could appear in access logs, error reports (e.g., stack traces that include the request URL), or be transmitted to third parties if any intermediary proxy is in place. This violates the "secrets never escape" invariant.
- **Recommendation:** Move the Google API key to a request header. Google's REST API supports `Authorization: Bearer <key>` as an alternative to the query-param form. If the query-param form must be used (e.g., for specific endpoint compatibility), redact the key from any URL before passing it to error messages or logs. At minimum, add a comment and a lint check to ensure the URL string is never logged.

---

### [HIGH] Confirmation bridge race condition — notification emitted before waiter is registered

- **File:** `packages/ai/src/gateway/gateway.ts:124–131`
- **Category:** Security / Architecture
- **Finding:** In `confirmAndRun`, the `notifier.emit` call at line 124 fires before `confirmations.awaitResolution` registers the in-memory waiter at line 131. If the notifier triggers a synchronous or near-synchronous resolution path (e.g., a unit test mock, or a future in-process event emitter that calls `resolveActionRequest` synchronously), the `confirmations.resolve()` call arrives at an empty waiter map and is silently dropped. The `awaitResolution` call then blocks until `confirmTimeoutMs` elapses and the tool reports "denied" — effectively a DoS / incorrect security outcome.
- **Evidence:**
  ```typescript
  // line 124 — notification BEFORE waiter registration
  this.deps.notifier.emit(ctx.chatSessionId, { kind: "action_request", ... });

  // line 131 — waiter registered AFTER notification
  const outcome = await this.deps.confirmations.awaitResolution(action.id, this.deps.confirmTimeoutMs);
  ```
  `ConfirmationRegistry.resolve()` does a silent no-op if the ID is not in the `waiters` map (line 33: `this.waiters.get(actionRequestId)?.settle(status)`).
- **Impact:** In the current production architecture the notifier is async (SSE push), making the race window small but non-zero. As the architecture evolves (e.g., if an in-process event bus is used), this ordering guarantee will silently break, causing confirmed tool calls to time out and appear denied. This is a correctness bug with a security dimension (a "confirmed" action read from the DB is not executed even though the user approved it).
- **Recommendation:** Register the waiter in `ConfirmationRegistry` **before** calling `notifier.emit`. Since `awaitResolution` returns a Promise, registering first is straightforward:
  ```typescript
  const outcomePromise = this.deps.confirmations.awaitResolution(action.id, this.deps.confirmTimeoutMs);
  this.deps.notifier.emit(ctx.chatSessionId, { ... });
  const outcome = await outcomePromise;
  ```

---

### [MEDIUM] Duplicate `summarizeAssistantToolInput` — private copy in `routes.ts` diverges from canonical

- **File:** `packages/ai/src/routes.ts:572–579`; canonical at `packages/ai/src/assistant-tools.ts:33–41`
- **Category:** Code Quality
- **Finding:** `summarizeAssistantToolInput` is defined twice: once canonically in `assistant-tools.ts` (exported) and once as a private function in `routes.ts` (not imported from the canonical location). The two implementations are functionally identical today, but the routes.ts copy is invisible to future callers and will diverge silently when the canonical is modified.
- **Evidence:**
  ```typescript
  // routes.ts:572 — local private duplicate
  function summarizeAssistantToolInput(input: Record<string, unknown>): Record<string, unknown> {
    const inputKeys = Object.keys(input).sort();
    return { inputKeys, inputKeyCount: inputKeys.length };
  }

  // assistant-tools.ts:33 — canonical export already imported by gateway.ts
  export function summarizeAssistantToolInput(...) { ... }
  ```
  `routes.ts` also imports `findAssistantToolFromManifests` and `listAssistantToolsFromManifests` from `./assistant-tools.js` (lines 39–41) but does not import `summarizeAssistantToolInput` from there.
- **Impact:** If the summary format is evolved (e.g., to include value types), the routes.ts copy must be updated separately — a maintenance trap that has already fired in other modules.
- **Recommendation:** Delete the private copy in `routes.ts` and import `summarizeAssistantToolInput` from `./assistant-tools.js`.

---

### [MEDIUM] Stale error-handling branch — `"Workspace context is unavailable"` references a permanently removed concept

- **File:** `packages/ai/src/routes.ts:777–779`
- **Category:** Code Quality / Architecture
- **Finding:** The `handleRouteError` function contains a branch that maps the error message `"Workspace context is unavailable"` to a 403 response. According to CLAUDE.md, `workspaceId` was permanently removed from `AccessContext` in Slice 1f, and `AccessContext` now only carries `{ actorUserId, requestId }`. No remaining code in the `packages/ai` module sets up or requires workspace context, so this error string can no longer be thrown from within the module's data path.
- **Evidence:**
  ```typescript
  if (error.message === "Workspace context is unavailable") {
    return reply.code(403).send({ error: error.message });
  }
  ```
- **Impact:** Dead code that obscures the real error surface. Preserving dead branches conflicts with the "no stale concepts" standard. It will confuse future maintainers about what the module's error contract actually is.
- **Recommendation:** Remove this branch. If a workspace-context error can still originate from a dependency (outside this module), add a comment tracing where — otherwise delete cleanly.

---

### [MEDIUM] Tool input validation is structurally shallow — nested objects and arrays bypass type checks

- **File:** `packages/ai/src/gateway/input-validation.ts:23–51`
- **Category:** Security / Code Quality
- **Finding:** `validateToolInput` only type-checks top-level scalar properties declared in `schema.properties`. Nested object properties, array items, and any property whose `type` is `"object"` or `"array"` receive no structural validation. An attacker (or a misbehaving AI agent) can inject unexpected shapes into nested fields that module `execute` handlers consume without further validation.
- **Evidence:**
  ```typescript
  const check = JSON_TYPE_OF[declared.type];
  if (check && !check(value[key])) {
    throw new ToolInputValidationError(`Field ${key} must be a ${declared.type}`);
  }
  // No recursion into object/array — nested structure is unchecked
  ```
  The file explicitly documents this limitation ("Deliberately minimal, dependency-free structural validation (required keys + declared scalar/object/array types)"). The doc comment says this is "sufficient for Phase 2 + the fixture" but does not define a graduation criterion or a tracking issue.
- **Impact:** If any registered tool declares a complex `inputSchema` with nested required fields, a malicious or confused AI client can omit nested required properties. Module `execute` handlers that destructure these fields with TypeScript non-null assumptions will throw or behave unexpectedly. The comment acknowledges this is a known limitation but provides no migration path.
- **Recommendation:** File a tracking issue (or reference the existing one) for replacing the ad-hoc validator with a proper JSON Schema library (e.g., `ajv` or `zod`). Add the issue reference to the comment. Until then, module `execute` handlers must defensively validate their own nested inputs.

---

### [MEDIUM] `credentialPayload` accepts an empty object `{}` — encrypts a zero-material secret

- **File:** `packages/ai/src/routes.ts:129–130`
- **Category:** Security
- **Finding:** When `authMethod` is `"api_key"` and the caller provides `credentialPayload: {}`, the route silently encrypts an empty JSON object (`{}`) as the credential. There is no minimum-content check. A user can create an "active" API-key provider with no actual key, then the system will attempt to call that provider with an empty decrypted payload.
- **Evidence:**
  ```typescript
  const encryptedCredential =
    authMethod === "cli"
      ? secretCipher.encryptJson({ cli: true })
      : secretCipher.encryptJson(body.credentialPayload ?? {});
  ```
  `body.credentialPayload` is guaranteed non-undefined at this point (enforced earlier at line 445), but it can be `{}`.
- **Impact:** No immediate secret escape, but it creates a persistently broken provider config that will cause runtime failures when the worker decrypts the credential and finds no usable key. The error will surface late (at inference time, not at creation time), making debugging harder.
- **Recommendation:** Add a minimum-content check for `api_key` auth method: verify `credentialPayload` is non-empty and contains at least one key. Example: `if (authMethod === "api_key" && Object.keys(body.credentialPayload).length === 0) throw new HttpError(400, "credentialPayload must not be empty for api_key auth method")`.

---

### [MEDIUM] `max_tokens: 8192` hardcoded for Anthropic — not configurable per-model or per-request

- **File:** `packages/ai/src/adapters/http-api.ts:79`
- **Category:** Architecture / Code Quality
- **Finding:** The Anthropic request body hardcodes `max_tokens: 8192`. This value is not passed from the caller (`GenerateChatInput`) and is not a configurable property. Different Anthropic models have different maximum context windows, and different features require different token budgets. Hardcoding a single value for all Anthropic models violates the provider-agnostic design intent.
- **Evidence:**
  ```typescript
  body: {
    model: modelId,
    max_tokens: 8192,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content }))
  }
  ```
  The OpenAI-compatible and Google branches have no corresponding hardcoded limits.
- **Impact:** Calls to models with lower maximum output tokens (e.g., older Claude models) will fail with a 400 from the Anthropic API. Calls that legitimately need more tokens will be truncated silently. This will cause confusion when features require longer outputs.
- **Recommendation:** Add `maxTokens?: number` to `GenerateChatInput` and pass it through. Fall back to a safe default (e.g., 4096) only if not specified. Alternatively, make `max_tokens` a required field of the configured model metadata.

---

### [LOW] `resolveAssistantAction` in `gateway.ts` constructs a raw `AccessContext` without `requestId` from the incoming session

- **File:** `packages/ai/src/gateway/gateway.ts:78`
- **Category:** Architecture
- **Finding:** The `resolveActionRequest` public method constructs a fresh `AccessContext` with `requestId: \`mcp_${randomUUID()}\`` rather than using a request ID from the caller. Since `resolveActionRequest` is called from the HTTP route layer (the approve/deny endpoint), the request ID it uses for DB scoping is unrelated to the HTTP request that triggered the resolution, making audit trails harder to correlate.
- **Evidence:**
  ```typescript
  const access: AccessContext = { actorUserId, requestId: `mcp_${randomUUID()}` };
  ```
  The HTTP route that calls this should pass its own `requestId`.
- **Impact:** Low — no security impact, but audit logs cannot correlate the DB operation with the HTTP request that authorized it.
- **Recommendation:** Accept an optional `requestId` parameter in `resolveActionRequest` and thread it through from the calling HTTP handler.

---

### [LOW] `routes.ts` invokes assistant tools with `chatSessionId: ""` — hollow context for tool execution

- **File:** `packages/ai/src/routes.ts:421`
- **Category:** Architecture
- **Finding:** When the HTTP route handler (`POST /api/ai/assistant-tools/:name/invoke`) executes a read-only tool directly (i.e., bypassing the gateway for `risk === "read"`), it constructs a `ToolContext` with `chatSessionId: ""`. This is a placeholder that will break any tool that uses `chatSessionId` for its own session-scoped logic.
- **Evidence:**
  ```typescript
  .then((r) => r.data ?? {})
  }, {
    actorUserId: accessContext.actorUserId,
    requestId: accessContext.requestId ?? "",
    chatSessionId: ""    // ← hollow
  })
  ```
- **Impact:** Low today, because current read-only tools do not use `chatSessionId`. If a tool is added that uses `chatSessionId` for session-scoped state, the HTTP route invocation path will silently use the wrong session ID.
- **Recommendation:** Either pass a real `chatSessionId` (from a session header or query param), or explicitly document and enforce that tools invoked via this HTTP path must not consume `chatSessionId`. Consider using a sentinel value such as `"direct-invoke"` instead of `""` to make the intent explicit.

---

### [LOW] `requestId` field on `AccessContext` constructed with `?? ""` fallback — masks missing request ID

- **File:** `packages/ai/src/routes.ts:419`
- **Category:** Architecture / TypeScript
- **Finding:** `accessContext.requestId ?? ""` is used when building the `ToolContext`. If `requestId` is undefined, the tool context will carry an empty string, which silently degrades audit traceability.
- **Evidence:**
  ```typescript
  requestId: accessContext.requestId ?? "",
  ```
- **Impact:** Low — but if `requestId` is expected to be a valid non-empty ID (which it is, per `AccessContext` shape), the fallback masks a contract violation.
- **Recommendation:** Assert `requestId` is present or make the field non-optional in `AccessContext`. The empty-string fallback is a latent bug magnet.

---

### [LOW] `selectProviderWithCredential` uses a type cast instead of a typed query — unsafe return type

- **File:** `packages/ai/src/repository.ts:308`
- **Category:** TypeScript
- **Finding:** `selectProviderWithCredential` ends with `as Promise<... | undefined>` because Kysely infers the wrong return type when `"encrypted_credential"` is added to the select list alongside the `sql<boolean>` expression for `has_credential`. The cast suppresses the type mismatch rather than resolving it structurally.
- **Evidence:**
  ```typescript
  .executeTakeFirst() as Promise<
    (AiProviderConfigSafeRow & { readonly encrypted_credential: EncryptedAiSecret }) | undefined
  >;
  ```
- **Impact:** Low — the cast is justified (the query is correct), but it means TypeScript cannot catch future select-list changes that would cause the actual shape to diverge from the cast type.
- **Recommendation:** Use Kysely's `$castTo<>()` or restructure the query to let Kysely infer the correct type. Alternatively, add a comment explaining exactly why the cast is necessary and what invariant it relies on.

---

### [LOW] `optionalProviderStatus` uses `as never` cast to work around a TypeScript set-has limitation

- **File:** `packages/ai/src/routes.ts:704`
- **Category:** TypeScript
- **Finding:** `WRITABLE_PROVIDER_STATUSES.has(value as never)` uses `as never` to coerce the string into the set's element type. This is a legitimate workaround for a TypeScript limitation with `Set<Exclude<...>>`, but it's undocumented.
- **Evidence:**
  ```typescript
  if (typeof value === "string" && WRITABLE_PROVIDER_STATUSES.has(value as never)) {
  ```
- **Impact:** None at runtime, but `as never` is a smell that will confuse future maintainers and could mask a future real type error if the set type is changed.
- **Recommendation:** Use `WRITABLE_PROVIDER_STATUSES.has(value as Exclude<AiProviderStatus, "revoked">)` which is semantically explicit, or restructure with an explicit string membership check.

---

### [LOW] No token usage tracking per user — token budget transparency and overflow risk unaddressed

- **File:** `packages/ai/src/adapters/http-api.ts` (all three provider branches)
- **Category:** Architecture
- **Finding:** The `HttpApiAdapter` returns only `{ text: string }` from `generateChat`, discarding the token usage data that all three providers include in their response bodies (Anthropic: `usage.input_tokens`/`usage.output_tokens`; OpenAI: `usage.prompt_tokens`/`usage.completion_tokens`; Google: `usageMetadata.promptTokenCount`/`candidatesTokenCount`). No token counting is persisted or surfaced.
- **Evidence:**
  ```typescript
  async generateChat(input: GenerateChatInput): Promise<{ readonly text: string }> { ... }
  // return value discards all usage metadata
  ```
- **Impact:** Cannot implement per-user spend reporting, rate-limit enforcement, or budget alerts. As AI usage grows, this absence will become a blocker for cost governance.
- **Recommendation:** Extend the return type to `{ readonly text: string; readonly usage?: { inputTokens: number; outputTokens: number } }` and populate it from each provider's response. This is additive and non-breaking.

---

### [LOW] `resolveActionRequest` in gateway is not tested for the cross-user guard path

- **File:** `packages/ai/src/gateway/gateway.ts:73–86`; test at `tests/integration/ai-tools.test.ts`
- **Category:** Tests
- **Finding:** The comment at line 82 ("Without this guard a logged-in user could unblock another user's tool call via a guessed ID") documents a critical security invariant. The integration test covers the READ path (User B cannot see User A's action records), but does not test whether User B calling `resolveActionRequest` with User A's `actionRequestId` (which they obtained by guessing or via an info-leak) is correctly rejected by the DB-layer RLS UPDATE policy.
- **Evidence:**
  The test at `tests/integration/ai-tools.test.ts:337` tests listing isolation, but does not attempt to call the `POST /api/ai/assistant-actions/:id/resolve` endpoint as a different user than the owner.
- **Impact:** The RLS UPDATE policy (`owner_user_id = app.current_actor_user_id()`) should enforce this, but the integration test does not cover it. An untested invariant is a latent risk.
- **Recommendation:** Add an integration test: User A creates a pending action; User B attempts to resolve it via the API; assert 404 (not found, because RLS hides it from User B).

---

### [LOW] No integration test covers the `available: false` capability-route response

- **File:** `tests/integration/ai.test.ts`
- **Category:** Tests
- **Finding:** The integration test for `GET /api/ai/capability-route/:capability` only verifies the "happy path" (active model found, `available: true`). There is no test for the case where no active model is configured for the capability (e.g., all models are disabled or the capability is not declared).
- **Evidence:**
  The test at `tests/integration/ai.test.ts:313` asserts `available: true` and `reason: "matched-active-model"` but never asserts `available: false` and `reason: "no-active-model"`.
- **Impact:** If the `no-active-model` branch has a regression (e.g., it throws instead of returning `available: false`), the integration gate will not catch it.
- **Recommendation:** Add a test that requests a capability for which no active model exists and asserts `{ available: false, reason: "no-active-model", model: null }`.

---

### [INFO] Confirmation registry — orphaned waiters on server restart are accepted cost, but undocumented timeout behavior

- **File:** `packages/ai/src/gateway/confirmation-registry.ts`
- **Category:** Architecture
- **Finding:** The comment correctly acknowledges that a server restart mid-wait orphans the pending call. However, the timeout branch does not update the DB row's `status` to `"cancelled"` — it remains `"pending"` in the database indefinitely after the server-side waiter times out. The UI could show a permanently pending action that will never be resolved.
- **Evidence:**
  ```typescript
  // On timeout: resolve("timeout") → caller returns { ok: false, denied: true }
  // DB row status remains "pending" — no cleanup call
  ```
- **Impact:** Low for Phase 2 (the UI shows the pending action; users can manually cancel it). High if the drawer accumulates stale "pending" records that the server will never resolve.
- **Recommendation:** On timeout, call `repository.resolveAssistantAction(... { status: "cancelled" })` to move the DB row to a terminal state. This is a small addition to the timeout handler in `confirmAndRun`.

---

### [INFO] `manifest.ts` migrations array lists 3 of 5 SQL files — relies on directory scan for correctness

- **File:** `packages/ai/src/manifest.ts:43–46`
- **Category:** Architecture
- **Finding:** The `database.migrations` array in the manifest lists only `"sql/0013_ai_module.sql"`, `"sql/0016_ai_assistant_actions.sql"`, and `"sql/0033_ai_auth_method.sql"`. Migrations `0023_ai_action_requests_owner_only.sql` and `0037_ai_worker_read_grants.sql` are NOT listed here. These are applied because the migration runner uses `migrationDirectories: ["packages/ai/sql"]` (directory scan), not the manifest's `migrations` array.
- **Evidence:**
  Confirmed via `grep -rn "0023\|0037" packages/ai/` — only present in the `sql/` directory, not in the manifest's `migrations` array.
- **Impact:** The `database.migrations` array in the manifest is incomplete and potentially misleading to maintainers inspecting what migrations this module owns. The actual migration set is governed by directory scan.
- **Recommendation:** Either keep the manifest array up-to-date with all owned migration files (treating it as documentation), or remove the `migrations` array entirely and rely solely on `migrationDirectories`. Mixed use (partial array + directory scan) is ambiguous.

---

### [INFO] `routes.ts` is 790 lines — approaching the 1000-line enforcement limit

- **File:** `packages/ai/src/routes.ts`
- **Category:** Code Quality
- **Finding:** At 790 lines, `routes.ts` is 79% of the 1000-line limit enforced by `pnpm check:file-size`. Adding the capability-route, assistant-actions, and assistant-tools routes (all currently in this file) makes it likely that the next feature addition will push it over the limit.
- **Evidence:** `wc -l packages/ai/src/routes.ts` → 790 lines.
- **Impact:** Not a blocker today, but the file is at risk of triggering a build failure at the next feature increment.
- **Recommendation:** Proactively extract the route registration functions for the three logical subsystems into separate files: `routes/providers.ts`, `routes/models.ts`, `routes/assistant-tools.ts`. The shared helpers (`handleRouteError`, `serializeProvider`, etc.) move to a `routes/helpers.ts` or inline into each subsystem file.

---

## Dimension Summary

| Dimension | Status | Notes |
|---|---|---|
| **Capability router** | PASS | Always reads from user's configured models via RLS-scoped `selectModelForCapability`. No hardcoded models. |
| **Provider abstraction** | PASS | `ChatProviderAdapter` interface correctly abstracts all three providers behind `generateChat`. |
| **Embedding provider** | N/A | No embedding code in `packages/ai`. Embeddings live in `@jarv1s/db` and the chat module. |
| **AI credentials at rest** | PASS | AES-256-GCM with keyring rotation via `AiSecretCipher`. Never returned to frontend. |
| **Credentials in job payloads** | PASS | No pg-boss payloads in this module. Worker reads encrypted credential directly from DB. |
| **Token counting** | GAP | Usage metadata discarded in `HttpApiAdapter`. No per-user token tracking. (LOW) |
| **Streaming safety** | N/A | No streaming implemented. Transcript polling is file-based and session-isolated. |
| **Prompt construction / sandboxing** | PASS | Messages passed directly from caller; no system-level prompt injection at this layer. |
| **RLS coverage** | PASS | All three tables: ENABLE + FORCE RLS, owner-only policies, grants minimal. |
| **DataContextDb adherence** | PASS | `assertDataContextDb` called at top of every repository method. |
| **AccessContext shape** | PASS | Only `{ actorUserId, requestId }` used. No `workspaceId`. |
| **Module isolation** | PASS | No cross-module table queries. Public API / tool invocation only. |
| **pgvector image** | N/A | Not referenced in this module. |
| **Migration integrity** | PASS | No edits to applied migrations. All SQL in `packages/ai/sql/`. |
