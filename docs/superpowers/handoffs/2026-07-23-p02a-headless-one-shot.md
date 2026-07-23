# Handoff — P-02a: headless one-shot engine + auto permission (#1242)

**Task:** #1242 (Part of epic #1238; remediation from #1240 P-02 V1 live UAT).
**Spec:** `docs/superpowers/specs/2026-07-23-cli-print-engine-default.md` **§9** (read it in full — it
is the authority; this doc is the Start section only).
**Base branch:** `build/cli-print-engine-default` (PR #1241). P-02a **stacks on P-01** — you branched
from that branch, NOT `origin/main`.
**Model/posture:** build unattended; leave prod-sensitive code paths you were told not to touch alone.

## The one-paragraph why

The "already-wired" one-shot `ClaudePrintChatEngine` is `claude -p` wearing the **interactive**
harness: `submit()` runs it inside a herdr/tmux pane (`mux.open`), and `buildCommand()` gates every
tool call through a `PreToolUse` hook that blocks ≤150s on an async approval **card**. A one-shot turn
can't pause mid-turn for async human approval, so it stalls exactly like job-search JS-02. Make the
one-shot path **headless** (no pane) with **local "auto" permission** (no card).

## Scope (exactly this — spec §9.3/§9.4)

1. **`packages/chat/src/live/claude-print-chat-engine.ts`** — replace the `this.mux.open(...)` in
   `submit()` with a **detached background child-process spawn** of the built command (it already
   `cd`s into `neutralDir`). Rebind `isAlive()` / `kill()` / `interrupt()` to the process handle
   instead of the mux handle. **Do not** change `readNew()` — completion is already detected from the
   transcript `.jsonl` on disk. The `mux`/`TmuxIo` plumbing stays for the interactive engine; this
   engine just stops using `mux.open`.
2. **`packages/chat/src/live/claude-permission-hook.ts`** — add a **one-shot hook variant** that
   decides **locally, with NO gateway round-trip and NO 150s deadline**:
   - **allow:** `mcp__jarvis__*`; read-only vault reads (`Read`/`Glob`/`Grep` under
     `JARVIS_NOTES_ROOTS`, reuse the existing `safeVaultRead`); file writes/edits
     (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) whose target path is **inside the session working dir
     / declared roots**.
   - **deny (surfaced in transcript, never a card):** everything else, explicitly including **`Bash`**
     (Ben: Bash is off the one-shot allow set for now; a future YOLO mode grants it).
   - **CRITICAL:** leave the EXISTING blocking-card hook (`CLAUDE_PERMISSION_HOOK_SOURCE`,
     `writeClaudePermissionHook`, and the `NATIVE_CONFIRM_TIMEOUT_MS` / `HOOK_INTERNAL_DEADLINE_S` /
     `HOOK_TIMEOUT_SECONDS` ordering) **untouched** — it guards the interactive fallback and its
     ordering fixed the #1157/#1158 prod outage. Add a parallel one-shot path; don't refactor the
     interactive one. `tests/unit/claude-permission-hook.test.ts` must stay green as-is.
3. **`buildCommand()`** — drop `--permission-mode default`; wire the new one-shot hook + keep
   `--allowedTools`/`--strict-mcp-config`. Pick the Claude permission mode that, combined with the
   local hook returning `allow`/`deny`, runs tools without prompting (no TTY in a headless `-p`).
4. **`AgyPrintChatEngine`** (google) — apply the analogous headless + auto-permission change.
5. **`codex exec --json` path** — verify it is already headless with no card; if it opens a pane or
   blocks on a card, fix to match. Note findings in the PR.

## Exit criteria (all required)

- One-shot chat turn opens **no herdr/tmux pane** (Claude + Google); codex path confirmed headless.
- **No blocking card** on the one-shot path; file writes auto-run; **Bash auto-denied**; `mcp__jarvis__*`
  + vault reads auto-run.
- Interactive fallback engine + its #1157/#1158 blocking-card hook **untouched and still green**.
- New unit tests cover the local allow/deny decisions (incl. Bash-denied, out-of-root-write-denied,
  in-root-write-allowed, mcp-allowed).
- `pnpm verify:foundation` **green on a fresh gate DB** (DROP/CREATE your per-agent gate DB first).
- Commit with a user-facing release-note summary. Push to `build/cli-print-engine-default`.

## HARD STOP

**Stop at the UAT gate. Do NOT merge PR #1241.** When the gate is green and pushed, report done with
the commit SHA and gate exit code. The coordinator re-serves the dev instance and Ben re-runs P-02
V1–V4 live before any merge. Record nothing as "signed off" — only Ben does that, on #1242/#1240.

## Start

1. `pnpm install` (fresh worktree — no `node_modules`).
2. Run `/start`, then read spec §9 in full and this doc.
3. Write a plan with the writing-plans skill (TDD: failing test → implement → green).
4. Execute. Keep the interactive path untouched. Full gate. Push. STOP at the UAT gate.
