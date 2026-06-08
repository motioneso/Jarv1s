# Jarv1s Chat — Phase 2: Agentic Tools (MCP)

**Status:** Approved design (grill-with-docs, 2026-06-08)
**Epic:** #22 (Jarv1s Chat — live, agentic, remembering) · Phase 2
**Supersedes/expands:** §7 of `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md`
**Decision record:** `docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md`
**Glossary:** repo-root `CONTEXT.md` (Jarvis, Module, Assistant tool, Risk, Action request, Gateway)

---

## 1. Goal

Turn Jarvis from a conversational assistant (Phase 1) into one that can **act on the
user's behalf** — read and (with authorization) write through modules' assistant tools —
while every action funnels through a single, policy-enforcing chokepoint. Phase 2 builds
**only the MCP surface and the module-connection contract**. It ships **no real feature
tools**; it is proven with a test-only fixture module. Real tools (tasks, web search, …)
connect to the contract afterward, by other work.

This is the work the Tasks Foundation spec deferred to "M2 — a generic AI write-tool
execution surface": there is no write-tool execution path today
(`AiAssistantToolExecutor` has only `invokeReadTool`).

## 2. What already exists (M-A3, do not rebuild)

- Module manifests declare `assistantTools` (name, `permissionId`, `risk:
read|write|destructive`, input/output JSON schemas) via `module-sdk`.
- `ai_assistant_action_requests` table — owner-only RLS, status enum
  (`pending|confirmed|rejected|cancelled`), `input_summary` jsonb.
- A REST route `/api/ai/assistant-tools/:name/invoke` that branches read→execute,
  write/destructive→create pending action request. **Used by the M-A3 REST era and by
  briefings** (`packages/briefings` calls `invokeReadTool` to assemble briefings).
- Phase 1 live chat: persistent per-user tmux CLI session, record-level SSE streaming,
  `chat-session-manager` emitting `TranscriptRecord`s to subscribers, completed turns
  persisted with an `executed` set. **All CLI tools are currently disabled.**

## 3. Non-Goals (explicit scope guardrails)

- **No feature module is touched.** tasks/calendar/email/notifications are untouched.
  Connecting any module (tasks included) is later work against this contract.
- **No configurable policy, no per-user module enable/disable.** Policy is hardcoded
  (§7). Persisted policy, per-tool overrides, "always allow", and per-user module
  enablement all live in the future **Module Connector** epic (#30).
- **No migration of the existing read tools / no removal of the central read executor.**
  Briefings depends on it; consolidating modules onto this contract is follow-up.
- **No real tools.** Web search arrives later as a bounded MCP tool (#31). Phase 2 ships a
  test-only fixture module.
- **No sandboxed code execution.** Out of scope; its own future spec.

## 4. Architecture

### 4.1 In-process Gateway

The Jarv1s MCP **Gateway** runs **inside the API process** (not a per-session subprocess).
It reuses the API's `withDataContext`, RLS scoping, and the `ai_assistant_action_requests`
repository, and — critically — owns both ends of the confirmation bridge (the blocked
tool call _and_ the drawer that resolves it). The agent's CLI, running in its per-user
tmux session on the same host, connects over localhost.

> **Transport is pending a spike (§10).** Claude Code supports authenticated HTTP MCP; if
> Codex/Gemini cannot, a thin stdio shim that forwards to the in-process Gateway is the
> portable fallback. Either way the Gateway and all logic stay in-process.

### 4.2 Identity — per-session token

When the chat engine launches, the API mints a short-lived **per-session token** bound to
`{ actorUserId, chatSessionId }`, injects it into the MCP config, and revokes it when the
engine is reaped (lifecycle-scoped, not a fixed TTL that could expire mid-conversation).
The Gateway maps token → `actorUserId` on every call and runs the handler under
`withDataContext`. **Identity is never in the agent's context and never a tool argument** —
anything the model can see or set is injection-controllable.

### 4.3 The module→tool contract (the deliverable)

A module owns **both** the declaration and execution of its tools, via a `module-sdk`
interface. Core never branches per-module.

```ts
// packages/module-sdk — the connection point
export interface ModuleAssistantTool {
  readonly name: string; // "tasks.updateStatus"
  readonly description: string; // shown to the agent
  readonly permissionId: string; // "tasks.update"
  readonly risk: "read" | "write" | "destructive";
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;

  // Called ONLY when authorized (read allowed, or write approved).
  // Input is already validated against inputSchema. Do module-specific
  // preconditions HERE and throw to surface a normal error result.
  execute(scopedDb: DataContextDb, input: ToolInput, ctx: ToolContext): Promise<ToolResult>;

  // Optional: human-readable description of a proposed write for the
  // Approve/Deny card. Falls back to the generic input summary if absent.
  summarize?(input: ToolInput, ctx: ToolContext): string;
}

type ToolInput = Record<string, unknown>; // schema-validated by the Gateway
interface ToolContext {
  actorUserId: string;
  requestId: string;
  chatSessionId: string;
}
interface ToolResult {
  data: Record<string, unknown>;
} // becomes the agent-visible result
```

**Thin handler / fat Gateway.** The Gateway owns, uniformly for every tool: input
validation, Risk-based policy, the confirm bridge, `withDataContext` scoping, and
denial/error formatting. The handler owns only the authorized happy path.

A module exposes tools by listing `ModuleAssistantTool`s on its manifest. Adding a new
module's CRUD = declaring tools in that module — **zero edits to core.**

### 4.4 Enablement seam (seam only — feature deferred)

The Gateway resolves its exposed tool set through a single resolver — "active modules for
this user." In Phase 2 that returns the compiled-in default set. When real per-user
enablement ships (#30), the resolver reads it and disabled modules' tools vanish from the
surface with **no change to the Gateway or any module.**

## 5. Policy (hardcoded for Phase 2)

| Risk          | Behavior                                                            |
| ------------- | ------------------------------------------------------------------- |
| `read`        | Run immediately.                                                    |
| `write`       | Confirm (Approve/Deny) before execution.                            |
| `destructive` | **Always confirm — un-skippable floor.** Can never be set to allow. |

No storage, no overrides, no "always allow" in Phase 2. All of that is #30. The
destructive floor is permanent even after configurable policy lands.

## 6. Confirmation bridge (server-side blocking)

1. Gateway hits a `write`/`destructive` call → persists an `ai_assistant_action_requests`
   row (`input_summary` only; **full input stays in the blocked handler's memory**, never
   persisted) → **emits `{ kind: "action_request", id, tool, summary }` into that session's
   record stream** (routed by `chatSessionId` from the token) → `await`s an **in-memory
   promise** keyed by the action-request id.
2. The drawer renders the streamed record as an **Approve/Deny card** (reuses Phase 1's
   subscriber/multi-tab streaming — no new polling channel).
3. User clicks → endpoint resolves the action-request row **and** signals the in-memory
   promise.
4. Gateway unblocks → Approve: `execute` → `{ data }`; Deny: short-circuit (handler never
   called) → `{ denied: true, reason }`. Either way emit `{ kind: "action_result" }` and
   record it in the turn's `executed` set.

The agent is told up front (tool descriptions + seed prompt) that write/destructive tools
are intercepted for approval, may pause, and that a **denial is a normal outcome** — not an
error to retry around.

**Accepted costs:** (a) the wait must sit below each CLI's tool-call timeout — the spike
measures this; on timeout the Gateway returns "still pending — approve it in your drawer";
(b) a server restart mid-wait orphans the in-flight call (row stays `pending`, blocked
handler gone). Acceptable for the self-hosted deploy; no crash-recovery is built.

## 7. Security (invariant)

- **Allowlist, not denylist.** The agent's allowed tools = **only** the Gateway's tools.
  Native shell, file, edit, **and web** tools are **off**; **no bypass-permissions**. This
  replaces Phase 1's bypassable `--tools ""` denylist.
- **Single chokepoint.** Because the Gateway is the only capability, it sees and gates
  _every_ action — a genuine prompt-injection mitigation. Even if injected content tells
  Jarvis to `vault.delete`, the call hits the Gateway, the destructive floor forces a human
  Approve, and the card shows exactly what it wants to do.
- **Web later, bounded.** Web access does **not** come from the CLI's native web tool
  (ungated → bypasses the chokepoint; native fetch is an exfiltration channel under
  injection). It comes from a bounded `web.search` MCP tool through the Gateway (#31).
- **Secrets never escape.** Errors return safe messages only; secrets never reach the
  agent, the result, or logs.
- The spike must confirm the allowlist + no-bypass is **robustly enforceable per CLI**, not
  just that MCP connects.

## 8. Testing — fixture module

A **test-only fixture module** (a fake manifest exposing `example.read` / `example.write` /
`example.destroy`) exercises the full Gateway without touching any real module:

- read runs immediately; write blocks → resolves on approve/deny; destructive always
  blocks and cannot be downgraded.
- input validation against `inputSchema`; identity scoping (RLS) per token; secrets/internal
  errors never leak; denial returns a normal result.
- a conformance test the first real module can copy. A connection format without a
  conformance test is how the first real module breaks.

## 9. Downstream work (tracked, NOT Phase 2)

- **#30 Module Connector** — per-user module enable/disable + persisted tool policy /
  overrides / "always allow" / management UI.
- **#31 web.search** — the first bounded read tool.
- **Tasks connection** — implement tasks read tools (against this contract) + tasks write
  tools (Phase 2 owns the write surface; M-A5 scoped writes out). Sequenced after tasks
  core (M-A5) and this contract land.
- **Consolidation** — migrate the existing read tools + briefings off the central
  `invokeReadTool` switch onto this contract; retire the switch.

## 10. The spike (prerequisite)

Research spike — **MCP client support across Claude Code / Codex / Gemini CLIs**:

1. **Transport** — stdio vs authenticated HTTP/SSE per CLI; does the in-process-HTTP plan
   hold, or is a stdio shim required for portability?
2. **Config injection** — how each CLI is given MCP config at launch
   (`--mcp-config` / `mcp_servers` / `mcpServers`).
3. **Long-running tool calls** — each CLI's tool-call timeout (the confirm bridge depends
   on it; sets the Gateway's wait ceiling).
4. **Native-tool lockdown** — robust, non-bypassable allowlist + no-bypass-permissions per
   CLI (not just "MCP connects").

Output decides HTTP-direct vs stdio-shim and the timeout/lockdown parameters. The
module→tool contract (§4.3) is transport-independent and can be built in parallel.

## 11. Coordination & sequencing

- **Contract first.** The `module-sdk` `ModuleAssistantTool` interface (§4.3) is the
  keystone everything consumes; build it first, then the Gateway / confirm bridge / drawer
  / fixture in parallel.
- **Parallel with tasks core (M-A5).** The only shared file is `module-sdk`. Tasks **read**
  tools should be authored against this contract (avoids a later migration); tasks **write**
  tools are Phase 2's surface.
- **Glossary + ADR.** `CONTEXT.md` is shared with `feat/tasks-foundation`; this work adds
  only the assistant/tools terms. ADR for this work is **0005** (tasks owns 0004).
