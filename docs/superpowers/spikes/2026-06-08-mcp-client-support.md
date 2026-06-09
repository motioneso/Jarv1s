# Spike — MCP client support across Claude Code / Codex / Gemini CLIs

**Date:** 2026-06-08 · **Issue:** #32 · **Feeds:** Phase 2 spec §10
**Local versions:** Claude Code 2.1.169 · codex-cli 0.137.0 · gemini-cli 0.43.0 (all installed; codex/gemini in `~/.npm-global/bin`).

## Verdict

**HTTP-direct works for all three CLIs.** Each can connect as an MCP client to a self-hosted
localhost **HTTP** server with a **Bearer/Authorization header** for the per-session token. **No
stdio shim is required for portability** — the in-process HTTP gateway (ADR 0005) is reachable by
Claude, Codex, and Gemini. The allowlist security invariant (native tools OFF, MCP-only, no bypass)
is **robustly enforceable on all three**. The one binding constraint is **Codex's 60s default
tool-call timeout**, which must be raised for the blocking confirm bridge.

## Per-CLI findings

### 1. Transport + header auth — ALL THREE: HTTP + Bearer header ✓

| CLI    | HTTP MCP                              | Header/Bearer auth to localhost                                                                                   |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Claude | `--transport http`                    | `--header "Authorization: Bearer <t>"` (or `headers` in `--mcp-config` JSON)                                      |
| Codex  | `url = "..."` in `[mcp_servers.NAME]` | `bearer_token_env_var = "JARVIS_TOKEN"` (token via env, not in config) — also `http_headers` / `env_http_headers` |
| Gemini | `httpUrl: "..."` in `mcpServers`      | `headers: { "Authorization": "Bearer ${MCP_TOKEN}" }` (`${VAR}` env expansion)                                    |

OAuth exists on Codex/Gemini but is interactive (browser) → **not** for headless; use the static
Bearer token. Decision A (in-process gateway) holds; transport = **HTTP-direct**.

### 2. Config injection at launch (headless)

- **Claude:** `claude --mcp-config <file|inline-json> --strict-mcp-config` injects a per-session server
  inline; `--strict-mcp-config` ignores other sources. Project `.mcp.json` would need approval, so use
  inline `--mcp-config` (no approval prompt) for the spawned session.
- **Codex:** `codex exec --skip-git-repo-check -c 'mcp_servers.jarvis.url="..."' -c 'mcp_servers.jarvis.bearer_token_env_var="JARVIS_TOKEN"'` — full server injected via `-c`, token in env only, no shared-config edit. Headless via `codex exec`.
- **Gemini:** server _shape_ in a project `.gemini/settings.json` (`mcpServers`) + token via `${MCP_TOKEN}` env at spawn + `--allowed-mcp-server-names jarvis`. No inline full-server flag — needs a settings file. Trusted Folders is OFF by default, so headless doesn't block.

### 3. Native-tool lockdown — ALL THREE robustly MCP-only ✓ (the security keystone)

- **Claude:** `--allowedTools "mcp__jarvis__*"` (allowlist) + deny natives (`--disallowedTools "Bash" "Edit" "Read" "Write" "WebFetch" "WebSearch" "Glob" "Grep"` or `--tools ""`). **Deny rules are harness-enforced, NOT model-enforced → not prompt-injection-bypassable.** They apply even under `bypassPermissions`. (This replaces Phase 1's bypassable `--tools ""` denylist with a real allowlist.)
- **Codex:** `[features] shell_tool=false` + `apply_patch_tool=false` removes the native shell/patch tools entirely; belt-and-suspenders `--sandbox read-only -a never`. Per-server `enabled_tools`/`disabled_tools` also available.
- **Gemini:** **Policy Engine** (user-tier `~/.gemini/policies/*.toml`): `deny *` then `allow mcpName=jarvis` (a `deny` strips the tool from the model entirely). Plus `tools.core: []` (disables all built-ins the moment it's set) + `security.disableYoloMode: true`. Caveats: **workspace-tier policies are broken (#18186) → use user/admin tier**; **no underscores in the MCP server name** (FQN parser splits on `_`).
- **NEVER:** Claude `--permission-mode bypassPermissions` for native reach (deny still applies, but don't rely on it); Codex `--yolo`/`--dangerously-bypass-approvals-and-sandbox`; Gemini `--approval-mode=yolo`.

### 4. Long-running tool calls (the confirm-bridge wait) — Codex is the binding constraint

| CLI       | Default per-tool-call timeout                                          | Action                                                                                  |
| --------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Claude    | ~28h (effectively none); set `MCP_TOOL_TIMEOUT` / per-server `timeout` | set per-server `timeout: 180000` for clarity                                            |
| **Codex** | **60s** (`tool_timeout_sec`)                                           | **MUST raise** → `tool_timeout_sec = 180` (60s default would kill a 120s approval wait) |
| Gemini    | 600000ms (10 min) (`timeout`)                                          | fine as-is; can raise                                                                   |

## Decisions for the spec

1. **Transport = HTTP-direct, in-process gateway, per-session Bearer token.** No stdio shim. (ADR 0005 unchanged; transport open question resolved.)
2. **Confirm-bridge ceiling:** set the gateway's `confirmTimeoutMs` **below the configured CLI tool timeout**. Configure each CLI's tool timeout to ~180s and set `confirmTimeoutMs ≈ 150s`; on timeout return "still pending — approve in your drawer."
3. **Lockdown is per-CLI but all achievable.** The follow-on (CLI-launch) plan must, per provider: inject the HTTP server + token, allowlist only `jarvis` MCP tools, disable all native tools, forbid the bypass/YOLO modes, and set the tool timeout. Gemini extra care: user-tier policy + no `_` in server name.

## Open items to verify hands-on (not blocking the contract)

- Live smoke each CLI against a stub HTTP MCP server: confirm header auth connects, a 120s blocking
  tool call returns (with raised timeouts), and a native-tool request is actually refused.
- Confirm Codex `enabled_tools` server-scoping and Gemini Policy-Engine `mcpName` matching behave as documented.

**Conclusion: the Phase 2 contract + in-process HTTP gateway is sound for all three providers. Proceed to the CLI-launch/lockdown follow-on plan using the per-CLI recipes above.**
