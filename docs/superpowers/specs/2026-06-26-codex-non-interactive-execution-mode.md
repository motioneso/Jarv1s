# Codex Non-Interactive Execution Mode

**Date:** 2026-06-26
**Status:** Approved — implementation complete (2026-06-28)
**Owner:** Codex
**GitHub:** #521
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-26-provider-execution-mode-spike.md`, `~/Jarv1s/packages/ai/src/adapters/transcript-reader.ts`, `~/Jarv1s/packages/chat/src/live/types.ts`, `~/Jarv1s/packages/chat/src/live/runtime.ts`, `~/Jarv1s/packages/chat/src/live/chat-session-manager.ts`, `~/Jarv1s/apps/web/src/settings/settings-ai-admin-pane.tsx`, `~/Jarv1s/packages/shared/src/ai-types.ts`

## Problem

Jarv1s can already run Codex in its current interactive path, and the June 26, 2026 spike showed
that `codex exec --json` plus `codex exec resume --last --json` can preserve non-interactive
multi-turn continuity. The remaining gap is not basic turn completion. The gap is that
non-interactive Codex emits tool/runtime activity in a different transcript shape than the
interactive path Jarv1s currently parses.

Today Jarv1s assumes Codex transcript parity means:

- a provider config can be selected by admin settings
- routing picks that provider for chat/tool-use capabilities
- the live engine still satisfies the existing `CliChatEngine` contract
- transcript parsing surfaces thinking, tool activity, status, and final reply
- approval/action visibility does not weaken relative to interactive mode

Codex non-interactive mode is only shippable if Jarv1s can make it look identical to interactive
mode from the rest of the system's point of view.

## Goal

Add a provider-level **Execution mode** preference for Codex with values **Interactive** and
**Non-interactive**, persist that preference in provider config, route chat launches through the
preferred mode, and make non-interactive Codex preserve full interactive parity by adapting its
runtime/transcript differences inside Jarv1s rather than changing the system-wide live engine
contract.

## Non-Goals

- No user-visible behavior difference between interactive and non-interactive Codex modes.
- No fallback behavior where Jarv1s silently swaps modes at runtime.
- No engine-contract fork. `launch` / `submit` / `readNew` / `isAlive` / `kill` stay the contract.
- No product rollout/default decision beyond making the provider setting available once parity is
  implemented.
- No changes to non-Codex providers in this spec except shared type plumbing needed to store the
  execution-mode preference.

## Locked Decisions

- `Execution mode` is a provider-level admin-owned setting.
- The setting must be persisted in provider config and returned in provider DTOs.
- Routing must honor the configured execution mode for the active provider.
- Interactive and non-interactive mode are internal runtime choices only.
- Non-interactive Codex must preserve transcript parity and approval/action visibility parity.
- Jarv1s must hide the runtime differences inside the adapter/engine layer, not expose a second
  live-engine contract to the manager.
- If parity cannot be preserved, the mode does not ship.

## Design

### Provider Config Surface

Extend AI provider config to carry an execution-mode enum for CLI-backed providers:

- `interactive`
- `non_interactive`

This belongs with provider config rather than model config because the issue is runtime behavior of
the provider binary, not model selection. The provider DTO returned by
`ListAiProviderConfigsResponse` should expose the stored mode so the admin pane can render and edit
it.

The setting should be accepted for all provider rows in schema shape so the config model stays
uniform, but only Codex is in scope to actually honor `non_interactive` in this spec.

### Admin UI

In the existing admin AI provider settings pane, each provider card gets an `Execution mode`
control with:

- `Interactive`
- `Non-interactive`

The control is admin-only and stored through the same provider update route already used for status,
display name, and auth method changes. The UI does not need product copy beyond the field label and
the two options. The behavior promise comes from the runtime: whichever mode is selected must behave
the same in chat.

### Routing And Launch Selection

Routing still chooses the active provider/model exactly as it does today. Execution mode is a
second-stage runtime decision after provider routing, not a separate route dimension.

When the selected provider is `openai-compatible` and its configured execution mode is
`non_interactive`, the engine factory should build a Codex launch path that uses the non-interactive
runtime shape while still presenting the normal `CliChatEngine` interface to
`ChatSessionManager`.

That means:

- `ChatSessionManager` does not branch on execution mode.
- `CliChatEngine` interface does not change.
- The Codex engine implementation owns the differences in launch command, transcript discovery, and
  record mapping.

### Runtime Strategy

Keep one Codex engine implementation with two internal launch/read strategies:

- interactive: existing `codex` session flow
- non-interactive: `codex exec --json` plus resume behavior

The manager still sees one persistent per-user engine. For non-interactive mode, the engine is
responsible for preserving the illusion of persistence by:

- launching/resuming the correct Codex session
- reading the non-interactive transcript family
- translating non-interactive transcript records into normal Jarv1s `TranscriptRecord`s
- keeping completion/liveness/kill semantics compatible with the existing polling loop

This is a shim, not a second manager path.

### Transcript Mapping

This is the core Codex work.

Today `mapCodexRecord()` only recognizes interactive-path `event_msg` payloads such as:

- `agent_reasoning`
- `exec_command_end`
- `agent_message`
- `task_complete`

The spike established that non-interactive Codex still emits `task_complete`, but tool activity is
surfaced as `response_item` records of type:

- `function_call`
- `function_call_output`

The adapter must be expanded to parse both interactive and non-interactive Codex record families
and normalize them into the same Jarv1s semantics:

- reasoning/thoughts -> `thinking`
- tool invocation / tool completion -> `tool`
- non-final agent narration -> `status`
- final turn completion -> reply + `complete=true`

The implementation should prefer one Codex parser with both shapes rather than separate reader
files. The point is to preserve one provider semantic model even if Codex itself emits two record
families.

### Approval And Action Visibility

Transcript parity is not enough by itself. Jarv1s also needs non-interactive Codex to preserve the
current approval/action visibility model.

This spec treats the following as required:

- MCP-driven action requests still surface through the existing injected record path.
- Tool-use transcript mapping must not collapse important approval/action distinctions into opaque
  final text.
- Non-interactive mode must not create a silent tool path that bypasses the normal live transcript
  or MCP gateway assumptions.

If Codex non-interactive emits enough structure to map tool calls but not enough to preserve
approval/action visibility, parity has failed and the mode must remain blocked.

### Completion, Liveness, And Stop

The spike already showed that `task_complete` remains available in non-interactive mode, so final
reply detection should stay close to the current path.

What still must be implemented and verified:

- `readNew` must continue to surface appended records incrementally, not only a buffered final blob.
- `isAlive` must remain meaningful enough for the manager's watchdog/reconciliation behavior.
- `kill` / stop-turn semantics must still halt in-flight Codex work cleanly.
- transcript discovery must distinguish the correct resumed session from stale prior transcripts in
  the same neutral dir.

This work belongs in the engine layer, not in the manager.

## Components

### Shared Types And Contracts

Update provider DTOs and request types in `packages/shared/src/ai-types.ts` to include
`executionMode`.

Add a provider execution-mode enum in shared types and thread it through:

- provider list DTO
- create/update provider config requests
- tests using provider fixtures

### Provider Persistence And Routes

Add provider-config persistence for execution mode in the owning AI settings layer and return it
through the existing admin routes. The exact storage shape can follow the existing provider config
pattern; no separate table is needed.

### Admin Settings Pane

Update `apps/web/src/settings/settings-ai-admin-pane.tsx` so the provider card renders and submits
the execution-mode selection.

### Runtime Selection

Update the chat runtime/provider resolution path so the selected provider config reaches engine
construction with enough information to choose interactive vs non-interactive Codex launch behavior.

### Transcript Reader

Extend `packages/ai/src/adapters/transcript-reader.ts` so the Codex parser understands both
interactive and non-interactive record shapes.

### Tests

Add focused tests for:

- provider DTO/request shapes including execution mode
- admin pane rendering + mutation payloads
- runtime selection honoring provider execution mode
- Codex transcript parsing for `response_item.function_call`
- Codex transcript parsing for `response_item.function_call_output`
- parity of final reply detection in both modes
- no regression to existing interactive Codex transcript parsing

## Error Handling

- Unknown execution mode values are rejected at the API boundary.
- Non-interactive mode on a provider other than Codex stays rejected or ignored by policy until that
  provider has its own approved spec.
- If non-interactive Codex launch cannot produce parity-preserving transcript semantics, the launch
  should fail visibly rather than silently degrading into a weaker mode.
- Transcript lines that are partial or malformed should keep the current tolerant read behavior.

## Security And Invariants

- No weakening of MCP approval boundaries.
- No silent fallback from non-interactive to interactive mode.
- No provider-specific engine contract fork exposed to `ChatSessionManager`.
- No provider/model routing semantics change beyond honoring the configured execution mode.
- No secrets or provider tokens may leak into logs while adding new transcript parsing.

## Verification

- Unit test provider-config DTO/request shape changes.
- Unit test admin settings pane execution-mode controls.
- Unit test runtime selection for Codex interactive vs non-interactive mode.
- Unit test transcript parsing against captured non-interactive Codex JSONL samples containing
  `response_item.function_call` and `response_item.function_call_output`.
- Regression test that existing interactive Codex samples still emit the same `thinking`, `tool`,
  `status`, and final reply records.
- Integration test a live Codex non-interactive two-turn flow through Jarv1s with tool use visible
  in the transcript stream.

## Acceptance Criteria

- Admins can configure Codex `Execution mode` as `Interactive` or `Non-interactive`.
- The configured value is persisted and returned through provider APIs.
- Runtime selection honors the configured value for Codex.
- Non-interactive Codex preserves interactive parity for transcript events, completion, tool
  visibility, and approval/action visibility.
- `ChatSessionManager` and the shared `CliChatEngine` contract remain unchanged.
- If parity is not met, this spec is not implementation-complete and the mode remains blocked.
