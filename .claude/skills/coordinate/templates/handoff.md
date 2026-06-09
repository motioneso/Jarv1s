# Build Handoff — <spec slug>

**Spec (approved):** docs/superpowers/specs/<slug>.md
**GitHub issue:** #NN
**Worktree:** <repo>/.claude/worktrees/<slug>   **Branch:** <branch off origin/main>
**Coordinator label:** `Coordinator`   (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess a `…-N` pane-id — they reflow when panes close.)
**Context self-handoff threshold:** ~70%

## Start

1. `pnpm install` (fresh worktree has no `node_modules`).
2. Read the spec above IN FULL.
3. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the
   coordinator for approval → on approval, build TDD/green → close out with
   **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files
  (`Co-Authored-By: Claude Sonnet 4.6`).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `<X>`** the moment you hit: a blocker, a plan ready for
  approval, a design fork outside this spec, a review request, or done.
- **Never touch** the project board, milestones, or merge — those are the coordinator's.
- **Self-monitor your context.** At ~70% of the window: message the coordinator, then use the
  **`relay`** skill — write a continuation handoff, `herdr-handoff` your successor, and let the
  coordinator reap you.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, no filler, full technical
  accuracy — saves tokens). Commit messages, PR bodies, and code stay normal/conventional.

## Collision notes (from the coordinator)

- <e.g. "Your migration lands AFTER #NN's — do not assume a migration number; the coordinator
  assigns landing order." / "You share `app.tasks` with <spec> — coordinate schema changes.">
