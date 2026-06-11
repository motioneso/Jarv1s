## Phase 3 — AI Gateway & Tool Security

**Model:** Sonnet 4.6 (Fable 5 unavailable — org model restriction)  
**Date:** 2026-06-10  
**Scope:** `packages/ai/src/gateway/` (gateway, policy, input-validation, session-tokens, confirmation-registry, types), `packages/ai/src/routes.ts`, `packages/ai/src/assistant-tools.ts`, `packages/chat/src/mcp-transport.ts`, `packages/chat/src/routes.ts` (gateway wiring)

---

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0  
- HIGH: 0  
- MED: 1  
- LOW: 2  
- INFO: 2  

---

### Findings

#### [MED] Direct REST `/invoke` path skips `validateToolInput` — tool schema not enforced

**File:** `packages/ai/src/routes.ts:417-423`  
**Invariant violated:** All tool inputs should pass through validation before reaching dispatch.  
**Detail:**  
The MCP transport path calls `gateway.callTool(token, toolName, rawInput)`, which internally calls `validateToolInput(found.tool.inputSchema, rawInput)` before dispatch. However, the direct REST invocation path at `/api/ai/assistant-tools/:name/invoke` calls `manifestTool.execute!(scopedDb, body.input ?? {}, ...)` without calling `validateToolInput`. The only validation applied is `parseInvokeAssistantToolBody`, which accepts any JSON object as `input` without type or schema checking.

This means a direct REST caller (authenticated via session or bearer token) can pass inputs that violate the tool's declared JSON schema — wrong types, missing required fields, extra fields. Tool handlers that rely on the gateway's schema enforcement would receive unexpected input. For example, a tool that declares `{ type: "string", required: ["path"] }` and assumes `input.path` is always a string would receive `null` or an object from a direct REST call.

`validateToolInput` is a thin validator (required fields + scalar type checks, no content/format validation), but its absence on the REST path is an inconsistency that could expose handlers to type confusion.

**Suggested fix:**  
Add `validateToolInput(manifestTool.inputSchema, body.input ?? {})` before the `manifestTool.execute!` call at line 417. This also avoids the divergence in behavior between MCP and REST callers.

---

#### [LOW] Input validation is type-only — content/format not validated at the gateway layer

**File:** `packages/ai/src/gateway/input-validation.ts`  
**Concern:** Tool handlers receive values that pass type checks but may contain malicious content.  
**Detail:**  
`validateToolInput` validates:
- Object type at root level
- Required fields present
- Declared scalar/object/array type per property

It does NOT validate:
- String max length (a tool field that expects a title could receive 10 MB of text)
- String format/pattern (a `path` field could receive `../../etc/passwd`)
- Enum membership (a field with an expected set of values could receive arbitrary strings)
- Nested object schema (sub-objects pass the `"object"` type check with any contents)
- Array item types

The docstring acknowledges this: "Deliberately minimal... a full JSON-schema validator can replace this when real modules need it."

Security implications: tool handlers are responsible for sanitizing their own inputs. A tool handler that constructs a filesystem path from an unvalidated string field, or passes a string to a shell command, or uses it as a SQL parameter outside the ORM, could be exploited via the values accepted by the gateway. This is a delegation of responsibility to tool authors — correct for the current phase, but worth tracking as a gap.

**Suggested fix:**  
For the current set of built-in modules: audit each tool handler in Phase 6 to confirm no unvalidated string reaches a filesystem, shell, or SQL context. Long-term: replace the minimal validator with a full JSON Schema validator (e.g., Ajv) so tool authors can declare `maxLength`, `enum`, `pattern`, `minItems`, etc. in their input schemas and get enforcement for free.

---

#### [LOW] Two separate "resolve" endpoints with different behavior — one does not unblock the pending tool call

**Files:** `packages/ai/src/routes.ts:314`, `packages/chat/src/routes.ts:107`  
**Concern:** Design inconsistency; confused callers cannot complete a confirmation from the wrong endpoint.  
**Detail:**  
There are two HTTP endpoints for resolving an action request:

1. **`POST /api/ai/assistant-actions/:id/resolve`** (AI routes, line 314): calls `repository.resolveAssistantAction(scopedDb, id, { status })` — updates the DB row. Does NOT call `gateway.resolveActionRequest()` or `confirmations.resolve()`. The in-memory `ConfirmationRegistry` waiter is never notified.

2. **`POST /api/chat/action-requests/:id/resolve`** (Chat routes, line 107): calls `gateway.resolveActionRequest(actorUserId, id, status)` — updates the DB row AND calls `confirmations.resolve()` to unblock the pending `callTool` awaiter.

If a frontend calls endpoint (1) to confirm a tool call, the DB record is updated to "confirmed" but the MCP tool call times out. The confirmation registry's waiter then fires a `"timeout"` outcome, and the tool is NOT executed. Meanwhile, a subsequent call to endpoint (2) would find no "pending" row (already updated to "confirmed") and would also fail to unblock.

This creates a scenario where:
- The DB shows the action as "confirmed"
- The UI displays "confirmed"  
- The tool was never actually executed
- The user does not know why

From a security perspective this is actually stronger than the reverse (tools executing without proper confirmation), but from a user-trust perspective it is a silent failure that could erode confidence in the confirmation feature.

**Suggested fix:**  
Either: (a) Remove or deprecate the AI route's resolve endpoint in favor of the chat route (the live path), or (b) Have the AI route call `gateway.resolveActionRequest()` through a dependency injection path, so both endpoints go through the same confirmation + DB update flow. Document the intentional separation if kept.

---

#### [INFO] MCP session token appears in CLI process environment — belongs to Phase 4

**Concern:** Session token visible in `ps aux` / `/proc/*/environ` for same-uid processes.  
**Detail:**  
The session token (`jst_<uuid>`) is minted by `tokens.mint(identity)` and injected into the CLI subprocess via environment variable (`JARVIS_MCP_TOKEN=jst_...` in the launch environment). On Linux, this environment is visible in `/proc/<pid>/environ` to any process running as the same user, and appears in `ps auxe` or `pgrep -a` output.

Any process running as the same OS user (other terminals, a compromised NPM package in a pre-install hook, etc.) could read the token and call MCP tools as the session user until the token is revoked at engine reap.

Full analysis belongs to Phase 4 (Chat & MCP Transport). Flagged here because the session token lifecycle is managed by `SessionTokenRegistry` in the AI gateway.

---

#### [INFO] Gateway tool output is not sanitized — tool handlers own their response content

**File:** `packages/ai/src/gateway/gateway.ts:95-103`  
**Concern:** Tool response data passes through to MCP caller with no content scrubbing.  
**Detail:**  
`runHandler()` returns `{ ok: true, data: result.data }` — the raw data object from the tool handler. `gatewayResponseToMcp()` then converts this to `JSON.stringify(res.data)` in the MCP response.

If any tool handler returns data that includes secrets (e.g., a vault file containing a credential, a DB row with an unstripped column), that data propagates directly to the Claude CLI. The gateway provides no second-line redaction layer.

Tool handlers are expected to only return the data the tool is designed to return, and each is reviewed for correctness. Phase 6 should verify that no module's tool handler returns columns or fields that should not be exposed. A defense-in-depth approach would be to define allowed output shapes via `outputSchema` and strip unlisted fields at the gateway layer.

---

### What was confirmed clean

- **Token→identity enforcement:** `callTool()` calls `deps.tokens.verify(token)` at line 51 before any other operation. The MCP transport also pre-verifies the token at line 45. Identity never comes from the request body or tool input. ✓
- **No bypass path for unavailable tools:** `executableTools(actorUserId)` filters by active modules and requires an `execute` function. Tools not in the active manifest return `{ ok: false, error: "Tool not available" }`. No fallback dispatch. ✓
- **write/destructive tools always go to `confirmAndRun`:** `resolvePolicy` is a hardcoded single-expression function — `"read"` → run, everything else → confirm. No configurable override that could weaken this. ✓
- **Confirmation ownership guard:** `resolveActionRequest` only calls `confirmations.resolve` if `repository.resolveAssistantAction` returns a non-null row (meaning the DB UPDATE affected a row the actor owns). Cross-user confirmation is blocked at the DB layer via RLS + actor GUC. ✓
- **`ConfirmationRegistry` de-dup:** The waiter is deleted from the map in the `settle` callback, so subsequent `resolve(id, ...)` calls after settlement are silent no-ops. Double-execution is not possible. ✓
- **Action request payload is metadata-only:** `summarizeAssistantToolInput(input)` records only key names + count (`{ inputKeys, inputKeyCount }`). No raw values, no private content in the `app.ai_assistant_action_requests` row. ✓
- **Handler exceptions do not leak internals:** `runHandler()` catches all exceptions and returns the sanitized string `"Tool ${name} failed"`. ✓
- **`resolveActionRequest` does not surface DB/exception details:** On `!resolved` it returns silently. On other exceptions the outer try-catch in the chat route returns `{ error: "Could not resolve action request" }`. ✓
