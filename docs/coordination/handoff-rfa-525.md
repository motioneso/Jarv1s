# Build Handoff — rfa-525-cross-tool-reasoning

**Spec (approved):** docs/superpowers/specs/2026-06-27-cross-tool-reasoning.md
**GitHub issue:** #525
**Risk tier:** `sensitive`
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-525-cross-tool-reasoning **Branch:** rfa-525-cross-tool-reasoning (off origin/main d06d6842)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow; re-resolve the live pane by label each time.)
**Coordinator session id:** `6502bd00-7c52-4e73-9ed5-d95a42f54dd8` (immutable authority — confirm this session is still live before relying on it.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (relay immediately on compaction).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute Build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install` — skip if node_modules exists (worktrees share pnpm store).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Specs go stale — related work has landed (#525 unblocked by #532 merging). For each spec item, grep/read the cited files on YOUR branch and confirm the gap/state it describes is still real. If any item's premise has already shipped or drifted, escalate to the coordinator with the drift + your re-scoped plan.
5. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate to coordinator for approval → on approval, build TDD/green → run pre-push trio before every push → close out with **`coordinated-wrap-up`**.

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest files locally; record exit codes in wrap-up report. Use `JARVIS_PGDATABASE=jarvis_build_rfa_525_cross_tool` for integration tests.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files. Co-Authored-By: Claude.
- Plan approval comes from the **coordinator**, not a human. Do not write code before approval.
- **Escalate to coordinator** the moment you hit: a blocker, plan ready for approval, design fork outside this spec, done.
- **Never touch** the project board, milestones, merges, or `docs/coordination/`.
- **Self-monitor your context** on countable events. At ~80–100k tokens or on compaction summary: use the `relay` skill.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator.

## Collision notes (from the coordinator)

- **#527 (usefulness-feedback) is mid-build** in a parallel lane — both touch export/delete/RLS coverage. Scope your export/delete additions to the cross-tool-reasoning surfaces only; do not modify the usefulness_feedback table or its export/delete handlers.
- **#533 (memory-dashboard) launching in parallel** — it touches memory schema/package/API. Do not modify memory records schema; route any cross-tool memory needs through the public memory API.
- **Migration slot:** If this spec requires a schema migration, do NOT assume a migration number. Escalate to the coordinator before writing the SQL file; the coordinator assigns migration numbers by landing order.
- **chat runTurn / hidden context injection:** #529, #530, #532 all merged — the passive-retrieval seam is in place. Build on top of the existing passive-retrieval injection point if needed; do not re-plumb the runTurn path.
- **assistant gateway / action requests:** #534 (action-permission-tiers) is merged — use its canonical permission tier APIs; do not introduce a parallel permission check.
- No `git add -A`; stage only your own changed paths.
