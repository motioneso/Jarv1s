# In-container Claude permission-prompt visibility — design (spike-gated)

- **Issue:** #578 — UX: in-container Claude permission prompts are invisible to the user
- **Date:** 2026-06-28
- **Status:** problem + analysis confirmed; cross-mode permission mechanism **deferred to a research spike** (see §5). Part 1 (safe allowlist) is approved and may proceed independently.
- **Scope:** `packages/chat/src/live/` (Claude live engines), `packages/ai/src/gateway/`, the per-session launch config.

## 1. Problem

When the in-container Claude session hits a permission prompt (e.g. "Allow reading
from `Personal/`?"), the prompt appears only inside the container's multiplexer
pane. The web user sees nothing — Jarvis silently stalls mid-turn with no
indication it is waiting for input. The only way to unblock it today is to attach
to the container and answer the prompt manually. Discovered 2026-06-28 mid-answer
to "what facts can you tell me about yourself?", blocked on a vault file read.

## 2. Root cause (confirmed)

The Claude live engines launch with `--permission-mode default` and
`--allowedTools "mcp__jarvis__*"` (`cli-chat-engine.ts:480`,
`claude-print-chat-engine.ts:138`). The MCP allowlist pre-approves jarvis MCP
tools, but Claude's **native** tools (`Read`/`Glob`/`Bash`/…) are neither disabled
nor allowlisted in the MCP-wired path, so using a native tool (e.g. reading a vault
file) triggers Claude's own permission prompt.

In the **interactive TUI engine** (`CliChatEngineImpl`, the current default for
anthropic — `runtime.ts:99`) that prompt renders in the REPL inside the
multiplexer pane, which no web user can see → the invisible stall.

The Codex path already avoids this by running never-prompt
(`approval_policy="never"`, `cli-chat-engine.ts:521-524`). The Claude interactive
path never got an equivalent guarantee.

## 3. What already exists (reuse target)

Jarvis already has a complete blocking approve/deny-in-chat channel, used today for
MCP tool calls routed through the gateway:

- `ConfirmationRegistry` (`packages/ai/src/gateway/`) blocks a tool call awaiting a
  user decision — **150s timeout, fail-closed to deny** (`gateway.ts:171`,
  `routes.ts:589`).
- `gateway-notifier.ts` emits an `action_request` into the chat stream
  ("Approve or deny: <summary>") with an `actionRequestId`.
- `action-request-card.tsx` renders the approve/deny card in the drawer; the click
  POSTs `confirmed`/`rejected` (`routes.ts:271`); the gateway unblocks the call.

The gap: this channel intercepts only **MCP tools through the gateway**. Claude's
**native** tool permissions bypass it. The design goal is to route native-tool
permission decisions into this same existing channel — without a new bespoke UI.

## 4. Part 1 — safe allowlist (approved, mode-independent)

Independent of the cross-mode question, pre-approve a tight, **read-only,
path-scoped** safe set so the most common prompt never arises:

- `mcp__jarvis__*` (unchanged) plus `Read` / `Glob` / `Grep` scoped to the vault
  mount (issue cites `/data/external-notes/**`; **confirm the exact path the
  in-container session sees at build time** — the live CLI runs in a neutral dir
  outside the repo, so the vault mount path must be established, not assumed).
- No write/execute tools in the safe set. Reads are the user's own vault content.

This preserves the hard invariants: no permission bypass, default-deny posture,
RLS still governs the data layer. It eliminates the single most frequent prompt
and is safe to ship before the spike resolves.

## 5. Part 2 — cross-mode permission interception (RESEARCH SPIKE)

**Constraint (Ben, 2026-06-28):** Jarvis must support **both** the interactive
CLI/TUI mode (`CliChatEngineImpl`) **and** the non-interactive print mode
(`claude -p`, `ClaudePrintChatEngine`). The permission solution must cover both.

This is unresolved because the cleanest per-mode mechanisms do not overlap:

- **`--permission-prompt-tool <mcpTool>`** routes permission decisions to an MCP
  tool on the existing gateway — clean, reuses the trust boundary, cannot hang.
  **But it is headless-only (`-p`); it has no effect in the interactive REPL.**
- **`PreToolUse` hook** (in a written `.claude/settings.json`, mirroring the
  per-session `.gemini/settings.json` pattern at `cli-chat-engine.ts:593`) is
  **mode-agnostic** — it can intercept native tools in both the REPL and `-p`. A
  hook can allowlist safe reads and, for anything else, block and call into the
  `action_request` channel, returning `allow`/`deny`. **But** it introduces a new
  privileged component (network + auth + fail-closed + `0600` lockdown) and would
  duplicate decision logic outside the gateway.

### Spike questions (exit criteria)

1. Does a `PreToolUse` hook reliably intercept **every** native tool (Read, Glob,
   Bash, Write, Edit, WebFetch, …) in the **interactive REPL**, and return a
   programmatic `allow`/`deny` without any TUI prompt rendering?
2. Can a hook **block** for the confirmation window (align to the 150s
   `ConfirmationRegistry` timeout) while it awaits the user's decision, and
   fail-closed (deny) on timeout — in both modes?
3. How does the hook authenticate its blocking call into the `action_request`
   channel without exposing a secret on the process line or in the neutral dir
   (reuse the MCP bearer pattern? a separate scoped token)?
4. Does `--permission-prompt-tool` compose with a `PreToolUse` hook in `-p` (do we
   need both, or does one mechanism cover both modes)?
5. Recommended unified architecture: single mode-agnostic hook for both modes, or
   hook (TUI) + permission-prompt-tool (`-p`)? What is the per-turn latency cost of
   a blocking hook?

### Spike deliverable

A findings note in `docs/superpowers/spikes/YYYY-MM-DD-cli-permission-interception.md`
(following the existing `2026-06-08-cli-capability-matrix.md` spike pattern) with a
working prototype demonstrating native-tool interception → `action_request` card →
blocking decision → `allow`/`deny`, in **both** modes. The spike's recommendation
feeds the final implementation design for Part 2.

## 6. Backstop (in scope, mode-independent)

Add a **stall watchdog**: if a turn emits no transcript output for N seconds and
nothing is pending in the `ConfirmationRegistry`, end the turn with a visible
message ("Jarvis got stuck") instead of hanging. This covers non-permission stalls
(CLI crash, network) and bounds the worst case even before Part 2 lands.

## 7. Non-goals

- No `--dangerously-skip-permissions` for the Claude path (violates the no-bypass
  invariant for native tools).
- No bespoke approve/deny UI — reuse the existing `action_request` card.
- No scraping/parsing of the multiplexer pane's TUI text to detect prompts (brittle;
  the structured hook / permission-prompt-tool mechanisms replace it).
- No change to the data-layer authorization model; this is CLI tool-permission UX
  only.
