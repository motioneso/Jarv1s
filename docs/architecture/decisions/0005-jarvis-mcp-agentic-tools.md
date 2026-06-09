# 0005 — Jarvis acts only through an in-process MCP gateway with module-owned tools and blocking confirmation

**Status:** accepted (2026-06-08)
**Context:** Jarv1s Chat Phase 2 (epic #22). Full design:
`docs/superpowers/specs/2026-06-08-jarvis-chat-phase2-agentic-mcp.md`.

## Decision

Jarvis becomes agentic through a single **in-process MCP Gateway** (in the API process),
and **only** through it. Four load-bearing choices:

1. **In-process gateway, per-session identity.** The Gateway runs inside the API process
   (reusing `withDataContext`, RLS, and the action-requests repository) rather than as a
   per-session subprocess. A server-minted **per-session token** bound to
   `{actorUserId, chatSessionId}` — never visible to or settable by the agent — is the
   sole source of identity for every tool call.

2. **Module-owned tools (declaration + execution co-located).** A module exposes tools via
   a `module-sdk` interface that carries an `execute` handler. Core is a generic dispatcher
   that never branches per-module; new modules add CRUD with zero core edits. This replaces
   the central `AiAssistantToolExecutor` switch in `packages/ai` (left in place for now
   because briefings depends on it; consolidation is later).

3. **Blocking confirmation, server-side.** A `write`/`destructive` call is intercepted: the
   Gateway emits an Approve/Deny card into the live chat record stream and **blocks** until
   the user resolves it (in-memory promise), then executes or returns a "denied" result.
   Full input stays in memory (only a summary persists). Policy is hardcoded for Phase 2
   (read→run, write→confirm, **destructive→always-confirm floor**); configurable policy is
   deferred to the Module Connector epic (#30).

4. **Allowlist security invariant.** The agent's _only_ capability is the Gateway. Native
   shell/file/edit/web tools are off and bypass-permissions is disabled, via a robust
   allowlist — not Phase 1's bypassable `--tools ""` denylist. Web access, when added,
   comes from a bounded `web.search` MCP tool through the Gateway (#31), never the CLI's
   native web tool.

## Why (the trade-offs)

- **In-process over per-session subprocess:** the confirmation bridge needs one process to
  own both the blocked call and the drawer that resolves it; a subprocess would duplicate
  DB/RLS/credential handling and still call back to the API.
- **Module-owned over central switch:** the central switch already bends module isolation
  (`packages/ai` imports four modules' repositories) and forces a core edit per new
  module — exactly the rot a connector contract exists to prevent.
- **Blocking over poll-and-return:** keeps the agent's model trivial (tool in → result
  out), which is the only way confirmation behaves identically across Claude/Codex/Gemini;
  a poll model depends on each provider reliably choosing to poll.
- **Allowlist over denylist:** the CLI runs as the host user, so any leaked native tool is
  a path to creds/`.env`/other users' data; combined with prompt-injection on ingested
  content it becomes an exfiltration chain. A single gated chokepoint is the mitigation.

## Consequences

- The Gateway's wait must sit below each CLI's tool-call timeout (a research spike measures
  this per CLI); on timeout the action stays pending in the drawer.
- A server restart mid-confirmation orphans the in-flight call. Accepted for the
  self-hosted deploy; no crash-recovery is built.
- Transport (HTTP-direct vs stdio-shim) is pending the spike; the in-process gateway and
  the module→tool contract hold regardless.
