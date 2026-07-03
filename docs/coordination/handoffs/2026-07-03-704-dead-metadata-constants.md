# Build Handoff — 704 dead metadata constants

**Spec (approved):** GitHub issue #704
**GitHub issue:** #704
**Risk tier:** `sensitive`
**Worktree:** `~/Jarv1s/.claude/worktrees/704-dead-metadata-constants` **Branch:** `coord/704-dead-metadata-constants` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2652-c442-7b81-bac8-7d5dc4d83310`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

GitHub issue #704 from the dead-code audit follow-up epic #700. The referenced audit file is not
present on `origin/main`; use the issue body as the durable source of the approved finding list.

## Scope

Re-confirm and remove only these dead metadata constants:

- `SETTINGS_EXPORT_QUEUE` in `packages/settings/src/manifest.ts` — duplicate of canonical
  `EXPORT_BUILD_QUEUE` in `data-export-jobs.ts`; no importers.
- `WELLNESS_EXPORT_QUEUE_NAME` in `packages/wellness/src/manifest.ts` — pure alias of
  `WELLNESS_EXPORT_QUEUE`; no importers.
- `WHEEL_VERSION` in `packages/shared/src/wellness-api.ts` — symbol and literal
  `jarvis-emotion-v1` unreferenced.
- `PROACTIVE_SOURCE_DEFAULT` in `packages/shared/src/proactive-monitoring-api.ts` — zero usages;
  sibling default helper uses inline literal.

Do not rename queue literals, queue constants, job kinds, payload keys, or API contracts. This lane
deletes confirmed-dead aliases/constants only.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm each listed constant has zero current consumers on `origin/main`; if any is live,
   keep it and report it in the plan.
4. Submit a compact plan for coordinator approval before code.
5. Delete only confirmed-dead constants and direct orphan imports/comments if any.
6. Run focused package tests plus typecheck/format/lint as relevant; include exact commands and
   exits in wrap-up.

## Collision Notes

#704 starts only after #705 landed. Do not touch `docs/coordination/` from the build branch. Use
explicit staging only; no `git add -A`.
