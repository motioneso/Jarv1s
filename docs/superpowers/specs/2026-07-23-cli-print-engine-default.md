# Spec — Default the chat engine to one-shot (`-p` / `exec`) for all providers

**Status:** DRAFT — awaiting Ben approval (spec-before-build gate).
**Grounded on:** engine code read at `js-01-module-skeleton` @ `b3b7bdbd`; platform build branches
**fresh off `origin/main`** (`86b6bc2d` at drafting). Re-confirm tree freshness before build.
**Epic / tasks:** to be opened on approval (see §7).
**Owner decision (2026-07-23, Ben):** default all providers to the `-p` one-shot engine; **keep the
interactive route as an opt-in fallback** (not removed).

---

## 1. Problem

Jarvis's live chat drawer runs each session through a per-user CLI engine. Today the **default**
execution mode is the **interactive** long-running CLI session (a `claude` / `codex` / `agy` process
held open in a tmux pane, driven turn-by-turn). Ben's call: the interactive route is the fragile
part — a persistent session driving multi-step tool-use across async, human-gated approvals does not
compose reliably. It stalled live during job-search JS-02 UAT: the assistant proposed a write tool,
ended its turn telling the user to approve, and after approval nothing resumed the sequence.

Direction: **make the one-shot (`-p` for Claude, `exec --json` for Codex, `--print` for Gemini) the
default for every provider**, and prove it drives the drawer well before building more on top.

## 2. Current state (grounded)

The one-shot engines **already exist and are wired** — this is a default flip, not a new build.

- **Selection factory** — `packages/chat/src/live/runtime.ts:96-119`:
  - `anthropic` + `execution_mode==='non_interactive'` → `ClaudePrintChatEngine` (`claude -p --resume`)
  - `google` + `non_interactive` → `AgyPrintChatEngine` (`agy --print`)
  - `openai-compatible`/codex + `non_interactive` → `CliChatEngineImpl` → `CodexExecSession`
    (`codex exec --json`)
  - **else → interactive** (`CliChatEngineImpl` tmux session)
- **Gate source** — the `non_interactive` flag comes from the per-provider column
  `ai_provider_configs.execution_mode` (migration `packages/ai/sql/0117_provider_execution_mode.sql`:
  `text NOT NULL DEFAULT 'interactive'`, `CHECK IN ('interactive','non_interactive')`), joined into
  model rows as `provider_execution_mode` (`packages/ai/src/repository.ts:1830`) and read at
  `packages/chat/src/live/persistence.ts:151`.
- **Code fallbacks** default to interactive where the value is absent:
  `packages/chat/src/live/cli-chat-engine.ts:177` and `chat-engine-rpc-client.ts:735`
  (`executionMode ?? "interactive"`).

## 3. The change

Flip the resolved default from `interactive` → `non_interactive`, keeping interactive selectable.

1. **New migration** (next number, e.g. `packages/ai/sql/0151_default_execution_mode_non_interactive.sql`
   — never edit applied `0117`):
   - `ALTER COLUMN execution_mode SET DEFAULT 'non_interactive'` on `ai_provider_configs`.
   - Backfill: `UPDATE ai_provider_configs SET execution_mode='non_interactive' WHERE execution_mode='interactive'`.
     **Decision:** existing `'interactive'` rows are all unchosen-default (interactive was the only
     default until now), so backfilling them to one-shot matches intent. Users re-select interactive
     per provider afterward if they want the fallback. Note in the release summary.
   - Keep the `CHECK` constraint (both values still valid).
2. **Align code defaults**: change the two `?? "interactive"` fallbacks to `?? "non_interactive"`
   so the code default matches the DB default when a config row is absent.
3. **No engine code changes** — `ClaudePrintChatEngine` / `AgyPrintChatEngine` / `CodexExecSession`
   already carry the one-shot behavior. Scope is default + validation only.

**Interactive fallback preserved:** the `execution_mode` column stays settable per provider; the
factory's `else` branch and the interactive engine are untouched. A user (or admin) can flip any
provider back to `interactive` in provider settings.

## 4. Non-goals

- Not removing/retiring the interactive route (kept as fallback; retirement is a later cleanup once
  one-shot is trusted).
- Not changing MCP-gateway wiring, persona, or the action-request/approval model.
- Not the job-search onboarding rework — that's tracked under epic #1230 (see §6).

## 5. Validation — "works well" exit criteria

The empirical proof Ben asked for. For **each** provider (Claude, Codex, Gemini) driven through the
live drawer on a real dev instance (per the #1000-harness rule for UI features):

- **V1 Multi-turn + resume:** a ≥3-turn conversation where turn N references turn N−1 — confirms
  one-shot `--resume`/session continuity holds across turns.
- **V2 MCP tool round-trip:** a turn that calls an `mcp__jarvis__*` tool (e.g. `app.getMapSlice`)
  and uses the result — confirms tool-use works in one-shot mode with the gateway.
- **V3 Streaming/latency UX:** typing indicator + reply render within acceptable latency; no visibly
  broken partial-output UX vs interactive.
- **V4 Fallback still works:** flip one provider back to `interactive`, confirm the drawer still
  drives it (fallback not regressed).
- **V5 e2e:** a `tests/e2e` #1000-harness Playwright spec covering the drawer happy path on the
  one-shot default, green on a fresh dev instance.
- **Gate:** `pnpm verify:foundation` green on a fresh gate DB (includes the `foundation.test.ts`
  migration-list assertion — add the new migration row).

If any of V1–V3 fails for a provider, that provider's one-shot engine is the finding; interactive
stays its default until fixed (per-provider, since the column is per-provider).

## 6. Coupling to job-search (parked)

Once one-shot is the default, the job-search onboarding **cannot** rely on the assistant to
orchestrate résumé `intake → approve → critique` (a one-shot cannot pause mid-turn for a human
approval and resume). JS-02 must move to **Option B**: the web onboarding invokes intake + critique
directly via user-initiated RPC (the upload _is_ the authorization), not via `submitTurn`→assistant.
That reland is tracked under **epic #1230 / #1233**, gated by Ben's JS-02 UAT — **not** part of this
platform epic. This spec only records the dependency.

## 7. Rollout / tracking

- Open a platform **epic**: "Default chat engine to one-shot (`-p`/`exec`) for all providers."
- Tasks:
  - **P-01** — Default flip: new migration (`SET DEFAULT` + backfill) + align code fallbacks + update
    `foundation.test.ts` migration list. Gate green.
  - **P-02** — Provider validation V1–V5 on a live dev drawer (Claude, Codex, Gemini) + fallback V4.
- Build off a **fresh worktree from `origin/main`**; re-run tree-freshness before starting.
- Release summary (user-facing): "Jarvis chat now runs each turn as a fast one-shot by default across
  all AI providers; the previous interactive session mode remains available per provider."

## 8. Risks

- **Backfill clobbers a deliberate `interactive` choice.** Accepted: no such deliberate choice exists
  pre-flip (interactive was the sole default). Documented in the release summary; reversible per
  provider in settings.
- **A provider's one-shot path underperforms interactive** (streaming UX, resume). Caught by V1–V3;
  mitigated by keeping interactive as a per-provider fallback rather than a hard cutover.
- **Migration-list test drift.** `foundation.test.ts` asserts the full migration list with `toEqual`;
  P-01 must add the new row or the gate fails.

---

## 9. Addendum — P-02a: the "already-wired" one-shot engine is not actually headless one-shot

**Status:** DRAFT — awaiting Ben approval (spec-before-build gate; supersedes §3.3 and the §2 "not
changing the approval model" non-goal for the one-shot path only).
**Grounded on:** live P-02 V1 UAT (2026-07-23, Ben) on the dev drawer + engine code re-read at PR
#1241 tip `d19dc6e3`.

### 9.1 Empirical finding (falsifies §3.3)

§3.3 assumed the one-shot engines "already carry the one-shot behavior; scope is default + validation
only." P-02 V1 disproves that. `ClaudePrintChatEngine` (`packages/chat/src/live/claude-print-chat-engine.ts`)
is `claude -p` (correct binary) **wearing the interactive harness**:

- **Not headless.** `submit()` (`:73`) launches the command with `this.mux.open(...)` — it runs
  `claude -p` **inside a herdr/tmux pane**. Ben saw the pane pop up under the drawer on the first V1
  turn → immediate fail. Output is already read from the transcript `.jsonl` on disk (`readNew()`,
  `:82`), so the pane contributes nothing but the leak; only lifecycle (`isAlive`/`kill`/`interrupt`,
  `:107-120`) is bound to the mux handle.
- **Blocking approval card.** `buildCommand()` (`:144`) sets `--permission-mode default` and wires the
  `PreToolUse` hook (`claude-permission-hook.ts`, matcher `*`) that POSTs **every** tool call to the
  gateway `/internal/permission`, blocking ≤150 s on an async **action_request card**. A one-shot turn
  **cannot** pause mid-turn for async human approval and resume the same reasoning turn — the exact
  stall the pivot exists to kill (job-search JS-02). The #1157/#1158 deadline machinery around that
  card was built for the _interactive_ engine and does not belong on the one-shot path.

The same two defects apply to `AgyPrintChatEngine` (google) and must be checked on the `codex exec`
path.

### 9.2 Owner decision (2026-07-23, Ben)

The one-shot engine must:

1. **Run headless — no herdr/tmux pane.** Spawn `claude -p` as a captured background child process;
   drive completion from the transcript file (already the mechanism). Never touch the mux on the
   one-shot path.
2. **Run "auto" permission mode** — auto-**allow** normal operations, **including file writes** ("a
   file write is NOT dangerous"). Escalate only for genuinely **dangerous** operations. Because a
   one-shot turn cannot do async human escalation, "escalate" here means **auto-deny + surface the
   denial in the transcript** (safe default), **never** a blocking card.

Security envelope preserved: the jarvis **MCP gateway remains the real boundary** — it enforces RLS
per-actor with the `jst_` session token server-side regardless of any client-side decision, so
auto-allowing `mcp__jarvis__*` at the client is safe.

### 9.3 Proposed one-shot permission policy (needs Ben sign-off — §9.5)

Model it as an **allowlist** (deny-unknown is the safe reading of "escalate only for dangerous" when
no human is in the loop), decided **locally in the hook with no gateway round-trip**:

- **Auto-allow:**
  - `mcp__jarvis__*` (gateway enforces RLS).
  - Read-only vault reads (`Read`/`Glob`/`Grep` under `JARVIS_NOTES_ROOTS`) — already allowed.
  - File writes/edits (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) **confined to the session working
    dir (`neutralDir`) / declared roots**. This honors "file write is not dangerous" while keeping the
    #1085 F2/F3 workspace containment that the dropped gateway round-trip used to enforce.
- **Auto-deny (surfaced in transcript, no card):** everything else — writes/reads outside the allowed
  roots, and any tool not on the allow set.
- **Bash — the open question (§9.5).** Auto-allowing arbitrary shell in an unattended headless turn is
  the one genuinely dangerous surface; denylists of dangerous shell patterns are leaky. Default
  proposal: **Bash off the allow set (auto-deny)** for the one-shot chat path unless/until a scoped
  need appears. Ben decides.

### 9.4 Implementation sketch (on approval)

- `claude-print-chat-engine.ts`: replace the `mux.open` in `submit()` with a detached background child
  spawn; rebind `isAlive`/`kill`/`interrupt` to the process handle; drop the mux dependency on this
  path. Keep `readNew()` file-based completion detection unchanged.
- `claude-permission-hook.ts`: add a one-shot hook variant that decides **locally** (allowlist above,
  no `/internal/permission` POST, no 150 s deadline). Leave the existing interactive blocking-card
  hook intact for the interactive fallback — do not disturb the #1157/#1158 ordering it guarantees.
- `buildCommand()`: drop `--permission-mode default` in favor of the auto posture; keep
  `--allowedTools`/`--strict-mcp-config`.
- Apply the analogous headless + auto-permission change to `AgyPrintChatEngine`; verify the
  `codex exec --json` path behaves the same (headless, no card).
- Tests: unit cover the new local allow/deny decisions; keep the existing interactive-hook deadline
  test green (untouched path).

### 9.5 Decision (2026-07-23, Ben) — APPROVED

**Bash in the one-shot chat envelope: option (a) — auto-deny Bash entirely, for now.** Raw shell in an
unattended headless turn is the one genuinely dangerous surface, and dangerous-command denylists leak,
so Bash is off the allow set on the one-shot chat path. Ben: _"a for now, yolo gets them bash"_ — a
future explicit **YOLO / full-access mode** is the path that grants Bash (and any other elevated
tools); it is out of scope here and gets its own spec + task when built. Everything else in §9.3 is
approved as written (auto-allow `mcp__jarvis__*`, vault reads, and sandboxed file writes/edits;
auto-deny everything else, surfaced in the transcript, never a card).

Build is unblocked: implement §9.4 with Bash auto-denied.

### 9.6 Tracking

P-02a lands on PR #1241 (or a stacked follow-up). Re-run P-02 V1–V4 live after it; do not merge until
Ben's per-provider sign-off. Job-search resumes only once one-shot is proven through the drawer.
