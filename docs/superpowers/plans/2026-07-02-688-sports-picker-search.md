# Sports Settings Search-First Picker — Implementation Plan (#688)

**Goal:** Redesign the Sports module settings picker from fully-expanded team grids into a search-first UX: type-ahead search, followed-teams chip summary row at top, browse-by-league as a collapsed secondary path. Preserve all existing follow/unfollow and follow-all-league behavior.

**Tech Stack:** TypeScript, React, TanStack Query, Vitest (renderToString), CSS (JDS token-only primitives).

---

## Premise Verification (grounded in branch `coord/688-sports-picker-search`)

- **Current picker fully expanded, no search:** Confirmed. `packages/sports/src/settings/index.tsx:154` maps all `competitions` → `<CompetitionGroup>`, which renders every `team` as a button unconditionally (`:96-110`). No search input, no followed-teams summary, no collapse.
- **Follow-all-league action exists:** Confirmed. `<CompetitionGroup>` renders `.sp-whole` button per competition (`:86-94`), toggling whole-league follow via `followKey(competitionKey, null)`.
- **Follow/unfollow mutation paths exist and are reused:** Confirmed. `followMutation` / `unfollowMutation` (`:122-123`) keyed on `FOLLOWS_KEY`; `toggle()` (`:142-146`) routes by `followKey`. These are reused unchanged.
- **Shared types sufficient, no contract change needed:** Confirmed. `SportsCatalogResponse` carries `competitions[].teams[]` with `name`, `shortName`, `teamKey`, `competitionKey` (`packages/shared/src/sports-api.ts:149-151`). All data needed for client-side search is already delivered. No data-source/server change required.
- **CSS lives in `apps/web/src/styles/sports-2.css`** (115 lines), imported by `apps/web/src/settings/settings-page.tsx:5`. New classes append here.
- **Existing test (`tests/unit/settings-sports-pane.test.tsx`) uses SSR `renderToString` + `QueryClient.setQueryData`** — interactive `useState` search input will render with empty query by default, so the existing 3 tests continue to pass (their content is present without typing). `useState` does work under SSR (initial render only).
- **Idiomatic search input pattern:** `apps/web/src/tasks/tasks-page.tsx:207-222` uses `<input type="search" ... />` with `useState`. I follow the same shape (minus the AI-interpret affordance, which is out of scope).

**Conclusion:** Every spec premise holds. No data-source/server contract change. No re-scope needed.

## File Map

- Modify: `packages/sports/src/settings/index.tsx` — add search input state, followed-teams summary chip row, collapsible competition groups, search-results filtering.
- Modify: `apps/web/src/styles/sports-2.css` — append classes for search input, chip row, collapsible league headers, empty/no-match states.
- Modify: `tests/unit/settings-sports-pane.test.tsx` — add focused tests for search filtering and followed-teams summary behavior.

No data-source, route, repository, shared-type, or server changes.

## Design

**Layout (top → bottom):**

1. `<PaneHead>` (unchanged).
2. **Followed-teams summary row** — removable chips for each existing follow (team chip with × for team follows; league chip with × for whole-league follows). Only renders when `follows.length > 0`. Whole-league follows render as "All NFL" style chips.
3. **Search input** — `<input type="search" placeholder="Find a team or league…">` bound to `useState("")`.
4. **Search results / browse:**
   - **When query non-empty:** flat list of matching teams (across all competitions), each a toggle button. Match on team `name`/`shortName` OR competition `label`, case-insensitive substring. Whole-league match shows the "Follow all of X" affordance inline.
   - **When query empty:** collapsible competition groups. Each group header is a `<button>` toggling an `expandedKeys: Set<string>` state. Collapsed (default) shows only the "Follow all of {league}" button + team count; expanded reveals the team grid (existing `CompetitionGroup` body).
5. `<Note>` error fallback (unchanged).

**State added to `SportsSettings`:** `query: string`, `expandedKeys: Set<string>` (starts empty → all collapsed).

**Preserved behavior:**

- `toggle(competitionKey, teamKey|null)` unchanged — same mutations, same `followKey`, same invalidation.
- Follow-all-league button present per competition in both search-result and browse modes.
- `.is-active` styling on followed teams/leagues unchanged.

**Chip remove** calls the same `toggle()` path (unfollow), reusing `unfollowMutation`.

## Task 1: Add Search + Followed-Teams Summary Tests (TDD)

**Files:**

- Modify: `tests/unit/settings-sports-pane.test.tsx`

- [ ] **Step 1: Write failing tests**

  Add four focused tests:
  1. `"renders followed-teams summary chips when follows exist"` — seed one team follow (`epl`/`team.ars`); assert rendered html contains the team chip with remove affordance (class `sp-chip`) and "Arsenal" / "ARS" label.
  2. `"whole-league follow renders as a league chip"` — seed a whole-league follow (`competitionKey:"nfl", teamKey:null`); assert a chip labeled "All NFL".
  3. `"search input filters teams across competitions by name"` — seed two competitions with distinct teams; set the search input value via component state is not possible in SSR, so instead this test seeds catalog and asserts that with an empty query the collapsed groups render (team count visible), AND a separate minimal unit test extracts the pure filter function (see Step 2) and asserts `"ars" matches "Arsenal"` but not `"Cowboys"`.
  4. `"collapsed browse group hides team grid until expanded"` — default empty query; assert team buttons are NOT in initial render (collapsed), but the "Follow all of {league}" button IS present.

  Run:

  ```bash
  pnpm vitest run tests/unit/settings-sports-pane.test.tsx --runInBand
  ```

  Expected: new tests fail (chips/search/collapse don't exist yet). Existing 3 tests may also need adjustment if the default render changes — but per design they should still pass because their asserted content (label, marquee badge, "Follow all of") remains present. Verify and fix expectations only where the DOM structure legitimately changed.

## Task 2: Extract Pure Filter + Implement Search-First Component

**Files:**

- Modify: `packages/sports/src/settings/index.tsx`

- [ ] **Step 1: Export a pure `filterTeams` helper for unit testing**

  Add and export:

  ```ts
  export function filterTeams(
    query: string,
    competitions: readonly (CompetitionRef & { teams: readonly TeamRef[] })[]
  ): readonly { competition: CompetitionRef & { teams: readonly TeamRef[] }; team: TeamRef }[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { competition: …; team: TeamRef }[] = [];
    for (const competition of competitions) {
      for (const team of competition.teams) {
        const hay = `${team.name} ${team.shortName} ${competition.label}`.toLowerCase();
        if (hay.includes(q)) out.push({ competition, team });
      }
    }
    return out;
  }
  ```

  Also export `leagueMatches(query, competitions)` returning leagues whose `label` matches (for showing whole-league follow affordance in search results).

  Add a small unit test in `settings-sports-pane.test.tsx` (or a co-located `settings-sports-filter.test.ts`) asserting `filterTeams("ars", catalog)` returns Arsenal and not Cowboys, and `leagueMatches("prem", catalog)` returns the Premier League.

- [ ] **Step 2: Add `FollowedSummary` sub-component**

  Renders chip row from `followsByKey`. Each chip: crest/initials + label + remove `<button>`. Team chip label = `shortName || name`; league chip label = `All {competition.label}`. Remove → `onToggle(competitionKey, teamKey)`.

- [ ] **Step 3: Add `SearchInput` + search-results view**

  Controlled `<input type="search">` bound to `query`. When `query.trim()` non-empty, render flat `filterTeams` results as toggle buttons (reuse `.sp-team` styling + `.is-active`). Also render any `leagueMatches` as "Follow all of X" rows above team results.

- [ ] **Step 4: Make browse groups collapsible**

  Replace the unconditional `competition.teams.map` in `CompetitionGroup` with a header `<button aria-expanded=…>` toggling membership in `expandedKeys`. Default collapsed: render only the `.sp-whole` follow-all button + a team-count hint. Expanded: render the existing `.sp-teamgrid`.

- [ ] **Step 5: Wire it all in `SportsSettings`**

  Add `const [query, setQuery] = useState("");` and `const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());`. Render order: PaneHead → FollowedSummary → SearchInput → (search results OR browse groups) → Note.

  Pass `catalogQuery.data?.competitions ?? []` to both search and browse paths.

- [ ] **Step 6: Run focused tests**

  ```bash
  pnpm vitest run tests/unit/settings-sports-pane.test.tsx --runInBand
  ```

  Expected: all pass.

## Task 3: Styles

**Files:**

- Modify: `apps/web/src/styles/sports-2.css`

- [ ] **Step 1: Append new classes**

  Add token-only (no raw colors) classes: `.sp-search`, `.sp-summary`, `.sp-chip`, `.sp-chip__remove`, `.sp-grouphead` (collapsible header), `.sp-grouphead__count`, `.sp-noresults`. Reuse existing `--surface`, `--border-subtle`, `--pine-soft`, `--ink`, `--text-muted`, `--radius-lg`, `--font-sans`, `--transition-control` tokens already present in the file.

  Do not reformat existing rules. Append only.

## Task 4: Gate and Commit

- [ ] **Step 1: Run required gate**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

  Expected: all pass.

- [ ] **Step 2: Commit scoped files only**
  ```bash
  git add packages/sports/src/settings/index.tsx \
     apps/web/src/styles/sports-2.css \
     tests/unit/settings-sports-pane.test.tsx \
     docs/superpowers/plans/2026-07-02-688-sports-picker-search.md
  git commit -m "feat(sports): search-first followed-team picker (#688)" \
    -m "Type-ahead search across teams/leagues, followed-teams chip summary, \
       collapsible browse-by-league. Preserves follow/unfollow and follow-all." \
    -m "Co-Authored-By: Claude <noreply@anthropic.com>"
  ```

## Self-Review

- **Spec coverage:** search across team/league names ✓; followed teams pinned in removable chip summary ✓; browse-by-league collapsed secondary ✓; preserve follow-all-league ✓; avoid rendering all team grids until league expanded ✓; focused tests for search + summary ✓; empty/loading/error via existing primitives (`<Note>`, `pending` disabled state) ✓.
- **No contract changes:** data-source/server untouched. All search is client-side on already-delivered catalog data.
- **Preserved behavior:** `toggle()`, `followKey()`, both mutations, invalidation, `.is-active`, follow-all button all unchanged.
- **No repo-wide format, no `docs/coordination` touch.**
- **Placeholder scan:** no TODO/TBD steps.
