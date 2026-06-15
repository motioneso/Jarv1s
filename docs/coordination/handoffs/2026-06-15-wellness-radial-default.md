# Build Handoff — wellness-radial-default

**Spec (approved):** docs/superpowers/specs/2026-06-15-wellness-radial-default.md
**GitHub issue:** (none — owner-directed feedback pass; reference annotations mqflamxi-hg6ud9 + mqflb9g2-a5esw6)
**Risk tier:** `routine` (frontend-only, wellness web; no schema/auth/secret/RLS) → auto-merge after green gate + Codex review (Ben's standing authorization 2026-06-15).
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/wellness-radial-default **Branch:** wellness-radial-default (off origin/main @ 2a72ce1)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/worktrees/wellness-radial-default/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Wellness-Coordinator` (UNIQUE — escalate via the two-call `herdr pane send-text` then `herdr pane send-keys <pane> Enter`. Re-resolve the live pane by label from `herdr pane list` each time; never reuse a `…-N` number.)
**Coordinator session id:** `6cf61f00-9c15-4936-9d6a-f9ae0bf4523e` (immutable authority; label is routing, pane number is ephemeral.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately). This is a SMALL task; you should not approach it.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute Build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install` (worktree shares the pnpm store).
3. Read the spec above IN FULL, then open BOTH prototype files: `docs/brand/mockups/feelings-wheel-modal.html` and `apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md`. Match the design to them.
4. Invoke **`coordinated-build`**: write the plan → escalate to the coordinator for approval → on approval, build → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before push → close out with **`coordinated-wrap-up`** (PR + report to coordinator).

## Scope (two annotations, one pass)

- **D1 — radial by DEFAULT.** Remove the "radial" tweak gating (`prefs.radial` checkbox at `apps/web/src/wellness/wellness-page.tsx:247`); the feeling-wheel renders by default in `CheckinModal`. Remove the toggle + dead prefs plumbing + any non-radial fallback branch — no stale tweak vocabulary. If removal hits a non-trivial dependency, ESCALATE (don't leave it half-gated).
- **D2 — center fills space.** `apps/web/src/wellness/radial-dial.tsx` center renders as a tall slim oval (square viewBox + width:100% + no height pin). Fix so dial + center are a true filled circle matching the prototype center.
- Verify check-in submit still works (radial selection → same `createWellnessCheckin` payload).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files (`Co-Authored-By: Claude Sonnet 4.6`). NEVER `git add -A`/`git add .` — other sessions share the tree.
- **Never touch** `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- **Never run repo-wide `pnpm format`** or broad `git add` — scope format + staging to your own changed paths.
- Plan approval comes from the **coordinator** (label `Wellness-Coordinator`), not a human gate. No code before approval.
- **Escalate to the coordinator** the moment you hit: a blocker, plan-ready, a design fork outside this spec, review request, or done. Use the two-call Herdr deliver path.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc/payload/log/prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, full technical accuracy). Commit messages / PR body / code stay conventional.

## Collision notes

- No other agent is in the wellness web surface right now. You own `apps/web/src/wellness/*` and `apps/web/src/today/today-page.tsx` for this pass. No migrations (frontend-only) — do not add any.
