# Provider Execution Mode Spike (#517)

**Status:** Draft / Spike
**Date:** 2026-06-26
**Owner:** Codex
**GitHub:** #517
**Grounded on:** `~/Jarv1s/packages/chat/src/live/types.ts` (`CliChatEngine` is a persistent session contract: `launch` / `submit` / `readNew` / `isAlive` / `kill`), `~/Jarv1s/packages/chat/src/live/chat-session-manager.ts` (`ChatSessionManager` owns one live engine per user and is built around launch/replay/poll/reap behavior), `~/Jarv1s/packages/chat/src/live/cli-chat-engine.ts` (current live providers run as long-lived CLI sessions with provider-specific transcript/runtime behavior), `~/Jarv1s/apps/web/src/settings/settings-ai-admin-pane.tsx` (existing admin home for AI provider settings).

## 1. Decision

Run a strictly technical spike for an **optional provider-level execution mode** setting in admin AI
provider settings:

- Label: **Execution mode**
- Options: **Interactive** and **Non-interactive**
- Scope: **provider-level**, applies across **all capabilities** that route through that provider
- Access: **admin-only**
- UI home: existing admin AI provider settings, per provider

This spike does **not** approve implementation. It answers whether Jarv1s can support a
non-interactive provider mode without user-visible behavior regressions.

## 2. Success bar

The bar is **parity with interactive mode**. A user should not notice a difference in normal use.

If a provider fails parity, non-interactive mode is **blocked for that provider** and the spike must
record the follow-up research needed before any product decision.

## 3. Why this is a spike, not a build spec

The current live chat stack is not a one-shot prompt runner. It is built around a **persistent
session** contract:

- `launch`
- `submit`
- `readNew`
- `isAlive`
- `kill`

That matters because a non-interactive or multiplexed provider mode may break assumptions Jarv1s
currently relies on:

- long-lived per-user session continuity
- transcript polling and incremental reads
- approval / action-request surfacing
- tool invocation shape and MCP wiring
- runtime cleanup and liveness checks

This spike exists to measure those gaps before any implementation plan is written.

## 4. Locked decisions

- The setting is **provider-level**.
- It applies across **all capabilities** for that provider.
- It is **admin-only**.
- It lives in **admin AI provider settings**, per provider.
- The control label is **Execution mode** with options **Interactive** and **Non-interactive**.
- No tooltip or helper copy should over-promise behavior before the spike is complete.
- This is a **technical** spike, not a product-facing spec.
- Providers to test: **claude**, **codex**, **agy**.
- The spike must test:
  - live chat behavior
  - multi-turn continuity
  - tool access
  - approval / action-request parity
  - runtime differences
  - transcript differences
- The success bar is parity with interactive mode.
- If parity fails, the provider is blocked for non-interactive mode and flagged for follow-up.

## 5. Scope

The spike should answer whether each target provider can run in a non-interactive or multiplexed
mode while preserving the behavior Jarv1s currently gets from interactive persistent sessions.

The spike includes:

- technical evaluation of the provider/runtime path, not a product launch recommendation
- provider-by-provider findings for **claude**, **codex**, and **agy**
- explicit parity verdicts against the current interactive path
- concrete blockers, if any, tied to current runtime assumptions

The spike does not include:

- shipping the setting
- changing routing policy
- defaulting any provider to non-interactive mode
- new user-facing copy beyond the locked control label/options
- rollout or enablement decisions beyond "blocked" vs "eligible for a later build spec"

## 6. What the spike must test

For each target provider, compare **interactive** vs **non-interactive** mode on the same Jarv1s
flows.

### 6.1 Live chat

- Can Jarv1s still produce streamed or incrementally-readable output that fits the existing
  `submit` + `readNew` loop?
- Does the runtime still support turn completion detection without fragile heuristics?
- Does stop/kill behavior still work cleanly?
- Does liveness still map to `isAlive` in a trustworthy way?

### 6.2 Multi-turn continuity

- Can a later turn reliably see prior turns without replay drift or missing context?
- If the mode is not truly persistent, can Jarv1s emulate continuity without visible behavior
  differences?
- Does `/clear` or equivalent conversation reset stay correct?

### 6.3 Tool access

- Are the same tools available?
- Are tool calls surfaced in a way that matches current transcript/action handling?
- Does MCP access still work, including auth and per-session isolation expectations?

### 6.4 Approval / action-request parity

- Does the provider still surface approvals or action requests in a shape Jarv1s can map to current
  records?
- Can approve / deny flows behave the same way?
- Are there new unsafe or silent-execution paths that would bypass current expectations?

### 6.5 Runtime / transcript differences

- Does the provider still emit artifacts Jarv1s can poll incrementally?
- Are transcript formats different enough to require adapter work?
- Does the runtime create different cleanup, timeout, or reconnection risks?

## 7. Technical questions the spike must answer

1. Can each provider support Jarv1s' current persistent-session expectations directly, or would
   non-interactive mode require a different engine contract?
2. If the provider is effectively one-shot in non-interactive mode, can Jarv1s preserve multi-turn
   continuity without user-visible regressions?
3. Can `readNew` semantics be preserved, or would Jarv1s need a transcript buffering/shim layer?
4. Can `isAlive` and `kill` remain real runtime controls, or do they degrade into best-effort
   process cleanup?
5. Do approval / action-request events still surface as explicit records, or do they collapse into
   opaque text output?
6. Does tool execution preserve the same permission boundaries and MCP behavior as interactive mode?
7. Are runtime/transcript differences provider-specific, or is there a shared non-interactive
   adapter shape worth pursuing later?
8. Is the setting truly safe to define at the **provider** level across all capabilities, or do any
   capabilities have hard technical blockers even when live chat passes?
9. For any failing provider, is the blocker:
   - adapter work inside Jarv1s
   - missing provider/runtime capability
   - unacceptable approval/tooling regression
   - transcript/runtime observability gap

## 8. Provider matrix

The implementer should fill this matrix with grounded findings from the spike.

| Provider | Current Jarv1s path | Non-interactive runtime shape | Live chat parity | Multi-turn parity | Tool parity | Approval / action-request parity | Runtime / transcript notes | Verdict | Follow-up needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| claude | Persistent interactive `claude` session launched by `CliChatEngineImpl.buildClaudeCommand()` with `--session-id`, transcript polling, MCP config file, and manager-owned turn loop | `claude -p` / `--print`, with session persistence still present unless `--no-session-persistence` is set; `--resume` and `--session-id` are available in print mode | unknown | unknown | unknown | unknown | Print mode did persist the requested session id to `~/.claude/projects/.../<session-id>.jsonl`, but runtime evaluation was blocked by a `429` weekly limit during the spike window on **June 26, 2026** | unknown | Re-run the same two-turn and tool probes once the Claude non-interactive account limit resets; verify streamed output, transcript records, tool surfacing, and MCP/approval behavior |
| codex | Persistent interactive `codex` session launched by `CliChatEngineImpl.buildCodexCommand()` with transcript polling under `~/.codex/sessions`, MCP config flags, and explicit MCP auto-approval tuning | `codex exec` non-interactive mode, with persisted session files by default and `codex exec resume` for follow-up turns | pass | pass | blocked | unknown | Non-interactive `exec` preserved session continuity and still wrote `task_complete` records Jarv1s can detect, but tool execution surfaced as `response_item` `function_call` / `function_call_output` records rather than the interactive-path `event_msg` `exec_command_end` shape Jarv1s currently parses | blocked | Adapter work would be required to parse non-interactive Codex tool records and re-map them into Jarv1s transcript/action handling before this mode could reach parity |
| agy | Persistent interactive `agy` session launched by `CliChatEngineImpl.buildGeminiCommand()` with transcript polling under `~/.gemini/tmp/.../chats/*.jsonl` and settings-file MCP headers | `agy --print`, with `--continue` / `--conversation` for follow-up turns; runtime persisted logs under `~/.gemini/antigravity-cli/brain/.../transcript_full.jsonl` during the spike | blocked | pass | blocked | blocked | Print mode used a different Antigravity planner transcript schema than the interactive Gemini chat JSONL Jarv1s parses today; a simple file-read probe timed out after unrelated tool exploration instead of returning the local file promptly | blocked | Requires new transcript parsing, new tool/action mapping, and proof that print-mode tool execution can be constrained and observed with parity to the current interactive engine |

Use these verdicts only:

- `pass` — parity achieved; eligible for a later build spec
- `blocked` — parity failed; non-interactive mode is blocked for this provider
- `unknown` — spike incomplete; more research required before any build spec

## 8.1 Initial grounded findings

This section captures the current runtime facts before any build work:

- Jarv1s live chat is currently built around one long-lived `CliChatEngine` per user session, and
  `ChatSessionManager` assumes the engine supports `launch`, `submit`, incremental `readNew`,
  `isAlive`, and `kill`.
- `ChatSessionManager` persists conversation state outside the provider runtime, but live parity
  still depends on an engine that can be relaunched and then replay prior turns without user-visible
  drift.
- Approval and action-request records are not derived only from provider transcripts. The manager
  also supports synthetic `action_request` / `action_result` injection via `injectRecord()` from
  the MCP gateway path, so any non-interactive mode still has to preserve MCP/session isolation and
  the live fan-out shape.
- Current transcript parsing is provider-specific:
  - `claude` final-turn detection is driven by transcript `assistant` records with
    `message.stop_reason === "end_turn"`.
  - `codex` final-turn detection is driven by `event_msg` / `task_complete` records.
  - `agy` final-turn detection is driven by `type === "gemini"` records with non-empty `content`.
- Current local CLI surfaces confirm that all three providers expose a one-shot/non-interactive
  entrypoint, but that does not prove Jarv1s parity:
  - `claude` defaults to interactive mode and advertises `-p` / `--print` for non-interactive
    output.
  - `codex` defaults to interactive mode and exposes a distinct `codex exec` non-interactive path.
  - `agy` exposes `--print` / `--prompt` for non-interactive mode.

## 8.3 Shared adapter constraints already visible in code

- A provider-level execution mode would not be UI-only. It would have to flow through provider
  config storage, provider DTOs, route payloads, and the chat runtime's engine selection path.
- A pure one-shot mode does not fit the current `CliChatEngine` contract. Jarv1s would need either:
  - a compatibility shim that emulates `readNew` / `isAlive` / `kill`, or
  - a separate engine contract and a manager/runtime fork.
- `readNew` parity is a hard constraint, not an optimization. `ChatSessionManager.runTurn()` is
  structured around incremental polling and resets the activity deadline only when new records are
  observed.
- `/clear`, provider switching, idle reaping, reconciliation, and stop/kill behavior all assume
  there is a concrete live session to destroy. A non-interactive provider mode must either preserve
  a real runtime handle or accept behavior drift here.

## 8.4 Executed runtime findings

The spike ran direct non-interactive probes on **June 26, 2026** using the local CLIs available in
this environment.

### Claude

- `claude auth status` succeeded, so the CLI itself is authenticated in this environment.
- `claude -p --session-id <uuid>` and `claude -p --resume <uuid>` both persisted to the expected
  Claude transcript path under `~/.claude/projects/.../<session-id>.jsonl`.
- Both non-interactive turns failed before real model execution with a `429` weekly limit message:
  "You've hit your weekly limit · resets 11am (America/Los_Angeles)".
- Because the run never reached a successful assistant/tool turn, live-chat parity, tool parity,
  and approval parity remain unproven here.

### Codex

- `codex login status` succeeded.
- `codex exec --json` produced a persisted session and `codex exec resume --last --json` correctly
  reused the same thread id on a second turn, preserving prior-turn continuity.
- Final-turn detection remains compatible enough for Jarv1s' current `reply` completion path:
  the session JSONL still emitted `event_msg` records with `task_complete`.
- Tool execution shape diverged from the current interactive-path parser assumptions:
  a file-read probe emitted `response_item` records of type `function_call` and
  `function_call_output`, while the current `mapCodexRecord()` parser only recognizes tool activity
  when it appears as `event_msg` `exec_command_end`.
- That transcript mismatch is sufficient to fail parity today even though basic one-shot and
  multi-turn completion worked.

### Agy

- `agy --print` succeeded for simple text-only turns, and `agy --continue --print` preserved enough
  conversation state for a second turn to recall the first answer.
- The persisted non-interactive log did **not** land in the interactive Gemini chat transcript path
  Jarv1s currently reads (`~/.gemini/tmp/.../chats/*.jsonl`). Instead it wrote to
  `~/.gemini/antigravity-cli/brain/.../.system_generated/logs/transcript_full.jsonl`.
- That log uses an Antigravity planner schema (`USER_INPUT`, `PLANNER_RESPONSE`, `LIST_DIRECTORY`,
  `tool_calls`, etc.), which the current Jarv1s Gemini parser does not understand.
- A simple file-read tool probe (`Read ./word.txt and reply with only its contents.`) timed out
  after ~20 seconds while the runtime wandered through unrelated directories (`/home/ben`,
  `~/.gemini/antigravity-cli`) instead of returning the local file promptly.
- That combination fails live/runtime parity and tool/action parity outright.

## 9. Expected deliverables

- A provider-by-provider findings write-up
- The completed matrix in §8
- A short summary of shared adapter/runtime constraints
- A clear verdict for each provider: `pass`, `blocked`, or `unknown`
- Follow-up research items only where parity fails or remains unproven

## 10. Acceptance criteria

- The spike documents the current constraint that Jarv1s live chat is built around a persistent
  `launch` / `submit` / `readNew` / `isAlive` / `kill` contract.
- The spike evaluates **claude**, **codex**, and **agy** separately.
- The spike explicitly tests and records findings for:
  - live chat behavior
  - multi-turn continuity
  - tool access
  - approval / action-request parity
  - runtime differences
  - transcript differences
- Each provider gets a parity verdict: `pass`, `blocked`, or `unknown`.
- Any provider that fails parity is explicitly marked **blocked** for non-interactive mode.
- The document stays technical and avoids product/rollout recommendations beyond those provider
  verdicts.
- The output is sufficient to support a later implementation spec, or to stop one.

## 11. Blast radius to inspect during the spike

This is not an implementation checklist. It is the minimum set of surfaces the spike must verify so
findings are grounded in the real runtime:

- Admin AI provider settings UI, where the future control would live
- Provider routing/config selection for all capabilities using that provider
- Live chat session manager and engine contract
- Provider-specific launch/runtime adapters
- Transcript parsing / incremental read behavior
- Approval / action-request mapping
- MCP/tool access path and session isolation expectations

## 12. Out of scope

- Implementing the setting
- Choosing a default execution mode
- Provider rollout sequencing
- User-facing education/copy beyond the locked control label/options
- Relaxing parity expectations for a provider just to make non-interactive mode ship
- Replacing the persistent live-chat contract in this spike
