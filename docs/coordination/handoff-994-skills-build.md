# Build Handoff — #994 Skills list-first UX and slash invocation

**Spec:** `docs/superpowers/specs/2026-07-13-994-skills-list-first-invocation.md`
**Approved plan:** `docs/superpowers/plans/2026-07-13-994-skills-list-first-invocation.md`
**Approval:** PR #1046, merged to `main` at `52b9e29c`
**Risk tier:** routine
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-994-skills-build`
**Branch:** `ux/994-skills-build`
**Builder:** Luna (`gpt-5.6-luna`) at medium reasoning
**Coordinator and merge authority:** label `UX Coordinator`, session
`019f5dc2-8bd9-78b2-827f-67bd9a99e6c9`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`

## Dispatch

Sol already wrote the plan and the coordinator approved it. Verify the plan's premises against this
branch, then execute it directly with TDD; do not rewrite the plan or wait for another plan gate.
Escalate any stale premise or genuine fork before code.

The stopped predecessor left one focused code commit and an uncommitted diff. Review and test both
before continuing; preserve valid work and report anything that conflicts with the approved plan.

## Collision boundary

Own only the #994 paths named by the plan: Skills settings, skill autocomplete, chat composer/style,
Skills routes, focused tests, and `tests/e2e/skills-settings-chat.spec.ts`. #991 owns
Assistant/persona/model/YOLO and Priorities paths plus its separate E2E file; do not touch them.
The peer Coordinator owns `tests/uat/**`; never edit that tree.

## Exit

Preserve #760 DB/API/file/invocation contracts and duplicate-name ID binding. Ship keyboard/ARIA and
narrow-layout acceptance plus real UI proof with screenshots on the feature PR. Stage explicit task
paths only, never `git add -A`, never edit `docs/coordination/**`, never run repo-wide
formatting, and never merge. Use `coordinated-wrap-up` to report the PR and evidence to
`UX Coordinator`.
