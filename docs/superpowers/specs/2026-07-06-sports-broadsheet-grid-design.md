# Sports Broadsheet Grid — Editorial Column Re-Architecture of `/sports`

**Issue:** #839 (Part of epic #726 — Park Press design-language migration)
**Date:** 2026-07-06
**Status:** Approved design — ready for implementation plan
**Scope:** Frontend-only. No server, DTO, or `@jarv1s/shared` changes.

---

## Problem

The #829 skin (merged PR #831) applied hairlines, a ticker, and squared corners to the
**existing stacked-widget layout**. It is a reskin, not the editorial re-organization the reference
mockup demanded. On real prod `/sports`:

- The lead is a **centered, symmetric** flag-scoreboard with a lake of whitespace — reads as a
  widget, not a front page.
- Scores are **full-width rows**, one game spread across the whole page.
- League news is a **sprawling 4-up photo-wall** (~5000px scroll) — the opposite of editorial density.

None of this reads as a sports broadsheet. The gap is **information architecture**, not typography.

## Goal

Re-architect `/sports` into a true multi-column newspaper composition — **better than** the mockup,
not a copy — with a **bold-sans + mono** editorial voice (**explicitly no serif**), respecting the
app's light/dark theme.

## Non-Goals

- **No serif type.** The broadsheet feel comes from layout, hairlines, and heavy sans display — not
  a serif face. (Explicit owner decision, 2026-07-06.)
- **No dedicated editorial backend.** Content is pulled from the sources we already have. No
  columnists, bylines, opinion desk, or owned article bodies.
- **No forced newsprint ground.** The page respects the global light/dark toggle; it does not become
  a light-only exception (owner decision: "it's more layout than colors").
- **No server / DTO / shared-contract changes.** If a want requires a new field, it is out of scope
  for this task and becomes its own milestone.

---

## Data Reality (the hard boundary)

`GET /api/sports/overview` → `SportsOverviewResponse` gives us exactly:

| Field        | Shape                                                             | Use in the redesign                  |
| ------------ | ----------------------------------------------------------------- | ------------------------------------ |
| `hero`       | `gameday` (a `GameSummary`) **or** `story` (a `Headline \| null`) | Editorial hero band                  |
| `followed`   | `FollowedTeamCard[]`                                              | Existing ticker (unchanged)          |
| `scoreboard` | `ScoreboardGroup[]` (games grouped by league)                     | **SCORES** column (compact)          |
| `topStories` | `Headline[]`, ranked, capped at 6                                 | **LATEST** numbered column           |
| `leagueNews` | `LeagueNewsGroup[]` (headlines by league)                         | Headlines band (de-densified)        |
| `standings`  | `StandingsGroup[]`                                                | **STANDINGS** column (restyled rail) |

A `Headline` is `{ id, competitionKey, competitionLabel, title, url, publishedAt, imageUrl, teamKeys }`
— an **external link with an optional thumbnail**, not an article we own. A `GameSide` is
`{ teamKey, name, shortName, crestUrl, score, record, winner }` — **no team brand color**.

**Consequences that bind the design:**

1. The mockup's "Featured Story" (body copy), "Columns & Analysis" (named columnists + headshots),
   "Opinion", and "In Depth" have **no backing data**. They are dropped. Building them would mean
   fabricated bylines and lorem body — a violation of the no-stale-scaffolding rule.
2. The scorebar cannot use colored team fills. Color comes from **crests + ink + hairlines**.
3. Hero photography exists **only** in `story` mode (`headline.imageUrl`); `gameday` mode has no
   photo and leads with the scorebar itself.

---

## Architecture

A single page composed of stacked **bands**, where the middle band is a multi-column **keyline
grid**. All new structure is presentational; data flow (React Query `overviewQuery`, polling via
`hasLiveGame`, `followedPairs` is-you marking) is preserved verbatim.

```
┌─ PageHeader (masthead-weight title, mono lede)                     ┐
├─ SportsTicker            (UNCHANGED)                               │
├─ EditorialHero           ← replaces Hero / GamedayHero / StoryHero │
│    gameday: mono eyebrow · horizontal scorebar · rationale/also    │
│    story:   mono eyebrow · photo-left + heavy-sans headline-right  │
├─ BroadsheetGrid          ← replaces SplitSection                   │
│    ┌ LATEST ────────┬ SCORES ─────────┬ STANDINGS ──┐  vertical    │
│    │ topStories 1–6 │ compact league  │ restyled     │  hairlines  │
│    │ numbered list  │ mini-tables     │ rail         │  between    │
│    └────────────────┴─────────────────┴─────────────┘  columns     │
├─ NewsBand                 ← replaces the LeagueNewsSection photo-wall │
│    tight multi-column headline lists, ≤1 lead thumbnail per league │
└────────────────────────────────────────────────────────────────────┘
```

### Components

**Keep unchanged:** `SportsTicker`, `StandingsRail` internals (restyle CSS only), `Crest`,
`FormPips`, `LiveDot`, `RationaleChip`, icons, `hasLiveGame`, `LIVE_REFETCH_INTERVAL_MS`,
`FollowedCard`/`today-widget.tsx`, `sports-client`, `query-keys`, `locale`, `EmptyState`
(re-verified against the new grid but functionally intact).

**New / rewritten (all in `packages/sports/src/web/`):**

- **`EditorialHero`** — absorbs `Hero` + `GamedayHero` + `StoryHero`. One `<section>` with a mono
  eyebrow strip on a hairline. `gameday` → `LeadScorebar`; `story` → photo-left/headline-right lead
  (photo omitted when `imageUrl` is null → headline runs full width). Preserves the existing
  `aria-live="polite"`/`aria-atomic` on the live score and the `LiveDot` semantics.
- **`LeadScorebar`** (helper within the hero) — horizontal band: away crest+name+record · big
  score · centered `statusDetail` · big score · home crest+name+record. Winner emphasized in ink
  weight, never color-coded red/green (respects the never-red-pip rule).
- **`LatestColumn`** — `topStories` as a numbered ranked list (mono numerals `1`–`6`), each item
  `competitionLabel` eyebrow + `title` link. The lead item (index 0) may render its `imageUrl`
  thumbnail; the rest are text-only for density. Reuses the existing counter CSS built in #829.
- **`CompactScores`** — restyle of `Scoreboard`. Keeps the `All`/per-league filter chips (functional)
  and the `useState` active-filter logic. Renders each `ScoreboardGroup` as a tight mini-table:
  league kicker → compact away/home rows (`shortName` + score + `statusDetail`), not full-width.
- **`NewsBand`** — restyle of `LeagueNewsSection`. `leagueNews` groups become a tight multi-column
  headline band: league kicker + compact text list, at most one lead thumbnail per group. No 4-up
  photo grid.

### Files

- **Modify:** `packages/sports/src/web/sports-page.tsx` (composition + hero + scores + split → grid).
- **Modify:** `packages/sports/src/web/sports-news.tsx` (`LeagueNewsSection` → `NewsBand`,
  `TopStoriesRail` → `LatestColumn`; `StoryHero` folded into `EditorialHero`).
- **Create:** `packages/sports/src/web/styles/sports-5-editorial.css` — hero band, scorebar, keyline
  grid, numbered column, compact score tables, news band. (`sports-1.css` is at 965/1000 lines and
  cannot absorb this; new file keeps every bundle under the 1000-line gate.)
- **Modify (import only):** add the new stylesheet import to `sports-page.tsx`.
- **Test:** `packages/sports/tests/unit/sports-page.test.tsx` (extend) + any new pure-helper test.
- **No changes:** `packages/shared/src/sports-api.ts`, any server file, `tokens.css` (no new colors).

### Type & Grid System

- Display headlines: existing `--font-display` pushed to heavy weight (800–900), tight tracking,
  larger display sizes. No new webfonts (self-contained bundle).
- Every kicker / eyebrow / numeral: `--font-mono`, uppercase, letter-spaced.
- Dividers: 1px hairlines only; vertical keylines between grid columns, horizontal rules between
  stacked bands. Squared corners, no card chrome.
- Grid: CSS grid, 3 columns with vertical hairline separators via `border-left` on inner columns
  (the existing `.sp-railcol` keyline pattern), gap `0`. Column widths tuned so LATEST reads as the
  dominant lane.

### Responsive

- `>900px`: 3-column keyline grid + asymmetric hero.
- `≤900px`: grid collapses to a single stacked column; vertical keylines are replaced by horizontal
  rules between sections (reuses the existing `sp-split` single-column breakpoint approach). Hero
  photo stacks above the headline.

### Theme

Works in both app themes. All ink/ground/hairline values come from existing theme tokens; light =
warm-ish ground with near-black ink, dark = light ink on charcoal. No page-scoped color exceptions,
no new raw colors.

---

## Error, Empty, and Degraded States

- **Loading:** existing `SportsSkeleton` updated to mirror the new band shapes (hero + grid + news)
  so nothing reflows on first paint.
- **Error:** existing "Sports are unavailable right now." status line, unchanged.
- **Degraded:** existing `DegradedBand` notice, unchanged.
- **No follows:** existing `EmptyState` — re-verified to render correctly above/around the new grid;
  the "has slate" fallback board adopts the new compact scores + news styling.
- **Missing pieces:** `topStories` empty → LATEST column hidden (no empty box); `imageUrl` null →
  hero/lead runs text-only; `scoreboard` empty → SCORES column hidden. Columns are independently
  omitted, never rendered empty.

---

## Testing

- **Unit (Vitest + RTL):** keep the `hasLiveGame` polling-decision tests. Add coverage for any new
  pure helper (hero-mode selection, `topStories` numbering/cap, column-omission when a source is
  empty). No test asserts nothing.
- **Visual:** `pnpm capture:screens` in **both** light and dark themes; manual review against the
  mockup for composition (not pixel parity).
- **Gate:** frontend suite + `pnpm lint` + `pnpm format:check` + `check:file-size` + `typecheck`.
  Web-only diff — the integration/pg suites are not in scope for this change.

---

## Risks

- **CSS file-size gate.** The editorial CSS is substantial; keep it in the new
  `sports-5-editorial.css` and split further if it approaches 1000 lines.
- **Hero mode asymmetry.** `gameday` (no photo) and `story` (photo) must share one visual skeleton so
  the page doesn't jump between two unrelated hero shapes — enforced by a single `EditorialHero`
  component with shared eyebrow/frame.
- **Density vs. reachability.** Compact score tables must stay keyboard- and screen-reader-legible;
  preserve existing table semantics and the ticker's `role="region"` scroll affordance.

```

```
