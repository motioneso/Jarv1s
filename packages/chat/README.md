# @jarv1s/chat

The chat module: REST + live (terminal-CLI-backed) chat. Live sessions are driven through a portable
`Multiplexer` seam (`@jarv1s/ai`) so a deployed instance can use whichever multiplexer the host
provides (tmux or herdr), selected by the admin `chat.multiplexer` instance setting with PATH
auto-detection (ADR 0008).

## Known security limitation — shared-uid

All live chat sessions run as **one OS user** (the shared uid the API/worker process runs as). This
has two distinct boundaries:

- **The agent path is contained.** An injected prompt reaching the CLI has no native file or shell
  primitive: every session launches with `--tools ""` / an MCP allowlist + `--strict-mcp-config`, so
  the model can only reach the allowlisted `mcp__jarvis__*` tools (themselves RLS-scoped to the
  acting user). `sanitizeInput` strips the leading-`!` shell escape on the programmatic input path.
- **The human-attach path is NOT contained by uid.** A human who **already holds a shell as the
  shared uid** can `attach` to any live session and read any user's neutral dir / CLI auth material.
  This is inherent to running every user's session under one OS account.

**Mitigations today:** host-shell access is the operator's own (the operator already controls the
box); per-user neutral dirs are created with mode `0700`; connector/AI secrets are AES-256-GCM
encrypted at rest and never placed in prompts, pg-boss payloads, logs, or exports.

**The real fix is the deferred uid-per-user milestone** — true OS-user isolation per chat user. The
`0700` neutral dirs and the `TmuxIo` env/cwd + `transcriptGlobDir` homeBase seams are the
forward-compatibility hooks for that work.

See `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md` §8.

## Assistant action restart cleanup

Pending write/destructive tool approvals are in-memory waits. On API startup, Jarv1s cancels
pending action requests older than the startup grace window so a restart leaves visible terminal
`cancelled` rows instead of approvals that can never resume. Fresh pending rows stay pending.

## Deferred — agent-path PreToolUse policy

A Claude Code `PreToolUse` hook (deny any tool call that is not an allowlisted `mcp__jarvis__*` call),
provisioned into the anthropic neutral dir, as **defense-in-depth behind the already-locked
`--tools ""` / `--allowedTools` launch flags**.

This is **deferred from v1** because:

- The programmatic input path is already neutralized — `sanitizeInput` strips the `!`-escape.
- Native tools are already denied at launch flags (`--tools ""` / the MCP allowlist).
- It is provider-specific (Claude only — Codex `--sandbox read-only` and Gemini
  `--allowed-mcp-server-names jarvis` already block at launch).
- Fail-closed semantics + cross-engine scope need their own design.

Tracked as a follow-up issue under epic #47.
