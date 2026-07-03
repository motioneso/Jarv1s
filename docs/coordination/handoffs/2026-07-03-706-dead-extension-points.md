# Build Handoff — 706 dead extension points

**Spec (approved):** GitHub issue #706
**GitHub issue:** #706
**Risk tier:** `routine`
**Worktree:** `~/Jarv1s/.claude/worktrees/706-dead-extension-points` **Branch:** `coord/706-dead-extension-points` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f26ad-cb6c-7fa1-99f7-3e2dd29fbf99`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

GitHub issue #706 from dead-code audit epic #700. The referenced audit file is not present on
`origin/main`; coordinator source is the issue plus `~/Jarv1s/docs/audits/2026-07-02-dead-code-audit.md`.

## Scope

Re-confirm and remove only abandoned extension/scaffolding points that are still dead on current
`origin/main`:

- `DefaultSourceVerifierRegistry` in `packages/goals/src/verifier.ts` plus `SourceVerifier` /
  `SourceVerifierRegistry` in `packages/goals/src/types.ts`.
- `getFocusReadiness` plus `ComposeDepsForPriority` in
  `packages/briefings/src/priority-consumer.ts`.
- `NotificationsRoutesDependencies`, `ListNotificationsResult`, and `PgBossClientHooks` if still
  leftover-only in `packages/notifications` / `packages/jobs`.
- `buildScannerDependencies` in `packages/proactive-monitoring/src/scanner.ts` if still superseded
  by inline construction.

If any target looks like a deliberate public extension contract, roadmap hook, or live registration
surface, keep it and escalate before code. No schema, route, job payload, RLS, auth, or behavior
changes.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm every listed symbol against current `origin/main`; skip anything live.
4. Submit a compact plan for coordinator approval before code.
5. Delete only confirmed-dead scaffolding and direct orphan tests/imports/comments.
6. Run focused package tests plus typecheck/format/lint as relevant; report exact commands and
   exits in wrap-up.

## Collision Notes

Do not touch `docs/coordination/`. Use explicit staging only; no `git add -A`. #709 is running in
parallel and must avoid this lane's target files.
