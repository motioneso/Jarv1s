# Agy Non-Interactive Print Mode Viability

**Date:** 2026-06-26
**Status:** Approved — design complete; build blocked pending Agy runtime parity proof
**Owner:** Codex
**GitHub:** #522
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-26-provider-execution-mode-spike.md`, `~/Jarv1s/packages/ai/src/adapters/transcript-reader.ts`, `~/Jarv1s/packages/chat/src/live/types.ts`, `~/Jarv1s/packages/chat/src/live/runtime.ts`, `~/Jarv1s/packages/chat/src/live/chat-session-manager.ts`, `~/Jarv1s/apps/web/src/settings/settings-ai-admin-pane.tsx`, `~/Jarv1s/packages/shared/src/ai-types.ts`

## Problem

The June 26, 2026 spike showed that `agy --print` and `agy --continue --print` can preserve simple
text-only multi-turn continuity, but it did not show runtime parity with Jarv1s' current
interactive Gemini/Agy path.

Unlike Codex, Agy non-interactive mode does not only present a new transcript shape. It appears to
use a different runtime family:

- non-interactive logs land under the Antigravity transcript path, not the interactive Gemini chat
  transcript family Jarv1s currently reads
- the transcript schema is planner-oriented (`USER_INPUT`, `PLANNER_RESPONSE`, `LIST_DIRECTORY`,
  `tool_calls`, etc.)
- a simple file-read prompt wandered through unrelated directories and timed out instead of
  returning the local file promptly

That means Agy print mode is not implementation-ready yet. First it has to prove that it can meet
the same parity bar Jarv1s already gets from interactive mode.

## Goal

Design the end-to-end provider-execution-mode support Jarv1s would need for Agy print mode, but
treat build work as blocked until the runtime proves full parity with interactive mode for:

- admin configuration
- routing to preferred mode
- transcript semantics
- tool-use visibility
- approval/action visibility
- completion/liveness/stop behavior

## Non-Goals

- Do not ship Agy non-interactive mode from this spec alone.
- Do not weaken the parity bar to “good enough for text-only turns.”
- Do not add fallback behavior where Jarv1s silently uses interactive mode instead.
- Do not fork the system-wide `CliChatEngine` contract to accommodate Agy.
- Do not promise product enablement before the runtime path is proven viable.

## Locked Decisions

- `Execution mode` is still a provider-level admin-owned setting.
- The full end-to-end design must include admin toggle, persistence, routing, and runtime use of the
  preferred mode.
- There must be no user-visible behavior difference between interactive and print mode.
- Transcript parity alone is insufficient; approval/action visibility parity is also required.
- Jarv1s should hide runtime differences inside provider-specific adapter/engine work, not in the
  manager contract.
- If Agy print mode cannot reach parity, the outcome is a blocker record, not a degraded launch.

## Design

### Provider Config Surface

Use the same provider-level `executionMode` field as the Codex design:

- `interactive`
- `non_interactive`

Persist it in provider config and expose it through the admin provider DTOs. This is still worth
designing even if Agy remains blocked, because the setting model should be uniform across providers.

### Admin UI

The admin AI provider settings pane should render the same `Execution mode` control for the Google
/ Agy provider row. The UI behavior is not the risky part here. The risky part is whether the mode
behind that control can actually honor the parity promise once selected.

This spec therefore includes the UI and persistence path, but release remains blocked on runtime
viability.

### Routing And Launch Selection

Routing still chooses the provider/model first. Execution mode is a provider runtime preference
applied after routing.

If Agy is configured for `non_interactive`, the runtime layer must choose the print-mode launch
path. But unlike Codex, this path is explicitly provisional. Jarv1s should not wire the mode live
until the viability work below proves that the print-mode engine can satisfy the existing live
contract without weakening behavior.

### Viability Questions

This spec exists to answer five concrete questions.

#### 1. Can print mode support incremental `readNew` semantics?

Why it matters: `ChatSessionManager` is built around incremental transcript polling, not one-shot
full-response buffering.

The Agy runtime currently writes to a different Antigravity transcript family. Jarv1s needs to know
whether that transcript can be tailed incrementally and mapped into `TranscriptRecord`s in a stable
way, or whether the runtime only yields a buffered final result.

If the answer is “only buffered final output,” parity has failed.

#### 2. Can print mode tool activity be mapped cleanly?

Why it matters: tool use is part of the visible transcript and of Jarv1s' safety model.

The viability work must document the exact Antigravity print-mode record shapes for:

- reasoning/planner steps
- tool invocation
- tool result
- status/narration
- final reply

Then it must prove those records can be translated into the same Jarv1s semantics as interactive
mode.

#### 3. Can approval/action visibility be preserved?

Why it matters: the user explicitly wants no difference between interactive and print mode.

If print mode collapses approval-relevant behavior into opaque planner text, or bypasses the current
MCP/action visibility path, parity has failed even if the final answer text looks good.

#### 4. Can print mode obey the same local-runtime boundaries?

Why it matters: the spike found a file-read request that wandered through unrelated directories and
timed out.

This is not a cosmetic bug. It suggests print mode may have different planner/tool behavior from
interactive mode. Viability requires explaining whether that was:

- prompt phrasing noise
- transcript-observation noise
- a real runtime/tool-policy difference
- a print-mode bug or limitation

If the runtime really explores or executes differently enough that local-tool behavior is less
predictable than interactive mode, parity has failed.

#### 5. Can stop/liveness semantics be preserved?

Why it matters: the manager watchdog, stop-turn, and reconciliation loops assume a real runtime that
can be observed and halted.

The viability work must prove whether Agy print mode supports:

- trustworthy completion detection
- meaningful liveness checks
- clean stop/kill behavior
- replay/resume semantics without drift

### Candidate Runtime Shapes

There are two viable implementation shapes only if the answers above come back positive.

#### Option A: One engine, provider-specific print-mode shim

Use the current `CliChatEngine` contract and hide Agy print-mode differences in the engine/adapter.

This is the preferred shape if parity proves achievable, because it matches the Codex plan and keeps
the manager unchanged.

#### Option B: Buffered compatibility shim

If the Antigravity transcript cannot really be tailed but can still preserve all other semantics, a
compatibility shim could buffer print-mode output and emit synthetic incremental records.

This option is not preferred because it is easier to get subtly wrong, and it risks fake parity
instead of real parity. It is acceptable only if the viability work proves that the shim does not
hide approval/action or tool-boundary differences.

If neither option preserves real parity, Agy print mode remains blocked.

## Components

### Shared Types And Provider Config

Use the same provider-config `executionMode` plumbing as the Codex design so the admin/config model
stays uniform.

### Admin Settings Pane

Render and persist the `Execution mode` field for the Google/Agy provider card through the existing
admin pane.

### Runtime Investigation Layer

The actual work before implementation is to capture and document representative Agy print-mode
transcripts for:

- plain two-turn conversation
- tool-free final completion
- local file-read tool usage
- any approval-like or action-like flow available in this runtime
- interruption / timeout / failure cases

### Transcript Reader Feasibility

Only after those transcript samples exist should Jarv1s decide whether to extend
`transcript-reader.ts` or add a provider-specific Agy print-mode mapper. The exact code shape should
follow the smallest path that still preserves one semantic model for the provider.

## Error Handling

- Unsupported or unknown execution-mode values are rejected at the API boundary.
- If the provider is configured for non-interactive mode before viability is proven, runtime use of
  that mode must remain blocked by policy rather than silently degrading.
- Transcript parsing should keep the current tolerant handling of partial JSONL lines if the
  transcript family is line-oriented.
- If Agy print mode cannot surface enough structure for safe parity, Jarv1s should fail closed and
  keep the provider interactive-only.

## Security And Invariants

- No weakening of MCP approval boundaries.
- No silent fallback from print mode to interactive mode.
- No manager-contract fork to accommodate provider-specific runtime quirks.
- No acceptance of text-only parity as sufficient.
- No shipping until runtime behavior is proven equivalent enough to preserve Jarv1s semantics.

## Verification

Before implementation readiness, the viability work must produce:

- captured Agy print-mode transcript samples for the key scenarios above
- a documented mapping from Antigravity transcript records to Jarv1s transcript semantics, or a
  documented reason why such mapping is impossible
- an explanation of the directory-wandering file-read failure and whether it is fixable
- evidence of whether approval/action visibility survives in print mode
- evidence of whether stop/liveness/replay behavior matches the current manager expectations

If viability succeeds, then implementation verification should include:

- provider-config DTO/request tests for execution mode
- admin settings pane tests for the execution-mode control
- runtime-selection tests honoring the provider's preferred mode
- transcript-mapping tests against captured print-mode samples
- an end-to-end live test proving tool and action visibility parity

## Acceptance Criteria

- The spec defines the full end-to-end shape for provider execution mode: admin toggle, persistence,
  routing, and runtime selection.
- We have a grounded answer on whether Agy print mode can preserve interactive parity.
- If parity is achievable, the outcome is an implementation-ready follow-up using the existing live
  engine contract.
- If parity is not achievable, the blocker is recorded clearly enough to keep Agy interactive-only
  without further ambiguity.
