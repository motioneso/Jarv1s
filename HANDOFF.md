# Build Handoff — backlog-84-qa-subagents

**Spec (approved):** docs/superpowers/specs/2026-06-09-backlog-84-qa-native-subagents.md
**GitHub issue:** #84
**Risk tier:** `routine` (skill file updates only — no product code, no migration, no schema)
**Worktree:** ~/Jarv1s/.claude/worktrees/backlog-84-qa-subagents **Branch:** backlog-84-qa-subagents (off origin/main)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify exactly one pane holds this label before messaging)
**Relay threshold:** ~80–100k tokens OR compaction summary in your own context → relay immediately

## Start

1. Resolve `coordinated-build` skill; if not by name use the absolute Build skill path above.
2. `[ -d node_modules ] || pnpm install`
3. Read the spec at `docs/superpowers/specs/2026-06-09-backlog-84-qa-native-subagents.md` IN FULL.
4. Invoke `coordinated-build` and follow it: plan → coordinator approval → build → pre-push trio → `coordinated-wrap-up`.

## What you're changing

- **`coordinate` skill** (`.claude/skills/coordinate/SKILL.md`): update Phase 3 QA spawn to use `Agent(run_in_background: true, isolation: "worktree")` instead of `herdr agent start`; keep Herdr path as documented fallback.
- **`coordinated-qa` skill** (`.claude/skills/coordinated-qa/SKILL.md`): add a clause that when invoked as a native subagent, the final message IS the verdict — return compact verdict JSON directly.
- No trial run is needed before landing the PR — the acceptance criteria for the trial run (recording token spend + wall clock) is fulfilled _after_ this lands, during a real coordination run. Note this explicitly in the PR body.

## Key design notes (from Fable planning session)

- `isolation: "worktree"` is **load-bearing** — the QA agent needs to check out the PR branch for `git diff` / code review, and `git checkout` on the shared coordinator tree is forbidden mid-run. Keep it.
- `JARVIS_PGDATABASE=jarvis_qa_<n>` is **conditional insurance** — the happy path (trust CI + `/code-review`) needs no DB, but if CI is red the QA agent reproduces `pnpm verify:foundation` locally and would collide on the shared default DB. Keep it.

## Your compact

- Work only in this worktree/branch. `git add` only your files. `Co-Authored-By: Claude`
- Plan approval comes from the coordinator, not Ben.
- Escalate to `Coordinator` the moment you hit: plan ready, blocker, or done.
- Never touch the project board, milestones, or merge.
- Caveman mode for all coordinator messages.

## Collision notes

- Skill files are not touched by any other agent in this run.
- `pnpm verify:foundation` must still pass (lint, format:check, typecheck run over skill `.md` files if they're in scope — confirm with `pnpm lint` and adjust if needed).
