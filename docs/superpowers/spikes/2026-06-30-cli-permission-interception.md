# Spike: cross-mode native-tool permission interception (Claude CLI + `-p`)

- **Issue:** #635 (Part of #578) — research spike blocking Part 2 build
- **Spec:** `docs/superpowers/specs/2026-06-28-in-container-permission-prompt-visibility-design.md` §5
- **Date:** 2026-06-30
- **Grounded on:** `origin/main` @ `6a84b4eb` (includes #634/#639 read-only vault allowlist)
- **Claude Code version tested:** `2.1.197`
- **Status:** RESOLVED — recommendation below. Working prototype in
  [`2026-06-30-cli-permission-interception/`](./2026-06-30-cli-permission-interception/).

## TL;DR

A single **`PreToolUse` hook is the unified mechanism**. It fires for **every** native
Claude tool in **both** the interactive REPL and `claude -p`, and returns a programmatic
`allow`/`deny` with no TUI prompt rendered. `--permission-prompt-tool` is `-p`-only and
**redundant** once the hook exists — do not use it.

**One non-obvious, security-critical finding (verified):** Claude Code **fails OPEN**
when it _kills_ a `PreToolUse` hook on the hook's configured `timeout`. A killed hook =
"non-blocking error → proceed with the tool." Therefore the hook must **own its own
deadline** and always `exit 0` with an explicit `deny` decision; the config `timeout`
must sit _above_ that internal deadline so Claude's killer never fires. Every error path
in the hook must `exit 0`/`deny`, never exit non-zero.

## How this was tested

All claims below are empirical, run against `claude 2.1.197` driving real `Read`/`Bash`
tool calls. `-p` runs used `--output-format json` (parsed `permission_denials`); the
interactive run was driven through a pty, with a logging hook as the mode-independent
proof of firing. The hook→gateway path was exercised by piping real `PreToolUse` stdin
JSON into the prototype hook against a bearer-authed mock gateway. See the prototype dir
to reproduce.

## Spike questions → answers

### Q1. Does a `PreToolUse` hook intercept _every_ native tool in the interactive REPL and return allow/deny, with no TUI prompt?

**Yes.** With `matcher: "*"`, the hook fired on `Read`, `Glob`, `Grep`, `Bash`, `Write`,
`Edit`, `WebFetch`, … Verified:

- **`-p` mode:** asked Claude to `Read work/sample.txt` then `Bash echo HELLO`. Hook
  fired for both. Returning `permissionDecision:"allow"` → Read ran and returned contents;
  returning `permissionDecision:"deny"` for Bash → tool blocked, surfaced in
  `permission_denials: [{tool_name:"Bash", …}]`. No prompt rendered.
- **Interactive REPL** (no `-p`, pty-driven): hook fired for `Read` with
  `permission_mode:"default"` — same `hookSpecificOutput` JSON governed the decision. The
  REPL never showed a permission prompt.

The hook's stdin JSON carries everything needed to make a decision:
`tool_name`, `tool_input`, `cwd`, `permission_mode`, `session_id`, `transcript_path`,
`tool_use_id`.

Also verified: the hook **fires even for tools already in `--allowedTools`** (e.g. the
shipped Part-1 vault `Read(<root>/**)` grants). So the hook is a universal _first_ gate,
not a fallback. Implication for latency (Q5): the hook must fast-path-allow the safe
read-only vault patterns _itself_, in-process, so pre-approved reads pay no network cost.

### Q2. Can the hook block for the 150s confirmation window and fail closed on timeout, in both modes?

**Block: yes.** A hook that `sleep`s holds the turn — an 8s blocking hook produced a ~19s
end-to-end turn; the tool ran only after the hook returned. This works identically in both
modes (it is just the hook process taking time to exit).

**Fail-closed: yes, but only if the hook owns the deadline — NOT via the config `timeout`.**

> ⚠️ **Verified gotcha.** Config `timeout: 3`, hook `sleep 12` then "allow". Claude killed
> the hook at 3s and **ran the tool anyway** (`permission_denials: []`, contents returned;
> the hook never printed its decision). **A hook killed by its own `timeout` fails OPEN.**

So fail-closed cannot be delegated to Claude's `timeout`. Instead:

- The hook long-polls the gateway with an **internal deadline = 150s** (matching
  `ConfirmationRegistry`'s `confirmTimeoutMs`, `routes.ts:607`).
- On timeout, rejection, gateway-unreachable, missing token, or _any_ exception, the hook
  prints `permissionDecision:"deny"` and **`exit 0`**.
- Config `timeout` is set to **160s** (> the 150s internal deadline) purely as a backstop
  so Claude's killer never fires on the happy path.

Prototype results (deterministic, `demo.py`), all `exit 0`:

| Scenario                                    | Decision             |
| ------------------------------------------- | -------------------- |
| user approves                               | `allow`              |
| user rejects                                | `deny`               |
| gateway never resolves → hook self-deadline | `deny` (fail-closed) |
| gateway down / unreachable                  | `deny` (fail-closed) |
| empty/forged bearer token → 401             | `deny` (fail-closed) |

### Q3. How does the hook authenticate into the `action_request` channel without leaking a secret?

**Reuse the existing per-session MCP bearer pattern — no new secret type.** Today
(`session-tokens.ts`) the gateway mints a per-session `jst_<uuid>` token
(`SessionTokenRegistry.mint`, 60-min sliding TTL) carrying
`{actorUserId, chatSessionId, allowedToolNames}`. For Claude it is written — **never on
argv** — to a `chmod 600` file in the neutral dir (`writeClaudeMcpConfig` →
`.jarvis-claude-mcp.json`, `Authorization: Bearer …`); the launch line passes only the
path. MCP calls validate it in `mcp-transport.ts` (`tokens.verify` → 401 on bad/expired),
and identity comes **only** from the token, never agent input.

The hook does exactly the same: reads the bearer from a `0600` file
(`JARVIS_PERM_TOKEN_FILE`, alongside the existing `.jarvis-claude-mcp.json`), sends it as
`Authorization: Bearer <jst>` to a new gateway endpoint (e.g.
`POST /internal/permission`) bound to loopback. The gateway resolves the actor from the
token, opens a `ConfirmationRegistry` waiter, emits the `action_request` into that user's
chat stream, blocks on `awaitResolution(id, 150_000)`, and returns `{decision}`. No secret
on the process line, none in the prompt, none echoable by the model. Redaction shapes in
`adapters/redact.ts` already scrub `Bearer …`/`jst_…`.

### Q4. Does `--permission-prompt-tool` compose with a `PreToolUse` hook in `-p`? Do we need both?

**No, and no.** `--permission-prompt-tool` is documented and behaves as `-p`-only — it has
no effect in the interactive REPL, which is the default anthropic engine
(`runtime.ts` → `CliChatEngineImpl`). Since the `PreToolUse` hook already covers **both**
modes (Q1), adding `--permission-prompt-tool` would split decision logic across two
mechanisms for zero coverage gain. **Use the hook alone.** (The hook is also strictly more
capable: it can `updatedInput`-rewrite and it sees the same stdin in both modes.)

### Q5. Recommended unified architecture + latency

**One mode-agnostic `PreToolUse` hook**, provisioned per session into the neutral dir's
`.claude/settings.json` (`chmod 600`, mirroring the existing `.gemini/settings.json` write
at `cli-chat-engine.ts`), wired for both `CliChatEngineImpl` and `ClaudePrintChatEngine`.

```
Claude native tool call
   │
   ▼
PreToolUse hook  (jarvis-permission-hook)         ── fires in BOTH modes, every tool
   ├─ tool ∈ safe read-only vault allowlist?  ── YES ─▶ allow   (in-process, ~0 network)
   │        (reuse vault-allowlist.ts / JARVIS_NOTES_ROOTS)
   └─ NO ─▶ read 0600 bearer ─▶ POST /internal/permission (loopback, Bearer jst)
                 │
                 ▼
        gateway: ConfirmationRegistry.awaitResolution(id, 150_000)
                 │  emit action_request ─▶ action-request-card.tsx (existing drawer UI)
                 ▼
        user clicks Approve/Deny  ─▶ resolveActionRequest ─▶ {decision}
                 │
        deadline/err/reject ─▶ deny           ── hook ALWAYS exit 0
```

- **Reuses everything already built:** `ConfirmationRegistry` (150s, fail-closed),
  `gateway-notifier` `action_request`, `action-request-card.tsx`, the per-session bearer.
  No new UI. The only net-new server surface is one loopback endpoint that wraps the
  existing `awaitResolution` + notifier — the same shape as the MCP `callTool` path.
- **Latency:** allow-path for pre-approved vault reads is a local hook process spawn +
  JSON (sub-100ms in the prototype, no network). Non-allowlisted tools cost one loopback
  round-trip plus however long the human takes, bounded at 150s then auto-deny. Common
  case (vault reads, already in `--allowedTools`) is effectively free.
- **Keep the launch flags too** (defense-in-depth): `--permission-mode default` +
  `--allowedTools` with only the safe read set stay as-is. If the hook ever fails to
  provision, the launch posture still denies native writes/exec rather than prompting
  invisibly.
- **Settings precedence caveat:** a `PreToolUse` `allow` does **not** override an explicit
  `deny` _rule_ in settings. Do not add native-tool `deny`/`ask` rules to the session
  settings — let the hook be the sole decision authority (the launch `--allowedTools` is an
  allow-list, not a deny-rule, so it composes cleanly).

## Backstop (in scope): stall watchdog

Independent of the hook, add a turn-level watchdog in the engine: if a turn emits no
transcript output for N seconds **and** nothing is pending in `ConfirmationRegistry`, end
the turn with a visible "Jarvis got stuck" message instead of hanging. This covers
non-permission stalls (CLI crash, network) and is the safety net even before the hook
lands. Note the hook makes the _permission_ stall impossible (worst case = 150s → auto
deny → turn continues), so the watchdog's N can be generous (e.g. 180s, just above the
permission deadline).

## Build recommendation (for the Part 2 spec/issue)

1. New helper `writeClaudePermissionHook(neutralDir, …)` → writes `.claude/settings.json`
   (`PreToolUse` `matcher:"*"`, `timeout:160`) + the hook script, both `chmod 600`.
2. Hook script = the prototype here, hardened: fast-path the `vault-allowlist.ts` patterns;
   read bearer from the existing `0600` token file; `POST /internal/permission`; **always
   `exit 0`**, deny on every failure; internal deadline 150s.
3. New loopback gateway route `POST /internal/permission` that maps
   `{tool_name, tool_input}` + bearer → `ConfirmationRegistry` waiter + `action_request`
   emit + `awaitResolution(150_000)` → `{decision}`. Audit-log like the MCP path.
4. Wire into **both** `CliChatEngineImpl` and `ClaudePrintChatEngine`. Do **not** add
   `--permission-prompt-tool`.
5. Add the stall watchdog to the turn loop.
6. Tests: hook unit (allow/deny/fail-closed paths, all `exit 0`); integration in both
   modes that a non-safe native tool surfaces an `action_request` card and blocks.

## Non-goals (unchanged from spec)

No `--dangerously-skip-permissions`; no bespoke UI; no multiplexer pane scraping.

## Reproduce

```sh
cd docs/superpowers/spikes/2026-06-30-cli-permission-interception
python3 demo.py        # deterministic: allow / deny / 3× fail-closed, all exit 0
```

See the prototype [`README.md`](./2026-06-30-cli-permission-interception/README.md) for the
live `claude -p` and interactive-REPL reproductions.
