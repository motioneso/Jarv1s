# Sports: follow clubs across all Champions-League-eligible federations + full English pyramid — Design Spec

**Status:** proposed — awaiting Ben approval before build.
**Date:** 2026-07-09
**Owner:** Ben + Jim (hive)
**GitHub:** #907 (task) · Sports module (#656)
**Grounded on:** `feat/897-news-module` @ `d89f27cd` (worktree with an in-session /today annotation
batch uncommitted — the machinery this spec depends on is unchanged by that batch).

**Read, not remembered (source-grounded):**

- `packages/sports/src/source/catalog.ts` — `CatalogEntry` (`espnSport`/`espnLeague`/`logoUrl`),
  `SPORTS_CATALOG`, `catalogEntry()`, `competitionLogoUrl()`. The single list that defines every
  followable competition today (8 entries).
- `packages/sports/src/source/espn-source.ts` — `listTeams` (`{SITE_BASE}/{sport}/{league}/teams`,
  lines ~203-237), `resolve()` (competitionKey → ESPN path segments), scoreboard/schedule/standings/
  news endpoints, `ESPN_FETCH_HOSTS` allowlist.
- `packages/sports/src/sports-service.ts` — `getCatalog()` (lines ~144-165) fans out one cached
  `/teams` call **per competition** and returns `{competitions:[{...entry, teams}], degraded}`.
- `packages/sports/src/routes.ts` — `GET /api/sports/catalog`, `GET /api/sports/follows`,
  `POST/DELETE /api/sports/follows`. POST validates `competitionKey` via `catalogEntry(...)`;
  **teamKey is not validated**.
- `packages/sports/src/settings/index.tsx` — the follow picker: loads the entire catalog up front,
  filters teams/leagues client-side (`filterTeams`, `searchLeagues`).
- `packages/sports/sql/0133_sports_follows.sql` — `app.sports_follows`
  `(owner_user_id, competition_key, team_key NULL)`, owner-only FORCE RLS. `team_key = NULL` means
  "whole competition".
- `packages/sports/src/web/sports-standings.tsx` (~417-437) — the only consumer of `StandingsShape`;
  `"table"` and `"groups"` render identically (rank + Pts).

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
   fan-out). A new endpoint fetches one league's clubs **on demand** when the user opens or searches
   that league. Plus a server-side cross-league team search for "just find my club".
3. **Populate the full league dataset** — the full English pyramid (`eng.1`–`eng.5`) and every
   confederation's qualifying domestic leagues — from an authoritative, probe-verified slug table.

No DB migration, no RLS change, no new standings shape. Existing follows stay valid.

## 1. Goals

- A user can find and follow **any club** in any Champions-League-eligible domestic league worldwide,
  browsing by confederation → league → club, or by typing the club name.
- The full **English football pyramid** is followable: Premier League, Championship, League One,
  League Two, National League (`eng.1`–`eng.5`).
- The follow picker opens **without firing dozens of live ESPN requests** — league metadata is cheap,
  club rosters load only for the league the user actually looks at.
- Zero change to follow storage, RLS, overview/standings rendering, or the `teamKey`-agnostic write
  path. Existing followed clubs keep working unchanged.

## 2. Non-goals

- **No scores/standings for every new league on the /today or /sports pages.** Following a club in a
  smaller league adds it to the user's followed set; whether that club's fixtures render in the
  ticker is governed by the existing overview logic and ESPN data availability, unchanged here.
- **No new sport.** Soccer-only expansion (US leagues already covered).
- **No migration / no schema change.** `app.sports_follows` is already competition-agnostic.
- **No exhaustive lower-division coverage outside England.** England gets its full pyramid per Ben's
  explicit ask; other federations get their **top division(s) that qualify clubs to the continental
  cup** — not every regional tier. (Extendable later; the dataset structure allows it.)
- **No offline club database.** Rosters stay live-from-ESPN (with caching), consistent with the
  module's "no cache table, TTL only" design.

## 3. The wall we are removing (why this is architectural)

`SportsService.getCatalog()`:

```
for each entry in SPORTS_CATALOG:
    teams = cached("teams", {competitionKey})   // → ESPN /{sport}/{league}/teams
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

`"INTL"` covers cross-confederation / non-domestic entries already in the catalog (World Cup,
Champions League tournaments, and the US majors NFL/NBA/NHL/MLB — which are non-soccer and simply
group under their own headers; the picker only applies confederation grouping to `espnSport ===
"soccer"`).

This is pure data; `catalogEntry()` and `competitionLogoUrl()` are unaffected.

### 4.2 Split the catalog contract: leagues eager, teams lazy

**Contract change (`packages/shared/src/sports-api.ts`):**

- `GET /api/sports/catalog` returns **leagues only** — no `teams` array:
  `{ competitions: CatalogLeague[], degraded }` where `CatalogLeague` is the entry metadata
  (`competitionKey`, `label`, `kind`, `confederation`, `standingsShape`, `logoUrl`) **without**
  rosters. This call touches **no** ESPN `/teams` endpoint — it's static catalog data, effectively
  free.
- **New** `GET /api/sports/leagues/:competitionKey/teams` → `{ teams: CatalogTeam[], degraded }`.
  Validates `competitionKey` via `catalogEntry()`, then returns that one league's clubs via the
  existing `cached("teams", {competitionKey})` path. Called on demand when the user expands/opens a
  league in the picker.
- **New** `GET /api/sports/teams/search?q=<query>` → `{ results: CatalogTeamMatch[], degraded }` for
  the "type my club" path. See §4.4 for how this avoids re-introducing the fan-out.

Remove the eager per-league `/teams` loop from `getCatalog()`. Keep `teamsFor` /
`cached("teams", …)` — it now backs the lazy endpoint instead.

`fast-json-stringify` note: every new field (`confederation`) and every new response
(`leagueTeams`, `teamSearch`) must be declared in **both** the `required` array **and** `properties`
of its schema, or the emitted field is silently dropped. (Recurring trap — see
`packages/shared/src/*-api.ts` and the sports `logoUrl` addition in the same session.)

### 4.3 Picker UI: browse by confederation, lazy-expand

`settings/index.tsx` becomes a two-mode picker:

- **Browse mode (default):** confederation sections (UEFA, CONMEBOL, CONCACAF, AFC, CAF, OFC) →
  leagues within each (from the cheap `/catalog`) → **on expanding a league**, fetch its clubs via
  `/leagues/:key/teams` and render follow toggles. Roster fetch is per-league and memoized client-
  side for the session.
- **Search mode:** typing a query ≥ 2 chars hits `/api/sports/teams/search?q=` (debounced) and lists
  matching clubs across all leagues with their league label, each a follow toggle.

England's pyramid renders as five leagues under UEFA; expanding League Two lazily loads its 24 clubs.
This preserves the existing authored settings patterns (no new component families; reuse the current
toggle + section primitives).

### 4.4 Cross-league team search without re-fanning-out

The naive search — "fetch every league's `/teams`, then filter" — is exactly the fan-out we're
removing. Options, in preference order:

1. **Warm roster cache + incremental fill (recommended).** Reuse the existing per-league `/teams`
   TTL cache. Search queries only leagues whose rosters are **already cached**, plus it opportunis-
   tically warms a small, bounded number of **unfetched** leagues per query (e.g. ≤ 5, prioritised by
   confederation prominence), so repeated searching converges to full coverage without ever issuing
   50 calls in one request. Long TTL (rosters change ~seasonally; 24 h) makes this cheap after warm-
   up. The response carries `degraded: true` while coverage is partial so the UI can show "still
   loading more leagues…".
2. **Background roster warm on boot.** A low-priority job pre-populates the roster cache for all
   catalog leagues out-of-band (respecting ESPN rate limits), so search is complete without blocking
   any user request. Heavier; defer unless option 1 proves insufficient.

MVP ships option 1. It bounds worst-case ESPN calls per request to a small constant and degrades
gracefully.

### 4.5 Storage, RLS, standings — unchanged

- `app.sports_follows` already stores `(owner_user_id, competition_key, team_key)` for arbitrary
  competitions/teams. No migration.
- POST `/follows` keeps validating `competitionKey` via `catalogEntry()`; adding leagues to the
  catalog is what authorizes them. `teamKey` stays unvalidated (a broken teamKey simply yields an
  empty card, never a cross-user leak — RLS is owner-only).
- Standings reuse `"table"` for all new soccer leagues (`"groups"` renders identically today; no new
  branch). Confirmed single consumer in `sports-standings.tsx`.

### 4.6 The league dataset (probe-verified, appendix-driven)

Add one `CatalogEntry` per qualifying domestic league. ESPN soccer slugs follow `{iso3}.{tier}`
(e.g. `eng.1`, `esp.1`, `mex.1`, `bra.1`, `jpn.1`). Logos come from the two ESPN schemes already in
use (`competitionLogoUrl` / per-entry `logoUrl`): US leagues at `/i/teamlogos/leagues/500/{slug}.png`,
soccer at `/i/leaguelogos/soccer/500/{numericId}.png`.

**Every slug and logo id MUST be verified by a probe script before landing** — a 404 slug produces
an empty league in the picker. Deliver `scripts/probe-espn-leagues.mjs` that, for a candidate list,
checks `/teams` (200 + non-empty) and the logo URL, and emits the verified `CatalogEntry` rows. This
keeps the dataset honest and regenerable rather than hand-transcribed.

Confirmed-resolving seeds (probed 2026-07-09): `eng.1`–`eng.5`, `mex.1`, `bra.1`, `arg.1`, plus the
existing `usa.1`, `esp/ger/ita/fra` top flights are the expected UEFA set. Full per-confederation
enumeration is an implementation task driven by the probe script (Appendix A lists the target set).

## 5. Slices

1. **Slice 1 — architecture (no visible coverage change yet).** Add `confederation` to
   `CatalogEntry`; split the catalog contract (leagues-only `/catalog`, new lazy
   `/leagues/:key/teams`); rework the picker to lazy-expand by confederation; keep the current 8
   competitions. Ship + verify the picker still follows correctly with zero eager `/teams` fan-out.
2. **Slice 2 — English pyramid.** Add `eng.2`–`eng.5` (probe-verified) + logos. Smallest, highest-
   confidence coverage win; validates the dataset+probe flow end to end.
3. **Slice 3 — Americas + top UEFA.** Liga MX, Brasileirão, Argentina, plus the marquee UEFA leagues
   (La Liga, Bundesliga, Serie A, Ligue 1, Eredivisie, Primeira Liga…).
4. **Slice 4 — remaining confederations + cross-league search.** AFC/CAF/OFC/rest-of-CONMEBOL/
   CONCACAF from the probe table, and the `/teams/search` endpoint (§4.4) with warm-cache incremental
   fill.

Each slice is independently shippable; Slice 1 is the only one with architectural risk.

## 6. Risks & mitigations

- **ESPN rate limits / flakiness at scale.** Mitigated by lazy loading (§4.2), long roster TTL, the
  existing `degraded` flag, and bounded per-request warm-fill (§4.4). No slice ever issues an
  unbounded fan-out.
- **Slug drift / dead leagues.** The probe script (§4.6) is the guard; dataset is regenerable, never
  hand-transcribed. CI-runnable to catch ESPN slug changes.
- **Picker performance with thousands of clubs.** Never materialised at once — browse is per-league
  lazy, search is server-side and bounded. Client holds only expanded leagues.
- **Standings for obscure leagues** may be sparse/absent from ESPN. Acceptable: following adds the
  club to the user's set; missing standings degrade to the existing empty-state, not an error.
- **Module isolation.** All changes stay within `@jarv1s/sports` + its shared contract. No news-module
  coupling.

## 7. Verification

- `pnpm verify:foundation` green (typecheck, lint, format, file-size, unit).
- Picker cold-load issues **0** ESPN `/teams` calls (assert against the eager loop's removal);
  expanding one league issues exactly 1.
- Follow → overview round-trip works for a club in a newly-added league (e.g. a Championship club).
- Probe script output matches the committed catalog rows (no unverified slugs).
- Existing e2e sports specs stay green (fixture `followedLeagueCards` unaffected).

## Appendix A — target league set (implementation-time, probe-verified)

- **England (full pyramid):** eng.1 Premier League · eng.2 Championship · eng.3 League One ·
  eng.4 League Two · eng.5 National League.
- **UEFA (top flights):** esp.1, ger.1, ita.1, fra.1, ned.1, por.1, sco.1, bel.1, tur.1, and the
  remaining member associations' first divisions per the probe table.
- **CONMEBOL (Libertadores feeders):** bra.1, arg.1, col.1, chi.1, uru.1, ecu.1, par.1, per.1,
  bol.1, ven.1.
- **CONCACAF (Champions Cup feeders):** mex.1, usa.1 (existing), crc.1, hon.1, gua.1, slv.1, pan.1.
- **AFC (Champions League Elite feeders):** jpn.1, kor.1, chn.1, sau.1, aus.1, uae.1, qat.1, irn.1,
  tha.1.
- **CAF (Champions League feeders):** egy.1, mar.1, rsa.1, alg.1, tun.1.
- **OFC:** nzl.1 (+ island nations where ESPN has coverage; likely sparse).

Slugs above are candidates in ESPN's `{iso3}.{tier}` convention; the probe script promotes only
those returning a populated `/teams` roster + a valid logo into the catalog.

## User-facing summary

Follow your club wherever it plays — the full English pyramid down to the National League, plus Liga
MX, Brazil, Argentina, and top divisions across every confederation that competes for a continental
title. Browse by region or just type your club's name.
