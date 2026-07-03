# Build Handoff — 705 dead frontend clients

**Spec (approved):** GitHub issue #705
**GitHub issue:** #705
**Risk tier:** `sensitive`
**Worktree:** `~/Jarv1s/.claude/worktrees/705-dead-frontend-clients` **Branch:** `coord/705-dead-frontend-clients` off current green `origin/main`
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f2652-c442-7b81-bac8-7d5dc4d83310`
**Relay threshold:** ~80-100k tokens or compaction summary.

## Source

GitHub issue #705 from the dead-code audit follow-up epic #700. The referenced audit file is not
present on `origin/main`; use the issue body as the durable source of the approved finding list.

## Scope

Re-confirm and remove only the unused frontend API client helpers listed in issue #705:

- Orphan file: `apps/web/src/api/download.ts`.
- `apps/web/src/api/client.ts`: `renameTaskList`, `deleteTaskList`, `renameTaskTag`,
  `deleteTaskTag`, `createTaskList`, `discoverAiProvidersModels`, `listAiCapabilityRoutes`,
  `putAiCapabilityRoute`, `testOnboardingProviderConnection`, `getCalendarEvent`,
  `switchChatProvider`, `listConnectorProviders`, `runBriefingDefinition`,
  `updateConnectorAccount`.
- `apps/web/src/api/memory-client.ts`: `getMemoryFacts`, `getMemoryCorrections`,
  `deleteMemoryFact`, `confirmMemoryFact`, `rejectMemoryFact`.
- `apps/web/src/api/client-proactive.ts`: `refreshProactiveCards`,
  `getProactiveMonitoringSettings`, `updateProactiveMonitoringSettings`.
- `apps/web/src/api/weather-client.ts`: `getWeatherLocation`, `putWeatherLocation`.
- `apps/web/src/api/usefulness-feedback-client.ts`: `listUsefulnessFeedback`.

Preserve similarly named live siblings, especially `discoverAiModels`, `getProactiveCards`, and
`getWeatherToday`. Do not change data-export/deletion behavior, queue constants, shared contracts,
or API route behavior.

## Required Flow

1. `[ -d node_modules ] || pnpm install`.
2. Read AGENTS.md, CLAUDE.md, this handoff, and the coordinated-build skill.
3. Re-confirm every listed helper has zero current consumers on `origin/main`; if a helper is live,
   keep it and report it in the plan.
4. Submit a compact plan for coordinator approval before code.
5. Delete only confirmed-dead helpers/files. Do not broaden cleanup beyond issue #705.
6. Run focused web client tests plus web lint/typecheck/format checks; include exact commands and
   exits in wrap-up.

## Collision Notes

#705 is unblocked because #701 has landed. Hold #704 until #705 lands or proves no overlap. Do not
touch `docs/coordination/` from the build branch. Use explicit staging only; no `git add -A`.
