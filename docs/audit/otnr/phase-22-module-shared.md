## Phase 22 — Module shared

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 4
- LOW: 5
- INFO: 2

### Findings

#### [MED] Chat message/activity DTOs have no response or route schema — boundary stripping not enforced
**File:** `packages/shared/src/chat-api.ts:34-59`  
**Invariant violated / concern:** Secrets-never-escape / precise API contracts — `additionalProperties: false` response-schema stripping (used everywhere else in the package) is the boundary that guarantees server-only fields cannot leak. `ChatMessageDto`, `ChatActivityEventDto`, `ChatModelRouteMetadataDto`, `ChatSelectedToolMetadataDto`, `AppendChatUserMessageRequest`, and `CreateChatThreadRequest` are declared as TypeScript types only; the file exports a route schema for `listChatThreads` alone (`packages/shared/src/chat-api.ts:92`). The chat module consumes only `listChatThreadsRouteSchema` (`packages/chat/src/routes.ts:5,142`).  
**Detail:** Every other module-api file pairs each DTO with a `*Schema` object that drives Fastify response serialization (`additionalProperties: false`), so unexpected/server-only properties are dropped at the wire. The chat message DTOs — which carry private `body` content, `modelRoute`, and tool metadata — have no such schema. Whatever object the message/append/list-messages routes return is serialized verbatim. This makes accidental field leakage (e.g. an internal field spreading from a row) silent rather than schema-blocked, and leaves the request bodies (`AppendChatUserMessageRequest`, `CreateChatThreadRequest`) without input validation schemas in the contract package. It is also an internal inconsistency: the contract advertises types the routes cannot validate or serialize against.  
**Suggested fix:** Add `chatMessageDtoSchema`, `chatActivityEventSchema`, `chatThreadSchema` (already present)-style response schemas plus `appendChatUserMessageRequestSchema` / `createChatThreadRequestSchema`, and corresponding `*RouteSchema` objects, mirroring the other api files; wire them into the chat routes so message bodies are serialized through `additionalProperties: false`.

#### [MED] Open `additionalProperties: true` subtrees in response schemas bypass field stripping
**File:** `packages/shared/src/platform-api.ts:319,331` (also `briefings-api.ts:142,171`; `ai-api.ts:438,408`; `notifications-api.ts:60`; `calendar-api.ts:71`; `email-api.ts:71`)  
**Invariant violated / concern:** Secrets-never-escape (defense in depth) — `additionalProperties: false` is what prevents server-only fields from reaching frontend responses, but every `Record<string, unknown>` field (`metadata`, `value`, `sourceMetadata`, `scheduleMetadata`, `inputSummary`, `result`, `externalMetadata`) is schema'd as `{ type: "object", additionalProperties: true }`. Inside those subtrees the serializer passes through whatever keys the server places there, unfiltered.  
**Detail:** These are legitimately open JSON bags, so this is not a confirmed leak — but it is a real defense-in-depth gap. `AdminAuditEventDto.metadata`, `InstanceSettingDto.value`, `BriefingRunDto.sourceMetadata`, and `AiAssistantActionDto.inputSummary`/`AiAssistantToolInvocationDto.result` are exactly the places where private content or a stray secret could be parked by an upstream module, and the shared contract provides zero structural backstop. The shared package cannot fully constrain these, but the contract could at minimum document the metadata-only / no-secrets expectation so producing modules don't treat the open bag as a safe dumping ground.  
**Suggested fix:** Where the value space is known (e.g. audit-event metadata, briefing source metadata), tighten to a constrained schema; where it must stay open, add an explicit contract comment that the producer is responsible for ensuring no secrets/private content enter the bag, since the boundary will not strip it.

#### [MED] `platform-api` retains workspace contract surface that conflicts with the house/AccessContext model
**File:** `packages/shared/src/platform-api.ts:10-23,91-129,468-507`  
**Invariant violated / concern:** No-stale-concepts / AccessContext shape — `workspaceId` was permanently removed from `AccessContext` (Slice 1f) and the roadmap moved to the single-house model (ADRs 0007–0009), yet the shared contract still exports `WorkspaceDto`, `WorkspaceMembershipDto`, `MeResponse.memberships`/`workspaces`/`activeWorkspaceId`, and full create/upsert/delete workspace route schemas.  
**Detail:** This is the canonical cross-package contract; stale vocabulary here propagates into every consumer (web shell, API) and re-legitimizes a concept the architecture retired. `ModuleDto.lifecycle` still enumerates `"workspace-toggleable"` (`platform-api.ts:73`) and `ModuleSettingsSurfaceDto` excludes workspace scope but the membership/workspace routes remain first-class. Either workspaces are a live concept (in which case the memory note about `workspaceId` removal is the stale item and this is INFO) or they are dead and should be deleted in the same pass as the model change. Given the hard invariant explicitly calls out the removal as permanent, the contract carrying full workspace CRUD is a real divergence worth resolving.  
**Suggested fix:** Confirm against the current house model whether workspaces survive as an admin grouping. If retired, remove the workspace DTOs/route schemas and the `workspace-toggleable` lifecycle value; if retained, document why they coexist with a workspace-less `AccessContext` so the two stop looking contradictory.

#### [MED] Per-file duplication of shared schema fragments instead of one canonical set
**File:** `packages/shared/src/ai-api.ts:180-205` (and the identical `errorResponseSchema` in `platform-api.ts:174`, `connectors-api.ts:67`, `briefings-api.ts:78`, `chat-api.ts:61`, `calendar-api.ts:98`, `email-api.ts:98`; `jsonObjectSchema` in 4 files; `nullableStringSchema` in 4 files; `idParamsSchema` in 2 files)  
**Invariant violated / concern:** Bespoke helpers duplicating a canonical utility (DEVELOPMENT_STANDARDS) — `errorResponseSchema` is copy-pasted byte-for-byte in seven files; `jsonObjectSchema`, `nullableStringSchema`, `nullableNumberSchema`, and `idParamsSchema` are each redefined in multiple files.  
**Detail:** This is the highest-leverage code-judo move in the package: a single `packages/shared/src/schema-fragments.ts` exporting `errorResponseSchema`, `jsonObjectSchema`, `nullableJsonObjectSchema`, `nullableStringSchema`, `nullableNumberSchema`, and `idParamsSchema` would delete roughly 7 copies of the error schema plus a dozen other duplicated fragments, and guarantee the wire shapes stay identical across modules (today they can silently drift — e.g. some files use `anyOf:[{string},{null}]` for nullable strings while others use `{ type: ["string","null"] }`, see `platform-api.ts:203` vs `tasks-api.ts:105`). Because these are `as const` literals, sharing them is purely additive and behavior-preserving.  
**Suggested fix:** Extract the common fragments to one module, import them everywhere, and standardize the nullable-string/number representation while doing so.

#### [LOW] Inconsistent nullable representation across the contract (`anyOf` vs JSON-Schema type array)
**File:** `packages/shared/src/tasks-api.ts:105-111` vs `packages/shared/src/platform-api.ts:203-204`  
**Invariant violated / concern:** Precise/consistent API contract — nullable scalars are expressed two different ways: `{ anyOf: [{ type: "string" }, { type: "null" }] }` (tasks, calendar, email, notifications) and `{ type: ["string", "null"] }` (platform, ai, connectors, briefings).  
**Detail:** Both validate identically, but the split makes the contract harder to read and the duplication in the prior finding harder to deduplicate. It also means a reviewer cannot grep one canonical nullable idiom.  
**Suggested fix:** Pick one representation (the `type: [...]` form is terser) and apply it everywhere, ideally via the shared fragment module.

#### [LOW] Google connector request/response interfaces drop `readonly` and break the package convention
**File:** `packages/shared/src/connectors-api.ts:242-257`  
**Invariant violated / concern:** Structural consistency / unjustified mutability — every other DTO and request interface in the package marks all fields `readonly`; `GoogleAuthorizeRequest`, `GoogleAuthorizeResponse`, `GoogleCompleteRequest`, and `GoogleCompleteResponse` use mutable fields.  
**Detail:** This looks like a later add-on that didn't follow the file's own style. Mutable contract fields invite accidental in-place mutation of request/response objects and stand out as inconsistent.  
**Suggested fix:** Add `readonly` to all four interfaces' fields to match the rest of the file.

#### [LOW] Google route schemas omit error responses and `additionalProperties: false` on response
**File:** `packages/shared/src/connectors-api.ts:269-290`  
**Invariant violated / concern:** Precise API contract — unlike every other route schema in the package, `googleAuthorizeResponseSchema` and the google route schemas declare no error responses (no 400/401/403/404 mapped to `errorResponseSchema`) and `googleAuthorizeResponseSchema` omits `additionalProperties: false`.  
**Detail:** The OAuth authorize/complete endpoints are exactly the security-sensitive ones (they accept `clientSecret`), yet their contract is the loosest in the file. Missing `additionalProperties: false` on the response means extra fields are not stripped; missing error-status schemas means error bodies are unvalidated and inconsistent with sibling routes.  
**Suggested fix:** Add `additionalProperties: false` to `googleAuthorizeResponseSchema`/`googleCompleteResponseSchema` and map the relevant 400/401/403 responses to `errorResponseSchema`, matching the other connector routes.

#### [LOW] `taskParamsSchema` and request schemas omit `additionalProperties: false`
**File:** `packages/shared/src/tasks-api.ts:118-124,196-215,227-245`  
**Invariant violated / concern:** Boundary input validation — the tasks-api request/params schemas (`taskParamsSchema`, `createTaskRequestSchema`, `updateTaskRequestSchema`, `addTaskActivityRequestSchema`, etc.) omit `additionalProperties: false`, whereas ai-api, connectors-api, briefings-api, and platform-api request schemas all set it.  
**Detail:** Without `additionalProperties: false`, a request body with unexpected keys passes validation silently. This is a hardening gap on the write path of a private-data module (tasks), inconsistent with the rest of the package.  
**Suggested fix:** Add `additionalProperties: false` to the tasks request and params schemas to reject unknown fields, matching the other modules.

#### [LOW] `tasks-view.ts` business logic lives in the contract package
**File:** `packages/shared/src/tasks-view.ts:38-49,64-80`  
**Invariant violated / concern:** Feature logic leaked into shared infrastructure (DEVELOPMENT_STANDARDS) — `@jarv1s/shared` is otherwise pure type/JSON-schema contracts, but `tasks-view.ts` contains runtime task-prioritization logic (`quadrantOf`, `groupByPriority`, `quadrantTasks`, `byDueThenTitle`) that must stay in lockstep with the backend (`quadrantOf` comments "Mirrors backend serialize.ts getQuadrant").  
**Detail:** This is duplicated domain logic intentionally placed in shared so the web app (only consumer — `apps/web/src/tasks/*`) can reuse it. The comment admitting it mirrors backend `serialize.ts` is a maintenance hazard: the urgency threshold (48h) and importance threshold (priority>=4) now live in two places that can silently diverge. It is also the only file in the package with executable behavior and `Date.now()` time-dependence, which is awkward to unit-test from a contract package.  
**Suggested fix:** Either (a) keep it but extract the shared thresholds into named constants imported by both the backend serializer and this view helper so there is one source of truth, or (b) move it to a web-side `tasks/view-model.ts` since the web app is the sole consumer, leaving `@jarv1s/shared` as pure contracts.

#### [INFO] Browser-bundle safety: confirmed clean
**File:** `packages/shared/src/index.ts:1-14`  
**Invariant violated / concern:** Shared-browser-bundle rule (no `node:*` imports) — reviewed.  
**Detail:** Grep across `packages/shared/src` for `node:`, `require(`, `fs`, `process.`, `__dirname`, and `Buffer` returns nothing; the only cross-file import is the type-only `import type { TaskDto }` in `tasks-view.ts:1`. The package is Vite-safe. Secret-bearing request fields (`credentialPayload` in ai-api, `tokenPayload` in connectors-api, `clientSecret` in connectors-api google) are request-only and never appear in any response DTO; responses expose only `hasCredential`/`hasSecret` booleans — correct secrets posture for the contract layer.  
**Suggested fix:** None.

#### [INFO] `Record<string, unknown>` usage is appropriate, not unsafe typing
**File:** `packages/shared/src/ai-api.ts:50-51,77,89` (and metadata/value/payload fields across the package)  
**Invariant violated / concern:** Unsafe `unknown` (DEVELOPMENT_STANDARDS) — reviewed and cleared.  
**Detail:** All `unknown` occurrences are `Record<string, unknown>` modeling genuinely open JSON objects (tool input/output schemas, metadata bags, credential payloads). There are no bare `any`, no `as any`, and no non-null assertions anywhere in the package. The branded `Brand<TValue, TBrand>` helper in `index.ts:1-3` is sound. Typing is precise given the open-JSON domain.  
**Suggested fix:** None (the only related hardening is the `additionalProperties: true` defense-in-depth note above).
