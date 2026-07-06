# Build Handoff — #651 timezone Plan 2

**Run:** `2026-06-30-rfa-fleet`
**GitHub issue:** #651
**Work source:** issue #651 + `docs/superpowers/specs/2026-06-28-user-local-timezone-single-source-of-truth-design.md`
**Risk tier:** `routine` (doc/plan-only)
**Worktree:** `~/Jarv1s/.claude/worktrees/651-timezone-plan2`
**Branch:** `coord/651-timezone-plan2`
**Build skill path:** `~/Jarv1s/.claude/worktrees/651-timezone-plan2/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1b3e-bd16-71b3-b753-703cd94e4e70`
**Relay threshold:** countable events: around 80-100k tokens or any compaction summary; then relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `CLAUDE.md`, `docs/DEVELOPMENT_STANDARDS.md`, issue #651, this handoff, and `docs/superpowers/specs/2026-06-28-user-local-timezone-single-source-of-truth-design.md`.
3. Invoke `coordinated-build` by name, or read the build skill path above in full and follow it.
4. Verify current timezone utilities and relevant request/chat paths before planning.
5. Send your plan to `Coordinator` and wait for approval before editing.

## Scope

Write the missing Plan 2 doc under `docs/superpowers/plans/` with reviewable build slices and acceptance tests for product-wide local timezone handling.

Plan must cover:
- `X-Timezone` or equivalent request signal from web client to API.
- Validated/resolved IANA timezone exposed to route/tool dependencies without changing `AccessContext`.
- Chat/system prompt context with user-local date/time and timezone for relative dates.
- Tool/planner relative-date conversion through one source of truth.
- User-facing date/time rendering through shared converter utilities.

## Collision Notes

- This lane is doc/plan-only. Do not implement the full timezone fix.
- Current `origin/main` already includes shared timezone utility work from #649; verify before writing stale instructions.
- The plan must call out build slices and tests clearly enough for later RFAs.

## Non-Negotiables

- Do not touch `docs/coordination/` except this handoff if you need to amend your own report.
- Do not touch board, milestones, merges, or other agents' worktrees.
- No repo-wide `pnpm format`; format/stage only files you changed.
- No `git add .` or `git add -A`.
- Do not extend `AccessContext`; keep it `{ actorUserId, requestId }`.
- Use `~/Jarv1s` paths in documentation, not local absolute paths.

## Done

Open a PR, include local command exit codes, then message `Coordinator` with PR number and compact evidence. The coordinator owns QA and merge.
