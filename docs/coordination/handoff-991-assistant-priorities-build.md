# Build Handoff — #991 Assistant, model, YOLO, and Priorities truth

**Spec:** `docs/superpowers/specs/2026-07-13-991-assistant-priorities-dogfood-hardening.md`
**Approved plan:** `docs/superpowers/plans/2026-07-13-991-assistant-priorities-dogfood-hardening.md`
**Approval:** PR #1046, merged to `main` at `52b9e29c`
**Risk tier:** sensitive
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-991-assistant-priorities-build`
**Branch:** `ux/991-assistant-priorities-build`
**Builder:** Luna (`gpt-5.6-luna`) at medium reasoning
**Coordinator and merge authority:** label `UX Coordinator`, session
`019f5dc2-8bd9-78b2-827f-67bd9a99e6c9`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`

## Dispatch

Sol already wrote the plan and the coordinator approved it. Verify the plan's premises against this
branch, then execute it directly with TDD; do not rewrite the plan or wait for another plan gate.
Escalate any stale premise or genuine fork before code.

The stopped predecessor left focused uncommitted changes. Review and test that diff before
continuing; preserve valid work and report anything that conflicts with the approved plan.

## Collision boundary

Own only the #991 paths named by the plan: Assistant/persona/model/YOLO settings, priority module
surfaces, focused tests, and its dedicated `tests/e2e/**` file. #994 owns Skills/autocomplete/chat
composer paths and `tests/e2e/skills-settings-chat.spec.ts`; do not touch them. The peer
Coordinator owns `tests/uat/**`; never edit that tree.

## Exit

Preserve DataContextDb/RLS and existing model/priority contracts. Record real desktop and narrow UI
proof with screenshots on the feature PR. Stage explicit task paths only, never `git add -A`,
never edit `docs/coordination/**`, never run repo-wide formatting, and never merge. Use
`coordinated-wrap-up` to report the PR and evidence to `UX Coordinator`.
