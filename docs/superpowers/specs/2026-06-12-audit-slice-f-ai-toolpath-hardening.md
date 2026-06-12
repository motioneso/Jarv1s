# Spec: Audit Slice F — AI Tool-Path Hardening

**Date:** 2026-06-12 (revised post-Fable review)
**Audit issues:** #132, #119, #148, #172
**Tier:** `security` (AI tool invocation paths, actor-scope enforcement)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only)
**Dependency:** Parallel-safe with migration spine (B, D, E). Does not share files with those
slices. Build as one atomic PR — all four issues touch `packages/ai/` or its dependents.

---

## Context

Four gaps in the AI tool invocation path:

- **#132** — The REST read-tool route (`packages/ai/src/routes.ts`) calls `manifestTool.execute!`
  with **unvalidated** input. `validateToolInput` is already used at the gateway layer — it must
  also gate the REST path. Only read-only tools reach this path (write/destructive tools are
  correctly gated by the confirmation flow), so the blast radius is input injection on read tools.
- **#119** — The MCP gateway has no server-side per-session tool allowlist. Today the Claude CLI
  client enforces allowlist via `--allowedTools`, but the server does not cross-check. A call to
  an out-of-allowlist tool still reaches the actor's tool executor. The fix must be a real
  server-side enforcement, not an observation of existing CLI behavior.
- **#148** — `packages/briefings/src/repository.ts` calls `manifestTool.execute` with a blank
  `ToolContext`: `{ actorUserId: "", requestId: "", chatSessionId: "" }`. The worker has the actor
  in `job.data`. This is an oversight — actor-scoped tool behavior is broken in briefing workers.
- **#172** — `packages/chat/src/mcp-transport.ts` calls `deps.gateway.listTools()` with no actor,
  returning tools for `actorUserId: ""`. The existing `executableTools(actorUserId)` method filters
  by actor — `listTools()` bypasses that.

---

## Fix design

### #119 — Per-session server-side tool allowlist (the substantive redesign)

**This section is a complete redesign — the original spec described adding an actor-aware filter
that was already present. The gap is that the per-client allowlist from the CLI's `--allowedTools`
flag has no server-side counterpart.**

**Chosen approach: session-token allowlist capture**

Extend `SessionIdentity` in `packages/ai/src/gateway/session-tokens.ts:3-6` with an
`allowedToolNames: Set<string> | null` field captured at token mint time:

```typescript
// packages/ai/src/gateway/session-tokens.ts
export interface SessionIdentity {
  actorUserId: string;
  chatSessionId: string;
  allowedToolNames: Set<string> | null;  // null = unrestricted (non-chat and non-MCP paths)
}
```

When the MCP transport mints a session token (in `packages/chat/src/mcp-transport.ts`, the
token-create call at ≈ line 45), pass the tools/list response set as the initial allowlist:

```typescript
const tools = await deps.gateway.executableTools(actorUserId);
const allowedNames = new Set(tools.map(t => t.tool.name));
const token = deps.tokens.mint({ actorUserId, chatSessionId, allowedToolNames: allowedNames });
```

**Tool name mapping (mcp__jarvis__* pattern):** the MCP client receives tool names in
`mcp__<server>__<tool>` format per MCP convention. Verify whether `executableTools` returns
names in this format or in the bare tool name. If bare: transform to `mcp__jarvis__<name>`
for the allowedNames set, or store both. State explicitly in the PR which format the set uses.

**Default for non-chat token mints:** when a token is minted outside the MCP/chat path (e.g.,
the REST tool-call route), `allowedToolNames` is `null` — meaning unrestricted (existing behavior
on these paths). The enforcement guard only fires when `allowedToolNames` is non-null.

**Enforce in `callTool` AFTER `executableTools` lookup:**

```typescript
async callTool(token: string, toolName: string, rawInput: unknown): Promise<GatewayToolResponse> {
  const identity = this.tokens.verify(token);
  const tools = await this.executableTools(identity.actorUserId);
  const found = tools.find(t => t.tool.name === toolName);
  if (!found) {
    return { ok: false, error: `Tool not found: ${toolName}` };
  }
  // Server-side allowlist check (non-null = this session has a captured allowlist)
  if (identity.allowedToolNames !== null && !identity.allowedToolNames.has(toolName)) {
    return { ok: false, error: `Tool not in session allowlist: ${toolName}` };
  }
  // ... existing validation and execute logic
}
```

The allowlist check is defense-in-depth on top of `executableTools` — both must pass.

### #132 — `validateToolInput` on REST read-tool path

**Location:** `packages/ai/src/routes.ts` — the `manifestTool.execute!` call on the REST
read-tool path.

**Fix:** call `validateToolInput` before `execute`:

```typescript
import { validateToolInput } from "./gateway/input-validation.js";
// ...
const validatedInput = validateToolInput(found.tool.inputSchema, rawInput);
const result = await manifestTool.execute!(scopedDb, validatedInput, {
  actorUserId,
  requestId,
  chatSessionId: "",   // REST path has no chat session; "" is correct here
});
```

**Import path is `./gateway/input-validation.js`** (with `.js` extension — ESM convention in
this codebase, verified from other imports in routes.ts).

**Invariant scoping:** the invariant "validateToolInput before every execute" applies to
**caller-supplied inputs** only. `packages/briefings/src/repository.ts` calls
`manifestTool.execute(scopedDb, {}, ...)` with a hard-coded empty object `{}` — this is not
caller-supplied input and calling `validateToolInput({}, {})` there is redundant/misleading.
The invariant applies to the REST and MCP paths where the caller sends arbitrary input.

**ToolInputValidationError → HTTP 400 mapping:** `validateToolInput` throws
`ToolInputValidationError` on schema mismatch. This error must map to HTTP 400, not 500.
Add an `instanceof ToolInputValidationError` branch in `handleRouteError` (≈ routes.ts:598):

```typescript
if (error instanceof ToolInputValidationError) {
  return reply.code(400).send({ error: error.message });
}
```

OR wrap the `validateToolInput` call in a try/catch that rethrows as `HttpError(400, message)`.
Specify which approach in the PR.

### #148 — Thread `actorUserId` and proper `requestId` in briefings `ToolContext`

**Location:** `packages/briefings/src/repository.ts` ≈ lines 259-266 (the `manifestTool.execute`
call in `generateSummary`).

The `definition.owner_user_id` is in scope in `generateSummary` (it's on the briefing
definition record) and provably equals the actor — use it:

```typescript
await manifestTool.execute(scopedDb, {}, {
  actorUserId: definition.owner_user_id,
  requestId: `pgboss:${job.id}`,   // job.id from the pg-boss job context, NOT actorUserId
  chatSessionId: "",
});
```

`job.id` is the pg-boss job ID, available on the job object at `packages/briefings/src/jobs.ts:76`.
Using `actorUserId` as `requestId` was incorrect — a requestId should identify the request, not
the actor. Use `pgboss:<job.id>` to match the convention in other worker paths.

**If `definition.owner_user_id` is not directly available** in the call site, thread it from
`GenerateBriefingRunInput` (the job payload type) — but verify this first: the definition is
loaded from the DB in the same function and should carry `owner_user_id`.

### #172 — Actor-scoped `tools/list` in MCP transport

**Location:** `packages/chat/src/mcp-transport.ts:99` and
`packages/ai/src/gateway/gateway.ts`.

**The `listTools()` method returns a global unscoped tool list.** Delete it and replace with
`listToolsForActor(actorUserId: string)`.

**In `packages/ai/src/gateway/gateway.ts`:**
```typescript
listToolsForActor(actorUserId: string): ToolDto[] {
  // executableTools is already actor-scoped
  return this.executableTools(actorUserId).map(t => toDto(t));
}
// Delete listTools() — it bypasses actor scoping
```

If `executableTools` is async, `listToolsForActor` is async too. Check the existing method
signature before deciding sync vs async.

**In `packages/chat/src/mcp-transport.ts`:**
```typescript
if (method === "tools/list") {
  // actorUserId is already in identity — captured from token at line 70
  const tools = await deps.gateway.listToolsForActor(identity.actorUserId);
  return reply.code(200).send({
    jsonrpc: "2.0",
    id,
    result: { tools: tools.map(dtoToMcpTool) },
  });
}
```

The token is verified at the top of the handler (≈ line 70) — use `identity.actorUserId` from
there rather than re-verifying.

**Delete `listTools()`.** Update `tests/integration/mcp-gateway.test.ts:63` (which currently
calls `listTools()`) to call `listToolsForActor(testActorUserId)` instead.

---

## Hard invariants

- **`validateToolInput` before every caller-supplied-input `execute` call** (REST and MCP paths).
  Briefings' constant `{}` input is exempt — document this in a code comment.
- **`ToolInputValidationError` maps to 400**, not 500. No unhandled validation errors bubble to
  a 500 response.
- **No actor-unscoped `tools/list`.** `listTools()` is deleted. The MCP `tools/list` response
  is always actor-scoped.
- **`ToolContext.actorUserId` is never empty string** in any non-test call site. After the PR:
  `grep -rn 'actorUserId: ""' packages/ --include="*.ts"` must return zero non-test hits.
- **Session token `allowedToolNames` enforced before execute.** A tool not in the session's
  captured allowlist returns an error, not a tool execution.
- **Provider-agnostic AI invariant preserved.** No fix hardcodes a provider or model.

---

## Tests

- **`pnpm verify:foundation`** green.
- **Input validation:** call the REST read-tool path with input that fails the tool's JSON schema;
  expect HTTP 400, not 500, not unguarded execute.
- **Allowlist enforcement (MCP):** call `tools/call` via the MCP transport with a tool name not
  in the session's captured allowlist; expect an error response (not tool execution).
- **`tools/list` actor-scoped:** call `tools/list` on the MCP transport with a valid session
  token; verify the returned list matches only the actor's configured modules.
- **Briefings ToolContext:** run a briefing job end-to-end (or unit-test the repository's
  `generateSummary`); verify `actorUserId` and `requestId` are non-empty in the ToolContext.
- **`mcp-gateway.test.ts`:** update the `listTools()` call at line 63 to `listToolsForActor`;
  confirm the suite passes.

---

## Out of scope

- Full audit logging of tool invocations.
- Tool allowlist management UI.
- New tool registration or capability changes.
- The broader MCP server feature set beyond these four fixes.
