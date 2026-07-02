# Sports Page Feedback Pass — Design Spec

**Status:** proposed — awaiting Ben approval.
**Date:** 2026-07-01
**Owner:** Ben + hive
**GitHub:** #668 (task, `needs-spec`, `dogfood`, `sev:major`) · follow-up to #656 / PR #666
**Grounded on:** branch `coord/668-sports-feedback-spec` @ `d39601de` (origin/main `f32124f5`)

**Read, not remembered (source-grounded):**

- Issue #668 body — the 18 captured Agentation annotations (source of truth for the feedback).
- `docs/superpowers/specs/2026-06-30-sports-module.md` + `docs/superpowers/plans/2026-07-01-sports-module.md` — the shipped MVP's decisions this pass extends (D3 adapter, D4 in-memory cache, §4.6a design language).
- `packages/sports/src/sports-service.ts`, `src/source/espn-source.ts`, `src/source/catalog.ts` — where each defect mechanically lives (verified line-level below).
- `apps/web/src/sports/sports-page.tsx`, `sports-parts.tsx`, `apps/web/src/styles/sports-1.css` (992 lines — 8 from the 1000-line gate).
- `packages/shared/src/sports-api.ts` — the REST contract this pass revises.
- `apps/api/src/static-web.ts` + `infra/nginx/jarv1s-web.conf` — CSP `img-src 'self' data:` (the hidden blocker for all "real assets" items).
- **Live ESPN verification (2026-07-01):** news articles carry `categories[]` (`type:"team"`, numeric `teamId`) and `images[]` (`a.espncdn.com` header photos); `fifa.world` standings return **12 group children (A–L)**; NFL standings return **2 conference children** with `winPercent`/`playoffSeed` and no soccer-style `points`. The trimmed test fixtures do not show these fields; the live shapes were checked directly.

## 0. TL;DR

Dogfood pass on `/sports` (issue #668, 18 annotations) grouped into **six workstreams**: real assets (logos/flags/photos), source links, followed-team relevance, full names + next-match dates, a Top Stories + league-news layout, and league-aware standings. Everything is achievable inside the existing `SportsSource` adapter + in-memory cache architecture — **no new table, no migration, no worker, no new dependency**. The one platform-level decision is image delivery: today's CSP (`img-src 'self' data:`) silently blocks every ESPN crest/photo, which is why the page shows initials even where `crestUrl` is populated. Recommendation: extend CSP with the source adapter's **declared image-CDN hosts** (zero new server attack surface) rather than building a URL-fetching image proxy (re-introduces the SSRF class the v0.1.0 audit flagged).

## 1. Feedback → root cause map

Every annotation in #668 traces to one of six mechanisms. Numbers refer to the issue's list.

| #                  | Symptom                                                     | Root cause (verified in code)                                                                                                                                                                                                                 | Workstream |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1                  | Hero "Editorial photo" placeholder, never a photo           | `Headline` DTO has no image field; `espn-source.getHeadlines` drops the article `images[]`; `StoryHero` renders a static placeholder.                                                                                                         | A          |
| 3, 4, 8, 9, 13, 14 | Crests show initials (`US`, `SD`, `LI`, `SG`, …)            | Two stacked causes: (a) `buildCard` sets `crestUrl = todaySide?.crestUrl ?? null` — populated **only when the team plays today**; (b) even when a URL is present, CSP `img-src 'self' data:` blocks `a.espncdn.com`, so `<img>` never paints. | A          |
| 2, 6               | Hero + followed-card stories don't link to source           | `Headline.url` exists and the rail links it, but `StoryHero` renders plain text and `FollowedTeamCard` flattens the headline into the `primary` string, losing the URL.                                                                       | B          |
| 7, 10              | Card "news" unrelated to the followed team                  | `buildCard` uses `headlines[0]` of the **whole competition** (first MLB story ≠ a Giants story). Headlines carry no team association today.                                                                                                   | C          |
| 17                 | Game highlighted as followed with neither team followed     | `followedTeamKeys` is a flat set of lowercase abbreviations matched across **all** competitions; abbreviations collide between leagues (e.g. `min`, `sd`).                                                                                    | C          |
| 5, 11, 12          | Raw keys shown as names (`sd`, `liv`, `ana`)                | Name fallback chain ends at bare `teamKey`; `nextMatchLine` uses schedule-payload `shortName` which also falls back to `teamKey`.                                                                                                             | D          |
| 15                 | "Next" shows opponent but no date                           | `nextMatchLine` returns only `"vs <opponent>"`; `startsAt` is discarded.                                                                                                                                                                      | D          |
| 16                 | Rail headlines unbounded; wants Top Stories + news grid     | Overview flatMaps every competition's full headline list into one rail with no cap and no ranking.                                                                                                                                            | E          |
| 18                 | Standings ignore competition semantics; World Cup = 1 group | `espn-source.getStandings` reads `children[0]` only (drops WC groups B–L and the NFC); one hardcoded `# / Team / P` column set for every league; NFL `rank` resolves to `?? 0`.                                                               | F          |

## 2. Goals

- Every one of the 18 annotations in #668 resolved by this pass (none deferred).
- Real team logos / national emblems / story photos render on the page; initials swatch remains only as the authored degraded fallback.
- Every story on the page (hero, cards, rails, news grid) links to its originating article.
- "Followed" highlighting and followed-team news are provably scoped to the actual followed team (competition + team pair, team-tagged articles).
- No raw `teamKey` is ever rendered; next matches show a localized date/time.
- Standings render per competition semantics: soccer points table, tournament groups, US conference records.
- Stay inside MVP architecture: adapter + in-memory TTL cache, no persistence changes.

## 3. Non-Goals

- No new data source or keyed provider; ESPN via `SportsSource` stays (spec #656 D2/D3).
- No image proxy/cache service (considered and rejected — §5 D-1).
- No new table, column, or migration; `app.sports_follows` unchanged, RLS untouched.
- No live play-by-play, notifications, chat tools, or team pages (still fast-follow per spec #656 §9).
- No visual redesign beyond the Top Stories / news-grid restructure the feedback asks for; this is a functionality pass composing existing `sp-*`/`jds-*` idioms — Ben annotates the look afterwards, per the established functionality-vs-design split.

## 4. Design by workstream

### A. Real assets (items 1, 3, 4, 8, 9, 13, 14)

**A1 — Unblock external images (platform decision, §5 D-1).** `SportsSource` gains a declared static host list:

```ts
interface SportsSource {
  /** Https hosts its crest/photo URLs resolve to; consumed by the CSP builder. */
  readonly imageHosts: readonly string[]; // ESPN impl: ["a.espncdn.com", "s.secure.espncdn.com"]
  // ...existing methods
}
```

`apps/api/src/static-web.ts` composes `img-src 'self' data: <hosts>` from the registered source's declaration (tagged `// LOADER-SEAM(sports):` — the composition root reaches into module config). `infra/nginx/jarv1s-web.conf` is static config and must be updated to match; add a comment in both files pointing at each other, and a deployment note in the sports README. The exact ESPN host list is pinned at build time by inspecting the URLs the live endpoints return (the two above were observed; verify during implementation).

**A2 — Crest resolution chain.** `buildCard` resolves `crestUrl` (and full name, §D) with this precedence: today's scoreboard side → **teams catalog entry** (`listTeams`, already cached 24 h — the authoritative source of logos and full names, including national-team emblems for `fifa.world`, which answers item 3 with no special-casing) → any schedule side → `null` (initials swatch = authored degraded state). The overview path therefore warms the teams cache for followed competitions; that is at most one extra upstream call per competition per 24 h.

**A3 — Story photos.** `Headline` gains `imageUrl: string | null`; `espn-source.getHeadlines` maps the first `type: "header"` image (else first image, else null). `StoryHero` renders the photo with the existing placeholder as the no-image/degraded fallback (`sp-photo` stays as the loading/error skeleton). News-grid cards may show a small thumbnail when present (§E); rail Top Stories stay text-only.

### B. Source links (items 2, 6)

- `StoryHero` headline becomes an external link (`target="_blank" rel="noreferrer"`, matching the existing rail idiom).
- `FollowedTeamCard` stops overloading `primary` for news. New field:

```ts
readonly news: { readonly title: string; readonly url: string } | null; // status "news" content
```

`primary` remains the score/result line for `live`/`today` states. The card's news row renders as a link. Every headline rendered anywhere on the page is an anchor to `Headline.url`.

### C. Relevance (items 7, 10, 17)

**C1 — Team-tagged headlines.** ESPN articles carry `categories[] { type: "team", teamId }` (live-verified). The source stays stateless; the join happens in the service:

- `getHeadlines` maps article categories to `sourceTeamIds: readonly string[]` on each source-layer headline.
- `listTeams` returns `TeamRef & { sourceTeamId: string | null }` (the provider's team id).
- The **service** joins the two via its existing 24 h teams cache and emits the public DTO field `Headline.teamKeys: readonly string[]` (our key space). Fastify response serialization (`additionalProperties: false`) strips `sourceTeamId` from the catalog response automatically — provider ids never reach the frontend.

**C2 — Card news relevance.** A card in `news` state shows the newest headline whose `teamKeys` contains the card's `teamKey`; if none exists, the authored "No recent news" state renders (correct emptiness beats an unrelated story — direct fix for item 10).

**C3 — Competition-scoped follow matching.** Replace `followedTeamKeys: string[]` with:

```ts
readonly followedTeams: readonly { competitionKey: string; teamKey: string }[];
```

The client matches on the `(competitionKey, teamKey)` pair — `GameRow` and `StandingsRail` both know their group's `competitionKey`. Abbreviation collisions across leagues can no longer mark a game as followed (item 17). The rail/grid "You" marker moves from competition-level to team-level: shown only when `headline.teamKeys` intersects the followed teams of that competition.

### D. Full names and next-match dates (items 5, 11, 12, 15)

**D1 — Name resolution.** Card `name` precedence mirrors A2: today side → catalog entry → schedule side → last-resort `teamKey.toUpperCase()` (reachable only when the source is fully degraded, in which case the page already shows the `Cached`/degraded banner). Raw lowercase keys are never rendered.

**D2 — Structured next match.** Replace the pre-formatted `nextMatch: string | null` with:

```ts
readonly nextMatch: {
  readonly opponentName: string;   // full name, resolved per D1
  readonly homeAway: "home" | "away";
  readonly startsAt: string;       // ISO instant from the schedule
} | null;
```

The frontend formats `startsAt` with `Intl.DateTimeFormat` (browser locale + timezone — instants formatted client-side sidestep the server-day-bucket timezone traps hit in wellness): `vs Liverpool · Sat, Jul 4 · 3:00 PM`.

### E. Layout: Top Stories + league news grid (item 16)

The single unbounded rail becomes two surfaces; the overview DTO replaces `headlines: Headline[]` with:

```ts
readonly topStories: readonly Headline[]; // ranked, capped at 5
readonly leagueNews: readonly {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly headlines: readonly Headline[]; // capped at 6 per competition
}[];
```

- **Top Stories (rail, sticky, replaces "Headlines"):** deterministic ranking — (1) headlines tagged with a followed team, newest first; (2) then the newest headline of each followed competition not already included; cap 5. The story hero uses `topStories[0]` (so the hero is also relevance-ranked, not "first headline of first competition").
- **League news (new full-width section below Scores):** one group per followed competition, up to 6 headlines each, excluding anything already in Top Stories; grid card = optional thumbnail (`imageUrl`) + mono competition label + serif linked title — composed from the existing `sp-fcgrid`/`sp-hl` idioms, no new tokens, no new colors, no left-border accents.
- New CSS lands in **`apps/web/src/styles/sports-2.css`** (`sports-1.css` is at 992/1000 lines); import order `sports-1` then `sports-2` preserved in the page import.

### F. League-specific standings (item 18)

**F1 — Source returns all sections.** `getStandings` returns every `children[]` entry, not `children[0]`:

```ts
interface StandingsTable {
  readonly sections: readonly {
    readonly label: string | null; // "Group A", "American Football Conference"; null when flat
    readonly rows: readonly StandingsRow[];
  }[];
}
```

`StandingsRow` gains `winPercent: number | null` (US leagues). `StandingsGroup` (the API DTO) carries the same `sections` shape.

**F2 — Catalog declares presentation semantics.**

```ts
// catalog.ts
readonly standingsShape: "table" | "groups" | "record";
```

| Shape    | Competitions                   | Sections shown                     | Columns                                                                                                  |
| -------- | ------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `table`  | `eng.1`, `usa.1`               | first (single league table)        | `#` rank · Team · `Pts`                                                                                  |
| `groups` | `fifa.world`, `uefa.champions` | all groups, labeled subtables      | `#` (within group) · Team · `Pts`, advancement dot kept                                                  |
| `record` | `nfl`, `nba`, `nhl`, `mlb`     | all conferences, labeled subtables | Team · `W-L` (`W-L-T` when ties present) · `Pts` if points reported (NHL) else `Pct` — **no `#` column** |

The rail keeps its per-competition tabs; within a tab, `groups`/`record` shapes render stacked labeled subtables. Rank is only rendered where it is meaningful (`table`, `groups`); the NFL `#` nonsense disappears. Column semantics live in the frontend keyed off `standingsShape` shipped in the DTO; the service does no presentation.

## 5. Resolved decisions

| #   | Decision                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **CSP host allowlist** from `SportsSource.imageHosts`, **not** an image proxy                        | A URL-fetching proxy re-creates the SSRF surface the v0.1.0 audit flagged as the top finding and adds bandwidth/cache machinery. A static CSP host list has zero server attack surface. Cost: the browser hotlinks ESPN's CDN (client IP visible to ESPN for public sports images) — same exposure class the MVP design already accepted by shipping `crestUrl`. Proxy remains a documented fast-follow if the privacy posture tightens. |
| D-2 | Team relevance via article `categories` team ids, resolved server-side to `teamKeys`                 | One news fetch per competition (already cached) powers card news, "You" markers, and Top Stories ranking. The per-team news endpoint alternative costs N extra upstream calls and still doesn't help rank the shared rail. Provider ids stay out of the public contract.                                                                                                                                                                 |
| D-3 | Follow matching by `(competitionKey, teamKey)` pair everywhere                                       | Abbreviations are only unique within a competition; the flat set is the proven bug (item 17).                                                                                                                                                                                                                                                                                                                                            |
| D-4 | Structured DTOs (`news`, `nextMatch`, `sections`) instead of more pre-formatted strings              | The MVP's string-flattening is what lost the URLs and dates; structure lets the client localize dates and link stories. Route schemas (`additionalProperties: false`) are updated in the same commit as each DTO change — contract and serializer never drift.                                                                                                                                                                           |
| D-5 | Standings semantics as a catalog `standingsShape` flag, presentation in the frontend                 | Competition semantics are static catalog facts (like `kind`); the service stays a data composer; adding a competition later declares its shape in one place.                                                                                                                                                                                                                                                                             |
| D-6 | Name/crest fallback = teams catalog (24 h cache), **no** display-name column on `app.sports_follows` | Persisting names would survive a total source outage but costs a migration + foundation-test row for a cosmetic edge already covered by the degraded banner. Rejected as not worth the schema change.                                                                                                                                                                                                                                    |
| D-7 | Compose existing `sp-*` idioms for the new sections; no new Claude Design mock gate                  | This is a functionality pass per Ben's established split; the mock's design language (§4.6a of spec #656) already defines every primitive the new sections use. Ben annotates visuals in a later pass.                                                                                                                                                                                                                                   |
| D-8 | Caps: 5 Top Stories, 6 league-news headlines per competition                                         | Matches the "compact top stories, broader grid" ask with deterministic, testable numbers. Trivially tunable constants in the service.                                                                                                                                                                                                                                                                                                    |

## 6. Contract changes (summary)

All in `packages/shared/src/sports-api.ts` (browser-safe, no `node:*`), with matching route-schema updates in `packages/sports/src/routes.ts`:

- `Headline` **+** `imageUrl: string | null`, **+** `teamKeys: readonly string[]`.
- `FollowedTeamCard` **+** `news: { title, url } | null`; `nextMatch` becomes the structured object (§D2).
- `SportsOverviewResponse`: `headlines` → `topStories` + `leagueNews`; `followedTeamKeys` → `followedTeams` pairs.
- `StandingsGroup` gains `sections` (label + rows) **and** `standingsShape` (the frontend keys columns off it); `StandingsRow` **+** `winPercent: number | null`; `CompetitionRef` **+** `standingsShape` for consistency in the catalog response.

Breaking DTO changes are fine: the only consumer is `apps/web` (same repo, same PR); React Query keys are unchanged.

## 7. Files touched (expected)

| Area     | Files                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared   | `packages/shared/src/sports-api.ts`                                                                                                                                                                             |
| Module   | `packages/sports/src/source/sports-source.ts`, `espn-source.ts`, `catalog.ts`, `sports-service.ts`, `routes.ts`, `README.md`, fixtures (news + standings re-recorded with `categories`/`images`/all `children`) |
| Web      | `apps/web/src/sports/sports-page.tsx`, `sports-parts.tsx`, new `apps/web/src/styles/sports-2.css`, `apps/web/src/api/sports-client.ts` (only if signatures shift — DTO types flow from shared)                  |
| Platform | `apps/api/src/static-web.ts` (CSP from `imageHosts`, LOADER-SEAM tag), `infra/nginx/jarv1s-web.conf` (matching `img-src`)                                                                                       |
| Tests    | `tests/unit/espn-source.test.ts`, `tests/unit/sports-page.test.tsx`, service unit tests (ranking, relevance, pair matching, shapes)                                                                             |

No migrations. No changes under `packages/briefings` (facts API unchanged).

## 8. Verification

- Followed team with no game today shows its **real logo** and **full name** (catalog fallback path) — the exact `SD`/`sd` case from the feedback.
- World Cup standings tab shows **all 12 groups** as labeled subtables with advancement dots; NFL standings show two conferences with `W-L`/`Pct` and **no `#` column**.
- Card in news state: story mentions the followed team (fixture-pinned `categories` assertion); with zero team-tagged stories the card shows "No recent news", never an unrelated headline.
- Follow a team whose abbreviation exists in another league (e.g. `min`) → only the followed league's game/standings rows highlight.
- Hero story photo renders from the article image; with `imageUrl: null` the authored placeholder returns. Hero + card + grid stories all open the source article.
- Next-match footer shows opponent full name + localized date/time.
- Top Stories caps at 5 with followed-team stories ranked first; league news grid excludes Top Stories duplicates and caps at 6 per competition.
- Deployed CSP check: crest `<img>` from `a.espncdn.com` paints under both the API-served CSP and the nginx config (manual check on the LAN deployment noted in the PR).
- Degraded run (fixture throws): page renders initials swatches + placeholder + degraded banner, no 500 (existing behavior preserved).
- Gates: `pnpm verify:foundation` green; no file over 1000 lines.

## 9. Hard invariants honored

- **No DB change:** no migration, RLS untouched, `foundation.test.ts` untouched.
- **DataContextDb / AccessContext:** unchanged code paths; service still reads follows via `withDataContext`.
- **Secrets:** none involved; ESPN remains keyless. CSP change only widens `img-src` to declared https CDN hosts.
- **Provider-agnostic:** everything flows through `SportsSource`; `imageHosts` and `sourceTeamId` keep provider specifics inside the adapter/composition root; the public API stays in our key space.
- **Module isolation:** no cross-module imports; the CSP composition-root touch is tagged `// LOADER-SEAM(sports):` and listed in the module README (seam list grows to 7).
- **Design system:** tokens only, serif/mono/sans roles preserved, result colors never red, no curved left-border accents, authored empty/loading states, CSS files under 1000 lines.

## 10. Open questions for Ben (approval gate)

1. **D-1 image delivery:** OK with CSP-allowlisted hotlinking of ESPN's CDN (client IP visible to ESPN when loading public images), or do you want the proxy despite the SSRF-class surface and extra machinery? Spec recommends the allowlist.
2. **D-7 no design-mock gate** for the Top Stories / league-news restructure — confirm you're happy annotating the visuals in a later pass rather than pre-approving a mock.
3. **D-8 caps** (5 top stories / 6 per league) — fine as defaults?

## 11. Fast-follow (not this pass)

- Image proxy with strict adapter-declared host allowlist, if hotlinking privacy is later deemed unacceptable.
- Per-team news endpoint as a relevance booster if category tagging proves too sparse in practice.
- Everything already deferred by spec #656 §9 (play-by-play, notifications, chat tool, team pages, snapshot table/worker).
