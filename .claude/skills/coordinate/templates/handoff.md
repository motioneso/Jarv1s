# Build Handoff — <spec slug>

**Spec (approved):** docs/superpowers/specs/<slug>.md
**GitHub issue:** #NN
**Risk tier:** `routine` | `sensitive` | `security`  (set by content triggers — see `coordinate` Risk tiering. `security` ⇒ this PR gets cross-model QA + Ben merge sign-off; build to that bar.)
**Worktree:** <repo>/.claude/worktrees/<slug>   **Branch:** <branch off origin/main>
**Build skill path (absolute):** <repo>/.claude/skills/coordinated-build/SKILL.md   (use this exact path if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator`   (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess a `…-N` pane-id — they reflow when panes close.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
   Worktrees share the pnpm store; a relay successor in an existing worktree skips this.
3. Read the spec above IN FULL.
4. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the
   coordinator for approval → on approval, build TDD/green → run the pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out
   with **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files
  (`Co-Authored-By: Claude Sonnet 4.6`).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `<X>`** the moment you hit: a blocker, a plan ready for
  approval, a design fork outside this spec, a review request, or done.
- **Never touch** the project board, milestones, or merge — those are the coordinator's.
- **Self-monitor your context on countable events**, not a felt %. At ~80–100k tokens, or the
  moment you see a compaction summary in your own context: message the coordinator, then use the
  **`relay`** skill — write a continuation handoff, `herdr-handoff` your successor, and let the
  coordinator reap you.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, no filler, full technical
  accuracy — saves tokens). Commit messages, PR bodies, and code stay normal/conventional.

## Collision notes (from the coordinator)

- <e.g. "Your migration lands AFTER #NN's — do not assume a migration number; the coordinator
  assigns landing order." / "You share `app.tasks` with <spec> — coordinate schema changes.">
