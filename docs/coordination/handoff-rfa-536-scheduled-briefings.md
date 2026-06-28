# Build Handoff — rfa-536-scheduled-briefings

**Spec (approved):** docs/superpowers/specs/2026-06-27-scheduled-recurring-jarvis-briefings.md
**GitHub issue:** #536
**Risk tier:** `sensitive` (enum migration on `app.briefing_definitions`, pg-boss schedule shape changes — shared-table migration + cross-module contract)
**Worktree:** ~/Jarv1s/.claude/worktrees/rfa-536-scheduled-briefings **Branch:** rfa-536-scheduled-briefings (off origin/main @ c7cef3c3)
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `5e1a6b62-a480-4b5c-9706-e476cfe77044` (immutable authority — label is routing, number is ephemeral)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Specs go stale — related work
   lands between spec-authoring and your build. For each spec item, grep/read the cited files on
   YOUR branch and confirm the gap/state it describes is still real. If any item's premise has
   already shipped or drifted, **escalate to the coordinator** with the drift + your re-scoped
   plan before proceeding. Don't silently absorb stale premises into your plan.
5. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the
   coordinator for approval → on approval, build TDD/green → run the pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out
   with **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + the relevant vitest files
  locally and record exit codes in your wrap-up report; CI also runs on the PR via `gh pr checks`.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files
  (`Co-Authored-By: Claude`).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a plan ready for
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

- **Migration number: do NOT assume.** As of this handoff, migration `0123` is claimed by PR #566
  (rfa-535-long-running-goals, in-flight, nearly merged). Your migration will be **0124 or higher**.
  Use a placeholder filename during development; the coordinator confirms the number before you push.
  Check `origin/main` at rebase time — whichever number is next on main is yours.
- **No conflict on `packages/briefings/`** — that package is yours alone; no other in-flight work
  touches it.
- **#535 goals tool reference** (spec §6): the spec says morning/evening/weekly sources should
  include goals via `goals.listActive` once it exists. PR #566 will likely merge before your build
  completes. At rebase time, check if `goals.listActive` is available on `origin/main`. If yes,
  wire it. If not yet merged, record a source gap per spec §13 ("Source unavailable at run time:
  record a gap and continue") and note it in your wrap-up.
- **docs/coordination/ is coordinator-only.** Do not commit to that directory.
- **Stage only your own files.** Never `git add -A` — scope `git add` to your changed paths only.
