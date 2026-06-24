# Build Handoff — chat-mcp-flag (Plan Task 1)

**Spec (approved):** docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md (Task 1 only)
**GitHub issue:** (no issue — this is Task 1 of the chat-stability plan)
**Risk tier:** `routine`
**Worktree:** ~/Jarv1s/.claude/worktrees/chat-mcp-flag
**Branch:** chat-mcp-flag (off origin/main @ 202c638b)
**Build skill path:** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md (reference only — workflow summarized below)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"` after confirming `herdr pane list` shows EXACTLY ONE pane with this label)
**Coordinator session id:** `ses_111f40556ffeVraVZuie2X8ScJ` (immutable authority)
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. `main` shows red on every commit, but this is **NOT a code failure** — jobs refuse to start with "recent account payments have failed." **Local gate is the source of truth.**

- **Do NOT run `gh pr checks`** to verify your work — it always shows red from billing.
- Run the gate **locally** and record exit codes in your wrap-up report:
  - `pnpm format:check && pnpm lint && pnpm typecheck` (pre-push trio — run before EVERY push)
  - `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts` (this lane's test file)
- Precedent: docs/coordination/2026-06-18-overnight-automation.md

## Your task (Plan Task 1 — verbatim)

Disable codex's interactive per-MCP-tool approval menu by adding a feature-flag override to the codex launch command. Without this flag, the headless chat engine hits an interactive menu it cannot drive and the turn stalls.

**Files:**
- Modify: `packages/chat/src/live/cli-chat-engine.ts` (function `buildCodexCommand`, around line 499-507)
- Modify: `tests/unit/cli-chat-engine.test.ts` (add one assertion)

**Step 1 — Add the feature flag override**

In `buildCodexCommand`, the MCP config block currently looks like:
```ts
if (opts.mcpToken && opts.mcpServerUrl) {
  parts.push(
    `-c 'mcp_servers.jarvis.url="${opts.mcpServerUrl}"'`,
    `-c 'mcp_servers.jarvis.bearer_token_env_var="${tokenEnvVar}"'`,
    `-c 'mcp_servers.jarvis.tool_timeout_sec=180'`,
    `-c 'features.shell_tool=false'`,
    `-c 'features.apply_patch_tool=false'`,
  );
}
```

Add `-c 'features.tool_call_mcp_elicitation=false'` to this block (after apply_patch_tool). This is the fix — it suppresses the per-MCP-tool approval menu so the engine's headless turn proceeds.

**Step 2 — Update the codex launch test**

In `tests/unit/cli-chat-engine.test.ts`, add an assertion that the launch line contains the new flag:
```ts
expect(launchLine).toContain("tool_call_mcp_elicitation=false");
```
(Find the existing block of `expect(launchLine).toContain(...)` assertions for the MCP block and add this alongside them. Read the test file first to find the exact location and matching variable name.)

**Step 3 — Verify (this is your gate, since CI is down)**

```bash
pnpm exec vitest run tests/unit/cli-chat-engine.test.ts   # must pass, including your new assertion
pnpm typecheck                                             # must be green
pnpm format:check                                          # must be green
pnpm lint                                                  # must be green
```
Record all four exit codes (pass/fail) in your final report to the coordinator.

## Build workflow (follow this — you cannot auto-load the coordinated-build skill)

1. **Orient.** `cd` to your worktree: `~/Jarv1s/.claude/worktrees/chat-mcp-flag`. Confirm `git branch --show-current` prints `chat-mcp-flag` (NOT `main`). If `node_modules` is missing, run `pnpm install` once; otherwise skip (worktrees share the pnpm store).

2. **Read CLAUDE.md** in the repo root — pay attention to "Hard Invariants" and "GitHub Tracking". Honor every invariant.

3. **Do NOT write a separate plan doc.** The plan for this lane is Task 1 above — it's already bite-sized (2 edits + verify). Execute it directly. (The full coordinated-build skill's "write a plan, get coordinator approval" step is SKIPPED for this lane — the plan IS this handoff doc, and it's pre-approved.)

4. **Build TDD-style:** make the test edit first (Step 2), run it and watch it fail (proves the assertion is wired), then make the source edit (Step 1), run it and watch it pass. Commit green per step.

5. **Commit message convention:**
   ```
   fix(chat): disable codex MCP tool-call elicitation menu

   Add `-c 'features.tool_call_mcp_elicitation=false'` to the codex launch
   args so headless chat turns proceed without an interactive per-MCP-tool
   approval menu. approval_policy="never" does not suppress this menu;
   the feature flag is the only known kill switch.

   Refs: docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md (Task 1)
   ```
   - Use `git add` only for the files you changed (`packages/chat/src/live/cli-chat-engine.ts`, `tests/unit/cli-chat-engine.test.ts`). Never `git add -A` or `git add .` — other sessions share the repo host.
   - Commit on your branch only. Do NOT push yet.

6. **Pre-push trio + rebase (before EVERY push):**
   ```bash
   pnpm format:check && pnpm lint && pnpm typecheck
   git fetch origin main && git rebase origin/main
   ```
   Fix anything red before pushing.

7. **Push and open PR:**
   ```bash
   git push -u origin chat-mcp-flag
   gh pr create --title "fix(chat): disable codex MCP tool-call elicitation menu" \
     --body "Plan Task 1 — see docs/superpowers/plans/2026-06-24-chat-stability-notes-memory.md. Adds -c 'features.tool_call_mcp_elicitation=false' to suppress the interactive per-MCP-tool approval menu in headless codex chat turns." \
     --base main
   ```

8. **Report to coordinator.** Send a caveman-terse message to the `Coordinator` label via:
   ```bash
   herdr pane list   # confirm EXACTLY ONE pane labelled "Coordinator"; note its pane_id
   herdr pane run <that-pane-id> "chat-mcp-flag PR #<N> open. gate: vitest cli-chat-engine ✓, typecheck ✓, format ✓, lint ✓. branch chat-mcp-flag. ready for QA."
   ```
   If `herdr pane list` shows 0 or >1 Coordinator pane, DO NOT GUESS — halt and wait.

9. **Then stop.** The coordinator owns QA, merge, board, and close. Do not merge, do not move the board, do not close any issue.

## Your compact (non-negotiable)

- **Work only** in `~/Jarv1s/.claude/worktrees/chat-mcp-flag` on branch `chat-mcp-flag`.
- **CI is down** — local gate is truth; record exit codes.
- **Plan is pre-approved** (Task 1 above). Do not write a separate plan doc, do not ask the coordinator to approve a plan — execute Task 1 directly.
- **Escalate to coordinator** the moment you hit a real blocker (failing invariant, ambiguous requirement, missing dependency). Don't burn turns spinning. Use `herdr pane run <pane> "<msg>"` against the unique `Coordinator` label.
- **Never touch** the project board, milestones, issues, or merge — those are the coordinator's. Your finish line is PR + report.
- **Caveman mode** for all messages to the coordinator (terse, no filler, full technical accuracy). Commit messages, PR body, and code keep conventional form.
- **Honor every CLAUDE.md Hard Invariant.** No secrets in any doc, payload, log, or prompt.
- **Pre-push trio before every push:** `pnpm format:check && pnpm lint && pnpm typecheck` + fresh rebase on `origin/main`.

## Collision notes (from coordinator)

- You touch `packages/chat/src/live/cli-chat-engine.ts` + `tests/unit/cli-chat-engine.test.ts` ONLY.
- **chat-persona lane is serialized after you.** It touches `packages/chat/src/live/runtime.ts` + persona tests. It will rebase onto your merged PR. Land your edit clean so the rebase is trivial.
- No other lane touches the chat package in this wave. No migration numbers in play.
