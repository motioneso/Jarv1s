# Codex #521 Non-Interactive Execution Mode Handoff

**Date:** 2026-06-26
**Agent:** Codex
**Branch target:** `codex-521-noninteractive-execution-mode`
**Issue:** #521

## Scope

Implement the approved Codex execution-mode plan:

- Spec: `docs/superpowers/specs/2026-06-26-codex-non-interactive-execution-mode.md`
- Plan: `docs/superpowers/plans/2026-06-26-codex-non-interactive-execution-mode.md`
- Shared spike context: `docs/superpowers/specs/2026-06-26-provider-execution-mode-spike.md`

## Required Behavior

- Add provider-level `Execution mode` with `interactive` and `non_interactive`.
- Persist it on AI provider config and expose it through existing admin provider APIs.
- Render/edit it in the existing admin AI provider settings pane.
- Route Codex chat launches according to the configured provider mode.
- Keep `ChatSessionManager` and the public `CliChatEngine` contract unchanged.
- Hide Codex non-interactive transcript/runtime differences inside the engine/transcript adapter.
- Preserve interactive parity: transcript events, final reply completion, tool visibility, and approval/action visibility.
- Do not add silent fallback from non-interactive mode to interactive mode.

## Guardrails

- Read `CLAUDE.md` and `AGENTS.md` before editing.
- Use codebase graph tools for code discovery where available; fall back to `rg` for config/docs/string searches.
- Do not touch unrelated untracked docs or research files.
- Do not edit applied migrations; add a new migration.
- Stage only files you changed for this task.
- Use `~/Jarv1s` in docs/handoffs, not absolute local home paths.

## Start

1. Run `pnpm install` if the fresh worktree does not have dependencies.
2. Read the spec and plan above in full.
3. Execute the plan task-by-task.
4. Run the focused tests named in the plan.
5. Run `pnpm verify:foundation` if feasible.
6. Commit your work on the task branch with focused commits.
7. Report final status, commit SHAs, tests run, and any blockers back to the main Codex pane.
