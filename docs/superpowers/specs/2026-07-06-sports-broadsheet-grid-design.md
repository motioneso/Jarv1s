# Sports Broadsheet Grid — Editorial Column Re-Architecture of `/sports`

**Issue:** #839 (Part of epic #726 — Park Press design-language migration)
**Server task children:** #840 (`Headline.summary`), #841 (standings qualification note+color), #842 (standings-by-league route + all-league selector)
**Date:** 2026-07-06 (rev 2 — reconciled with owner functionality review)
**Status:** Approved design — ready for implementation plan
**Scope:** Frontend re-architecture of `/sports`, **plus a small, honestly-sourced server slice** (three DTO/route touches tracked as #840–#842). Not the pure frontend-only change the first draft assumed — see Non-Goals.

---

## Problem

The #829 skin (merged PR #831) applied hairlines, a ticker, and squared corners to the
**existing stacked-widget layout**. It is a reskin, not the editorial re-organization the reference
mockup demanded. On real prod `/sports`:

- The lead is a **centered, symmetric** flag-scoreboard with a lake of whitespace — reads as a
  widget, not a front page.
- Scores are **full-width rows**, one game spread across the whole page.
- League news is a **sprawling 4-up photo-wall** (~5000px scroll) — the opposite of editorial density.
- "Why you're seeing this" explainer text is scattered through the page.

None of this reads as a sports broadsheet. The gap is **information architecture**, not typography.

## Goal

Re-architect `/sports` into a true multi-column newspaper composition — **better than** the mockup,
not a copy — with a **bold-sans + mono** editorial voice (**explicitly no serif**), respecting the
app's light/dark theme. The approved visual target is the mockup at Artifact
`https://claude.ai/code/artifact/fc483717-a4c1-4e74-9372-3655f0dce939` (rev 3).

## Non-Goals

- **No serif type.** The broadsheet feel comes from layout, hairlines, and heavy sans display — not
  a serif face. (Explicit owner decision, 2026-07-06.)
- **No dedicated editorial backend.** Content is pulled from sources we already have. No columnists,
  bylines, opinion desk, or owned article bodies. Every new server field recovers data ESPN already
  sends us; nothing is fabricated.
- **No forced newsprint ground.** The page respects the global light/dark toggle; it does not become
  a light-only exception ("it's more layout than colors").
- **No explainer language anywhere.** The `rationale` "why you're seeing this" copy is removed from
  the page entirely (owner decision). Ranking/recency is conveyed by position, not prose.
- **Bounded server slice only.** The three server touches (#840–#842) are the _entire_ server scope.
  Each recovers an already-fetched ESPN field or re-routes an already-working fetch. Any want beyond
  these becomes its own milestone. In particular: no new upstream providers, no news/standings DB
  tables, no persistence of ESPN payloads.

---

## Data Reality (the hard boundary)

`GET /api/sports/overview` → `SportsOverviewResponse` gives us:

| Field        | Shape                                                             | Use in the redesign                       |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| `hero`       | `gameday` (a `GameSummary`) **or** `story` (a `Headline \| null`) | Editorial hero band                       |
| `followed`   | `FollowedTeamCard[]`                                              | Followed-teams ticker (unchanged)         |
| `scoreboard` | `ScoreboardGroup[]` (games grouped by league)                     | **Around-the-Leagues ticker** (see below) |
| `topStories` | `Headline[]`, ranked, capped at 6                                 | **LATEST** column (2-up, thumbnails)      |
| `leagueNews` | `LeagueNewsGroup[]` (headlines by league)                         | **NEWS BAND** (blurb + continue-reading)  |
| `standings`  | `StandingsGroup[]`                                                | **STANDINGS** column (selector + rail)    |

A `Headline` is `{ id, competitionKey, competitionLabel, title, url, publishedAt, imageUrl, teamKeys }`
today; **#840 adds `summary`** (from ESPN article `description`). A `GameSummary` carries **both**
`startsAt` (raw ISO instant) **and** `statusDetail` (ESPN's pre-formatted status string). A
`GameSide` is `{ teamKey, name, shortName, crestUrl, score, record, winner }` — **no team brand
color**. A `StandingsRow` carries `qualifies: boolean` today; **#841 adds `qualificationNote` +
`qualificationColor`** (from ESPN's per-row `note{description,color}`, currently dropped).

**Consequences that bind the design:**

1. The mockup's "Featured Story" body copy, "Columns & Analysis" (named columnists), "Opinion", and
   "In Depth" have **no backing data**. Dropped — building them means fabricated bylines.
2. Scorebar/standings color comes from **crests + ink + hairlines**, never team fills. The one
   exception is the standings qualification legend, which uses ESPN's own zone color as a small
   indicator (mapped to a theme-safe treatment — raw hex never enters `sports-*.css`).
3. Hero photography exists **only** in `story` mode; `gameday` leads with the scorebar itself.
4. Match times are honest to the viewer: rendered from `startsAt` in the user's timezone + clock
   format, not from the ESPN-zoned `statusDetail` string.

### The server slice (#840 / #841 / #842)

All three are "ESPN already sends it, we drop or don't route it" — no new upstream call except that
#842 calls the _existing_ standings fetch for a non-followed key.

- **#840 — `Headline.summary`.** ESPN news articles include a `description`; `getHeadlines()` fetches
  it and the mapper discards it. Widen the article type, carry `description` → `SourceHeadline` →
  `toPublicHeadline` → shared `Headline.summary` (+ zod, + fixture). Powers the news-band blurb.
- **#841 — standings qualification note.** ESPN standings rows carry `note{description,color}`
  (e.g. `{"description":"UEFA Champions League","color":"#2a66d1"}`). `toStandingsRow` collapses it to
  `qualifies: entry.note != null`. Widen `EspnStandingsEntry.note`, add `qualificationNote` +
  `qualificationColor` to `StandingsRow` (+ zod). Powers the cutoff legend.
- **#842 — standings-by-league route.** Overview standings are follow-scoped
  (`sports-service.ts:219-226`). Add `GET /api/sports/standings?competitionKey=` (validate against
  `SPORTS_CATALOG`, reuse the existing cached fetch) so the standings selector can show any of the 8
  supported leagues on demand. Chosen over widening the overview payload to all 8 leagues every load.

---

## Architecture

A single page composed of stacked **bands**. The middle band is a **two-column** keyline grid
(the scores column was dropped — the Around-the-Leagues ticker carries scores). Data flow (React
Query `overviewQuery`, `hasLiveGame` polling, `followedPairs` is-you marking) is preserved; the
standings selector adds a second lazy query against #842.

```
┌─ PageHeader (masthead-weight title, mono lede)                          ┐
├─ FollowedTicker          (UNCHANGED — teams you follow)                 │
├─ AroundLeaguesTicker     ← NEW: scores strip, L/R scroll buttons        │
│    league label ONCE per group, next league acts as the separator      │
│    times in the viewer's tz + clock format; buttons hide at each end    │
├─ EditorialHero           ← replaces Hero / GamedayHero / StoryHero      │
│    gameday: mono eyebrow · horizontal scorebar (no rationale prose)     │
│    story:   mono eyebrow · photo-left + heavy-sans headline-right       │
├─ BroadsheetGrid          ← replaces SplitSection (2 columns now)        │
│    ┌ LATEST (2fr) ─────────────────┬ STANDINGS (1fr) ──────────┐        │
│    │ topStories, 2-up newspaper    │ league selector (all 8)   │        │
│    │ flow, thumbnail per story,    │ conference/division       │        │
│    │ no "RANKED" label             │ sections + cutoff legend  │        │
│    └───────────────────────────────┴───────────────────────────┘        │
├─ NewsBand                 ← replaces the LeagueNewsSection photo-wall    │
│    per-story blurb (#840 summary) + "Continue reading →" (real url)     │
│    + filter by league/sport                                             │
└──────────────────────────────────────────────────────────────────────────┘
```

Manage follows: a plain `<a href="/settings?section=modules&module=sports">` link (the follow-
management UI already exists at that settings surface — no new panel). The ticker already renders
this link; the empty state reuses it.

### Components

**Keep unchanged:** `FollowedTicker` (the existing `SportsTicker` teams strip), `Crest`, `FormPips`,
`LiveDot`, icons, `hasLiveGame`, `LIVE_REFETCH_INTERVAL_MS`, `FollowedCard`/`today-widget.tsx`,
`sports-client`, `query-keys`, `locale` helper (`useUserLocale`/`formatTime`/`formatDate`),
`EmptyState` (re-verified against the new grid).

**New / rewritten (all in `packages/sports/src/web/` unless noted):**

- **`AroundLeaguesTicker`** — new scores strip built from `scoreboard`. Renders the league label
  once at each group's start; the next group's league label is the visual separator (no per-score
  league repetition). Left/right buttons smooth-scroll the strip (`scrollBy({behavior:"smooth"})`)
  and each hides when the strip is scrolled to that end (`scrollLeft <= 0` / at `scrollWidth`).
  Kickoff times render via `formatTime(game.startsAt, locale)`; live/final stay `statusDetail`.
- **`EditorialHero`** — absorbs `Hero` + `GamedayHero` + `StoryHero`. Mono eyebrow on a hairline.
  `gameday` → `LeadScorebar` (kickoff time via `formatTime`); `story` → photo-left/headline-right,
  photo omitted when `imageUrl` null. **No rationale/explainer prose.** Preserves the live score's
  `aria-live="polite"`/`aria-atomic` and `LiveDot`.
- **`LatestColumn`** — `topStories` as a **2-up newspaper flow** (`columns: 2`), each item a
  thumbnail (`imageUrl`) + `competitionLabel` eyebrow + `title` link. Mono numerals `1`–`6` retained
  (position encodes rank honestly); **the "RANKED" header word is removed** — kicker reads "Latest".
- **`StandingsRail`** (rewritten) — a **league selector** across all 8 supported leagues (from
  `GET /api/sports/catalog`; defaults to a followed league, else the first supported). Selecting a
  non-followed league lazily fetches `GET /api/sports/standings?competitionKey=` (#842). Renders
  `StandingsSection[]` as conference→division sections (via `section.label`). When rows carry
  `qualificationNote`/`qualificationColor` (#841), highlight those positions and render a compact
  **legend/key** (one entry per distinct note). Keep it simple and legible.
- **`NewsBand`** — restyle of `LeagueNewsSection`. Each item: `title` + **blurb** (`summary`, #840,
  truncated) + **"Continue reading →"** (`url`, external). A **league/sport filter** (chips or a
  select) narrows the band. At most one lead thumbnail per group.

### Files

- **Modify:** `packages/sports/src/web/sports-page.tsx` (composition; hero; grid → 2-col; add
  Around-the-Leagues ticker; times via `formatTime`).
- **Modify:** `packages/sports/src/web/sports-news.tsx` (`LeagueNewsSection` → `NewsBand` with blurb +
  filter; `TopStoriesRail` → `LatestColumn` 2-up; `StoryHero` folded into `EditorialHero`).
- **Modify:** `packages/sports/src/web/sports-ticker.tsx` (or a sibling) for `AroundLeaguesTicker`.
- **Modify:** `packages/sports/src/web/` standings component for the selector + legend + lazy fetch.
- **Create:** `packages/sports/src/web/styles/sports-5-editorial.css` — hero band, scorebar, keyline
  grid, 2-up Latest, standings selector/legend, news band, second ticker, responsive.
  (`sports-1.css` is at 965/1000 lines; new file keeps every bundle under the 1000-line gate.)
- **Server (#840):** `source/espn-source.ts`, `source/sports-source.ts`, `sports-service.ts`,
  `packages/shared/src/sports-api.ts`, `source/__fixtures__/nfl-news.json`.
- **Server (#841):** `source/espn-source.ts`, `packages/shared/src/sports-api.ts` (+ standings
  fixtures already contain `note`).
- **Server (#842):** `routes.ts`, `sports-service.ts`, `packages/shared/src/sports-api.ts`.
- **Test:** module unit tests for each server touch + the web component tests.

### Type & Grid System

- Display headlines: existing `--font-display` at heavy weight (800–900), tight tracking.
- Every kicker / eyebrow / numeral / league label: `--font-mono`, uppercase, letter-spaced.
- Dividers: 1px hairlines; vertical keyline between the two grid columns, horizontal rules between
  bands. Squared corners, no card chrome.
- Grid: CSS grid, **2 columns** `minmax(0, 2fr) minmax(0, 1fr)` (LATEST | STANDINGS), vertical
  hairline between. Latest uses `columns: 2` internally for the newspaper flow.

### Responsive

- `>900px`: 2-column keyline grid + asymmetric hero; Latest is 2-up.
- `≤900px`: grid collapses to one column; Latest drops to `columns: 1`; vertical keylines become
  horizontal rules; hero photo stacks above the headline. Both tickers stay horizontally scrollable.

### Theme

Works in both app themes. Ink/ground/hairline from existing tokens; no page-scoped color exceptions,
no new raw colors in `sports-*.css`. The one data-driven color — the standings qualification zone —
takes ESPN's hex only as an inline indicator value, mapped through a theme-safe wrapper; it is never
written as a literal into a stylesheet (design-token gate stays green).

---

## Error, Empty, and Degraded States

- **Loading:** `SportsSkeleton` updated to mirror the new bands (two tickers + hero + 2-col grid +
  news) so nothing reflows on first paint.
- **Error:** existing "Sports are unavailable right now." status line, unchanged.
- **Degraded:** existing `DegradedBand` notice, unchanged.
- **No follows:** existing `EmptyState` — re-verified around the new grid; Manage link points at the
  settings follow UI. Standings selector defaults to the first supported league.
- **Missing pieces:** `topStories` empty → LATEST hidden; `scoreboard` empty → Around-the-Leagues
  ticker hidden; `imageUrl` null → text-only; `summary` null → blurb omitted (title + continue-
  reading only); a league with no `qualificationNote` rows → no legend for it. Columns and elements
  are independently omitted, never rendered empty. **No explainer text substitutes for empty state.**

---

## Testing

- **Server (Vitest, module unit tests):**
  - #840: `toPublicHeadline`/mapper carries `summary` from a fixture article `description`; null when
    absent. Update `nfl-news.json`.
  - #841: `toStandingsRow` emits `qualificationNote`/`qualificationColor` from a fixture `note`; nulls
    when absent; `qualifies` still set.
  - #842: `GET /api/sports/standings?competitionKey=` returns a `StandingsGroup` for a valid catalog
    key; rejects an unknown key; does not require a follow.
- **Web (Vitest + `react-dom/server` `renderToString`, repo convention):** hero modes; 2-up Latest
  with per-item thumbnails and no "RANKED"; Around-the-Leagues league-once-then-separator grouping;
  scroll-button end-state logic (pure helper); standings selector + conference/division sections +
  legend rendering; news-band blurb + continue-reading + filter; column omission when a source is
  empty; time rendered via `formatTime`. No test asserts nothing.
- **Visual:** `pnpm capture:screens` in **both** themes; manual review against the rev-3 mockup.
- **Gate:** `pnpm lint && pnpm format:check && pnpm check:file-size && pnpm check:design-tokens &&
pnpm typecheck && pnpm test:unit`. Because there are server touches, also run the sports module's
  integration/unit suite for the changed server files (not the whole pg suite unless CI requires).

---

## Risks

- **CSS file-size gate.** Editorial CSS is substantial; keep it in `sports-5-editorial.css`, split
  further if it nears 1000 lines.
- **Standings selector data cost.** Lazy-fetch per selection (#842) — do not prefetch all 8 leagues.
  Cache per competition key (React Query) so re-selecting is free.
- **Qualification color vs design-token gate.** ESPN hex must not land in a stylesheet. Carry it as
  an inline indicator value through a theme-safe wrapper; the design pass finalizes the treatment.
- **Hero mode asymmetry.** `gameday` (no photo) and `story` (photo) share one `EditorialHero`
  skeleton so the page doesn't jump between two hero shapes.
- **Density vs. reachability.** 2-up Latest + compact standings must stay keyboard/SR-legible;
  preserve table semantics and each ticker's `role="region"` scroll affordance; scroll buttons are
  supplementary, not the only way to reach content.

---

## Open (owner design-pass items, not blockers)

Finalized when Ben annotates the live build (functionality pass now, look later):

- 2-up Latest with a thumbnail per story — density check.
- Standings qualification legend — exact color treatment (theme-safe mapping of ESPN zone color).
- Real team crests / league logos / photos are data-population (crest/image fields exist; league
  logos via a static asset map keyed by `competitionKey` — no DTO change).
