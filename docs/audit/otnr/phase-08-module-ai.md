## Phase 8 — Module ai

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 5
- LOW: 5
- INFO: 3

### Findings

#### [HIGH] HTTP REST route bypasses the gateway's per-user identity token and confirmation timeout — duplicate, weaker execution path for write/destructive tools
**File:** `packages/ai/src/routes.ts:353-438`  
**Invariant violated / concern:** Quality smell — two divergent code paths for the same security-critical operation (tool dispatch); risk of policy drift. Adjacent to Hard Invariant "Private by default" / module-isolation enforcement.  
**Detail:** The repo has a single canonical chokepoint for invoking module tools — `AssistantToolGateway.callTool` (`gateway/gateway.ts:50`) — which (a) derives identity ONLY from a minted per-session token (`tokens.verify`), (b) validates input against the tool's `inputSchema` via `validateToolInput`, (c) blocks write/destructive tools on a real human confirmation with a timeout, and (d) scrubs handler errors so internals never leak. The REST endpoint `POST /api/ai/assistant-tools/:name/invoke` reimplements a *parallel, weaker* version of the same flow: it does NOT run `validateToolInput` (any JSON object is forwarded to `manifestTool.execute`), it returns a `403 confirmation_required` and persists a pending action but never actually awaits/enforces a confirmation before the read-path executes, and it constructs `ToolContext` with `chatSessionId: ""` and `requestId: accessContext.requestId ?? ""`. Two execution surfaces for the same destructive-tool dispatch is exactly the kind of special-case sprawl that lets one path fall behind the other on a future policy change. The gateway already exists and is the declared canonical path.  
**Suggested fix:** Route the REST invoke endpoint through `AssistantToolGateway` (or delete the REST execute path entirely if the gateway/MCP path is the supported surface), so input validation, the confirmation bridge, and error scrubbing are enforced in exactly one place. At minimum, run `validateToolInput` on the REST path before any `execute`.

#### [MED] Dead/unreachable provider-call machinery: HttpApiAdapter, selectProviderWithCredential, AiSecretCipher.decryptJson have no production consumer
**File:** `packages/ai/src/adapters/http-api.ts:28`, `packages/ai/src/repository.ts:283`, `packages/ai/src/crypto.ts:34`  
**Invariant violated / concern:** Quality rule — dead code / thin-seam abstraction kept "for the future"; thermo-nuclear mandate to delete complexity rather than preserve it.  
**Detail:** A repo-wide search shows `HttpApiAdapter`, `AiRepository.selectProviderWithCredential`, and `AiSecretCipher.decryptJson` are referenced only within `packages/ai` itself and by tests — no `apps/worker`, `apps/api`, or `packages/chat` production code imports them. The live chat runtime (`packages/chat/src/live/runtime.ts`) uses the CLI/tmux bridge, never the HTTP adapter, and never decrypts a stored credential. Migration `sql/0037_ai_worker_read_grants.sql` grants the worker SELECT on the credential tables citing `packages/chat/src/jobs.ts -> selectProviderWithCredential`, but no such call exists in `jobs.ts`. So an entire encrypt-store-decrypt-then-HTTP-call pathway plus a worker DB grant to read encrypted credentials is carried with no live caller. `index.ts:1-3` even annotates HttpApiAdapter "do not remove as dead code." This is incidental complexity and an unnecessary credential-read grant surface.  
**Suggested fix:** Either wire the HTTP adapter + `selectProviderWithCredential` into the real worker job path now, or remove them (and the orphaned worker SELECT grant in 0037) until the API-key transport is actually built. Decide one canonical transport; do not carry two half-built ones.

#### [MED] REST invoke endpoint constructs a malformed ToolContext (empty chatSessionId, coerced requestId) and casts away the risk type
**File:** `packages/ai/src/routes.ts:372-423`  
**Invariant violated / concern:** Quality rule — cast-heavy contract obscuring the real invariant; AccessContext/ToolContext shape integrity.  
**Detail:** Line 373 casts `tool` to `AiAssistantToolDto & { risk: "write" | "destructive" }` purely to satisfy types, and line 417-422 invokes the handler with `{ actorUserId, requestId: accessContext.requestId ?? "", chatSessionId: "" }`. An empty-string `chatSessionId`/`requestId` is a fake value smuggled through a typed contract — any handler or downstream telemetry that keys on those fields silently gets junk. The gateway path (`gateway.ts:52`) builds a proper `ToolContext` with a real `requestId` (`mcp_${randomUUID()}`). The REST path also uses a non-null assertion (`manifestTool.execute!`) on line 418 after already null-checking, doubling the type noise.  
**Suggested fix:** Collapse this onto the gateway (see HIGH finding). If kept, generate a real requestId instead of `?? ""`, and model "this DTO is a write/destructive tool" with a type guard rather than an inline cast.

#### [MED] Capability route is non-deterministic / has no user-selectable default — "the router selects the user's configured model" is reduced to newest-created wins
**File:** `packages/ai/src/repository.ts:264-277`  
**Invariant violated / concern:** Hard Invariant 7 (Provider-agnostic AI — "the router selects the user's configured model"); concern is that selection is implicit, not user-configured.  
**Detail:** `selectModelForCapability` picks among all the user's active models that declare the capability by `ORDER BY created_at DESC, id DESC LIMIT 1`. There is no `is_default` / priority column and no per-capability preference. So which model answers "chat" is whichever the user happened to create last — re-creating a model silently changes routing, and the user cannot deterministically pin a preferred model per capability. This satisfies "not hardcoded" but not "the user's configured model" in a meaningful sense.  
**Suggested fix:** Add an explicit per-user, per-capability default/priority (column or join table) and order by it; fall back to recency only as a tiebreaker. Document the selection contract.

#### [MED] routes.ts handles errors by string-matching exception messages — brittle coupling to phrasing across package boundaries
**File:** `packages/ai/src/routes.ts:765-790`  
**Invariant violated / concern:** Quality rule — incidental complexity / brittle special-casing; error handling smell.  
**Detail:** `handleRouteError` branches on `error.message === "Session is missing or expired"`, `=== "Invalid bearer token"`, `=== "Workspace context is unavailable"`, and `error.message.includes("violates row-level security policy")`. These are stringly-typed contracts: the auth/db layers can rename a message and silently turn a 401/403 into an unhandled 500. The `"Workspace context is unavailable"` branch is also stale vocabulary — workspace was removed in Slice 1f (AccessContext is `{ actorUserId, requestId }` only), so this branch is dead. Postgres RLS denials surface as zero rows under FORCE RLS, not as a "violates row-level security policy" message on SELECT, so that arm rarely fires as intended.  
**Suggested fix:** Have the auth/db layers throw typed errors (e.g. a shared `UnauthorizedError`/`ForbiddenError` class) and switch on `instanceof`. Delete the dead `"Workspace context is unavailable"` branch.

#### [MED] tmux-bridge.ts is misnamed and its comments reference a TmuxBridgeAdapter that does not exist in the file
**File:** `packages/ai/src/adapters/tmux-bridge.ts:24-28`  
**Invariant violated / concern:** Quality rule — stale concept / misleading abstraction naming (no-stale-concepts).  
**Detail:** The file is named `tmux-bridge.ts` and its JSDoc says "used by both TmuxBridgeAdapter (one-shot turns) and the live persistent-session engine," but the file contains only `createRealTmuxIo` (a generic exec/fs IO shim) and `transcriptGlobDir`. There is no `TmuxBridgeAdapter` here. Nothing in the IO shim is tmux-specific — it runs `execFile` and reads/writes files. The naming misleads a reader into thinking this is tmux-coupled transport when it is a generic process/FS port plus a transcript-path resolver.  
**Suggested fix:** Rename to something accurate (e.g. `process-io.ts` / `transcript-paths.ts`) and split the unrelated `transcriptGlobDir` out, or update the comment to match reality and drop the dangling `TmuxBridgeAdapter` reference.

#### [LOW] Gemini provider sends the API key as a URL query parameter, where it can land in proxy/access logs
**File:** `packages/ai/src/adapters/http-api.ts:100`  
**Invariant violated / concern:** Hard Invariant 5 (Secrets never escape — never reach logs).  
**Detail:** For `google`, the key is placed in the URL: `...:generateContent?key=${this.apiKey}`. Even though the adapter scrubs the key from its own error messages (line 53), a key in a request URL is routinely captured by intermediary proxies, server access logs, and crash/telemetry that record full URLs — a different leak channel than the response body. (Currently mitigated only because the whole adapter is dead code — see the MED dead-code finding.)  
**Suggested fix:** Send the Gemini key via the `x-goog-api-key` header instead of the query string when this adapter goes live.

#### [LOW] input_summary in the action-request table records sorted user-supplied input KEY NAMES verbatim
**File:** `packages/ai/src/assistant-tools.ts:33-42`, `packages/ai/src/routes.ts:572-579`  
**Invariant violated / concern:** Hard Invariant 5/6 (private content must not land in persisted metadata) — borderline.  
**Detail:** `summarizeAssistantToolInput` deliberately drops values and keeps only `Object.keys(input)` plus a count, which is the right instinct. But for free-form tool inputs a *key name* can itself be private content (e.g. a tool whose input is keyed by an email subject, a person's name, or a free-text field used as a map key). Persisting raw key names to `ai_assistant_action_requests.input_summary` and rendering them in the Approve/Deny card is a small content-leak surface that the "metadata-only" framing implies it avoids.  
**Suggested fix:** Confirm tool input schemas only ever use fixed, non-sensitive property names, or whitelist key names against the declared `inputSchema.properties` before persisting, so unexpected dynamic keys are not stored.

#### [LOW] validateToolInput is a hand-rolled partial JSON-Schema validator that silently ignores nested/array-item/enum/format constraints
**File:** `packages/ai/src/gateway/input-validation.ts:23-51`  
**Invariant violated / concern:** Quality rule — bespoke helper duplicating a canonical capability (a JSON-schema validator), with an unsound contract.  
**Detail:** The validator checks only top-level required keys and top-level scalar/object/array `type`. It ignores nested object properties, array `items`, `enum`, `minLength`, `pattern`, `additionalProperties`, etc. The doc comment is honest about this ("deliberately minimal … a full JSON-schema validator can replace this"), but the gateway is the security chokepoint, so "validated" here overstates the guarantee a module author may rely on. The REST path doesn't even call it (see MED finding).  
**Suggested fix:** When real modules ship non-trivial schemas, swap in a real JSON-schema validator (ajv) rather than growing this by hand; until then, tighten the comment/JSDoc so callers don't over-trust it.

#### [LOW] AiAssistantActionRequestSafeRow is a type alias to AiAssistantActionRequest — an identity "safe row" abstraction that guarantees nothing
**File:** `packages/ai/src/repository.ts:51`  
**Invariant violated / concern:** Quality rule — identity abstraction / thin wrapper that implies a safety property it does not enforce.  
**Detail:** `AiProviderConfigSafeRow` and `AiConfiguredModelSafeRow` earn the "Safe" name because their queries deliberately omit `encrypted_credential` (the `safeProviderQuery` selects `encrypted_credential IS NOT NULL AS has_credential` instead of the column). But `AiAssistantActionRequestSafeRow = AiAssistantActionRequest` is a 1:1 alias and `safeAssistantActionQuery` uses `.selectAll()`. The "Safe" suffix here implies a column-filtering guarantee that does not exist (it happens to be fine because that table has no secret columns). The naming pattern invites a future maintainer to add a secret column to that table and trust the "Safe" alias.  
**Suggested fix:** Drop the alias and use `AiAssistantActionRequest` directly, or add a comment that this table has no sensitive columns so `.selectAll()` is intentional.

#### [LOW] cli-availability defines its own ProviderKind, duplicated against transcript-reader's identical union
**File:** `packages/ai/src/cli-availability.ts:6`, `packages/ai/src/adapters/transcript-reader.ts:64`  
**Invariant violated / concern:** Quality rule — duplicate type definition; routes.ts then imports BOTH under aliases.  
**Detail:** `ProviderKind = "anthropic" | "openai-compatible" | "google"` is declared independently in both `cli-availability.ts` and `transcript-reader.ts`. `routes.ts:42` imports the cli one as `CliProviderKind` while the package also exports the transcript one as `ProviderKind` (`index.ts:13`), so there are two structurally-identical types floating in the public surface. This is a maintenance trap if the CLI-capable provider set ever diverges from the broader `AiProviderKind` enum.  
**Suggested fix:** Define the CLI-capable provider union once (it is a subset of the shared `AiProviderKind`) and import it in both places.

#### [INFO] RLS posture for ai tables reviewed — owner-only, FORCE RLS, no BYPASSRLS, identity-change triggers present (clean)
**File:** `packages/ai/sql/0013_ai_module.sql:147-220`, `packages/ai/sql/0016_ai_assistant_actions.sql:101-141`  
**Invariant violated / concern:** Hard Invariants 1 & 2 (RLS for all actors; private by default) — verified clean.  
**Detail:** All three tables `ENABLE`+`FORCE ROW LEVEL SECURITY`, policies are strictly `owner_user_id = app.current_actor_user_id()` for SELECT/INSERT/UPDATE with `current_actor_user_id() IS NOT NULL` guards, no DELETE grant (cascade-only), no `app.has_share` arm (correctly, since these hold/relate to credentials), and BEFORE-UPDATE triggers prevent owner/identity/created_at/resolved-state tampering. The worker (`0037`) gets SELECT-only and is added to the SELECT policy verbatim. `resolveAssistantAction` additionally guards `WHERE status = 'pending'` and the gateway only unblocks the waiter if the row actually updated (`gateway.ts:82-85`), closing the cross-user unblock-by-guessed-id hole. Repos consistently call `assertDataContextDb` and accept only `DataContextDb`. This is a solid least-privilege design.

#### [INFO] Crypto envelope and capability SQL interpolation reviewed — AES-256-GCM, keyring rotation, parameterized capability (clean)
**File:** `packages/ai/src/crypto.ts:17-79`, `packages/ai/src/repository.ts:273`  
**Invariant violated / concern:** Hard Invariant 5 (AES-256-GCM at rest) and SQL-injection — verified clean.  
**Detail:** `encryptJson` uses AES-256-GCM with a random 12-byte IV per call, stamps `keyId`, and stores auth tag — correct GCM usage. `decryptJson` handles legacy (absent-keyId) envelopes by trying candidate keys and rejecting on auth-tag failure (rotation-safe). The `keys.get(currentKeyId)!` non-null assertion on line 18 is sound because `resolveKeyring` (`packages/db/src/keyring.ts:38`) always `keys.set(currentKeyId, ...)`. The capability filter `sql\`${capability} = any(${sql.ref(...)})\`` interpolates `capability` as a bound parameter (kysely `sql` tag), and `capability` is enum-validated upstream — no injection.  
**Suggested fix:** None.

#### [INFO] No pg-boss payload construction, no AI prompt assembly, and no token accounting live in packages/ai — reviewed and out of module
**File:** `packages/ai/src/` (whole module)  
**Invariant violated / concern:** Hard Invariant 6 (metadata-only job payloads); per-user token accounting; user-content delimiting — scope note.  
**Detail:** The `ai` module enqueues no pg-boss jobs and assembles no provider prompt in any live path (the only prompt builder, `HttpApiAdapter.buildRequest`, is dead code and passes message content directly with no system/user delimiter — flagged under the dead-code MED). Prompt composition, user-content delimiting, the CLI engine, and any token accounting live in `packages/chat/src/live/*` (Phase 7 scope). There is no per-user token accounting anywhere in `packages/ai`. Those concerns should be confirmed in the chat phase; within this module there is nothing to audit on F (payloads) beyond noting the absence.
