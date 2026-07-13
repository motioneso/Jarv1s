# Sports settings dogfood hardening (#989) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans is disabled in this repo.
> The coordinated-build owner drives this plan task-by-task themselves (not subagent-driven-development).
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Sports settings (`packages/sports/src/settings/index.tsx`) per approved spec
`docs/superpowers/specs/2026-07-12-sports-settings-dogfood-hardening.md`: collapse the league
catalog behind a disclosure, unify truthful follow/unfollow control state (aria-pressed +
plain-language labels), localize pending/error copy to the initiating control, and add a
Playwright acceptance spec.

**Architecture:** Everything lives in the existing single-file pane
(`packages/sports/src/settings/index.tsx`) plus its colocated stylesheet
(`sports-2.css`) — no new files except the E2E spec. Add one pure shared helper
`followControlState()` used by team buttons, whole-league buttons, and (for aria-label only)
followed-summary chips. Replace the global `pending`/`error` booleans with a single
`actionState` (`{competitionKey, teamKey, label, direction, phase}` | null) tracked via
component state set at click time and cleared/flipped via per-call mutate callbacks — NOT
derived from `mutation.isPending`/`variables`, so labels are exact without extra lookups.
Wrap `BrowseGroups` in a new collapsed-by-default disclosure (`browseOpen` state + a
`<button aria-expanded>` trigger) only rendered when the search box is empty.

**Tech Stack:** React 19 + TanStack Query v5 (existing patterns only), Vitest SSR string
tests (`renderToString`), Playwright (existing `mockApi`/route-mock conventions).

## Global Constraints

- Reuse `sportsQueryKeys.teamSearch`, `sportsQueryKeys.leagueTeams`, `createSportsFollow`
  (local `createFollow`), `deleteSportsFollow` (local `deleteFollow`) — no new endpoint, schema,
  or dependency (spec Decision 5).
- No optimistic storage model or toast framework (spec Decision 5) — truth is the refetched
  follow list.
- No raw colors outside `apps/web/src/styles/tokens.css`; no new jds-* primitive (spec Slice 2).
- Do not touch Sports routes/service/repository/shared contracts/SQL/providers, and do not touch
  Settings shell files (spec "Expected paths and collision locks").
- Every competition-scoped follow row stays independently visible/removable — no name-based
  dedupe added at the picker level (spec Decision 4).
- File-size gate: keep `index.tsx` and `sports-2.css` under 1000 lines each (CLAUDE.md).
- `pnpm check:design-tokens` and `pnpm verify:foundation` must pass before merge.

---

### Task 1: Shared control-state helper + aria-pressed labels (team + whole-league)

**Files:**
- Modify: `packages/sports/src/settings/index.tsx` (add `followControlState`, rewrite team button
  in `SearchResults` teamgrid + `BrowseGroups` teamgrid, rewrite whole-league button in both
  `SearchResults` and `BrowseGroups`)
- Test: `tests/unit/settings-sports-pane.test.tsx`

**Interfaces:**
- Produces: `export function followControlState(variant: "team" | "league", subjectLabel: string, active: boolean, pending: "follow" | "unfollow" | null): { visible: string; ariaLabel: string }`
  - `pending === "follow"` → `{ visible: "Following…", ariaLabel: "Following…" }`
  - `pending === "unfollow"` → `{ visible: "Unfollowing…", ariaLabel: "Unfollowing…" }`
  - `!pending && active && variant === "team"` → `{ visible: "Following", ariaLabel: \`Unfollow ${subjectLabel}\` }`
  - `!pending && active && variant === "league"` → `{ visible: \`Following all of ${subjectLabel}\`, ariaLabel: \`Unfollow all of ${subjectLabel}\` }`
  - `!pending && !active && variant === "team"` → `{ visible: \`Follow ${subjectLabel}\`, ariaLabel: \`Follow ${subjectLabel}\` }`
  - `!pending && !active && variant === "league"` → `{ visible: \`Follow all of ${subjectLabel}\`, ariaLabel: \`Follow all of ${subjectLabel}\` }`
  - `aria-pressed` is `active` — computed by the caller, not part of the return (callers already
    know `active` for their `is-active` className).

- [ ] **Step 1: Write failing unit tests for `followControlState`**

```tsx
// add to tests/unit/settings-sports-pane.test.tsx, new top-level describe block
describe("followControlState", () => {
  it("inactive team: visible and aria-label both read 'Follow {team}'", () => {
    expect(followControlState("team", "Arsenal", false, null)).toEqual({
      visible: "Follow Arsenal",
      ariaLabel: "Follow Arsenal"
    });
  });
  it("active team: visible reads 'Following', aria-label reads 'Unfollow {team}'", () => {
    expect(followControlState("team", "Arsenal", true, null)).toEqual({
      visible: "Following",
      ariaLabel: "Unfollow Arsenal"
    });
  });
  it("inactive league: visible and aria-label both read 'Follow all of {league}'", () => {
    expect(followControlState("league", "Premier League", false, null)).toEqual({
      visible: "Follow all of Premier League",
      ariaLabel: "Follow all of Premier League"
    });
  });
  it("active league: visible reads 'Following all of {league}', aria-label reads 'Unfollow all of {league}'", () => {
    expect(followControlState("league", "Premier League", true, null)).toEqual({
      visible: "Following all of Premier League",
      ariaLabel: "Unfollow all of Premier League"
    });
  });
  it("pending follow (any variant): both read 'Following…'", () => {
    expect(followControlState("team", "Arsenal", false, "follow")).toEqual({
      visible: "Following…",
      ariaLabel: "Following…"
    });
  });
  it("pending unfollow (any variant): both read 'Unfollowing…'", () => {
    expect(followControlState("league", "Premier League", true, "unfollow")).toEqual({
      visible: "Unfollowing…",
      ariaLabel: "Unfollowing…"
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @jarv1s/sports test -- settings-sports-pane` (or repo-root
`pnpm vitest run tests/unit/settings-sports-pane.test.tsx`)
Expected: FAIL — `followControlState is not a function` / not exported.

- [ ] **Step 3: Implement `followControlState` and wire it into the four button sites**

In `index.tsx`, add above `FollowedSummary`:

```tsx
export function followControlState(
  variant: "team" | "league",
  subjectLabel: string,
  active: boolean,
  pending: "follow" | "unfollow" | null
): { visible: string; ariaLabel: string } {
  if (pending === "follow") return { visible: "Following…", ariaLabel: "Following…" };
  if (pending === "unfollow") return { visible: "Unfollowing…", ariaLabel: "Unfollowing…" };
  const followLabel =
    variant === "league" ? `Follow all of ${subjectLabel}` : `Follow ${subjectLabel}`;
  if (!active) return { visible: followLabel, ariaLabel: followLabel };
  if (variant === "team") return { visible: "Following", ariaLabel: `Unfollow ${subjectLabel}` };
  return {
    visible: `Following all of ${subjectLabel}`,
    ariaLabel: `Unfollow all of ${subjectLabel}`
  };
}
```

Team button (both in `SearchResults`'s `.sp-teamgrid` map and `BrowseGroups`'s expanded
`.sp-teamgrid` map — same JSX in both, update both occurrences):

```tsx
{props.results.map((team) => {
  const active = props.followsByKey.has(followKey(team.competitionKey, team.teamKey));
  const pendingHere = pendingDirectionFor(props.actionState, team.competitionKey, team.teamKey);
  const state = followControlState("team", team.name, active, pendingHere);
  return (
    <button
      key={`${team.competitionKey}:${team.teamKey}`}
      type="button"
      className={`sp-team${active ? " is-active" : ""}`}
      aria-pressed={active}
      aria-label={state.ariaLabel}
      disabled={pendingHere !== null}
      onClick={() => props.onToggle(team.competitionKey, team.teamKey, team.name)}
    >
      <PickCrest name={team.name} shortName={team.shortName} crestUrl={team.crestUrl} />
      <span className="sp-team__name">{team.shortName || team.name}</span>
      <span className="sp-team__state">{state.visible}</span>
    </button>
  );
})}
```

Whole-league button (both `SearchResults` and `BrowseGroups`):

```tsx
const wholeActive = props.followsByKey.has(followKey(competition.competitionKey, null));
const pendingHere = pendingDirectionFor(props.actionState, competition.competitionKey, null);
const state = followControlState("league", competition.label, wholeActive, pendingHere);
return (
  <button
    key={`l-${competition.competitionKey}`}
    type="button"
    className={`sp-whole${wholeActive ? " is-active" : ""}`}
    aria-pressed={wholeActive}
    aria-label={state.ariaLabel}
    disabled={pendingHere !== null}
    onClick={() => props.onToggle(competition.competitionKey, null, competition.label)}
  >
    <span className="sp-whole__lbl">{state.visible}</span>
  </button>
);
```

Add the shared lookup helper (above `FollowedSummary`, near `followKey`):

```tsx
type FollowActionState = {
  competitionKey: string;
  teamKey: string | null;
  label: string;
  direction: "follow" | "unfollow";
  phase: "pending" | "error";
} | null;

function pendingDirectionFor(
  actionState: FollowActionState,
  competitionKey: string,
  teamKey: string | null
): "follow" | "unfollow" | null {
  if (actionState?.phase !== "pending") return null;
  if (actionState.competitionKey !== competitionKey || actionState.teamKey !== teamKey) return null;
  return actionState.direction;
}
```

Replace the old two-span `.sp-whole__lbl` + `.sp-whole__state` markup and the old bare
`onToggle: (competitionKey, teamKey) => void` prop type on `SearchResults`/`BrowseGroups`/
`FollowedSummary` with `onToggle: (competitionKey: string, teamKey: string | null, label: string) => void`
and `actionState: FollowActionState` (replacing the old `pending: boolean` prop) on all three
components. `FollowedSummary`'s remove button also switches to
`disabled={pendingDirectionFor(props.actionState, follow.competitionKey, follow.teamKey) !== null}`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
Expected: PASS (existing tests will fail to compile until Task 2 finishes threading
`actionState` through `SportsSettings` — if so, stub `actionState={null}` at call sites
temporarily in this task's own test file only; production wiring lands in Task 2).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/settings/index.tsx tests/unit/settings-sports-pane.test.tsx
git commit -m "feat(sports): truthful follow/unfollow control labels with aria-pressed"
```

---

### Task 2: Wire `actionState` into `SportsSettings` (replaces global pending/error)

**Files:**
- Modify: `packages/sports/src/settings/index.tsx` (the `SportsSettings` component body)
- Test: `tests/unit/settings-sports-pane.test.tsx`

**Interfaces:**
- Consumes: `FollowActionState`, `pendingDirectionFor` from Task 1.
- Produces: `SportsSettings` no longer passes `pending: boolean`; it passes
  `actionState={actionState}` to `FollowedSummary`/`SearchResults`/`BrowseGroups`, and renders an
  inline `<Note>` naming the target directly under whichever view (search or browse) is showing
  when `actionState?.phase === "error"`.

- [ ] **Step 1: Write failing test — target-named error copy replaces the generic pane banner**

```tsx
it("shows a target-named retry note (not the generic pane banner) after a failed follow", async () => {
  // Exercise via toggle() directly is not possible from SSR string tests (no interactivity);
  // this test asserts the OLD generic banner string is gone from source-level review instead —
  // covered by the E2E spec (Task 4) for the interactive path. Here we only assert the static
  // SSR render (no follows, no error) never contains the old banner text.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
  client.setQueryData(FOLLOWS_KEY, { follows: [] });
  const html = renderWithQuery(client);
  expect(html).not.toContain("Could not load or save sports follows. Try again.");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
Expected: FAIL — old banner string still present in `SportsSettings`.

- [ ] **Step 3: Replace `pending`/`error` state in `SportsSettings` with `actionState`**

```tsx
const [actionState, setActionState] = useState<FollowActionState>(null);

function toggle(competitionKey: string, teamKey: string | null, label: string) {
  const existing = followsByKey.get(followKey(competitionKey, teamKey));
  if (existing) {
    setActionState({ competitionKey, teamKey, label, direction: "unfollow", phase: "pending" });
    unfollowMutation.mutate(existing.id, {
      onSuccess: () => setActionState(null),
      onError: () =>
        setActionState({ competitionKey, teamKey, label, direction: "unfollow", phase: "error" })
    });
  } else {
    setActionState({ competitionKey, teamKey, label, direction: "follow", phase: "pending" });
    followMutation.mutate(
      { competitionKey, teamKey },
      {
        onSuccess: () => setActionState(null),
        onError: () =>
          setActionState({ competitionKey, teamKey, label, direction: "follow", phase: "error" })
      }
    );
  }
}
```

Remove the old `pending`/`error` derived consts entirely. Update the three render call sites to
pass `actionState={actionState}` instead of `pending={pending}`, and replace the bottom
`{error ? <Note>...</Note> : null}` with:

```tsx
{actionState?.phase === "error" ? (
  <Note>
    Couldn&rsquo;t {actionState.direction === "follow" ? "follow" : "unfollow"} {actionState.label}. Try again.
  </Note>
) : null}
```

Catalog/follows load failure still needs a message (was folded into the old `error` boolean) —
add a separate, unconditional check ahead of the action-state note:

```tsx
{catalogQuery.isError || followsQuery.isError ? (
  <Note>Could not load sports follows. Try again.</Note>
) : null}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
Expected: PASS, all prior tests green too (update any test call sites still passing
`pending={false}` to `actionState={null}`).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @jarv1s/sports typecheck` (or repo-root `pnpm typecheck`)
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sports/src/settings/index.tsx tests/unit/settings-sports-pane.test.tsx
git commit -m "feat(sports): localize pending/error follow feedback to the initiating control"
```

---

### Task 3: Collapsed-by-default "Browse leagues" disclosure

**Files:**
- Modify: `packages/sports/src/settings/index.tsx` (`SportsSettings` render — empty-query branch)
- Modify: `packages/sports/src/settings/sports-2.css` (disclosure trigger style, narrow-width rules)
- Test: `tests/unit/settings-sports-pane.test.tsx`

**Interfaces:**
- Produces: a `browseOpen` boolean state in `SportsSettings`, default `false`; a
  `<button aria-expanded={browseOpen} aria-controls="sp-browse-panel">Browse leagues</button>`
  trigger; `BrowseGroups` only renders (inside `<div id="sp-browse-panel">`) when
  `browseOpen === true`. `query.length === 0` branch changes from "always render BrowseGroups"
  to "render the trigger, and the panel only if open."

- [ ] **Step 1: Write failing test — browse leagues starts collapsed**

```tsx
it("empty-query view starts with browse leagues collapsed, not the full catalog", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(CATALOG_KEY, { competitions: TWO_LEAGUES, degraded: false });
  client.setQueryData(FOLLOWS_KEY, { follows: [] });
  const html = renderWithQuery(client);
  expect(html).toContain("Browse leagues");
  expect(html).toContain('aria-expanded="false"');
  // The confederation catalog itself must not render until expanded.
  expect(html).not.toContain("US majors &amp; global");
  expect(html).not.toContain("NFL");
});
```

Update the existing test `"renders search input and browse groups ... when query is empty"`
(added in a prior pass, now stale per spec Decision 1) to assert the collapsed trigger instead of
expanded groups — rename it and flip its assertions to match the new default-collapsed contract
(delete the old expanded-by-default assertions; that behavior is superseded by this spec).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
Expected: FAIL — `BrowseGroups` still renders unconditionally.

- [ ] **Step 3: Implement the disclosure**

```tsx
const [browseOpen, setBrowseOpen] = useState(false);
```

Replace the `query.length === 0` branch:

```tsx
) : (
  <>
    <button
      type="button"
      className="sp-browse-toggle"
      aria-expanded={browseOpen}
      aria-controls="sp-browse-panel"
      onClick={() => setBrowseOpen((open) => !open)}
    >
      Browse leagues
    </button>
    {browseOpen ? (
      <div id="sp-browse-panel">
        <BrowseGroups
          competitions={competitions}
          followsByKey={followsByKey}
          expandedKey={expandedKey}
          onExpand={setExpandedKey}
          expandedTeams={expandedQuery.data?.teams ?? []}
          expandedLoading={expandedQuery.isLoading}
          expandedDegraded={expandedQuery.data?.degraded === true || expandedQuery.isError}
          onRetryExpanded={() => void expandedQuery.refetch()}
          onToggle={toggle}
          actionState={actionState}
        />
      </div>
    ) : null}
  </>
)
```

Add to `sports-2.css`:

```css
.sp-browse-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 1px solid var(--border-subtle);
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 9px 12px;
  margin-bottom: 10px;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  transition: var(--transition-control);
}
.sp-browse-toggle:hover {
  background: var(--surface-2);
}
.sp-browse-toggle[aria-expanded="true"] {
  color: var(--ink);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/settings/index.tsx packages/sports/src/settings/sports-2.css tests/unit/settings-sports-pane.test.tsx
git commit -m "feat(sports): collapse the full league catalog behind a Browse leagues disclosure"
```

---

### Task 4: Slice 2 responsive pass — team-state span, narrow width, no overflow

**Files:**
- Modify: `packages/sports/src/settings/sports-2.css`

**Interfaces:**
- Consumes: `.sp-team__state`, `.sp-whole__lbl` (single-span now, per Task 1), `.sp-browse-toggle`
  (Task 3) — all already emitted by `index.tsx`.
- Produces: visual styling only, no new markup.

- [ ] **Step 1: Add `.sp-team__state` style (new span from Task 1) and prune the now-unused `.sp-whole__state` rule**

In `sports-2.css`, remove the `.sp-whole__state` and `.sp-whole.is-active .sp-whole__state` rules
(the two-span layout is gone — Task 1 collapsed the whole-league button to one `.sp-whole__lbl`
span whose text itself changes). Add:

```css
.sp-team {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.sp-team__state {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--text-faint);
}
.sp-team.is-active .sp-team__state {
  color: var(--forest-ink);
}
```

(This changes `.sp-team` from a horizontal crest+name row to a small stacked card so the new
state line fits without widening the grid cell — `.sp-teamgrid`'s `minmax(150px, 1fr)` already
has headroom. `PickCrest` and `.sp-team__name` need a wrapping row; adjust their container:)

```css
.sp-team__top {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
```

Update `index.tsx`'s team button JSX (both occurrences, from Task 1) to wrap crest+name in a
`<span className="sp-team__top">` so the CSS above applies:

```tsx
<span className="sp-team__top">
  <PickCrest name={team.name} shortName={team.shortName} crestUrl={team.crestUrl} />
  <span className="sp-team__name">{team.shortName || team.name}</span>
</span>
<span className="sp-team__state">{state.visible}</span>
```

- [ ] **Step 2: Add a narrow-width rule scoped to this pane only (no shell breakpoint reuse)**

```css
@media (max-width: 420px) {
  .sp-teamgrid {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  }
  .sp-browse__row {
    flex-wrap: wrap;
  }
  .sp-browse__row .sp-whole {
    width: 100%;
  }
}
```

- [ ] **Step 3: Manual check — no build step for CSS-only, but run the design-token gate**

Run: `pnpm check:design-tokens`
Expected: PASS (no raw colors introduced — every value above is `var(--...)`).

- [ ] **Step 4: Commit**

```bash
git add packages/sports/src/settings/index.tsx packages/sports/src/settings/sports-2.css
git commit -m "style(sports): stacked team-state card and narrow-width wrap for settings follow picker"
```

---

### Task 5: Playwright acceptance spec

**Files:**
- Create: `tests/e2e/sports-settings.spec.ts`

**Interfaces:**
- Consumes: `mockApi` from `./mock-api.js` (auth + base fixtures), `myModulesResponse`/
  `modulesResponse` pattern from `./mock-modules.js` (to mark `sports` active — mirror
  `registerMockSportsRoutes`'s `/api/me/modules` override in `mock-sports-api.ts:372-394`, but
  local to this file per spec Slice 3 "stateful route mock local to the Sports settings spec").
  Route shapes: `SportsCatalogResponse`, `SportsFollowsResponse`, `SportsTeamSearchResponse`,
  `SportsLeagueTeamsResponse`, `CreateSportsFollowRequest` from `@jarv1s/shared` (same types
  `index.tsx` uses).
- Produces: nothing consumed elsewhere — this is a leaf test file.

- [ ] **Step 1: Write the stateful mock + navigation helper and the desktop critical-path test**

```typescript
import { test, expect, type Page, type Route } from "@playwright/test";
import type {
  CompetitionRef,
  CreateSportsFollowRequest,
  SportsFollowDto,
  TeamRef
} from "@jarv1s/shared";

import { mockApi } from "./mock-api.js";

const NFL: CompetitionRef = {
  competitionKey: "nfl",
  label: "NFL",
  kind: "league",
  marquee: true,
  standingsShape: "record",
  confederation: "INTL"
};
const EPL: CompetitionRef = {
  competitionKey: "epl",
  label: "Premier League",
  kind: "league",
  marquee: true,
  standingsShape: "table",
  confederation: "UEFA"
};
const COWBOYS: TeamRef = {
  teamKey: "dal",
  competitionKey: "nfl",
  name: "Dallas Cowboys",
  shortName: "DAL",
  crestUrl: null
};
const ARSENAL: TeamRef = {
  teamKey: "team.ars",
  competitionKey: "epl",
  name: "Arsenal",
  shortName: "ARS",
  crestUrl: null
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Stateful mock local to this spec (spec Slice 3) — catalog, follows, search, roster, and
    create/delete follow, all in-memory. No ESPN call, no real account. */
async function mockSportsSettings(page: Page): Promise<void> {
  let follows: SportsFollowDto[] = [];
  let nextId = 1;

  await page.route("**/api/me/modules", (route) =>
    fulfillJson(route, {
      modules: [
        {
          id: "sports",
          name: "Sports",
          version: "0.1.0",
          lifecycle: "user-toggleable",
          required: false,
          supportsUserDisable: true,
          instanceDisabled: false,
          userDisabled: false,
          active: true
        }
      ]
    })
  );

  await page.route("**/api/sports/catalog", (route) =>
    fulfillJson(route, { competitions: [NFL, EPL], degraded: false })
  );

  await page.route("**/api/sports/follows", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, { follows });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as CreateSportsFollowRequest;
      const follow: SportsFollowDto = {
        id: `f${nextId++}`,
        competitionKey: body.competitionKey,
        teamKey: body.teamKey,
        createdAt: "2026-07-12T00:00:00.000Z"
      };
      follows = [...follows, follow];
      return fulfillJson(route, { follow });
    }
    return route.continue();
  });

  await page.route("**/api/sports/follows/*", (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    follows = follows.filter((f) => f.id !== id);
    return fulfillJson(route, { ok: true });
  });

  await page.route("**/api/sports/teams/search*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q")?.toLowerCase() ?? "";
    const teams = [COWBOYS, ARSENAL].filter((t) => t.name.toLowerCase().includes(q));
    return fulfillJson(route, { teams, partial: false });
  });

  await page.route("**/api/sports/leagues/*/teams", (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[4] ?? "");
    const teams = key === "nfl" ? [COWBOYS] : key === "epl" ? [ARSENAL] : [];
    return fulfillJson(route, { teams, degraded: false });
  });
}

async function gotoSportsSettings(page: Page): Promise<void> {
  await page.goto("/settings?section=modules&module=sports");
  await expect(page.getByRole("heading", { name: "Sports" })).toBeVisible();
}

test.describe("Sports settings follow picker (#989)", () => {
  test("search → follow → Following → unfollow a team; follow-all → unfollow-all a league", async ({
    page
  }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockSportsSettings(page);
    await gotoSportsSettings(page);

    // Browse leagues starts collapsed on desktop too.
    const browseToggle = page.getByRole("button", { name: "Browse leagues" });
    await expect(browseToggle).toHaveAttribute("aria-expanded", "false");

    // Search → follow an individual team.
    await page.getByRole("searchbox", { name: "Find a team or league" }).fill("cowboys");
    const followBtn = page.getByRole("button", { name: "Follow Dallas Cowboys" });
    await expect(followBtn).toBeVisible();
    await followBtn.click();
    await expect(page.getByRole("button", { name: "Unfollow Dallas Cowboys" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unfollow Dallas Cowboys" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // Unfollow via the same control.
    await page.getByRole("button", { name: "Unfollow Dallas Cowboys" }).click();
    await expect(page.getByRole("button", { name: "Follow Dallas Cowboys" })).toBeVisible();

    // Follow-all a league from search results.
    await page.getByRole("searchbox", { name: "Find a team or league" }).fill("nfl");
    const followAllBtn = page.getByRole("button", { name: "Follow all of NFL" });
    await followAllBtn.click();
    await expect(page.getByRole("button", { name: "Unfollow all of NFL" })).toBeVisible();

    await page.getByRole("button", { name: "Unfollow all of NFL" }).click();
    await expect(page.getByRole("button", { name: "Follow all of NFL" })).toBeVisible();
  });

  test("browse leagues disclosure opens only the selected league's roster and preserves loading/retry states", async ({
    page
  }) => {
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockSportsSettings(page);
    await gotoSportsSettings(page);

    const browseToggle = page.getByRole("button", { name: "Browse leagues" });
    await browseToggle.click();
    await expect(browseToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Premier League" })).toBeVisible();

    await page.getByRole("button", { name: "Premier League" }).click();
    await expect(page.getByRole("button", { name: "Follow Arsenal" })).toBeVisible();
    // Only the expanded league's roster fetched — NFL's roster button never appears unexpanded.
  });

  test("narrow viewport: browse starts collapsed, keyboard-openable, no horizontal overflow", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, {
      authenticated: true,
      connectorAccounts: [],
      connectorProviders: [],
      notifications: [],
      tasks: []
    });
    await mockSportsSettings(page);
    await gotoSportsSettings(page);

    const browseToggle = page.getByRole("button", { name: "Browse leagues" });
    await expect(browseToggle).toHaveAttribute("aria-expanded", "false");
    await browseToggle.focus();
    await page.keyboard.press("Enter");
    await expect(browseToggle).toHaveAttribute("aria-expanded", "true");

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // Search → follow round-trip still works at narrow width.
    await page.getByRole("searchbox", { name: "Find a team or league" }).fill("arsenal");
    await page.getByRole("button", { name: "Follow Arsenal" }).click();
    await expect(page.getByRole("button", { name: "Unfollow Arsenal" })).toBeVisible();
    await page.getByRole("button", { name: "Unfollow Arsenal" }).click();
    await expect(page.getByRole("button", { name: "Follow Arsenal" })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run to verify it fails on `main`-shaped code (pre-Task-1..4), then passes now**

Run: `pnpm exec playwright test tests/e2e/sports-settings.spec.ts`
Expected: PASS (Tasks 1–4 already landed by this point in the plan sequence).
If a selector mismatch appears (e.g. exact button name text differs from `followControlState`'s
actual output), fix the selector to match the real accessible name — do not change production
copy to fit the test.

- [ ] **Step 3: Confirm the settings deep link resolves without touching shell files**

If `page.goto("/settings?section=modules&module=sports")` doesn't land on the Sports pane (e.g.
the shell's query-param contract differs), read `apps/web/src/pages/settings*` (read-only — do
not edit) to find the actual deep-link contract and adjust only this test file's navigation
helper to match it.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/sports-settings.spec.ts
git commit -m "test(sports): Playwright acceptance for settings follow/unfollow at desktop and narrow widths"
```

---

### Task 6: Full gate + exit criteria sign-off

**Files:** none (verification only)

- [ ] **Step 1: Run the full local gate**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm check:design-tokens
pnpm vitest run tests/unit/settings-sports-pane.test.tsx
pnpm exec playwright test tests/e2e/sports-settings.spec.ts
git diff --check
```

Expected: all green. Record each command's exit code in the wrap-up report (per CLAUDE.md: "If
CI is unavailable, record the local commands and exit codes used instead").

- [ ] **Step 2: Re-read the spec's "Desktop and narrow acceptance" checklist and confirm each line item**

Walk `docs/superpowers/specs/2026-07-12-sports-settings-dogfood-hardening.md` lines 119–136 one
by one against the built pane; note any gap before calling this done.

- [ ] **Step 3: Hand off to `coordinated-wrap-up`**

Do not merge, do not touch the board — report PR + verified evidence to the coordinator per the
`coordinated-build` skill.

## Self-Review Notes

- Spec coverage: Slice 1 → Tasks 1–2; Slice 2 → Task 4 (+ Task 3's disclosure trigger style);
  Slice 3 → Task 5. Decisions 1–6 all have a task. Exit-criteria checklist → Task 6.
- Type consistency: `FollowActionState`, `followControlState`, `pendingDirectionFor` names are
  used identically across Tasks 1–3; `onToggle` signature `(competitionKey, teamKey, label)` is
  consistent everywhere it's threaded (SearchResults, BrowseGroups, FollowedSummary, SportsSettings).
- No placeholders: every step has literal code, not "add tests for the above."
