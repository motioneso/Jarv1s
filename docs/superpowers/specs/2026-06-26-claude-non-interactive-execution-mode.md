# Claude Non-Interactive Execution Mode

**Date:** 2026-06-26
**Status:** Draft design - pending live validation after Claude quota reset
**Owner:** Codex
**GitHub:** Follow-up to #517; paired with #521 and #522
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-26-provider-execution-mode-spike.md`, `~/Jarv1s/packages/ai/src/adapters/transcript-reader.ts`, `~/Jarv1s/packages/chat/src/live/types.ts`, `~/Jarv1s/packages/chat/src/live/runtime.ts`, `~/Jarv1s/packages/chat/src/live/cli-chat-engine.ts`, local `claude --help` output on 2026-06-26

## Problem

Jarv1s already runs Claude through the current interactive CLI path, with transcript polling under
`~/.claude/projects/.../<session-id>.jsonl`. The provider execution-mode spike confirmed that the
local Claude CLI is authenticated and that `claude -p --session-id <uuid>` / `claude -p --resume
<uuid>` write to the expected Claude transcript path, but the actual model turn was blocked by the
Claude weekly limit on June 26, 2026.

The remaining design question is not whether Claude exposes a non-interactive mode. It does:
`claude -p` / `--print`, `--resume`, and `--session-id` are all available locally. The question is
how to wire that mode through Jarv1s while preserving the same behavior as interactive mode.

## Goal

Add Claude support for the provider-level **Execution mode** preference. When an Anthropic/Claude
provider is configured for **Non-interactive**, Jarv1s should run Claude through `claude --print`
while keeping the existing live chat contract and user-visible behavior intact.

Success means:

- the admin provider config controls Claude execution mode
- routing honors the configured mode
- `ChatSessionManager` still talks to a normal `CliChatEngine`
- transcript parsing still surfaces thinking, tool activity, status, and final reply
- MCP/action visibility is not weaker than interactive mode
- live parity is validated after the Claude account limit resets

## Non-Goals

- No separate chat manager path for Claude print mode.
- No silent fallback from non-interactive mode to interactive mode.
- No default change for existing Claude providers.
- No `--no-session-persistence`; print-mode sessions must remain resumable.
- No weakening of Claude launch security flags or MCP isolation.

## Locked Decisions

- `Execution mode` remains provider-level and admin-owned.
- The shared provider-config/API/UI plumbing from #521 is reused.
- Claude print mode is hidden behind an adapter that implements the existing `CliChatEngine`
  contract.
- The implementation may be built before live validation, but shipping remains gated on a successful
  live smoke after the Claude quota reset.
- Loss of tool/action visibility is a blocker.

## Design

### Provider Config Surface

Use the shared `executionMode` provider field:

- `interactive`
- `non_interactive`

No Claude-specific settings are added. The provider row determines which engine implementation the
runtime factory builds after normal capability routing selects the provider/model.

### Runtime Strategy

Claude print mode should use a small Claude-specific non-interactive engine that still implements
`CliChatEngine`:

- `launch()` stores the neutral dir, persona path/content, MCP config file path, session id, and
  transcript path.
- `submit(text)` starts one `claude --print` process in the multiplexer with either
  `--session-id <uuid>` for the first turn or `--resume <uuid>` for later turns.
- `readNew(afterOffset)` reads the normal Claude transcript JSONL and uses the existing
  Anthropic parser.
- `isAlive()` and `kill()` proxy to the current print-mode process handle.

This mirrors the Agy print-mode shape, but Claude is simpler because print mode uses the same
Claude transcript family Jarv1s already parses.

### Launch Command

The print-mode command keeps the existing Claude security posture:

- `--permission-mode default`
- `--mcp-config <0600 file>` plus `--allowedTools "mcp__jarvis__*"` when MCP is enabled
- `--tools ""` when MCP is not enabled
- `--append-system-prompt-file <personaPath>`
- `--strict-mcp-config`
- model override flag only when configured
- no `--no-session-persistence`

First turn:

```bash
claude -p --session-id <uuid> <prompt>
```

Later turns:

```bash
claude -p --resume <uuid> <prompt>
```

The prompt should be passed via a temporary prompt file and `$(cat <file>)`, matching the Agy print
engine pattern. The MCP bearer must stay in the existing `0600` config file, not in argv, logs, or
pane text.

### Transcript Semantics

Claude print mode should continue writing records shaped like the current Claude Code JSONL:

- `type: "assistant"` with `message.content[]`
- `message.stop_reason === "tool_use"` for intermediate tool/thinking records
- `message.stop_reason === "end_turn"` for final reply

Because the transcript family is the same, the existing `mapAnthropicRecord()` parser should remain
sufficient. If live validation shows extra print-only records, add the smallest parser extension with
fixture coverage.

### Validation Gate

The June 26 spike could not validate full behavior because Claude returned a `429` weekly limit. The
implementation may proceed with unit tests and command-shape tests, but the mode is not complete
until a live smoke verifies:

- two-turn continuity with `--session-id` then `--resume`
- transcript records are emitted incrementally
- tool activity appears in transcript records
- MCP/action visibility is preserved
- stop/kill terminates an in-flight print turn cleanly

## Components

### Shared Execution Mode Plumbing

Reuse #521's provider config, API, and admin UI work. This spec adds Claude runtime support only.

### Claude Print Engine

Create a focused engine implementation rather than adding print-mode branches throughout
`CliChatEngineImpl`. The engine should share existing helpers where practical, but avoid exposing a
new manager contract.

### Transcript Reader

No parser change is expected initially. Add only fixture-backed changes if print-mode validation
reveals a new record shape.

## Error Handling

- If Claude print launch fails, surface the same unavailable path used by existing CLI launch
  failures.
- If the transcript file does not exist yet, `readNew()` returns no records and preserves the prior
  offset.
- If live validation fails after quota reset, keep Claude non-interactive mode blocked.
- No automatic fallback to interactive mode.

## Security And Invariants

- Secrets never appear in launch argv, capture-pane output, logs, or prompt files.
- MCP config remains file-backed and `0600`.
- `ChatSessionManager` and the public `CliChatEngine` contract remain unchanged.
- Claude interactive mode remains the default.
- Live parity is required before enabling the mode as complete.

## Verification

- Unit test Claude print command construction.
- Unit test first turn uses `--session-id` and later turns use `--resume`.
- Unit test `readNew()` parses existing Claude JSONL fixtures through the print engine.
- Regression test existing interactive Claude transcript parsing.
- After quota reset, run a live two-turn Claude print smoke and a tool/MCP visibility smoke.

## Acceptance Criteria

- Claude providers can be routed to non-interactive runtime when provider config says
  `executionMode: "non_interactive"`.
- Claude print mode satisfies the existing `CliChatEngine` interface.
- Existing Claude transcript parsing continues to work.
- First-turn and resume command shapes are covered by tests.
- Live validation after quota reset confirms parity before this is marked complete.
