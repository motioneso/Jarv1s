# Handoff — Build Issue #668 Sports Feedback Pass

You are the build agent for issue #668:

https://github.com/motioneso/Jarv1s/issues/668

## Branch / Worktree

- Branch: `coord/668-sports-feedback-build`
- Worktree: `~/Jarv1s/.claude/worktrees/668-sports-feedback-build`
- Base: `origin/coord/668-sports-feedback-spec` at plan commit `97e9ea6a`

## Required Documents

Read these in full before editing code:

- `AGENTS.md`
- `CLAUDE.md`
- `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
- `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md`

## Mission

Execute the approved 7-task TDD implementation plan for #668. The plan is the authority.

Expected task flow from the plan:

1. CSP/image host + sync pin.
2. Source enrichment.
3. League-specific standings.
4. Relevance filtering and followed-team markers.
5. Card upgrades: names, crests/logos, links, next-match dates.
6. News model/layout.
7. Docs, full gate, and manual LAN verification checklist.

## Guardrails

- Do not edit `docs/coordination/` after reading this handoff.
- Do not use `git add -A` or `git add .`; stage explicit paths only.
- Keep commits task-scoped and prefixed for #668.
- Run the smallest failing check first for each task, then the task-specific green check.
- Preserve Jarv1s invariants: DataContextDb, module isolation, no secrets/content leaks.
- No broad sports-platform rewrite; implement the approved plan.
- If a spec/plan contradiction appears, stop and escalate instead of guessing.
- If context gets high, write a compact relay handoff under `docs/superpowers/handoffs/`, commit it, spawn a successor, and report back.

## Completion

When all tasks are done:

1. Run the plan's final gate.
2. Push `coord/668-sports-feedback-build`.
3. Open a PR linked to #668.
4. Comment on issue #668 with PR URL, commit SHA, and exact verification evidence.
5. Report back in this pane with the same compact summary.
