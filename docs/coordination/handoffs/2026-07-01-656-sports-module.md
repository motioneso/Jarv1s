# Build Handoff — 656 Sports Module

**Spec (approved):** docs/superpowers/specs/2026-06-30-sports-module.md
**Plan (approved):** docs/superpowers/plans/2026-07-01-sports-module.md
**GitHub issue:** #656
**Risk tier:** `sensitive`
**Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module`
**Branch:** `coord/656-sports-module` off `origin/main` `73625702`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1f06-e858-7862-9245-ae8a22ea968c`
**Relay threshold:** countable events — ~80-100k tokens OR a compaction summary in your own context.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `AGENTS.md`, `CLAUDE.md`, the spec, and the plan in full.
3. Invoke `coordinated-build`; if skill discovery fails, read the build skill path above directly.
4. Verify the plan against the actual branch before implementation.
5. Escalate the pre-build plan to `Coordinator`; no implementation before approval.

## Current State

- Task 0 is done: the full approved spec and plan were restored from Ben's local approved artifacts
  and committed as `93b203b8`.
- Main CI run `28539705533` for `73625702` has required jobs green: `Verify foundation and app`,
  compose smoke, and prod compose smoke. Non-required image publishing is still in progress.
- #648 client PR #661 is merged; #648 remains open for separate server-side `X-Timezone` work.

## Scope

Execute the approved 15-task TDD plan. Do not expand into fast-follows:

- No live play-by-play.
- No proactive cards or notifications.
- No rich `sports.scores` chat tool.
- No team-detail sub-pages.
- No cache table or scheduled worker.

## Collision Notes

- Do not touch `docs/coordination/`; coordinator-only.
- No repo-wide `pnpm format`; format and stage only changed files.
- No `git add .` or `git add -A`.
- Migration number `0130` must be verified against current origin before adding SQL.
- Preserve private-by-default RLS for `app.sports_follows`.
- Use `DataContextDb` only for repository I/O.
- Keep ESPN behind `SportsSource`; routes/services must not hardcode the provider.
- Mark forced hand-wires with `// LOADER-SEAM(sports):` and document them in the README ledger.
