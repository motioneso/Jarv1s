# News module (V1) — design spec

**Date:** 2026-07-08
**Status:** Approved (Ben delegated full decision authority for this feature, 2026-07-08 — "I won't be able to approve anything, so you have full autonomy"; decisions below were made under that delegation and are open to post-hoc revision)
**Author:** Claude (Fable 5), modeled on the sports module (`packages/sports`)
**Task issue:** see "Tracking" below (filed alongside this spec)

## Problem

Jarvis has a broadsheet sports desk but no general-news surface. Ben asked for a **separate
news module** duplicating the sports module's setup: users pick which sources their news comes
from, can exclude specific sources, and can optionally narrow to certain topics. V1 stops there.

## Non-goals (V1)

- Custom/user-supplied RSS URLs (breaks the manifest `fetchHosts` static allowlist model; needs
  its own SSRF/host-allowlist design → future spec).
- Cross-source story dedupe/clustering, AI summarization, read-state, bookmarks.
- Per-article body fetch (sports #857 equivalent) — RSS descriptions are the only body text in V1.
- Paywalled/credentialed sources.

## Architecture — mirror of `packages/sports`

New workspace package `packages/news` (`@jarv1s/news`), module id `news`, wired exactly like
sports through `@jarv1s/module-sdk` / `@jarv1s/module-registry` / `@jarv1s/module-web-sdk`:

- **Manifest** (`src/manifest.ts`): lifecycle `user-toggleable`, `defaultEnabled: true`,
  navigation `/news` (icon `newspaper`, order **34** — immediately before Sports at 35; adjust if
  34 is taken), settings entry `/settings/modules/news` (`entry: "./settings"`), permissions
  `news.view` + `news.prefs` (manage own preferences), dataLifecycle: empty `exportSections` +
  cascade-delete `app.news_prefs` (prefs are catalog references, like sports follows).
- **External source** (dataset-connector SDK): ONE source id `newsfeeds`, `credential: "none"`,
  a single dataset `{ key: "feed", ttlMs: 10 * 60 * 1000, staleness: "degrade-empty" }`.
  `fetchHosts` = union of every catalog feed host; `imageHosts` = union of every catalog image-CDN
  host (these feed the web CSP `img-src` via `MODULE_IMAGE_CSP_HOSTS` — **and
  `infra/nginx/jarv1s-web.conf` must be updated to match**, same as the sports LOADER-SEAM note in
  `apps/api/src/static-web.ts`).
- **Adapter** (`src/source/rss-source.ts`): `ExternalSourceAdapter` with
  `fetchDataset("feed", { sourceKey, topicKey|null })`. Fetch URL is resolved ONLY from the static
  catalog (never from params/user input). Parse RSS 2.0 + Atom with **htmlparser2 in XML mode**
  (already in the lockfile transitively at 10.1.0 — add as a direct dep of `@jarv1s/news`, no new
  supply chain). No new runtime dependencies beyond that.
- **Service/routes/repository**: same shape as sports (`DataContextDb`-only repository,
  `DatasetClient` injected, degrade-empty per feed with a `degraded` flag, clock seam `now`).
- **Shared contracts**: `packages/shared/src/news-api.ts` (browser-safe, `as const` Fastify
  schemas mirroring `sports-api.ts` conventions, exported from the shared index). **Every field
  the service emits must be declared in the response schema** — fast-json-stringify silently drops
  (or, inside `oneOf`, rejects) unknown keys; this has bitten three times (#859, #885, nextMatch).

## Source & topic model

### Curated source catalog (`src/source/catalog.ts`)

Static list; each entry: `sourceKey`, `label`, `homepageUrl`, `defaultEnabled`, `feedHosts`,
`imageHosts`, `topFeedUrl`, and `topicFeeds: Partial<Record<TopicKey, url>>`.

V1 sources (final URLs to be **live-verified at build time** — capture one real fixture per
source under `src/source/__fixtures__/` like sports does):

| sourceKey     | label              | default | topics available                                                     | notes                                                                          |
| ------------- | ------------------ | ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `bbc`         | BBC News           | yes     | world, us, politics?, business, technology, science, health, culture | feeds.bbci.co.uk; images ichef.bbci.co.uk                                      |
| `guardian`    | The Guardian       | yes     | world, us, politics, business, technology, science, culture          | theguardian.com/&lt;section&gt;/rss; images i.guim.co.uk                       |
| `nytimes`     | The New York Times | no      | world, us, politics, business, technology, science, health, culture  | rss.nytimes.com; images static01.nyt.com                                       |
| `npr`         | NPR                | yes     | world, us, politics, business, technology, science, health, culture  | feeds.npr.org/&lt;id&gt;/rss.xml; images media.npr.org + npr.brightspotcdn.com |
| `aljazeera`   | Al Jazeera         | no      | (top only)                                                           | aljazeera.com/xml/rss/all.xml                                                  |
| `verge`       | The Verge          | no      | technology                                                           | Atom; images platform.theverge.com                                             |
| `arstechnica` | Ars Technica       | no      | technology, science                                                  | feeds.arstechnica.com; images cdn.arstechnica.net                              |
| `wired`       | Wired              | no      | technology                                                           | wired.com/feed/rss; images media.wired.com                                     |

Builder discretion: drop any source whose feed is dead/unparseable at build time (note it in the
PR); do not add sources beyond this list without a new spec round.

### Canonical topics (`TopicKey`)

`world`, `us`, `politics`, `business`, `technology`, `science`, `health`, `culture`.

### Preference semantics (the user model Ben described)

Single owner-only table `app.news_prefs`; three row kinds:

- `source` — explicit include (used for non-default sources the user turns ON)
- `source_exclude` — exclusion (default source the user turns OFF)
- `topic` — topic selection

Effective sources = (`source` rows if any, else the catalog defaults) **minus** `source_exclude`
rows. Effective topics = `topic` rows if any, else **null = "top" mode**.

Fetch plan: topics selected → for each effective source × selected topic with a mapped feed,
fetch that topic feed (sources lacking the topic contribute nothing). No topics → each effective
source's `topFeedUrl` only.

### SQL: `packages/news/sql/01XX_news_prefs.sql`

Migration number = next global at build time — check ALL modules' `sql/` dirs +
`infra/postgres/migrations` on latest **origin/main** (local scans show 0149 as max but 0150 was
taken by PR #886 on main; expect 0151, verify).

Mirror `0133_sports_follows.sql` exactly: owner-only RLS classification, ENABLE + FORCE RLS,
four policies against `app.current_actor_user_id()`, grants to `jarvis_app_runtime` only,
`UNIQUE (owner_user_id, kind, key)`, `kind` CHECK constraint, owner+created_at index. Add the
migration row to `foundation.test.ts`'s full-list assertion and run the FULL `test:integration`
(focused module tests won't catch the list assertion).

## API

| Route                        | Schema                   | Perm       | Notes                                                                                                      |
| ---------------------------- | ------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/news/catalog`      | sources + topics, static | news.view  | no fetch; includes per-source available topics + defaultEnabled                                            |
| `GET /api/news/overview`     | composed page            | news.view  | see payload below                                                                                          |
| `GET /api/news/prefs`        | prefs list               | news.view  |                                                                                                            |
| `POST /api/news/prefs`       | `{ kind, key }`          | news.prefs | validate kind ∈ enum, key ∈ catalog (sourceKey or topicKey per kind); idempotent-dedupe like sports create |
| `DELETE /api/news/prefs/:id` | `{ ok }`                 | news.prefs |                                                                                                            |

### Overview payload (`NewsOverviewResponse`)

```
{
  topStories: NewsHeadline[]        // ranked, cap 6
  sourceGroups: { sourceKey, sourceLabel, headlines: NewsHeadline[] }[]
  activeTopics: TopicKey[]          // effective selection ([] = top mode)
  enabledSources: { sourceKey, label }[]  // effective source set (for settings deep-link copy)
  degraded: boolean                 // any feed failed (degrade-empty per feed)
}
NewsHeadline = { id, sourceKey, sourceLabel, topicKey|null, topicLabel|null,
                 title, url, publishedAt, imageUrl|null, summary }
```

`id` = stable hash of the item link (dedupe key). Dedupe by URL **within** a source (the same
story appears in `top` + a topic feed); no cross-source dedupe in V1.

## Sanitization / security (all in the adapter, before anything leaves the source layer)

- Titles/summaries → plaintext: strip all tags, decode the narrow entity set (reuse the
  `decodeEntities`/`codePointOr` approach from `espn-source.ts`), collapse whitespace; caps:
  title 300 chars, summary 500 chars, 30 items/feed.
- `url`: must parse as http(s) or the item is dropped. `imageUrl`: https only AND host must be in
  the source's declared `imageHosts`, else null (defense in depth in front of the CSP).
- Feed URLs are static catalog data; params can never steer the fetch target. The dataset
  runtime's host pinning enforces `fetchHosts` regardless.
- Rendering: React text nodes only, never `dangerouslySetInnerHTML`.

## Ranking (`src/ranking.ts`, pure & clock-free like sports `news-ranking.ts`)

Weight: image +2, summary +1, first-position-in-its-feed +2 (the source's own lead). Order:
weight desc → `publishedAt` desc → feed order (stable). Feature threshold 4 (image + lead, or
image + summary + anything). Unit-test the ranking pure functions.

## Web UI — `/news`, broadsheet

Follow the /sports broadsheet idiom and the authored design system (serif display type: the
2026-07-07 no-serif amendment allowed display serif on /sports; **this spec extends the same
allowance to /news** — it is the same broadsheet genre, which is exactly why Ben asked for this
style). `jds-*` + new `nw-*` local primitives; colors only via existing `tokens.css` tokens; CSS
split across files under 1000 lines each; empty/loading states use existing authored patterns
(skeleton mirroring sports').

Layout, top to bottom:

1. **Masthead**: topic nav as FUNCTIONAL client-side filter chips (All + the canonical topics
   present in the payload) — unlike sports' inert preview nav; here filtering is in-page state,
   no routing. Keyline rules per broadsheet style.
2. **HeroCarousel** of `topStories` (5-slide cap, crossfade, pause on hover/focus,
   reduced-motion disables auto-advance) — port the sports carousel idiom (do NOT import from
   `@jarv1s/sports`; module isolation forbids it — parallel implementation in `nw-*`).
3. **Mosaic band**: feature article (weight-gated) + majors (2, art required) + standards (6) +
   "In brief" tail (10) — the sports NewsBand idiom over the cross-source ranked pool, with a
   source kicker on every cell (source attribution is mandatory on every rendered story).
4. **Rail**: "By source" column — per-source nameplate + its 4 latest headlines.
5. **Degraded notice** (quiet, with retry) when `degraded: true`; error/skeleton states mirror
   sports.

**Today widget**: "News desk" `jds-brief` card, top 4 headlines (title + source kicker),
shares the overview query key. No live polling (news has no live state — no refetch interval;
`refetchOnWindowFocus` only).

**Settings** (`src/settings/index.tsx`): PaneHead + two sections — Sources (every catalog source
as a toggle row showing label + topic coverage; toggling writes/deletes `source`/`source_exclude`
rows per the deviation-from-default semantics) and Topics (chip multi-select writing `topic`
rows; empty = all/top). React Query keys under `["news", ...]` in `src/web/query-keys.ts`.

**Web contribution** (`src/web/index.tsx`): `ModuleWebContribution` with literal
moduleId/path/icon/order mirroring the manifest (asserted by `tests/unit/module-web-scanner.test.ts`);
`./web` must stay browser-safe (no `node:*` — enforced by `module-web-browser-safety.test.ts`).

## Briefing tool

`news.topHeadlinesToday` — read-only, compact facts (≤5 lines: "Title — Source"), same
deferred-construction pattern as `configureSportsBriefingService` (registry wires the
`DatasetClient` at boot).

## Wiring checklist (verified against the repo 2026-07-08 — exact touch points)

Backend (explicit registration — the ONE hub file):

- `packages/module-registry/src/index.ts` — import from `@jarv1s/news`, add a registration
  object to `BUILT_IN_MODULES` (~line 767; sports' object at ~1222-1252 is the template):
  `manifest`, `sqlMigrationDirectories: [newsModuleSqlMigrationDirectory]`,
  `queueDefinitions: []`, and a `registerRoutes` closure that builds
  `createDatasetClient(newsfeedsSource, createRssDatasetAdapter(), {fetchFn, logger})`, calls
  `configureNewsBriefingService(datasetClient)`, then `registerNewsRoutes(...)` — same inline
  dataset-client wiring as sports. `assertModuleRegistryConsistency` +
  `MODULE_IMAGE_CSP_HOSTS` pick the manifest up automatically. Do NOT add news to
  `LIFECYCLE_MIGRATION_PENDING` (like sports, it ships with lifecycle support).
- `packages/shared/src/news-api.ts` + barrel export in `packages/shared/src/index.ts`.
- `packages/news/package.json` exports are load-bearing: `.` (registry), `./settings`
  (settings scanner), `./web` (web scanner). Deps mirror sports' + `htmlparser2`.
- apps/api, apps/worker, /today widget docking, pnpm-workspace/turbo/Dockerfile/tsconfig:
  **no changes** — all generic/glob-based.

Web (auto-scanned via vite virtual modules, but three hardcoded cosmetic maps):

- `apps/web/src/app-route-metadata.ts` `SECTION_OF` (~line 8-13) — add `news` (sports maps to
  "You") or it lands in the default nav section.
- `apps/web/src/settings/settings-module-view-model.ts:22` `USER_TOGGLEABLE_MODULE_IDS` — add
  `"news"`.
- `apps/web/src/settings/settings-personal-data-panes.tsx:94` `MODULE_ICONS` — add a Newspaper
  icon (falls back to `Boxes` otherwise).

Parity tests that hard-fail if missed:

- `tests/integration/foundation.test.ts:107-320` — exact full migration list; add the news row
  and run the FULL `test:integration` (focused tests won't catch it).
- `tests/unit/web-route-metadata.test.ts:38-44` — fixed route-path list; add `/news`.
- `tests/fixtures/virtual-jarvis-module-web.ts` — hand-maintained mirror of the web scanner
  ("sports is the only module with a `./web` export — keep in sync"); add news.
- `tests/unit/module-web-browser-safety.test.ts` — `./web` must pull in no `node:*`.
- Possibly-affected nav snapshots: `command-palette-model.test.ts`, `web-section-tour.test.ts`,
  e2e capture-screens specs.

Infra:

- `infra/nginx/jarv1s-web.conf` img-src parity with `MODULE_IMAGE_CSP_HOSTS` (the sports
  LOADER-SEAM note in `apps/api/src/static-web.ts:31-40`).

New tests to write (mirror sports' suite): manifest shape, registry integration, routes via
**`app.inject`** (NOT service-direct — the fast-json-stringify schema-strip trap is only visible
through the real serializer), service composition, repository RLS integration test, RSS parser
fixtures (one RSS2-with-media:content, one Atom), sanitizer ("zero surviving tags"), ranking,
prefs semantics, web contribution parity, settings pane, today widget.

## Verification

`pnpm verify:foundation` green; full `test:integration`; manual: dev server (`--host`), enable
defaults → /news renders populated broadsheet; toggle a source off → its stories disappear;
select `technology` → only tech feeds fetched; today widget renders; briefing tool returns facts.
Commit/PR summaries in release-note language.

## Tracking

Epic #896, task issue #897 (RFA). V1 fits one PR.
