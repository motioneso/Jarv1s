# Sports: follow clubs across all Champions-League-eligible federations + full English pyramid — Design Spec

**Status:** proposed — awaiting Ben approval before build.
**Date:** 2026-07-09 (grounding + adversarial review pass: Claude Fable 5, same day)
**Owner:** Ben + Jim (hive)
**GitHub:** #907 (task) · Sports module (#656)
**Grounded on:** `feat/907-sports-federation` @ `d89f27cd` (= `origin/main`; verified not behind
origin with `git fetch` + `git log HEAD..origin/main` empty). Every claim below was re-verified
against this tree; ESPN slugs and logo URLs were live-probed on 2026-07-09.

**Read, not remembered (source-grounded):**

- `packages/sports/src/source/catalog.ts` — `CatalogEntry`
  (`competitionKey`/`label`/`kind`/`marquee`/`standingsShape`/`espnSport`/`espnLeague`),
  `SPORTS_CATALOG` (8 entries), `catalogEntry()`. **Note:** on this tree `CatalogEntry` has **no**
  `logoUrl` field and there is **no** `competitionLogoUrl()` — an earlier draft of this spec assumed
  both from an uncommitted annotation batch in another worktree. League logos are treated as
  net-new, optional work here (§4.6).
- `packages/sports/src/source/espn-source.ts` — `listTeams` (lines ~209-243,
  `{SITE_BASE}/{sport}/{league}/teams`), `resolve()` (competitionKey → ESPN path segments, throws on
  unknown key), scoreboard/schedule/standings/news/articleBody datasets, `ESPN_FETCH_HOSTS`
  (`site.api.espn.com`, `content.core.api.espn.com`) and `ESPN_IMAGE_HOSTS` (`a.espncdn.com`,
  `s.secure.espncdn.com`) allowlists.
- `packages/sports/src/sports-service.ts` — `getCatalog()` (lines 142-162) fans out one cached
  `/teams` call **per catalog entry** via `Promise.all` and returns
  `{competitions:[{...entry, teams}], degraded}`.
- `packages/sports/src/routes.ts` — `GET /api/sports/catalog`, `GET/POST/DELETE /api/sports/follows`.
  POST (lines 118-136) validates `competitionKey` via `catalogEntry(...)`; **teamKey is not
  validated**.
- `packages/sports/src/manifest.ts` — every route must also be declared in the manifest `routes`
  array with a `permissionId`; dataset TTLs live here (`teams` = 24 h, scoreboard = 3 min,
  standings/headlines/schedule = 10 min), staleness `"degrade-empty"`.
- `packages/datasets/src/cache.ts` — the dataset cache is an **in-memory, per-process LRU** (max 500
  entries per source, stale retention 6 h). No cross-process sharing; empties on API restart.
- `packages/sports/src/settings/index.tsx` — the follow picker is **search-only** (PR #722): it loads
  the entire catalog (with all rosters) up front and filters client-side (`filterTeams`,
  `searchLeagues`, `leagueMatches` — exported and unit-tested). Empty query renders a "Search above
  to find teams or leagues to follow." note; there is no browse UI today.
- `packages/sports/sql/0133_sports_follows.sql` — `app.sports_follows`
  `(owner_user_id, competition_key, team_key NULL)`, owner-only FORCE RLS on all four ops.
  `team_key = NULL` means "whole competition".
- `packages/sports/src/web/sports-standings.tsx` (~lines 401-469) — the only consumer of
  `StandingsShape`; the render branches solely on `"record"` vs not, so `"table"` and `"groups"`
  render identically (rank + Pts).
- `packages/shared/src/sports-api.ts` — `sportsCatalogResponseSchema` currently **requires** a
  `teams` array on every competition; dropping it is a deliberate breaking contract change (§4.2).
  `competitionRefSchema` requires `marquee`. fast-json-stringify trap documented in-file (`body`,
  `nextMatch`, `resultMatch` / #885).
- `tests/unit/sports-routes.test.ts` (~line 280) — "GET /api/sports/catalog returns competitions
  with teams" asserts on the current shape and must change with the contract. **There is no e2e
  sports spec and no `followedLeagueCards` fixture anywhere in the repo** (an earlier draft claimed
  one); verification is unit-level via `app.inject` (§7).

## 0. TL;DR

Today a user can already follow **any club in any catalog league** — the follow write path never
validates `teamKey`, and clubs are enumerated live from ESPN's per-league `/teams` endpoint. The
only thing gatekeeping which clubs are followable is the **8-entry `SPORTS_CATALOG`**. So "follow
clubs everywhere" is fundamentally a **data-coverage** change… except for one architectural wall:

`getCatalog()` fetches **one ESPN `/teams` request per league, eagerly, on every follow-picker
load**. Going from 8 leagues to the ~50+ domestic leagues that feed the six continental Champions
Leagues would turn a single settings-page open into 50+ live ESPN round-trips. **That eager fan-out
is what forces this to be a spec, not a one-line catalog edit.**

This spec makes three changes:

1. **Model confederations.** Tag each league with its confederation (UEFA/CONCACAF/CONMEBOL/AFC/CAF/
   OFC) so the picker is browsable instead of a flat 2,000-club list.
2. **Load teams lazily.** `/api/sports/catalog` returns the **league list only** (cheap, no `/teams`
   fan-out). A new endpoint fetches one league's clubs **on demand**, and a new **server-side
   cross-league team search** replaces the picker's client-side filtering. The search ships in
   Slice 1, not later — the current picker is search-only, so lazy rosters without server search
   would remove its only interaction mode (see §5).
3. **Populate the full league dataset** — the full English pyramid (`eng.1`–`eng.5`) and every
   confederation's qualifying domestic leagues — from an authoritative, probe-verified slug table.
   Probing already showed ESPN's `{iso3}.{tier}` convention is **not universal** (`sau.1` fails,
   `ksa.1` works; `kor.1`/`egy.1`/`mar.1`/`nzl.1` all fail), so the probe script is load-bearing,
   not hygiene (§4.6).

No DB migration, no RLS change, no new standings shape. Existing follows stay valid.

## 1. Goals

- A user can find and follow **any club** in any Champions-League-eligible domestic league worldwide,
  browsing by confederation → league → club, or by typing the club name.
- The full **English football pyramid** is followable: Premier League, Championship, League One,
  League Two, National League (`eng.1`–`eng.5`).
- The follow picker opens **without firing dozens of live ESPN requests** — league metadata is cheap,
  club rosters load only for the league the user actually looks at or searches.
- Zero change to follow storage, RLS, overview/standings rendering, or the `teamKey`-agnostic write
  path. Existing followed clubs keep working unchanged.

## 2. Non-goals

- **No scores/standings for every new league on the /today or /sports pages.** Following a club in a
  smaller league adds it to the user's followed set; whether that club's fixtures render in the
  ticker is governed by the existing overview logic and ESPN data availability, unchanged here.
  (Overview cost already scales with the number of **distinct followed competitions** — that is
  user-chosen and bounded by their own follows, and this spec does not change it.)
- **No new sport.** Soccer-only expansion (US leagues already covered).
- **No migration / no schema change.** `app.sports_follows` is already competition-agnostic.
- **No exhaustive lower-division coverage outside England.** England gets its full pyramid per Ben's
  explicit ask; other federations get their **top division(s) that qualify clubs to the continental
  cup** — not every regional tier. (Extendable later; the dataset structure allows it. Scope
  decision reviewed and confirmed: probing shows even top flights alone are ~50 leagues, and no
  other federation's lower tiers were asked for.)
- **No offline club database.** Rosters stay live-from-ESPN (with caching), consistent with the
  module's "no cache table, TTL only" design.
- **No league logos as a blocker.** Live probing showed ESPN's league-logo CDN uses a **different
  id-space than the site API's league ids** (§4.6); logos are optional per-entry polish with a text
  fallback, never a gate on coverage.

## 3. The wall we are removing (why this is architectural)

`SportsService.getCatalog()` (sports-service.ts:142-162):

```
Promise.all(SPORTS_CATALOG.map(entry =>
    teams = cached("teams", {competitionKey})   // → ESPN /{sport}/{league}/teams
))
return { competitions: [{...entry, teams}], degraded }
```

The picker (`settings/index.tsx`) calls this once and filters client-side. That design **assumes a
small catalog**: N leagues ⇒ N live ESPN calls per cold picker load. It is correct and fast at N=8.
At N≈50 it is a self-inflicted fan-out — slow, ESPN-rate-limit-risky, and mostly wasted (the user
follows one club, not all 2,000).

The fix is to **separate league metadata from club rosters** in the catalog contract.

## 4. Design

### 4.1 Confederation on the catalog entry

Add to `CatalogEntry` (`catalog.ts`):

```ts
readonly confederation: "UEFA" | "CONCACAF" | "CONMEBOL" | "AFC" | "CAF" | "OFC" | "INTL";
```

Assignment for the existing 8 entries: `eng.1` → UEFA; `usa.1` → CONCACAF; `uefa.champions` → UEFA
(the tournament is unambiguously UEFA-run; grouping it under its confederation reads better in the
picker than a catch-all bucket); `fifa.world` → INTL; the non-soccer majors (NFL/NBA/NHL/MLB) →
INTL — the picker only applies confederation grouping to `espnSport === "soccer"`, so the INTL tag
on them is inert data.

This is pure data; `catalogEntry()` is unaffected. With ~55 entries `catalog.ts` will grow large —
if it approaches the repo's 1000-line file cap, split the row data into a sibling
`catalog-data.ts` (same module, pure data file).

### 4.2 Split the catalog contract: leagues eager, teams lazy

**Contract change (`packages/shared/src/sports-api.ts`):**

- `GET /api/sports/catalog` returns **leagues only** — no `teams` array:
  `{ competitions: CatalogLeague[], degraded }` where `CatalogLeague` is the entry metadata
  (`competitionKey`, `label`, `kind`, `marquee`, `confederation`, `standingsShape`) **without**
  rosters. `marquee` stays (it is `required` in `competitionRefSchema` today). This call touches
  **no** ESPN `/teams` endpoint — it's static catalog data, effectively free, and `degraded` is
  always `false` for it (kept in the shape for contract stability).
- **New** `GET /api/sports/leagues/:competitionKey/teams` → `{ teams: TeamRef[], degraded }`.
  Validates `competitionKey` via `catalogEntry()` (404 on unknown), then returns that one league's
  clubs via the existing `cached("teams", {competitionKey})` path. Called on demand when the user
  expands a league in the picker.
- **New** `GET /api/sports/teams/search?q=<query>` → `{ teams: TeamRef[], partial, degraded }` for
  the "type my club" path. `TeamRef` already carries `competitionKey`, so the client maps results to
  league labels from the (already loaded) catalog — the server does not search or return league
  rows; league-label matching ("Follow all of Championship") stays client-side against the cheap
  catalog list, preserving the current search UX. See §4.4 for `partial` and fan-out avoidance.

Remove the eager per-league `/teams` loop from `getCatalog()`. Keep `teamsFor` /
`cached("teams", …)` — it now backs the lazy endpoints instead.

**Both new routes must also be declared in `manifest.ts` `routes` with
`permissionId: "sports.view"`** — route registration without a manifest entry violates the module
route contract.

`fast-json-stringify` note: every new field (`confederation`, `partial`) and every new response
schema must declare each field in **both** the `required` array **and** `properties`, or the
emitted field is silently dropped (recurring trap: `nextMatch` #859, `resultMatch` #885 — see the
in-file comments in `sports-api.ts`). Removing `teams` from `sportsCatalogResponseSchema` is the
deliberate breaking half of this change; its single consumer is the settings picker (verified: the
only `sportsQueryKeys.catalog` consumer is `settings/index.tsx`).

### 4.3 Picker UI: browse by confederation, lazy-expand; search stays primary

Today's picker is **search-only** — there is no browse mode to preserve, only one to add.
`settings/index.tsx` becomes a two-mode picker:

- **Search mode (primary, unchanged UX):** typing a query ≥ 2 chars hits
  `/api/sports/teams/search?q=` (debounced) instead of filtering a preloaded roster dump.
  Results render as today: club rows with crest/initials fallback + follow toggle, plus
  client-derived "Follow all of {league}" rows from catalog-label matches and from result teams'
  parent leagues. While `partial: true`, show a quiet "still covering more leagues…" hint.
- **Browse mode (new, replaces the empty-state note):** with an empty query, render confederation
  sections (UEFA, CONCACAF, CONMEBOL, AFC, CAF, OFC) → leagues within each (from the cheap
  `/catalog`) → **on expanding a league**, fetch its clubs via `/leagues/:key/teams` and render
  follow toggles. Roster fetch is per-league and memoized client-side via React Query
  (new `sportsQueryKeys.leagueTeams(competitionKey)` / `sportsQueryKeys.teamSearch(q)` keys).

England's pyramid renders as five leagues under UEFA; expanding League Two lazily loads its 24
clubs. This preserves the existing authored settings patterns (no new component families; reuse the
current toggle + section + Note primitives; keep `PickCrest` initials fallback).

The exported client-side helpers (`filterTeams`, `searchLeagues`, `leagueMatches`) shrink: team
filtering moves server-side; league-label matching stays and keeps its unit tests.

One consequence of the contract flip (adversarial finding): the **followed-team summary chips**
currently resolve club names/crests from the catalog's embedded rosters
(`competition.teams.find(...)`). Post-flip that data no longer exists, so the chips resolve via the
same `/leagues/:key/teams` endpoint — one `useQueries` entry per _distinct followed-team league_
(typically 1–3), deduped with browse-expand fetches through the shared `leagueTeams` query key.

### 4.4 Cross-league team search without re-fanning-out

The naive search — "fetch every league's `/teams`, then filter" — is exactly the fan-out we're
removing. Options, in preference order:

1. **Warm roster cache + incremental fill (recommended).** Reuse the existing per-league `/teams`
   TTL cache. Search matches against leagues whose rosters are **already cached**, plus it
   opportunistically warms a small, bounded number of **unfetched** leagues per query (≤ 5,
   prioritized by confederation prominence order in the catalog), so repeated searching converges
   toward full coverage without ever issuing 50 calls in one request. The 24 h roster TTL (rosters
   change ~seasonally) makes this cheap after warm-up.

   **Required runtime extension (adversarial finding):** the dataset client has no "is this cached?"
   primitive — `getDataset` always fetches on miss, so "search only cached leagues" is
   unimplementable as previously drafted. Add a small, generic **`cacheOnly` read option** (peek:
   return hit-or-miss without fetching) to `@jarv1s/datasets` `DatasetClient.getDataset`. That is
   shared-infra, not cross-module coupling, and other modules can use it too.

   **Honest limits:** the dataset cache is per-process and in-memory (`packages/datasets/src/cache.ts`),
   so warm-fill convergence resets on API restart and is not shared across processes. Acceptable for
   MVP — the fill re-converges within a handful of searches, and worst-case coverage gaps only mean
   a club temporarily missing from search (browse mode always finds it).

   The response carries **`partial: true` while coverage is incomplete** — a separate field, not an
   overload of `degraded` (`degraded` means "the upstream source failed" everywhere else in the
   module and drives "couldn't load" UI; conflating them would show error messaging for a normal
   warm-up state).

2. **Background roster warm on boot.** A low-priority job pre-populates the roster cache for all
   catalog leagues out-of-band (respecting ESPN rate limits), so search is complete without blocking
   any user request. Heavier (job scheduling + metadata-only payload discipline); defer unless
   option 1 proves insufficient in practice.

MVP ships option 1. It bounds worst-case ESPN calls per request to a small constant and degrades
gracefully. (At Slice 1's 8-league catalog, ≤ 5 warm-fills per query means full coverage from the
second search onward — the mechanism is exercised long before the dataset grows.)

### 4.5 Storage, RLS, standings — unchanged

- `app.sports_follows` already stores `(owner_user_id, competition_key, team_key)` for arbitrary
  competitions/teams. No migration.
- POST `/follows` keeps validating `competitionKey` via `catalogEntry()`; adding leagues to the
  catalog is what authorizes them. `teamKey` stays unvalidated (a broken teamKey simply yields an
  empty card, never a cross-user leak — RLS is owner-only, FORCE, all four ops).
- Standings reuse `"table"` for all new soccer leagues (`"groups"` renders identically today; no new
  branch). Confirmed single consumer in `sports-standings.tsx`.

### 4.6 The league dataset (probe-verified, appendix-driven)

Add one `CatalogEntry` per qualifying domestic league. ESPN soccer slugs **mostly** follow
`{iso3}.{tier}` (e.g. `eng.1`, `esp.1`, `mex.1`, `bra.1`, `jpn.1`) — but **not always**, and this
was verified the hard way on 2026-07-09:

- `sau.1` → fails; Saudi Pro League is **`ksa.1`** (id 21231, 18 teams).
- `kor.1`, `egy.1`, `mar.1`, `nzl.1` → all fail. K League 1, the Egyptian Premier League, Botola,
  and any OFC coverage need alternate slugs discovered by the probe script (or turn out to be
  absent from ESPN, in which case they are dropped from the dataset — OFC in particular may end up
  empty; that is acceptable and should be stated in the picker copy for nobody, i.e. silently).

**Every slug MUST be verified by a probe script before landing** — a 404 slug produces an empty
league in the picker. Deliver `scripts/probe-espn-leagues.mjs` that, for a candidate list, checks
`/teams` (HTTP 200 + non-empty roster) and emits verified `CatalogEntry` rows (slug, ESPN league id,
ESPN's own display name as the label seed, team count). The dataset is regenerable, never
hand-transcribed. The probe is a **manual/dev script, not a CI gate** — putting live ESPN calls in
`verify:foundation` or CI trades slug-drift detection for network flakiness in every unrelated
build; run it when touching the dataset and record its output in the PR.

**League logos (adversarial finding — previous draft was wrong):** the assumed scheme
`https://a.espncdn.com/i/leaguelogos/soccer/500/{apiLeagueId}.png` **404s for every probed API id**
(3914, 760, 630, 3917, and eng.1's id 700). The CDN path itself is real but uses a **legacy
id-space distinct from the site-api league ids** (`/500/23.png` and `/500/2.png` return 200), and
the `/teams` payload carries no league `logos` field to bridge them. Consequence: league logos
cannot be derived; they would need a hand-curated id mapping per league. The current picker shows
**no league logos anyway** (league rows are text buttons), so: ship coverage without logos; if
logos are wanted later, add an **optional** `logoUrl` per entry, populated only where a curated id
is probe-verified, with the existing text row as fallback. Never block a league on a logo.

Representative probe results (2026-07-09), enough to trust the approach — full enumeration is the
implementation-time probe run:

| Slug      | ESPN id | Teams | League                    |
| --------- | ------- | ----- | ------------------------- |
| eng.2     | 3914    | 24    | EFL Championship          |
| eng.3     | 3915    | 24    | EFL League One            |
| eng.4     | 3916    | 24    | EFL League Two            |
| eng.5     | 3917    | 24    | National League           |
| esp.1     | 740     | 20    | LaLiga                    |
| ger.1     | 720     | 18    | Bundesliga                |
| ned.1     | 725     | 18    | Eredivisie                |
| por.1     | 715     | 18    | Primeira Liga             |
| sco.1     | 735     | 12    | Scottish Premiership      |
| tur.1     | 3946    | 18    | Süper Lig                 |
| bel.1     | 3901    | 18    | Belgian Pro League        |
| gre.1     | 3955    | 14    | Super League Greece       |
| sui.1     | 3944    | 12    | Swiss Super League        |
| aut.1     | 3907    | 12    | Austrian Bundesliga       |
| den.1     | 3913    | 12    | Danish Superliga          |
| mex.1     | 760     | 18    | Liga MX                   |
| crc.1     | 4005    | 10    | Liga Promerica            |
| bra.1     | 630     | 20    | Brasileirão               |
| arg.1     | 745     | 30    | Liga Profesional          |
| col.1     | 650     | 20    | Primera A                 |
| chi.1     | 640     | 16    | Primera División de Chile |
| uru.1     | 680     | 16    | Primera División Uruguay  |
| jpn.1     | 750     | 20    | J.League                  |
| ksa.1     | 21231   | 18    | Saudi Pro League          |
| chn.1     | 8376    | 16    | Chinese Super League      |
| aus.1     | 3906    | 12    | A-League Men              |
| rsa.1     | 3937    | 16    | Betway Premiership        |
| kor.1     | —       | —     | **FAILS — alt slug TBD**  |
| egy.1     | —       | —     | **FAILS — alt slug TBD**  |
| mar.1     | —       | —     | **FAILS — alt slug TBD**  |
| nzl.1     | —       | —     | **FAILS — alt slug TBD**  |
| ~~sau.1~~ | —       | —     | **FAILS — use `ksa.1`**   |

## 5. Slices

Resequenced after grounding (adversarial finding): the previous draft deferred server-side search to
Slice 4, but the current picker is **search-only** — shipping lazy rosters without server search
would leave the picker with no working interaction mode until Slice 4. Search therefore lands in
Slice 1 with the contract split.

1. **Slice 1 — architecture (no visible coverage change).** Add `confederation` to `CatalogEntry`;
   split the catalog contract (leagues-only `/catalog`, new `/leagues/:key/teams`, new
   `/teams/search` with bounded warm-fill incl. the `@jarv1s/datasets` `cacheOnly` peek); declare
   both routes in `manifest.ts`; rework the picker (server search primary + confederation browse
   replacing the empty-state note); update `sports-routes` / `web-sports-client` unit tests. Keep
   the current 8 competitions. Verify: picker cold load issues **0** `/teams` fetches; search and
   browse both follow correctly.
2. **Slice 2 — English pyramid + probe script.** Deliver `scripts/probe-espn-leagues.mjs`; add
   `eng.2`–`eng.5` from its verified output. Smallest, highest-confidence coverage win; validates
   the dataset+probe flow end to end.
3. **Slice 3 — Americas + UEFA top flights.** CONMEBOL + CONCACAF feeders and the UEFA first
   divisions from the probe table (§4.6 seeds these with 20+ already-verified rows).
4. **Slice 4 — AFC/CAF/OFC + long tail.** Remaining confederations, including chasing the
   failed-slug leagues (K League, Egypt, Morocco, OFC) via probe alternates; drop what ESPN simply
   lacks. Optional curated league logos if wanted.

Each slice is independently shippable; Slice 1 is the only one with architectural risk, and slices
2-4 are pure `catalog.ts` data + probe output.

## 6. Risks & mitigations

- **ESPN rate limits / flakiness at scale.** Mitigated by lazy loading (§4.2), 24 h roster TTL, the
  existing `degraded` flag for real failures, and bounded per-request warm-fill (§4.4). No slice
  ever issues an unbounded fan-out.
- **Slug drift / dead leagues.** The probe script (§4.6) is the guard; dataset is regenerable, never
  hand-transcribed. Run manually when touching the dataset (deliberately not a CI gate — network
  flake would poison unrelated builds).
- **Picker performance with thousands of clubs.** Never materialized at once — browse is per-league
  lazy, search is server-side and result-capped. Client holds only expanded leagues.
- **Search coverage gaps after restart.** Warm-fill state lives in the per-process in-memory dataset
  cache; a restart resets convergence. Bounded impact: `partial: true` signals it, browse mode is
  always complete, and coverage re-converges within a few searches.
- **Standings for obscure leagues** may be sparse/absent from ESPN. Acceptable: following adds the
  club to the user's set; missing standings degrade to the existing empty-state, not an error.
- **Module isolation.** All changes stay within `@jarv1s/sports` + its shared contract, plus one
  generic read option on `@jarv1s/datasets` (shared infra, not module coupling). No news-module
  coupling.

## 7. Verification

- `pnpm verify:foundation` green (typecheck, lint, format, file-size, unit).
- Unit (via `app.inject`, per the fast-json-stringify discipline — service-level tests cannot catch
  schema-stripping): catalog returns leagues without rosters and with `confederation`;
  `/leagues/:key/teams` returns a roster for a valid key and 404s an unknown one; `/teams/search`
  returns matches, honors the warm-fill bound (assert ESPN call count against a stubbed dataset
  client), and emits `partial` correctly. Update the existing
  `tests/unit/sports-routes.test.ts` catalog test (currently asserts the merged shape) and
  `tests/unit/web-sports-client.test.ts`.
- Picker cold-load issues **0** ESPN `/teams` calls (assert against the eager loop's removal);
  expanding one league issues exactly 1.
- Follow → overview round-trip works for a club in a newly-added league (e.g. a Championship club).
- Probe script output matches the committed catalog rows (no unverified slugs); probe run recorded
  in the dataset PRs.

## Appendix A — target league set (implementation-time, probe-verified)

- **England (full pyramid):** eng.1 Premier League · eng.2 Championship · eng.3 League One ·
  eng.4 League Two · eng.5 National League. (All five probe-verified, 20+24+24+24+24 teams.)
- **UEFA (top flights):** esp.1, ger.1, ita.1, fra.1, ned.1, por.1, sco.1, bel.1, tur.1, gre.1,
  sui.1, aut.1, den.1, and the remaining member associations' first divisions per the probe run.
- **CONMEBOL (Libertadores feeders):** bra.1, arg.1, col.1, chi.1, uru.1, ecu.1, par.1, per.1,
  bol.1, ven.1.
- **CONCACAF (Champions Cup feeders):** mex.1, usa.1 (existing), crc.1, hon.1, gua.1, slv.1, pan.1.
- **AFC (Champions League Elite feeders):** jpn.1, **ksa.1** (not `sau.1`), chn.1, aus.1, uae.1,
  qat.1, irn.1, tha.1, and K League 1 (alt slug TBD — `kor.1` fails).
- **CAF (Champions League feeders):** rsa.1, alg.1, tun.1, plus Egypt and Morocco (alt slugs TBD —
  `egy.1`/`mar.1` fail).
- **OFC:** `nzl.1` fails; probe for alternates, and accept that OFC may have no ESPN coverage at
  all (dropped silently if so).

Slugs above are candidates in ESPN's `{iso3}.{tier}` convention **where it holds**; the probe
script promotes only those returning a populated `/teams` roster into the catalog.

## User-facing summary

Follow your club wherever it plays — the full English pyramid down to the National League, plus Liga
MX, Brazil, Argentina, and top divisions across every confederation that competes for a continental
title. Browse by region or just type your club's name.
