# @jarv1s/sports

Sports follows, scores, standings, headlines, and a briefing hook. See
`docs/superpowers/specs/2026-06-30-sports-module.md` for the full design and
`docs/superpowers/plans/2026-07-01-sports-module.md` for the build plan (#656).

## Loader-seams

Every place core must be hand-wired today because the platform has no dynamic module
loader yet. Tagged `// LOADER-SEAM(sports):` in code where the seam is a single line;
listed here as the ledger for the seams that are cross-file.

1. **`BUILT_IN_MODULES` entry** — `packages/module-registry/src/index.ts` (static import
   of `@jarv1s/sports` + registration object: manifest, `sqlMigrationDirectories`,
   `registerRoutes`). Tagged `LOADER-SEAM(sports) 1`.
2. **`registerSportsRoutes` DI wiring** — same file, same registration object:
   `dataContext`, `resolveAccessContext`, and construction of the `SportsSource` adapter
   (`createEspnSportsSource`) — which concrete source lives in the composition root, not
   the manifest. Tagged `LOADER-SEAM(sports) 2`.
3. **Briefings `composeDeps` wiring** — `packages/briefings/src/compose.ts`, the
   `sports` `gatherToolSection` call + the sanitize-on-the-way-in trust-boundary comment.
   Tagged `LOADER-SEAM(sports) 3`.
4. **Web nav/route registration** — `apps/web/src/app-route-metadata.ts` (route id/path/
   label/match) and `apps/web/src/app.tsx` (lazy import + `ModuleGatedRoute`); the
   settings entry is manifest-driven (`manifest.settings[0].entry`) but the package
   `exports["./settings"]` subpath in `packages/sports/package.json` is the seam the
   settings scanner's dynamic `import("@jarv1s/sports/settings")` resolves against.
5. **`packages/shared/src/sports-api.ts`** — shared TS contracts (`TeamRef`,
   `CompetitionRef`, `SportsFollowDto`, `SportsCatalogResponse`, `SportsOverviewResponse`,
   route JSON schemas) added to the shared bundle consumed by both `apps/web` and
   `packages/sports`.
6. **`tests/integration/foundation.test.ts` migration-list assertion** — the
   `{ version: "0133", name: "0133_sports_follows.sql" }` row appended to the full
   migration-list `toEqual` (a focused module test would not catch a missing row here).

Also present but outside the numbered §5 list: `packages/sports/src/source/sports-source.ts`
(the `SportsSource` adapter contract itself) and `espn-source.ts` (the ESPN adapter — all
network access goes through this one file) each carry a `LOADER-SEAM(sports)` comment
marking them as the swap point for a future keyed/alternate source.

## Accepted deviation (spec §4.8)

Spec §4.8 states the manifest should declare **no** `assistantTools` in MVP. The briefings
engine has no provider registry — a section can only be produced by a `risk:"read"`
assistant tool discovered via `findExecute` over `manifest.assistantTools`. MVP therefore
declares exactly one tool, `sports.followedFactsToday`, whose only intended consumer is
the briefing. It is mechanically visible to the chat tool-registry (the platform has no
"briefing-only" flag) — this is the one deviation from §4.8, scoped tightly to compact
today-facts output (not the rich `sports.scores`/`sports.schedule` chat experience §2
bars). Removing chat visibility requires a platform change (briefing-only tool filtering)
and is out of scope for this module.

## Deferred fast-follows (spec §9)

Tracked as separate issues after MVP, not part of this build:

- Live play-by-play (per-sport data model).
- Proactive cards + notifications ("your team plays tonight" / final scores) — adds
  `proactiveMonitor`.
- `sports.scores` / `sports.schedule` assistant tool — adds richer `assistantTools`.
- Team-detail sub-pages.
- Shared public-reference snapshot table + scheduled sync worker (new RLS classification —
  needs the RLS-shareability treatment first).
- Keyed/supported source swap (API-Sports / BALLDONTLIE) if an SLA is wanted.
