# Build Handoff — wellness-mood-averages (feedback pass 4)

**Spec (approved):** docs/superpowers/specs/2026-06-15-wellness-mood-averages.md
**GitHub issue:** (none — owner-directed feedback; annotations mqflffbd-epjhx2 + mqflgbzb-cxbwvt)
**Risk tier:** `routine` (frontend-only, wellness web; client-side aggregation; no schema/API/auth/secret/RLS) → auto-merge after green gate + QA (Ben's standing authorization 2026-06-15).
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/wellness-mood-averages **Branch:** wellness-mood-averages (off origin/main @ f6c47ce)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/worktrees/wellness-mood-averages/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Wellness-Coordinator` (UNIQUE — escalate via the two-call `herdr pane send-text` then `herdr pane send-keys <pane> Enter`. Re-resolve the live pane by label from `herdr pane list` each time; never reuse a `…-N` number.)
**Coordinator session id:** `6cf61f00-9c15-4936-9d6a-f9ae0bf4523e` (immutable authority.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately). This is a SMALL task; you should not approach it.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the absolute Build skill path above and follow it directly.
2. `[ -d node_modules ] || pnpm install` (worktree shares the pnpm store).
3. Read the spec above IN FULL.
4. Invoke **`coordinated-build`**: write a SHORT plan (focus on the daily-average computation + the exact today-card copy/layout + the outside-click teardown approach) → escalate it to the coordinator for approval → on approval, build → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before push → close out with **`coordinated-wrap-up`** (PR + report to coordinator).

## Scope (two annotations, one pass)

- **D1 — today card current + daily-average mood** (`apps/web/src/wellness/wellness-today.tsx`, `CheckinToday`). Reuse `moodIndex`/`moodBand` from `@jarv1s/shared` (already imported). Average = mean `moodIndex` over today's check-ins. Rework the "Today's check in" heading into a mood summary. Functional default for layout — Ben annotates visuals later. Degrade for 0/1 check-ins.
- **D2 — chart tooltip = day average + outside-click dismiss** (`apps/web/src/wellness/wellness-chart.tsx`, rendered by `<WellnessTrends>`). Tooltip shows selected day's AVERAGE mood, not last check-in. Add outside-click dismissal via a `useEffect` listener with cleanup. **Do NOT** put side effects in a `setState` updater (StrictMode double-invokes — project invariant).
- Optional cleanup (only if touching that CSS): remove dead `.wl-radial` (~wellness-2.css:713) + dead `.wl-dial__hub .lbl/.val` selectors left by #262.

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files (`Co-Authored-By: Claude Sonnet 4.6`). NEVER `git add -A`/`git add .` — other sessions share the tree.
- **Never touch** `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- **Never run repo-wide `pnpm format`** or broad `git add` — scope format + staging to your own changed paths. (Run `pnpm exec prettier --write` on YOUR changed files before committing so format:check stays green.)
- Plan approval comes from the **coordinator** (label `Wellness-Coordinator`), not a human gate. No code before approval. (If Ben tells you directly to skip the plan, proceed.)
- **Escalate to the coordinator** the moment you hit: a blocker, plan-ready, a design fork outside this spec, review request, or done. Use the two-call Herdr deliver path.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc/payload/log/prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, full technical accuracy). Commit messages / PR body / code stay conventional.

## Collision notes

- You own `apps/web/src/wellness/*` for this pass; no other build agent is active there now (radial pass #262 already merged). No migrations (frontend-only) — do not add any.
