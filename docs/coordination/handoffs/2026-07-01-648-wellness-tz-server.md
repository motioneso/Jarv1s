# Build Handoff — 648 Wellness Timezone Server

**Spec:** `docs/superpowers/specs/2026-06-28-user-local-timezone-single-source-of-truth-design.md`
**Plan:** `docs/superpowers/plans/2026-06-30-local-timezone-plan2.md`
**GitHub issue:** #648
**Risk tier:** `sensitive`
**Provider:** Codex
**Worktree:** `~/Jarv1s/.claude/worktrees/648-wellness-tz-server`
**Branch:** `coord/648-wellness-tz-server` off `origin/main` `73625702`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1f06-e858-7862-9245-ae8a22ea968c`

## Current State

- #648 client-side slice merged in PR #661 at `73625702`.
- #648 remains open for server-side `X-Timezone` plumbing and wellness UTC day-window fixes.
- Main CI run `28539705533` for `73625702` has required jobs green.

## Scope

Implement the server-side part only:

- Request `X-Timezone` resolution per the timezone spec/Plan 2.
- Do not add timezone to `AccessContext`; its shape stays `{ actorUserId, requestId }`.
- Fix `packages/wellness/src/repository.ts` `listLogsForDate` day window.
- Fix `packages/wellness/src/routes.ts` adherence day iteration.
- Add focused regression tests for non-UTC zones around day boundaries.

## Constraints

- Do not touch `docs/coordination/`.
- No broad `git add .` or `git add -A`.
- No repo-wide format; format and stage only changed files.
- Preserve `DataContextDb` only and owner-only wellness RLS.
- Escalate plan for coordinator approval before implementation.
