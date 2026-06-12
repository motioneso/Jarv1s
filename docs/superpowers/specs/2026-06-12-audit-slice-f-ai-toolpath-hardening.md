# Spec: Audit Slice F — AI Tool-Path Hardening

**Date:** 2026-06-12
**Audit issues:** #132, #119, #148, #172
**Tier:** `security` (AI tool invocation paths, actor-scope enforcement)
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only)
**Dependency:** Parallel-safe. May land alongside the migration spine; does not share
files with Slices B, D, E, or G. Internal serialization: all four issues touch
`packages/ai/` or directly connected modules — build as one atomic PR.

---

## Context

Four gaps in the AI tool invocation path, all code-only fixes:

- **#132** — The REST tool-invocation route (`packages/ai/src/routes.ts`) calls
  `validateToolInput` at the MCP gateway layer but **not** on the REST read-tool path. The
  residual gap: read-only tools execute via `manifestTool.execute!` with unvalidated input and
  a blank `chatSessionId: ""`. Write/destructive tools are correctly gated (confirmation flow),
  so the blast radius is read-tool input injection, not write access.
- **#119** — The MCP server-side tool allowlist is enforced only by the Claude CLI client
  (`--allowedTools`). The gateway has no per-session server-side filter. An out-of-allowlist
  call still reaches the user's own tools (blast radius bounded to the authenticated user's
  tools), but parity with the declared security model is required. Severity: MED.
- **#148** — `packages/briefings/src/repository.ts:259-266` calls `manifestTool.execute` with
  a blank `ToolContext`: `{ actorUserId: "", requestId: "", chatSessionId: "" }`. The worker
  has `actorUserId` in `job.data` — the blank is an oversight that breaks actor-scoped tool
  behaviour in briefing workers.
- **#172** — `packages/chat/src/mcp-transport.ts:99` calls
  `deps.gateway.listTools()` with no actor context, returning tools for `actorUserId: ""`.
  The gateway's `executableTools(actorUserId)` correctly filters by actor — but `listTools()`
  never passes the actor in. A malicious or misconfigured client gets a de-personalized tool
  list.

---

## Fix design

### #132 — validateToolInput on REST read-tool path

**Location:** `packages/ai/src/routes.ts` ≈ lines 453–458 (the `manifestTool.execute!` call
on the read-tool REST path).

**Current (approximate):**
```typescript
// read tool — executes directly
const result = await manifestTool.execute!(scopedDb, rawInput, {
  actorUserId,
  requestId,
  chatSessionId: ""
});
```

**Fix:**
```typescript
import { validateToolInput } from "./input-validation.js";
// ...
const validatedInput = validateToolInput(found.tool.inputSchema, rawInput);
const result = await manifestTool.execute!(scopedDb, validatedInput, {
  actorUserId,
  requestId,
  chatSessionId: request.id ?? ""   // or a proper session ID if available
});
```

`validateToolInput` is already imported and used at `gateway/gateway.ts:62`. Use the same call.
The `chatSessionId` blank is a secondary issue — use `request.id` as a correlation ID if no
session is available on the REST path.

### #119 — Server-side tool allowlist in gateway

**Location:** `packages/ai/src/gateway/gateway.ts:executableTools(actorUserId)`.

The gateway already filters tools by `resolveActiveModules(actorUserId)` (actor-aware). The
MCP client sends a `--allowedTools` flag — but nothing on the server validates that the tool
being called is in the configured set.

**Fix:** Add a per-session server-side allowlist check to `callTool`. When a `tools/call` request
arrives, verify that the requested tool name is in the set returned by `executableTools(actorUserId)`
for that session. Reject unknown tool names with a clear error rather than propagating them.

```typescript
async callTool(token: string, toolName: string, rawInput: unknown): Promise<GatewayToolResponse> {
  const { actorUserId } = this.tokens.verify(token);
  const tools = await this.executableTools(actorUserId);
  const found = tools.find(t => t.tool.name === toolName);
  if (!found) {
    return { ok: false, error: `Tool not found: ${toolName}` };
  }
  // ... existing logic
}
```

This is additive — the existing `callTool` already does a `found` check; confirm it covers
all paths and add the actor-scoped filter if it does not.

### #148 — Thread actorUserId in briefings ToolContext

**Location:** `packages/briefings/src/repository.ts:259-266`.

**Current:**
```typescript
await manifestTool.execute(scopedDb, {}, {
  actorUserId: "",
  requestId: "",
  chatSessionId: ""
});
```

**Fix:**
```typescript
await manifestTool.execute(scopedDb, {}, {
  actorUserId: job.data.actorUserId,
  requestId: job.data.actorUserId,   // use actorUserId as correlation ID if no requestId exists
  chatSessionId: ""
});
```

`job.data.actorUserId` is available on `ActorScopedJobPayload` (`packages/jobs/src/pg-boss.ts:14-16`).
Thread it through. If the briefing worker's job type does not extend `ActorScopedJobPayload`,
update the job type to extend it first.

### #172 — Actor-scoped tools/list in MCP transport

**Location:** `packages/chat/src/mcp-transport.ts:99`.

**Current:**
```typescript
result: { tools: deps.gateway.listTools().map(dtoToMcpTool) }
```

**Fix:**
1. Add a `listToolsForActor(actorUserId: string)` method to `AssistantToolGateway` (in
   `packages/ai/src/gateway/gateway.ts`) that calls `executableTools(actorUserId)` and returns
   the DTO list. Keep `listTools()` for backward compatibility only if it has other callers;
   otherwise rename it.

2. In `mcp-transport.ts`, extract `actorUserId` from the already-verified token:
```typescript
if (method === "tools/list") {
  const { actorUserId } = deps.tokens.verify(token);   // token already verified above
  return reply.code(200).send({
    jsonrpc: "2.0",
    id,
    result: { tools: (await deps.gateway.listToolsForActor(actorUserId)).map(dtoToMcpTool) }
  });
}
```

The token is already verified at the top of the request handler (line 70–73) — extract the
`actorUserId` from it rather than re-verifying.

---

## Hard invariants

- **validateToolInput called before any tool execute.** After this PR, every code path that
  calls `manifestTool.execute!` must call `validateToolInput` first.
- **No actor-unscoped tool list.** `listTools()` with no actor must either be removed or made
  private/internal. The public-facing `tools/list` MCP method must always use the actor from
  the session token.
- **ToolContext actorUserId never empty string** in any non-test call site. Grep for
  `actorUserId: ""` after the PR — must return zero non-test hits.
- **Provider-agnostic AI invariant preserved.** No fix in this slice may hardcode a provider
  or model.

---

## Tests

- **`pnpm verify:foundation`** and **`pnpm test:tasks`** must be green.
- **Input validation test:** call the REST read-tool path with invalid input (schema mismatch);
  expect a validation error, not an unguarded execute.
- **Allowlist enforcement:** call `tools/call` via MCP transport with a tool name not in the
  actor's tool list; expect an error response, not a tool execution.
- **Briefings worker:** run a briefing job end-to-end (or unit-test the repository); verify
  `actorUserId` is non-empty in the ToolContext.
- **`tools/list` actor-scoped:** call `tools/list` on the MCP transport; verify the returned
  list matches the actor's configured modules (not a global unscoped list).

---

## Out of scope

- Full audit logging of tool invocations.
- Tool allowlist management UI.
- New tool registration or capability changes.
- The broader MCP server feature set beyond these four fixes.
