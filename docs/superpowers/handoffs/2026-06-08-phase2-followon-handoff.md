# Handoff — Jarv1s Chat Phase 2 follow-on (transport + CLI lockdown + drawer)

**Date:** 2026-06-08 · **Epic:** #22 Phase 2 · **Predecessor:** PR #33 (MCP gateway core — MERGED)

You are picking up the **second half of Phase 2**. The transport-independent core is done and on
`main`; your job is to make it reachable by a real CLI and wired into the drawer. **Read these first**
(all on `main`): the spec `docs/superpowers/specs/2026-06-08-jarvis-chat-phase2-agentic-mcp.md`, the
spike `docs/superpowers/spikes/2026-06-08-mcp-client-support.md` (per-CLI recipes — load-bearing),
ADR `docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md`, and the core plan
`docs/superpowers/plans/2026-06-08-jarvis-chat-phase2-mcp-core.md`. Glossary: repo-root `CONTEXT.md`.

## What already exists (do not rebuild)

`packages/ai/src/gateway/` — `AssistantToolGateway` with `listTools()`, `callTool(token, name, input)`,
`resolveActionRequest(actorUserId, id, status)`; hardcoded policy (read→run, write/destructive→confirm
floor); `SessionTokenRegistry` (mint/verify/revoke); `ConfirmationRegistry` (blocking promise +
timeout); `validateToolInput`; injected `SessionNotifier` + `ActiveModulesResolver` seams. The
module→tool contract is in `@jarv1s/module-sdk` (`ModuleAssistantToolManifest.execute/summarize`).
Exercised by a fixture module (`tests/integration/fixtures/example-tool-module.ts`); 10 unit + 8
integration tests green. **No feature module is touched; no transport/CLI/drawer wiring exists yet.**

## Your scope (write a PLAN first — superpowers:writing-plans — then TDD each task)

1. **HTTP transport for the gateway.** Expose `AssistantToolGateway` over a localhost **HTTP MCP
   server** (streamable HTTP) mounted in the API process. Authenticate every request with the
   **per-session Bearer token** (verify via `SessionTokenRegistry`; 401 on bad/missing). Map token →
   `actorUserId`. This is the only new network surface — keep it MCP-protocol-correct (tools/list,
   tools/call). Add a resolve endpoint (or reuse the chat API) that calls
   `gateway.resolveActionRequest` for the drawer's Approve/Deny.
2. **CLI launch wiring + per-CLI lockdown** (use the spike's exact recipes). When the chat engine
   launches: mint a session token, inject the MCP server config for the configured CLI, and **lock
   down to MCP-only**:
   - **Claude:** `--mcp-config <inline-json> --strict-mcp-config`, `--allowedTools "mcp__jarvis__*"`,
     deny all natives (Bash/Edit/Read/Write/WebFetch/WebSearch/Glob/Grep), no bypass.
   - **Codex:** `codex exec` + `-c 'mcp_servers.jarvis.url=...'` + `bearer_token_env_var` (token in
     env), `[features] shell_tool=false, apply_patch_tool=false`, `--sandbox read-only -a never`.
   - **Gemini:** `.gemini/settings.json` `mcpServers` (httpUrl + `headers: Authorization: Bearer
${MCP_TOKEN}`), user-tier Policy Engine `deny */allow mcpName=jarvis`, `tools.core: []`,
     `security.disableYoloMode: true`, `--allowed-mcp-server-names jarvis`. NB: no `_` in server name;
     workspace-tier policies are broken — use user tier.
   - Set each CLI's tool-call timeout ~180s (Codex's 60s default is the binding constraint) and the
     gateway's `confirmTimeoutMs` ~150s (below it); on timeout return "still pending in your drawer".
   - This replaces Phase 1's bypassable `--tools ""` denylist with the allowlist invariant (ADR 0005).
3. **Real `SessionNotifier`.** Wire the gateway's notifier to `chat-session-manager` so
   `action_request` / `action_result` records stream into the session's existing record stream (routed
   by `chatSessionId`). Avoid an ai→chat circular dep — inject the notifier where the gateway is
   constructed.
4. **Drawer Approve/Deny card.** Render `action_request` records in the chat drawer as an Approve/Deny
   card (tool + summary); Approve/Deny hits the resolve endpoint → `gateway.resolveActionRequest`;
   render the `action_result`.
5. **Enablement seam.** Wire `resolveActiveModules` to `getBuiltInModuleManifests()`
   (`@jarv1s/module-registry`) at construction — the Phase-2 seam (per-user enablement is #30).
6. **Tests + verify.** Integration (HTTP auth + RLS scoping + confirm round-trip), e2e (drawer card
   approve/deny with a mocked engine), opt-in live smoke per CLI (header auth connects; a 120s blocking
   call returns; a native-tool request is refused). `pnpm verify:foundation` + `audit:release-hardening`
   green. NOTE: integration tests reset the shared dev DB — coordinate (Herdr) before running, others
   share it.

## Guardrails

- **Spec-before-build holds** — the spec above is approved; still write a PLAN before code.
- **Security invariant is the point:** the gateway is the agent's ONLY capability; native tools OFF, no
  bypass/YOLO, per-CLI. If you can't prove lockdown for a CLI, that CLI is not done.
- **Don't touch feature modules** (tasks/calendar/email/notifications). Your surface = the new MCP HTTP
  server + the chat module + web drawer. Connecting tasks tools is issue #34 (the Tasks agent) — don't
  collide; coordinate via the `herdr-pane-message` skill (their label is "Tasks").
- Tracked siblings (not yours): #30 Module Connector, #31 web.search, #34 tasks connection.

## Start

Run `/start` for the M-A/epic conventions, then `superpowers:writing-plans` to author the follow-on
plan, then execute with `superpowers:subagent-driven-development` or `executing-plans`. Branch off
`main` (or a worktree). When done, open a PR against `main` titled
`feat(jarvis-chat): Phase 2 — MCP transport + CLI lockdown + drawer (#22)`.
