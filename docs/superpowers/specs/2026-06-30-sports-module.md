# Sports Module (page-first) — first loader-ready module — Design Spec

**Status:** proposed — awaiting Ben build go-decision.
**Date:** 2026-06-30
**Owner:** Ben + Jim (hive)
**GitHub:** #656 (task) · Part of #216 (Deferred: module ecosystem expansion) · Milestone 16
(Next Roadmap · Post-first-week success)
**Grounded on:** local `main` @ `8edabcbe` (origin/main `629fbce9`)

**Read, not remembered (source-grounded):**

- `packages/module-sdk/src/index.ts` — `JarvisModuleManifest` extension contract this module targets.
- `packages/module-registry/src/index.ts` — the hardcoded `BUILT_IN_MODULES` array + composition root
  (the loader-seam surface this module documents).
- `packages/weather/*` — the external-fetch precedent (adapter + in-memory TTL cache + on-demand
  route; no cache table, no worker). This module copies that shape.
- `packages/wellness/*` + `packages/wellness/sql/0082_wellness_checkins.sql` — owner-only module with
  its own `sql/` dir, `navigation` + `settings` manifest surfaces, and the canonical owner-only RLS
  policy pattern (`ENABLE`+`FORCE` RLS, `owner_user_id = app.current_actor_user_id()`, grant to
  `jarvis_app_runtime`).

## 0. TL;DR

Build **`@jarv1s/sports`**, a **page-first** module: a Sports nav destination that shows the user's
followed teams highlighted (latest result + next game) with general scores and headlines below,
useful **any day it's opened**. Data comes from **ESPN's unofficial JSON API behind a `SportsSource`
adapter** (free, no key, swappable) with an **in-memory TTL cache** (the weather pattern — no cache
table, no sync worker in MVP). The only persisted, user-private state is **`app.sports_follows`**
(owner-only RLS). A **briefing hook** exposes the day's followed-team facts to the existing briefing.

This is the **loader-ready exemplar**: the module contributes through its **manifest only**, owns its
`sql/` dir (`migrationDirectories` + `ownedTables`), and **every forced composition-root hand-wire is
enumerated in §7 as a documented "LOADER-SEAM"** — that list becomes the requirements for the future
dynamic-loader milestone. (Fork decision 2026-06-30: build in-tree loader-ready, defer the dynamic
loader until ~2 modules exist.)

## 1. Goals

- A `/sports` page rendering **curated content on any day**: followed teams highlighted (latest
  result + next game), general scores + headlines below (ESPN-lite reading surface).
- Follow selection driven **per user, private** — changing follows changes the page.
- The day's **followed-team facts feed the existing briefing**.
- **Catalog:** NFL, NBA, NHL, MLB + top soccer (EPL, MLS, UEFA Champions League) + **FIFA World Cup**.
- Source is **swappable** behind an adapter (anti-hardcode; the provider-agnostic spirit for data).
- Establish and **document the loader-seam list** so this module is the copy-me template.

## 2. Non-Goals (from the approved brief)

- No betting, no fantasy, no deep-dive rabbit holes.
- No **true live play-by-play** — fast-follow phase (needs a per-sport data model).
- No **proactive cards / notifications**, no **`sports.*` chat tool**, no **team-detail sub-pages** in
  MVP — all fast-follow.
- No **shared public-cache table** and no **scheduled sync worker** in MVP (see §5 — deferred, with the
  in-memory cache as the MVP path).
- No new AI usage; no secrets (ESPN needs none).

## 3. Resolved Decisions

| #   | Decision                                                                                                                                           | Rationale                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Page-first**, not proactive-first                                                                                                                | Brief: the page is the product; briefing consumes from it.                                                                                                                             |
| D2  | **ESPN unofficial JSON API** as the MVP source                                                                                                     | Free, no key/signup (no per-user key friction), covers scores + schedules + headlines + logos in one place; self-hosted personal use doesn't trip commercial-redistribution licensing. |
| D3  | Source **behind a `SportsSource` adapter**                                                                                                         | ESPN can break (undocumented); the adapter makes a swap to a keyed provider (API-Sports / BALLDONTLIE) a one-file change and is the anti-hardcode guarantee.                           |
| D4  | **In-memory TTL cache + on-demand fetch** (weather pattern); **no cache table, no worker** in MVP                                                  | Leanest correct MVP; avoids introducing a brand-new RLS classification (public-reference cache) in the first exemplar. Absorbs ESPN instability + rate pressure for a few users.       |
| D5  | Catalog = **US-4 + EPL/MLS/UCL + FIFA World Cup**                                                                                                  | Ben 2026-06-30. World Cup is the 2026 marquee event.                                                                                                                                   |
| D6  | `competition` entity covers **league AND tournament** shapes                                                                                       | World Cup is group-stage→knockout with national teams, not a season league.                                                                                                            |
| D7  | Only **`app.sports_follows`** is persisted + user-private (owner-only RLS)                                                                         | Scores/headlines are **public** data — no private content cached at rest in MVP.                                                                                                       |
| D8  | Deferred (fast-follow): live play-by-play, proactive cards/notifications, chat tool, team pages, **shared snapshot table + scheduled sync worker** | Keep exemplar tight; each is a seam noted below.                                                                                                                                       |

## 4. Architecture

### 4.1 Package anatomy (`packages/sports`)

```
packages/sports/
  package.json                 # @jarv1s/sports
  sql/
    00NN_sports_follows.sql     # owner-only table (number assigned at build landing — see §8)
  src/
    manifest.ts                 # JarvisModuleManifest (+ sqlMigrationDirectory export)
    source/
      sports-source.ts          # SportsSource interface (the adapter seam, D3)
      espn-source.ts            # ESPN impl (fetchFn-injectable for tests)
      catalog.ts                # competition_key -> ESPN league path map (D5/D6)
    sports-cache.ts             # in-memory TTL cache (weather pattern, D4)
    sports-service.ts           # compose page overview + briefing facts from source+cache
    repository.ts               # sports_follows CRUD via DataContextDb (owner-scoped)
    routes.ts                   # registerSportsRoutes(server, deps)
    briefing.ts                 # SportsBriefingProvider (followed-team facts for today)
    index.ts                    # public API exports (manifest, routes, briefing seam, sql dir)
```

Shared REST contracts live in **`packages/shared/sports-api.ts`** (Vite-bundled — **no `node:*`
imports**, per the shared-browser-bundle rule).

### 4.2 Data model — `app.sports_follows` (owner-only, private)

```sql
CREATE TABLE app.sports_follows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  competition_key text NOT NULL,             -- 'nfl','nba','nhl','mlb','eng.1','usa.1',
                                             --  'uefa.champions','fifa.world'
  team_key        text,                      -- NULL = follow whole competition; else a team
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, competition_key, team_key)
);
-- ENABLE + FORCE RLS; SELECT/INSERT/UPDATE/DELETE policies all
--   USING/WITH CHECK (owner_user_id = app.current_actor_user_id())
-- GRANT SELECT,INSERT,UPDATE,DELETE ... TO jarvis_app_runtime
```

**RLS classification: owner-only** (same class as `app.wellness_checkins` / `app.preferences`). No
share, no admin data read. This is the **only** table the module owns; `ownedTables:
["app.sports_follows"]`.

### 4.3 The `SportsSource` adapter (D3)

```ts
interface SportsSource {
  listTeams(competitionKey: string): Promise<TeamRef[]>; // for follow selection
  getScoreboard(competitionKey: string, day: IsoDate): Promise<GameSummary[]>; // incl. LIVE scores
  getSchedule(teamKey: string, competitionKey: string): Promise<GameSummary[]>; // next game(s) + recent form
  getStandings(competitionKey: string): Promise<StandingsRow[]>; // standings rail (+ qualification flag)
  getHeadlines(competitionKey: string): Promise<Headline[]>;
}
```

`espn-source.ts` implements it against ESPN's `site.api.espn.com` scoreboard/news/standings JSON,
`fetchFn` injectable (weather precedent) so tests use fixtures with **no real network**. `catalog.ts`
maps our stable `competition_key` → ESPN league path and carries the league-vs-tournament flag (D6).

Derived, not stored: **form** (last-N W/D/L pips) and **records** come from `getSchedule`/scoreboard
results; the **rationale** ("why you're seeing this") is computed by `sports-service` from the actor's
follows + today's fixtures. **"Live" here = scoreboard-level live score + clock** (ESPN scoreboard) —
this is in MVP; true **play-by-play** (drives, possessions, per-event feeds) remains fast-follow (§9).

### 4.4 Caching & freshness (D4)

In-memory `SportsCache` (copy of `WeatherCache`): scoreboards/headlines cached with a short TTL
(≈2–5 min for live scoreboards, longer for headlines). Shared per process; on-demand fill on the
first request after expiry. **No persistence, no worker.** Deferred alternative (fast-follow): a
shared **public-reference** snapshot table + scheduled sync worker — that introduces a _new_ RLS
classification ("public reference cache": SELECT `USING (true)` to app_runtime, writes system-only)
and must go through the RLS-shareability treatment before it ships. Explicitly **out of MVP**.

### 4.5 REST contract (shared TS schemas)

| Method | Path                      | Permission      | Purpose                                                                                                                                                                       |
| ------ | ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/sports/catalog`     | `sports.view`   | Competitions + teams (for the follow picker).                                                                                                                                 |
| GET    | `/api/sports/follows`     | `sports.view`   | The actor's follows.                                                                                                                                                          |
| POST   | `/api/sports/follows`     | `sports.follow` | Add a follow (competition or team).                                                                                                                                           |
| DELETE | `/api/sports/follows/:id` | `sports.follow` | Remove a follow.                                                                                                                                                              |
| GET    | `/api/sports/overview`    | `sports.view`   | Composed page: adaptive hero (gameday/story) + highlighted followed teams (result + next game + form) + grouped scoreboard + headlines + standings rail + per-item rationale. |

All handlers run under **`DataContextDb`** via `dataContext.withDataContext(...)` — never a root
Kysely handle. `AccessContext` unchanged (`{ actorUserId, requestId }`).

### 4.6 Frontend (`apps/web`)

- A `/sports` page. Followed teams highlighted at top; general scores + headlines below. React Query
  keys namespaced `["sports", ...]`.
- A settings surface (`/settings/modules/sports`) to pick competitions/teams to follow (brief's
  verification path: "follow a team in settings").
- Nav + route registration is **hand-wired on the web today** (`app-route-metadata.ts`,
  `app-shell.tsx`, `settings-page.tsx`) → tagged LOADER-SEAM (§7).

**Design language — see §4.6a. The plan's frontend tasks MUST NOT start until §4.6a is filled from an
approved Claude Design mock-up.**

### 4.6a Design language (distilled from the approved Claude Design mock-up)

**Status: filled.** Source of truth = the Claude Design project "Jarvis Design System"
(`ui_kits/jarvis-app/Sports.jsx` + `sports.css`). The mock-up's own summary: \*"page-first module,
editorial layout in the Jarvis system: followed teams first (latest result + next game), then scores

- headlines. Composes the Jarvis tokens; no new raw colors."_ Frontend tasks in the plan implement to
  this; the `sp-_`class taxonomy below is the reference. All classes compose existing`jds`/token
values only — the plan ports them into `apps/web` component CSS (bundle split, <1000 lines/file).

**Voice & feel.** An **editorial sports reading page** — serif headlines, mono eyebrows/labels/scores,
sans for UI and team names. ESPN-lite / NYT-sports, not a stat terminal. Newspaper column
(`max-width: 1080px`), generous whitespace, photo placeholders where a real image can drop in.

**Hard rules (non-negotiable, from CLAUDE.md + the mock-up):**

- Extend the authored `jds-*` system — **serif headings / mono eyebrows / sans body**.
- Raw CSS colors live **only** in `apps/web/src/styles/tokens.css`; the page consumes tokens
  (`--pine-*`, `--steel-*`, `--surface-*`, `--text-*`, `--border-*`, `--ink`/`--paper`, `--radius-*`).
- **Result colors NEVER red.** win = `--pine-*` (green), draw = `--steel-*`, loss = neutral
  (`--surface-2`/`--text-subtle`). This is a brand + a11y rule, applied everywhere (pills, form pips,
  winning rows).
- **No curved/rounded colored left-border card accent** (AI-tell ban). Highlighting a followed
  team/game uses a **`--pine-soft` background fill + full border + `--radius-card`**, never a colored
  left stripe. ✅ verified against the mock-up.
- Empty / loading / error states use authored patterns; live pulse (`sp-livedot`) **respects
  `prefers-reduced-motion`**.

**Page structure (top → bottom):**

1. **Header (`sp-top`)** — mono kicker (uppercase, `--accent-fg`) · serif title (34px) · serif muted
   lede · aside with a live-preview indicator + crest.
2. **Hero (`sp-hero`) — two adaptive modes** (this is how the page stays useful _any day_):
   - **Gameday hero (`sp-hero--live`):** a followed team is playing. Comp eyebrow + phase (mono), a
     `1fr auto 1fr` match grid with team names and **big tabular-nums scores (44px)**; the leading
     side is full-opacity, the other dimmed to 0.72. Footer carries a **rationale chip** (`sp-rationale`,
     `--accent-fg` — _why you're seeing this_, reuses the `RationaleChip` pattern) + a serif note and
     an "also today" line.
   - **Quiet-day story hero (`sp-hero--story sp-hero--split`):** no followed game today. A
     `300px | 1fr` split — editorial photo placeholder + serif headline (27px) + serif dek. Curated
     lead story so the page is never empty on a non-game day.
3. **Followed teams (`sp-fc` grid, `auto-fill minmax(266px,1fr)`)** — the "highlighted teams" zone.
   **One cross-sport card shape** (NFL and EPL cards are identical structurally): header (crest +
   name + mono comp + status tag `live`/`today`/`news`); a primary row that swaps by state (live
   score / final result / news headline); **form pips** (W/D/L colored squares, same never-red
   semantics); standing; and a **next-match footer** (with a `--big` pine-filled variant for an
   imminent game).
4. **Split: scores + headlines (`sp-split`, `1fr | 316px`)**:
   - **Scoreboard (`sp-board`):** league filter chips (`sp-chip`, active = `--ink`/`--paper` inverse);
     games grouped by league; game rows show crests, records, scores, and status (live / FT / time).
     A followed team's row/side is marked (`is-you`/`is-mine`: `--accent-fg` + `--pine-soft`).
   - **Headlines rail (`sp-rail`, sticky):** serif titles, mono comp labels, a "you" marker
     (`--accent` dot) on followed-team news.
   - **Standings rail (`sp-standings`):** tabbed, tabular-nums table; the user's team row highlighted
     (`is-you` → `--pine-soft`); advancement dot for tournament qualification.
5. **Empty state (`sp-empty`)** — user follows nothing yet: serif title (25px) + serif lede + a mark
   icon in a `--radius-xl` `--surface-2` circle, leading into the **follow picker**.
6. **Follow picker (`sp-pick`)** — the settings/onboarding surface: grouped by competition, a
   "whole league" checkbox + a team grid with crests and check toggles (active = `--pine-soft` +
   `--accent`); a "marquee" tag flags tournaments like the **World Cup**.

**Reused vs new primitives.** Reuses `RationaleChip` (hero/why), the chip/pill/tag idioms, crest
swatches, and the `--pine/--steel` desk semantics. Net-new to this module: the `sp-hero` (two modes),
the `sp-fc` followed-team card, the scoreboard `sp-game` row, and the follow picker — all authored in
tokens, none introducing a new color.

### 4.7 Briefing hook

`SportsBriefingProvider.getFollowedTeamFactsForToday(scopedDb, actorUserId)` returns compact,
non-sensitive facts (e.g. "Cowboys play tonight 7:20pm", "Rangers won 4–2") that the briefings engine
folds in. Wiring into the briefings `composeDeps` in the composition root is a LOADER-SEAM (§7); the
**plan stage reconciles the exact briefings seam** (the briefings engine's existing provider shape) —
flagged as the primary integration risk.

### 4.8 Manifest (declared surface)

`lifecycle: "user-toggleable"`, `availability.defaultEnabled: true`, `supportsUserDisable: true`.
Declares: `database` (migration + `ownedTables`), `navigation` (`/sports`), `settings`
(`/settings/modules/sports`), `permissions` (`sports.view`, `sports.follow`), `routes` (§4.5). **No**
`assistantTools`, `focusSignal`, `proactiveMonitor`, or `jobs` in MVP.

## 5. Loader-seams — the documented hand-wire list (§7 is the point of this module)

Every place core must be touched by hand today. The future loader collapses these; until then each is
tagged `// LOADER-SEAM(sports):` in code so the set is greppable.

1. **`BUILT_IN_MODULES` entry** in `packages/module-registry/src/index.ts` — static import of
   `@jarv1s/sports` + one registration object (manifest, sqlMigrationDirectories, registerRoutes).
2. **`registerSportsRoutes` DI wiring** — dataContext, resolveAccessContext, and **construction of the
   `SportsSource` adapter** (which source lives in the composition root, not the manifest — future:
   manifest-declared source config).
3. **Briefings `composeDeps` wiring** — registering `SportsBriefingProvider` with the briefings engine.
4. **Web nav/route registration** — `apps/web/src/app-route-metadata.ts`, `app-shell.tsx`,
   `settings-page.tsx` (frontend module registration is not manifest-driven yet).
5. **`packages/shared/sports-api.ts`** — shared contracts added to the bundle.
6. **`foundation.test.ts` full-migration-list assertion** — the new `app.sports_follows` migration row
   must be appended (Test-traps: `toEqual` on the full list; a focused module test won't catch it).

## 6. Exit Criteria

- [ ] `@jarv1s/sports` package: manifest, `SportsSource` + `espn-source`, `catalog`, in-memory cache,
      repository, routes, briefing provider, shared schemas.
- [ ] `app.sports_follows` owner-only table + RLS (ENABLE+FORCE, four owner policies, grant) +
      `foundation.test.ts` migration row appended; full `test:integration` run green.
- [ ] Catalog wired: NFL/NBA/NHL/MLB + EPL/MLS/UCL + FIFA World Cup; league **and** tournament shapes.
- [ ] Settings surface to follow competitions/teams; follows persist per-user and are **private**
      (another user sees only their own).
- [ ] `/sports` page implemented to **§4.6a**: adaptive hero (gameday **and** quiet-day story modes),
      cross-sport followed-team cards, grouped scoreboard, headlines rail, standings rail, follow
      picker + empty state; renders **any day**; result colors never red; no left-border accents;
      authored `jds-*` system + authored empty/loading states.
- [ ] Briefing shows the day's followed-team facts.
- [ ] ESPN calls go through the adapter + in-memory cache; `espn-source` tested with fixtures (no live
      network in CI).
- [ ] All 6 loader-seams tagged `// LOADER-SEAM(sports):` and listed in the package README.
- [ ] `pnpm verify:foundation` + `pnpm audit:release-hardening` green (verified directly, not by
      agent self-report).

## 7. Verification (from the brief)

- Follow a team in settings → persists, shows as followed.
- Open `/sports` on a non-game day → curated scores + headlines still render.
- Open on a game day for a followed team → that team highlighted with latest result + next game.
- Change follows → highlighted set changes (proves follow-driven, not hardcoded).
- The day's followed-team facts appear in the briefing.
- Data isolation: second user sees only their own follows (RLS).
- Simulate ESPN failure (fixture throws) → page degrades to cached/empty authored state, does not 500.

## 8. Hard Invariants honored

- **Private by default / RLS everywhere:** `sports_follows` owner-only, ENABLE+FORCE, no admin bypass.
- **DataContextDb only:** all repo/route I/O through `withDataContext`; no root Kysely handle.
- **AccessContext shape:** unchanged (`{ actorUserId, requestId }`).
- **Secrets never escape:** ESPN needs none; if a keyed source is added later it is AES-256-GCM at rest
  (Brave-key precedent) and never reaches frontend/logs.
- **Metadata-only job payloads:** N/A in MVP (no worker); the deferred sync worker will be metadata-only.
- **Provider-agnostic:** `SportsSource` adapter (data source); AI-provider invariant untouched (no AI).
- **Module isolation:** contributes via manifest + declared public API only; no cross-module internals.
- **Never edit applied migrations:** new `sql/` file only; module SQL lives in `packages/sports/sql`.
  Migration **number assigned at build landing** (global-by-landing-order; current high-water 0129) to
  avoid collision with concurrent builds — the plan pins it just before commit.
- **pgvector image:** untouched.
- **Design system:** preserve `jds-*`, authored empty/loading, no curved accent left-border.

## 9. Fast-follow (tracked as separate issues after MVP)

- Live play-by-play (per-sport data model).
- Proactive cards + notifications ("your team plays tonight" / final scores) → adds `proactiveMonitor`.
- `sports.scores` / `sports.schedule` assistant tool → adds `assistantTools`.
- Team-detail sub-pages.
- Shared public-reference snapshot table + scheduled sync worker (new RLS classification — needs the
  RLS-shareability treatment first).
- Keyed/supported source swap (API-Sports / BALLDONTLIE) if an SLA is wanted.
