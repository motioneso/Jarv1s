# Build Handoff — backlog-82-tabular-results

**Spec (approved):** docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md
**GitHub issue:** #82
**Risk tier:** `sensitive` (cross-module contract change in `packages/module-sdk/src/index.ts` + gateway serialization behavior change)
**Worktree:** ~/Jarv1s/.claude/worktrees/backlog-82-tabular-results **Branch:** backlog-82-tabular-results (off origin/main)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify exactly one pane holds this label before messaging)
**Relay threshold:** ~80–100k tokens OR compaction summary in your own context → relay immediately

## Start

1. Resolve `coordinated-build` skill; if not by name use the absolute Build skill path above.
2. `[ -d node_modules ] || pnpm install`
3. Read the spec at `docs/superpowers/specs/2026-06-09-backlog-82-compact-tabular-tool-results.md` IN FULL.
4. Invoke `coordinated-build` and follow it: plan → coordinator approval → TDD build → pre-push trio → `coordinated-wrap-up`.

## Your compact

- Work only in this worktree/branch. `git add` only your files. `Co-Authored-By: Claude`
- Plan approval comes from the coordinator, not Ben.
- Escalate to `Coordinator` the moment you hit: plan ready, blocker, design fork, or done.
- Never touch the project board, milestones, or merge.
- Self-monitor on countable events (~80–100k tokens or compaction summary) → relay.
- Caveman mode for all coordinator messages.

## Collision notes

- No migration needed.
- `packages/module-sdk/src/index.ts` change adds an **optional** field (`columnOrder?`) — backward-compatible; no existing caller breaks.
- `packages/ai/src/gateway/gateway.ts` — your change is the `renderToolResult` call in `runHandler`. The #80 agent touches `packages/ai/src/repository.ts` only — no conflict.
- `packages/tasks/src/` — only touched by this issue in this run.
