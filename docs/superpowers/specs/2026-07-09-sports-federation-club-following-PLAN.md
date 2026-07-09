# Sports Federation Club-Following Implementation Plan (#907)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users follow any club in any Champions-League-eligible federation (plus the full English pyramid) by making the sports catalog leagues-eager / teams-lazy and expanding the league dataset.

**Architecture:** Split `GET /api/sports/catalog` into a cheap leagues-only list plus two new lazy endpoints (`GET /api/sports/leagues/:competitionKey/teams`, `GET /api/sports/teams/search?q=`), tag every `CatalogEntry` with a confederation, rework the settings picker to server-side search + confederation browse, then grow `SPORTS_CATALOG` from 8 to ~50 probe-verified leagues. Additive tasks first; the breaking contract flip (catalog drops rosters) lands last in Slice 1 so every commit stays green.

**Tech Stack:** Fastify + fast-json-stringify schemas (`packages/shared/src/sports-api.ts`), dataset-connector SDK (`@jarv1s/datasets`), React + TanStack Query (settings picker), Vitest (`tests/unit/`).

**Spec:** `~/Jarv1s/docs/superpowers/specs/2026-07-09-sports-federation-club-following.md` — read it before starting any task.

## Global Constraints

- **fast-json-stringify trap:** every new response field must appear in BOTH `required` (where always emitted) AND `properties` of its schema, or it is silently dropped (`additionalProperties: false`). Verify emission via `app.inject` wire-body assertions, never service-level returns.
- **Route/manifest pairing:** every new Fastify route must also be declared in `packages/sports/src/manifest.ts` `routes` with `permissionId: "sports.view"`. `tests/unit/sports-manifest.test.ts` may assert the route list — update it in the same task.
- **Module isolation:** changes live in `packages/sports`, `packages/shared/src/sports-api.ts`, and one generic option in `packages/datasets`. No other module's internals.
- **No migrations, no RLS changes** — `app.sports_follows` is untouched.
- **File-size gate:** all source files ≤ 1000 lines (`pnpm check:file-size`). `catalog.ts` stays under it even at ~55 entries (~600 lines); if a later count exceeds it, split rows into `packages/sports/src/source/catalog-data.ts`.
- **Comment density:** generous why-comments citing issue #907 and constraints (Ben's standing rule); chat terse, code comments rich.
- **Gate per task:** run `pnpm verify:foundation` (typecheck, lint, format:check, file-size, unit) before every commit. Commit messages: conventional, one user-facing summary line, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **No new dependencies.** Debounce is a local hook; the probe script is plain Node 20+ (`fetch` built in).
- Work on branch `feat/907-sports-federation` in this worktree only.

---

### Task 1: `cacheOnly` peek option in `@jarv1s/datasets`

The cross-league search (Task 4) must ask "is this league's roster cached?" without triggering a live fetch. `DatasetClient.getDataset` has no such primitive — add one.

**Files:**

- Modify: `packages/datasets/src/client.ts` (interfaces at lines 18–35, `getDataset` at lines 108–153)
- Test: `tests/unit/dataset-client.test.ts` (append; reuse the file's existing client/adapter fixture pattern)

**Interfaces:**

- Produces: `GetDatasetOptions<T>` gains `readonly cacheOnly?: boolean`; `DatasetEnvelope<T>` gains `readonly cacheMiss?: boolean`. Contract: `cacheOnly: true` never calls the adapter; a fresh cache hit returns `{data, degraded: false}`, a stale-but-retained hit returns `{data, degraded: true}`, a miss returns `{data: fallback, degraded: false, cacheMiss: true}`. Task 4 consumes this.

- [ ] **Step 1: Write the failing test.** Open `tests/unit/dataset-client.test.ts`, copy its existing client-construction fixture (fake adapter with a call counter), and append:

```ts
describe("cacheOnly peek (#907)", () => {
  it("returns cacheMiss without calling the adapter on a cold cache", async () => {
    // build client with an adapter whose fetchDataset increments `calls`
    const result = await client.getDataset<string[]>(
      "teams",
      { competitionKey: "eng.1" },
      { fallback: [], cacheOnly: true }
    );
    expect(result.cacheMiss).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.degraded).toBe(false);
    expect(calls).toBe(0);
  });

  it("serves a fresh cached value without refetching", async () => {
    await client.getDataset("teams", { competitionKey: "eng.1" }, { fallback: [] }); // warm (1 call)
    const result = await client.getDataset<string[]>(
      "teams",
      { competitionKey: "eng.1" },
      { fallback: [], cacheOnly: true }
    );
    expect(result.cacheMiss).toBeUndefined();
    expect(result.degraded).toBe(false);
    expect(calls).toBe(1); // no second adapter call
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`cacheMiss` undefined on cold cache because a live fetch happened, `calls` = 1 not 0):

Run: `pnpm vitest run tests/unit/dataset-client.test.ts`

- [ ] **Step 3: Implement.** In `packages/datasets/src/client.ts`:

```ts
export interface DatasetEnvelope<T> {
  readonly data: T;
  /** True when this call served a fallback or a stale cache entry instead of a fresh fetch. */
  readonly degraded: boolean;
  readonly fetchedAt: string;
  /** Only set by `cacheOnly` reads: true when nothing (fresh or stale) was cached (#907). */
  readonly cacheMiss?: boolean;
}

export interface GetDatasetOptions<T> {
  readonly fallback: T;
  /**
   * Peek: report the cache without ever triggering a live fetch. Lets callers bound their own
   * fan-out (sports cross-league team search warm-fill, #907 spec §4.4).
   */
  readonly cacheOnly?: boolean;
}
```

In `getDataset`, immediately after `const hit = cache.get<T>(cacheKey, nowMs);` (before the existing fresh-hit early return):

```ts
if (options.cacheOnly) {
  // Peek path: never fetch. Stale-but-retained entries are served degraded, matching the
  // serve-stale semantics of the normal path (#907).
  if (hit) {
    return { data: hit.value, degraded: !hit.fresh, fetchedAt: new Date(nowMs).toISOString() };
  }
  return {
    data: options.fallback,
    degraded: false,
    cacheMiss: true,
    fetchedAt: new Date(nowMs).toISOString()
  };
}
```

- [ ] **Step 4: Run tests — expect PASS:** `pnpm vitest run tests/unit/dataset-client.test.ts`
- [ ] **Step 5: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/datasets/src/client.ts tests/unit/dataset-client.test.ts
git commit -m "feat(datasets): cacheOnly peek option on getDataset (#907)

Lets callers check the dataset cache without triggering a live fetch, so the
sports team search can bound its ESPN fan-out. Not user-visible on its own.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `confederation` on the catalog (type, schema, data, passthrough)

**Files:**

- Modify: `packages/shared/src/sports-api.ts` (`CompetitionRef` ~line 75, `competitionRefSchema` ~line 348, `sportsCatalogResponseSchema` ~line 576)
- Modify: `packages/sports/src/source/catalog.ts` (interface + all 8 entries)
- Modify: `packages/sports/src/sports-service.ts` (`getCatalog` mapping, lines 146–158)
- Test: `tests/unit/sports-catalog.test.ts`, `tests/unit/sports-routes.test.ts` (catalog test ~line 281)

**Interfaces:**

- Produces: `export type Confederation = "UEFA" | "CONCACAF" | "CONMEBOL" | "AFC" | "CAF" | "OFC" | "INTL"` in `@jarv1s/shared`; `CompetitionRef.confederation: Confederation`; `CatalogEntry.confederation: Confederation`. Tasks 5, 8–10 consume this.

- [ ] **Step 1: Write failing tests.** In `tests/unit/sports-catalog.test.ts` add:

```ts
it("tags every entry with a confederation (#907)", () => {
  for (const entry of SPORTS_CATALOG) expect(entry.confederation).toBeTruthy();
  expect(catalogEntry("eng.1")?.confederation).toBe("UEFA");
  expect(catalogEntry("usa.1")?.confederation).toBe("CONCACAF");
  expect(catalogEntry("uefa.champions")?.confederation).toBe("UEFA");
  expect(catalogEntry("fifa.world")?.confederation).toBe("INTL");
  expect(catalogEntry("nfl")?.confederation).toBe("INTL");
});
```

In `tests/unit/sports-routes.test.ts`, extend the existing `"GET /api/sports/catalog returns competitions with teams"` test:

```ts
// fast-json-stringify strip check: confederation must survive serialization (#907).
const nfl = body.competitions.find((c: { competitionKey: string }) => c.competitionKey === "nfl");
expect(nfl.confederation).toBe("INTL");
```

- [ ] **Step 2: Run — expect FAIL** (property missing): `pnpm vitest run tests/unit/sports-catalog.test.ts tests/unit/sports-routes.test.ts`
- [ ] **Step 3: Implement.** `packages/shared/src/sports-api.ts` — near `CompetitionRef`:

```ts
/** FIFA confederation grouping for the follow picker's browse mode (#907). "INTL" covers the
 *  US majors (grouping only applies visually to soccer) and cross-confederation tournaments. */
export type Confederation = "UEFA" | "CONCACAF" | "CONMEBOL" | "AFC" | "CAF" | "OFC" | "INTL";

export interface CompetitionRef {
  // ...existing fields unchanged...
  readonly confederation: Confederation;
}
```

`competitionRefSchema` — add to BOTH lists (fast-json-stringify trap):

```ts
required: ["competitionKey", "label", "kind", "marquee", "standingsShape", "confederation"],
properties: {
  // ...existing...
  confederation: {
    type: "string",
    enum: ["UEFA", "CONCACAF", "CONMEBOL", "AFC", "CAF", "OFC", "INTL"]
  }
}
```

`sportsCatalogResponseSchema` — its items object has its OWN literal `required` list (not derived from `competitionRefSchema`); add `"confederation"` there too:

```ts
required: ["competitionKey", "label", "kind", "marquee", "standingsShape", "confederation", "teams"],
```

`packages/sports/src/source/catalog.ts`:

```ts
import type { Confederation, StandingsShape } from "@jarv1s/shared";

export interface CatalogEntry {
  // ...existing fields...
  readonly confederation: Confederation;
}
```

Entry assignments: `nfl`/`nba`/`nhl`/`mlb`/`fifa.world` → `"INTL"`; `eng.1`/`uefa.champions` → `"UEFA"` (the CL is unambiguously UEFA-run — spec §4.1); `usa.1` → `"CONCACAF"`.

`packages/sports/src/sports-service.ts` `getCatalog` mapping — add one line:

```ts
confederation: entry.confederation,
```

- [ ] **Step 4: Run — expect PASS:** `pnpm vitest run tests/unit/sports-catalog.test.ts tests/unit/sports-routes.test.ts`
- [ ] **Step 5: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/shared/src/sports-api.ts packages/sports/src/source/catalog.ts packages/sports/src/sports-service.ts tests/unit/sports-catalog.test.ts tests/unit/sports-routes.test.ts
git commit -m "feat(sports): confederation tag on every catalog league (#907)

Groundwork for browsing leagues by region in the follow picker. No visible
change yet.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/sports/leagues/:competitionKey/teams` (lazy roster endpoint)

**Files:**

- Modify: `packages/shared/src/sports-api.ts` (new type + schema, next to `sportsCatalogResponseSchema`)
- Modify: `packages/sports/src/sports-service.ts` (new method next to `getCatalog`)
- Modify: `packages/sports/src/routes.ts` (new route after the catalog route)
- Modify: `packages/sports/src/manifest.ts` (`routes` array)
- Test: `tests/unit/sports-routes.test.ts`, `tests/unit/sports-manifest.test.ts` (update route-list expectations if it asserts them)

**Interfaces:**

- Consumes: nothing new.
- Produces: `SportsLeagueTeamsResponse { teams: readonly TeamRef[]; degraded: boolean }`, `sportsLeagueTeamsResponseSchema`, `SportsService.getLeagueTeams(competitionKey: string): Promise<SportsLeagueTeamsResponse>`. Task 5 consumes the endpoint.

- [ ] **Step 1: Write failing tests** in `tests/unit/sports-routes.test.ts` (follow the file's `buildApp`/fake-dataset-client pattern; the `listTeams` handler is already dispatched for the `"teams"` dataset key):

```ts
it("GET /api/sports/leagues/:competitionKey/teams returns one league's roster (#907)", async () => {
  const { app } = buildApp({
    datasetClient: makeDatasetClient({
      listTeams: async (competitionKey) => [
        {
          teamKey: "t.ars",
          competitionKey,
          name: "Arsenal",
          shortName: "ARS",
          crestUrl: "https://a.espncdn.com/i/teamlogos/soccer/500/359.png",
          sourceTeamId: "359"
        } as SourceTeamRef
      ]
    })
  });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/sports/leagues/eng.1/teams" });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.teams).toHaveLength(1);
  // Wire-body checks: crestUrl survives serialization; source-internal ids do NOT leak.
  expect(res.body).toContain("crestUrl");
  expect(res.body).not.toContain("sourceTeamId");
  await app.close();
});

it("GET /api/sports/leagues/:competitionKey/teams 400s an unknown competition (#907)", async () => {
  const { app } = buildApp();
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/sports/leagues/nope.9/teams" });
  expect(res.statusCode).toBe(400);
  await app.close();
});
```

(If the file's fake-client factory is named `makeSource`, use that name — match the file.)

- [ ] **Step 2: Run — expect FAIL** (404, route not registered): `pnpm vitest run tests/unit/sports-routes.test.ts`
- [ ] **Step 3: Implement.** `packages/shared/src/sports-api.ts`:

```ts
/** `GET /api/sports/leagues/:competitionKey/teams` — one league's clubs, fetched on demand by
 *  the follow picker (browse-expand and followed-chip name resolution). Replaces the retired
 *  eager per-league fan-out in the catalog (#907). */
export interface SportsLeagueTeamsResponse {
  readonly teams: readonly TeamRef[];
  readonly degraded: boolean; // roster fetch failed → empty teams + retry affordance
}

export const sportsLeagueTeamsResponseSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["competitionKey"],
    properties: {
      competitionKey: { type: "string", minLength: 1, maxLength: 100 }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["teams", "degraded"],
      properties: {
        teams: { type: "array", items: teamRefSchema },
        degraded: { type: "boolean" }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
```

`packages/sports/src/sports-service.ts` (public method, after `getCatalog`):

```ts
/** One league's clubs, on demand — picker browse-expand + followed-chip resolution (#907). */
async getLeagueTeams(competitionKey: string): Promise<SportsLeagueTeamsResponse> {
  const state: DegradeState = { degraded: false };
  const teams = await this.teamsFor(competitionKey, state);
  return { teams, degraded: state.degraded };
}
```

(Import `SportsLeagueTeamsResponse` from `@jarv1s/shared`.)

`packages/sports/src/routes.ts` (after the catalog route; import `sportsLeagueTeamsResponseSchema`):

```ts
server.get(
  "/api/sports/leagues/:competitionKey/teams",
  { schema: sportsLeagueTeamsResponseSchema },
  async (request, reply) => {
    try {
      await dependencies.resolveAccessContext(request);
      const { competitionKey } = request.params as { competitionKey: string };
      // Same authorization-by-catalog rule as POST /follows: being in SPORTS_CATALOG is what
      // makes a competition queryable (#907).
      if (!catalogEntry(competitionKey)) {
        throw new HttpError(400, `Unknown competition: ${competitionKey}`);
      }
      return await service.getLeagueTeams(competitionKey);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

`packages/sports/src/manifest.ts` `routes` array (import the schema):

```ts
{
  method: "GET",
  path: "/api/sports/leagues/:competitionKey/teams",
  responseSchema: sportsLeagueTeamsResponseSchema,
  permissionId: "sports.view"
},
```

- [ ] **Step 4: Run — expect PASS**, including `sports-manifest.test.ts` (fix its route-count/list expectations if asserted): `pnpm vitest run tests/unit/sports-routes.test.ts tests/unit/sports-manifest.test.ts`
- [ ] **Step 5: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/shared/src/sports-api.ts packages/sports/src/sports-service.ts packages/sports/src/routes.ts packages/sports/src/manifest.ts tests/unit/sports-routes.test.ts tests/unit/sports-manifest.test.ts
git commit -m "feat(sports): on-demand league roster endpoint (#907)

New GET /api/sports/leagues/:competitionKey/teams fetches one league's clubs
only when the picker needs them. Groundwork; picker switches over next.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `GET /api/sports/teams/search?q=` (bounded cross-league search)

**Files:**

- Modify: `packages/shared/src/sports-api.ts` (new type + schema)
- Modify: `packages/sports/src/sports-service.ts` (new constants + method)
- Modify: `packages/sports/src/routes.ts`, `packages/sports/src/manifest.ts`
- Test: `tests/unit/sports-routes.test.ts` (also extend the fake dataset client with `cacheOnly` support), `tests/unit/sports-manifest.test.ts`

**Interfaces:**

- Consumes: Task 1's `cacheOnly`/`cacheMiss` on `DatasetClient.getDataset`.
- Produces: `SportsTeamSearchResponse { teams: readonly TeamRef[]; partial: boolean; degraded: boolean }`, `sportsTeamSearchResponseSchema` (querystring `q`, minLength 2, maxLength 80), `SportsService.searchTeams(query: string)`. Task 5 consumes the endpoint. `partial` means "warm-fill hasn't covered every catalog league yet" — distinct from `degraded` ("a fetch actually failed"), per spec §4.4.

- [ ] **Step 1: Extend the fake dataset client** in `tests/unit/sports-routes.test.ts` so `cacheOnly` reads work. Give `makeDatasetClient` (or `makeSource` — match the file) a second parameter `cachedCompetitionKeys: ReadonlySet<string> = new Set()` and, at the top of `getDataset`, before the switch:

```ts
if ((options as { cacheOnly?: boolean }).cacheOnly) {
  const key = params.competitionKey as string;
  if (!cachedCompetitionKeys.has(key)) {
    return {
      data: options.fallback,
      degraded: false,
      cacheMiss: true,
      fetchedAt: new Date().toISOString()
    };
  }
  // fall through: a "cached" league serves via the normal handler below, no live-fetch counted
}
```

- [ ] **Step 2: Write failing tests:**

```ts
it("GET /api/sports/teams/search matches cached rosters across leagues (#907)", async () => {
  let liveFetches = 0;
  const roster = (competitionKey: string): SourceTeamRef[] =>
    competitionKey === "eng.1"
      ? [
          {
            teamKey: "t.ars",
            competitionKey,
            name: "Arsenal",
            shortName: "ARS",
            crestUrl: null
          } as SourceTeamRef
        ]
      : [];
  const cached = new Set(SPORTS_CATALOG.map((c) => c.competitionKey)); // everything warm
  const { app } = buildApp({
    datasetClient: makeDatasetClient(
      {
        listTeams: async (key) => {
          liveFetches++;
          return roster(key);
        }
      },
      cached
    )
  });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/sports/teams/search?q=arsenal" });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.teams.map((t: { teamKey: string }) => t.teamKey)).toEqual(["t.ars"]);
  expect(body.partial).toBe(false);
  // fast-json-stringify strip check: `partial` must be on the wire.
  expect(res.body).toContain('"partial"');
  await app.close();
});

it("search warm-fills at most 5 uncached leagues per query and reports partial (#907)", async () => {
  let liveFetches = 0;
  const { app } = buildApp({
    datasetClient: makeDatasetClient(
      {
        listTeams: async () => {
          liveFetches++;
          return [];
        }
      },
      new Set() // cold cache: all 8 catalog leagues uncached
    )
  });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/sports/teams/search?q=arsenal" });
  expect(res.statusCode).toBe(200);
  expect(liveFetches).toBe(5); // SEARCH_WARM_FILL_CAP
  expect(JSON.parse(res.body).partial).toBe(true); // 3 of 8 leagues skipped
  await app.close();
});

it("search rejects queries shorter than 2 chars via schema (#907)", async () => {
  const { app } = buildApp();
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/sports/teams/search?q=a" });
  expect(res.statusCode).toBe(400);
  await app.close();
});
```

(Import `SPORTS_CATALOG` from `../../packages/sports/src/source/catalog.js` at the top of the test file. The fake client counts a live fetch only when the `listTeams` handler runs via the non-`cacheOnly` path.)

- [ ] **Step 3: Run — expect FAIL** (404): `pnpm vitest run tests/unit/sports-routes.test.ts`
- [ ] **Step 4: Implement.** `packages/shared/src/sports-api.ts`:

```ts
/** `GET /api/sports/teams/search?q=` — bounded cross-league club search for the follow picker.
 *  `partial` = warm-fill hasn't covered every catalog league yet this process lifetime; NOT an
 *  error state (`degraded` keeps meaning "a fetch failed") — spec §4.4 (#907). */
export interface SportsTeamSearchResponse {
  readonly teams: readonly TeamRef[];
  readonly partial: boolean;
  readonly degraded: boolean;
}

export const sportsTeamSearchResponseSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["q"],
    properties: {
      q: { type: "string", minLength: 2, maxLength: 80 }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["teams", "partial", "degraded"],
      properties: {
        teams: { type: "array", items: teamRefSchema },
        partial: { type: "boolean" },
        degraded: { type: "boolean" }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
```

`packages/sports/src/sports-service.ts` — module-level constants near the other caps, then the method:

```ts
// Cross-league search fan-out bounds (#907 spec §4.4): per query, at most this many uncached
// league rosters are fetched live; leagues beyond the cap are skipped and reported via
// `partial` so the UI can hint that coverage is still warming. Repeated searches converge.
const SEARCH_WARM_FILL_CAP = 5;
const SEARCH_RESULT_CAP = 30;
```

```ts
/** Club search across all catalog leagues without an unbounded ESPN fan-out (#907 §4.4). */
async searchTeams(query: string): Promise<SportsTeamSearchResponse> {
  const state: DegradeState = { degraded: false };
  const q = query.trim().toLowerCase();
  const teams: TeamRef[] = [];
  let warmed = 0;
  let partial = false;
  // Sequential on purpose: warm-fill is a bounded, rate-courteous trickle, not a burst.
  for (const entry of SPORTS_CATALOG) {
    // Peek first (never fetches) — Task 1's cacheOnly option.
    const peek = await this.datasetClient.getDataset<SourceTeamRef[]>(
      "teams",
      { competitionKey: entry.competitionKey },
      { fallback: [], cacheOnly: true }
    );
    let roster: readonly SourceTeamRef[];
    if (peek.cacheMiss) {
      if (warmed >= SEARCH_WARM_FILL_CAP) {
        partial = true;
        continue;
      }
      warmed += 1;
      roster = await this.teamsFor(entry.competitionKey, state);
    } else {
      if (peek.degraded) state.degraded = true;
      roster = peek.data;
    }
    for (const team of roster) {
      // Team name/shortName only — league-label rows ("Follow all of…") stay client-side
      // against the cheap catalog list (spec §4.2).
      if (`${team.name} ${team.shortName}`.toLowerCase().includes(q)) teams.push(team);
    }
  }
  return { teams: teams.slice(0, SEARCH_RESULT_CAP), partial, degraded: state.degraded };
}
```

`packages/sports/src/routes.ts`:

```ts
server.get(
  "/api/sports/teams/search",
  { schema: sportsTeamSearchResponseSchema },
  async (request, reply) => {
    try {
      await dependencies.resolveAccessContext(request);
      const { q } = request.query as { q: string };
      return await service.searchTeams(q);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  }
);
```

`packages/sports/src/manifest.ts` `routes`:

```ts
{
  method: "GET",
  path: "/api/sports/teams/search",
  responseSchema: sportsTeamSearchResponseSchema,
  permissionId: "sports.view"
},
```

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run tests/unit/sports-routes.test.ts tests/unit/sports-manifest.test.ts`
- [ ] **Step 6: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/shared/src/sports-api.ts packages/sports/src/sports-service.ts packages/sports/src/routes.ts packages/sports/src/manifest.ts tests/unit/sports-routes.test.ts tests/unit/sports-manifest.test.ts
git commit -m "feat(sports): server-side club search with bounded warm-fill (#907)

New GET /api/sports/teams/search finds clubs across every catalog league
without an unbounded ESPN fan-out. Groundwork; picker switches over next.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Picker rework — server search + confederation browse + lazy chips

The picker (`packages/sports/src/settings/index.tsx`, currently search-only) switches to the new endpoints and gains a browse mode. After this task it no longer reads `catalog.competitions[].teams` at all, which is what makes Task 6's contract flip safe.

**Files:**

- Modify: `packages/sports/src/web/query-keys.ts`
- Modify: `packages/sports/src/settings/index.tsx` (full rework; 300 lines today)
- Modify: `packages/sports/src/settings/sports-2.css` (small additions for browse rows)
- Test: `tests/unit/settings-sports-pane.test.tsx` (rework)

**Interfaces:**

- Consumes: `GET /api/sports/leagues/:competitionKey/teams` (Task 3), `GET /api/sports/teams/search?q=` (Task 4), `Confederation` (Task 2).
- Produces (exported for tests): `leagueMatches(query, competitions: readonly CompetitionRef[])` (loosened type, logic unchanged), new `searchLeagueRows(query, resultTeams: readonly TeamRef[], competitions: readonly CompetitionRef[]): readonly CompetitionRef[]`, reworked `SearchResults` and new `BrowseGroups` components (both prop-driven, no internal fetching, so SSR string tests keep working). `filterTeams` and `searchLeagues` are **deleted** (server owns team matching now — no stale concepts).

- [ ] **Step 1: Add query keys** to `packages/sports/src/web/query-keys.ts`:

```ts
leagueTeams: (competitionKey: string) => ["sports", "league-teams", competitionKey] as const,
teamSearch: (query: string) => ["sports", "team-search", query] as const
```

- [ ] **Step 2: Rework the settings pane.** In `packages/sports/src/settings/index.tsx`:

Fetchers (next to the existing `getCatalog`/`getFollows`):

```ts
function getLeagueTeams(competitionKey: string) {
  return requestJson<SportsLeagueTeamsResponse>(
    `/api/sports/leagues/${encodeURIComponent(competitionKey)}/teams`
  );
}
function searchTeams(q: string) {
  return requestJson<SportsTeamSearchResponse>(
    `/api/sports/teams/search?q=${encodeURIComponent(q)}`
  );
}
```

Local debounce hook (no new deps):

```ts
/** Debounce the search box so each keystroke doesn't become a server query (#907). */
function useDebouncedValue(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
```

Helper changes: keep `leagueMatches` but type it over `readonly CompetitionRef[]` (drop the teams requirement — logic identical). Delete `filterTeams` and `searchLeagues`; add:

```ts
/** League rows for search results: catalog-label matches plus the parent league of every server
    result (so "arsenal" also offers "Follow all of Premier League"), deduped by key (#907). */
export function searchLeagueRows(
  query: string,
  resultTeams: readonly TeamRef[],
  competitions: readonly CompetitionRef[]
): readonly CompetitionRef[] {
  const byKey = new Map<string, CompetitionRef>();
  for (const competition of leagueMatches(query, competitions)) {
    byKey.set(competition.competitionKey, competition);
  }
  const compsByKey = new Map(competitions.map((c) => [c.competitionKey, c]));
  for (const team of resultTeams) {
    const competition = compsByKey.get(team.competitionKey);
    if (competition) byKey.set(competition.competitionKey, competition);
  }
  return [...byKey.values()];
}
```

`SearchResults` — same markup/classes (`sp-whole`, `sp-teamgrid`, `sp-team`, `PickCrest`), new props (results come from the server; league labels resolved via the catalog):

```ts
export function SearchResults(props: {
  query: string;
  results: readonly TeamRef[];
  partial: boolean;
  competitions: readonly CompetitionRef[];
  followsByKey: Map<string, SportsFollowDto>;
  onToggle: (competitionKey: string, teamKey: string | null) => void;
  pending: boolean;
}) {
  const leagues = searchLeagueRows(props.query, props.results, props.competitions);
  if (props.results.length === 0 && leagues.length === 0) {
    return props.partial ? (
      <Note>No matches yet — still covering more leagues. Try again in a moment.</Note>
    ) : (
      <Note>No teams or leagues match your search.</Note>
    );
  }
  // league rows: unchanged sp-whole buttons over `leagues`
  // team grid: unchanged sp-team buttons over `props.results` (team.competitionKey lives on TeamRef)
  // after the grid, when props.partial: <Note>Still covering more leagues…</Note>
}
```

New `BrowseGroups` — prop-driven (the roster query lives in `SportsSettings` so this stays SSR-testable). Order + labels:

```ts
const CONFEDERATION_ORDER: readonly Confederation[] = [
  "INTL", "UEFA", "CONCACAF", "CONMEBOL", "AFC", "CAF", "OFC"
];
const CONFEDERATION_LABELS: Record<Confederation, string> = {
  INTL: "US majors & global",
  UEFA: "Europe · UEFA",
  CONCACAF: "North & Central America · CONCACAF",
  CONMEBOL: "South America · CONMEBOL",
  AFC: "Asia · AFC",
  CAF: "Africa · CAF",
  OFC: "Oceania · OFC"
};

export function BrowseGroups(props: {
  competitions: readonly CompetitionRef[];
  followsByKey: Map<string, SportsFollowDto>;
  expandedKey: string | null;
  onExpand: (competitionKey: string | null) => void;
  expandedTeams: readonly TeamRef[];
  expandedLoading: boolean;
  expandedDegraded: boolean;
  onRetryExpanded: () => void;
  onToggle: (competitionKey: string, teamKey: string | null) => void;
  pending: boolean;
}) { ... }
```

Rendering: for each confederation in order with ≥1 league — a small heading (`sp-browse__conf`), then one row per league: an expand/collapse button (`sp-browse__league`, `aria-expanded`) showing the label, plus the existing `sp-whole`-style follow-all toggle. When `expandedKey` matches: loading → `<Note>Loading clubs…</Note>`; `expandedDegraded` → `<Note>Couldn't load this league's clubs. <button onClick={onRetryExpanded}>Retry</button></Note>`; else the `sp-teamgrid` of `expandedTeams` (identical team-button markup to `SearchResults`). Empty groups are skipped entirely.

`SportsSettings` body changes:

```ts
const debouncedQuery = useDebouncedValue(query);
const searchEnabled = debouncedQuery.length >= 2;
const searchQuery = useQuery({
  queryKey: sportsQueryKeys.teamSearch(debouncedQuery),
  queryFn: () => searchTeams(debouncedQuery),
  enabled: searchEnabled
});

const [expandedKey, setExpandedKey] = useState<string | null>(null);
const expandedQuery = useQuery({
  queryKey: sportsQueryKeys.leagueTeams(expandedKey ?? ""),
  queryFn: () => getLeagueTeams(expandedKey as string),
  enabled: expandedKey !== null
});

// Followed-team chips need club names/crests; the catalog no longer carries rosters after the
// contract flip, so resolve them via the same per-league roster endpoint (24h-cached,
// deduped with browse-expand by React Query key) — spec §4.3 (#907).
const followedTeamComps = [
  ...new Set(follows.filter((f) => f.teamKey !== null).map((f) => f.competitionKey))
];
const rosterQueries = useQueries({
  queries: followedTeamComps.map((key) => ({
    queryKey: sportsQueryKeys.leagueTeams(key),
    queryFn: () => getLeagueTeams(key)
  }))
});
const teamsByCompetition = new Map(
  followedTeamComps.map((key, i) => [key, rosterQueries[i]?.data?.teams ?? []])
);
```

Render: `searchEnabled` → `<SearchResults query={debouncedQuery} results={searchQuery.data?.teams ?? []} partial={searchQuery.data?.partial === true} …/>`; query length 1 → keep the existing hint Note; empty query → `<BrowseGroups …/>` (replaces the "Search above…" Note). `FollowedSummary` gains a `teamsByCompetition` prop and resolves `team` from it instead of `competition.teams.find(...)`; `competitionsByKey` becomes `Map<string, CompetitionRef>`. Imports: add `useEffect`, `useQueries` from react/`@tanstack/react-query`; add the new shared types. The `CompetitionWithTeams` local type is deleted (the pane never reads `catalog…teams` again). Keep the `catalogDegraded` retry Note as-is for now (removed in Task 6 when the field becomes always-false).

- [ ] **Step 3: CSS.** Append to `packages/sports/src/settings/sports-2.css`: `.sp-browse__conf` (mono eyebrow style — match the file's existing eyebrow/label pattern), `.sp-browse__league` (full-width row button, keyline-separated, `aria-expanded` styling), reusing existing color tokens only (no raw colors — tokens live in `apps/web/src/styles/tokens.css`).

- [ ] **Step 4: Rework tests** in `tests/unit/settings-sports-pane.test.tsx` (keep the seed-the-QueryClient + `renderToString` harness):
  - Update imports: `searchLeagueRows`, `BrowseGroups` in; `filterTeams`, `searchLeagues` out.
  - Catalog seeds keep working (extra `teams` on seeded competitions is ignored by TS via cast; add `confederation` to `CompetitionLite` and every fixture entry — e.g. `nfl` → `"INTL"`, `epl` → `"UEFA"`).
  - Flip the empty-query test: it now asserts browse groups render (`US majors & global`, `Europe · UEFA` present; the old "Search above" hint gone).
  - `SearchResults` tests pass `results` (a `TeamRef[]`) instead of relying on `filterTeams`; is-active coverage (#691) keeps its assertions.
  - New pure-function tests for `searchLeagueRows` (label match + parent-league derivation + dedupe).
  - New `BrowseGroups` render test: expandedKey set + `expandedTeams` seeded → team buttons render; `expandedDegraded` → retry Note.
  - Chip test: seed `sportsQueryKeys.leagueTeams("nfl")` with `{ teams: […dal…], degraded: false }` so the followed-chip resolves "DAL".

- [ ] **Step 5: Run — expect PASS:** `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
- [ ] **Step 6: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/sports/src/web/query-keys.ts packages/sports/src/settings/index.tsx packages/sports/src/settings/sports-2.css tests/unit/settings-sports-pane.test.tsx
git commit -m "feat(sports): follow picker — browse leagues by region, server-side club search (#907)

The sports follow picker now shows leagues grouped by confederation when the
search box is empty, loads a league's clubs only when you expand it, and
searches clubs server-side across every league.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Contract flip — catalog drops rosters (the fan-out dies)

Nothing reads `catalog…teams` after Task 5, so this is now a safe breaking change with exactly one contract surface.

**Files:**

- Modify: `packages/shared/src/sports-api.ts` (`SportsCatalogResponse` ~line 203, `sportsCatalogResponseSchema` ~line 576)
- Modify: `packages/sports/src/sports-service.ts` (`getCatalog`, lines 141–162)
- Modify: `packages/sports/src/settings/index.tsx` (drop the now-dead `catalogDegraded` retry Note)
- Test: `tests/unit/sports-routes.test.ts` (catalog test), `tests/unit/settings-sports-pane.test.tsx` (drop `teams` from seeds), `tests/unit/web-sports-client.test.ts` (verify only — it asserts URLs, not shapes)

**Interfaces:**

- Produces: `SportsCatalogResponse { competitions: readonly CompetitionRef[]; degraded: boolean }` — `degraded` kept for wire stability, now always `false`.

- [ ] **Step 1: Rewrite the catalog route test** in `tests/unit/sports-routes.test.ts`, replacing `"GET /api/sports/catalog returns competitions with teams"`:

```ts
it("GET /api/sports/catalog returns leagues only — zero ESPN roster calls (#907)", async () => {
  let teamsCalls = 0;
  const { app } = buildApp({
    datasetClient: makeDatasetClient({
      listTeams: async () => {
        teamsCalls++;
        return [];
      }
    })
  });
  await app.ready();
  const res = await app.inject({ method: "GET", url: "/api/sports/catalog" });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.competitions.map((c: { competitionKey: string }) => c.competitionKey)).toContain(
    "nfl"
  );
  expect(body.competitions[0].confederation).toBeDefined();
  // The wall this spec removes: catalog must not fan out to ESPN per league (#907 §3).
  expect(teamsCalls).toBe(0);
  expect(res.body).not.toContain('"teams"');
  await app.close();
});
```

- [ ] **Step 2: Run — expect FAIL** (`teamsCalls` = 8, `"teams"` on the wire): `pnpm vitest run tests/unit/sports-routes.test.ts`
- [ ] **Step 3: Implement.** `packages/shared/src/sports-api.ts`:

```ts
export interface SportsCatalogResponse {
  readonly competitions: readonly CompetitionRef[];
  // Kept for wire stability; static catalog data can no longer degrade (#907).
  readonly degraded: boolean;
}
```

`sportsCatalogResponseSchema` items become `competitionRefSchema` directly (delete the inline object that spread `competitionRefSchema.properties` and added `teams`).

`packages/sports/src/sports-service.ts` — replace `getCatalog` wholesale:

```ts
/** League metadata for the follow picker — static catalog data, no ESPN calls. Rosters are
 *  served lazily by getLeagueTeams/searchTeams instead (#907 §4.2). */
async getCatalog(): Promise<SportsCatalogResponse> {
  const competitions = SPORTS_CATALOG.map((entry) => ({
    competitionKey: entry.competitionKey,
    label: entry.label,
    kind: entry.kind,
    marquee: entry.marquee,
    standingsShape: entry.standingsShape,
    confederation: entry.confederation
  }));
  return { competitions, degraded: false };
}
```

`packages/sports/src/settings/index.tsx`: delete the `catalogDegraded` const and its retry `<Note>` block (dead once the field is always false — no stale concepts).

- [ ] **Step 4: Fix seeds** in `tests/unit/settings-sports-pane.test.tsx` (drop `teams` from `CompetitionLite` and fixtures) and confirm `tests/unit/web-sports-client.test.ts` still passes untouched.
- [ ] **Step 5: Run the full unit suite — expect PASS:** `pnpm vitest run tests/unit`
- [ ] **Step 6: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/shared/src/sports-api.ts packages/sports/src/sports-service.ts packages/sports/src/settings/index.tsx tests/unit/sports-routes.test.ts tests/unit/settings-sports-pane.test.tsx
git commit -m "feat(sports): catalog is leagues-only — picker opens without ESPN fan-out (#907)

Opening the sports follow picker no longer fires one ESPN request per league;
league lists are instant and club rosters load only when needed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Slice 1 checkpoint (manual):** with dev servers up (`--host`), open Settings → Sports: browse groups render instantly, expanding a league loads its clubs, searching "arsenal" returns Arsenal, follow/unfollow works, followed chips still show names/crests. Network tab shows zero `/teams` calls on pane open.

---

### Task 7: Probe script (`scripts/probe-espn-leagues.mjs`)

**Files:**

- Create: `scripts/probe-espn-leagues.mjs`
- Test: manual run (deliberately NOT wired into CI/verify — live-network flake must not poison unrelated builds; spec §4.6)

**Interfaces:**

- Produces: a CLI that turns candidate slugs into paste-ready `CatalogEntry` rows. Tasks 8–10 consume its output.

- [ ] **Step 1: Write the script:**

```js
#!/usr/bin/env node
/**
 * Probe ESPN soccer league slugs and emit verified CatalogEntry seed rows (#907 spec §4.6).
 *
 * ESPN's `{iso3}.{tier}` slug convention is NOT universal (sau.1 fails, ksa.1 works; kor.1/
 * egy.1/mar.1/nzl.1 all fail), so every slug must be probed before it lands in SPORTS_CATALOG.
 * Deliberately a manual dev script, not a CI gate — live network calls would flake builds.
 *
 * Usage:
 *   node scripts/probe-espn-leagues.mjs eng.2 eng.3 ksa.1
 *   node scripts/probe-espn-leagues.mjs --file candidates.txt   # one slug per line, # comments
 *
 * Exit 1 if any candidate fails, so a copy-paste of failures is impossible to miss.
 */
const SITE_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const DELAY_MS = 250; // rate courtesy — sequential, never a burst

async function readCandidates() {
  const args = process.argv.slice(2);
  if (args[0] === "--file") {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(args[1], "utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  }
  return args;
}

function tsQuote(value) {
  return JSON.stringify(value);
}

const slugs = await readCandidates();
if (slugs.length === 0) {
  console.error("No candidate slugs. Usage: node scripts/probe-espn-leagues.mjs eng.2 ksa.1 …");
  process.exit(1);
}

const verified = [];
const failed = [];
for (const slug of slugs) {
  await new Promise((r) => setTimeout(r, DELAY_MS));
  try {
    const res = await fetch(`${SITE_BASE}/${slug}/teams`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const league = json?.sports?.[0]?.leagues?.[0];
    const teams = league?.teams ?? [];
    if (!league || teams.length === 0) throw new Error("empty roster");
    verified.push({ slug, id: league.id, name: league.name, teamCount: teams.length });
    console.log(`OK   ${slug}  id=${league.id}  teams=${teams.length}  ${league.name}`);
  } catch (error) {
    failed.push({ slug, reason: String(error.message ?? error) });
    console.log(`FAIL ${slug}  ${String(error.message ?? error)}`);
  }
}

console.log("\n// --- paste-ready CatalogEntry rows (fill confederation per spec Appendix A) ---");
for (const v of verified) {
  console.log(`  {
    competitionKey: ${tsQuote(v.slug)},
    label: ${tsQuote(v.name)},
    kind: "league",
    marquee: false,
    standingsShape: "table",
    espnSport: "soccer",
    espnLeague: ${tsQuote(v.slug)},
    confederation: "TODO"
  },`);
}
if (failed.length > 0) {
  console.error(`\n${failed.length} candidate(s) FAILED: ${failed.map((f) => f.slug).join(", ")}`);
  process.exit(1);
}
```

- [ ] **Step 2: Verify manually** (network required):

Run: `node scripts/probe-espn-leagues.mjs eng.2 ksa.1 sau.1`
Expected: `OK` rows for `eng.2` (id 3914, 24 teams) and `ksa.1` (id 21231, 18 teams); `FAIL sau.1`; exit code 1 (because of the deliberate `sau.1` failure).

- [ ] **Step 3: Gate + commit:**

```bash
pnpm verify:foundation
git add scripts/probe-espn-leagues.mjs
git commit -m "feat(sports): ESPN league slug probe script (#907)

Dev tool that verifies candidate league slugs against ESPN before they enter
the sports catalog. Not user-visible.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Slice 2 — full English pyramid (`eng.2`–`eng.5`)

**Files:**

- Modify: `packages/sports/src/source/catalog.ts` (4 new entries after `eng.1`)
- Test: `tests/unit/sports-catalog.test.ts`

**Interfaces:** consumes Task 2's `confederation` field and Task 7's probe output. Data only.

- [ ] **Step 1: Update the failing test first.** In `tests/unit/sports-catalog.test.ts`, replace the `"covers the eight approved competitions"` expectation:

```ts
it("covers the approved competitions (#907 slice 2: English pyramid)", () => {
  expect(SPORTS_CATALOG.map((c) => c.competitionKey).sort()).toEqual(
    [
      "eng.1",
      "eng.2",
      "eng.3",
      "eng.4",
      "eng.5",
      "fifa.world",
      "mlb",
      "nba",
      "nfl",
      "nhl",
      "uefa.champions",
      "usa.1"
    ].sort()
  );
});

it("gives England its full pyramid, all UEFA table leagues (#907)", () => {
  for (const key of ["eng.2", "eng.3", "eng.4", "eng.5"]) {
    const entry = catalogEntry(key);
    expect(entry?.confederation).toBe("UEFA");
    expect(entry?.standingsShape).toBe("table");
    expect(entry?.espnSport).toBe("soccer");
  }
});
```

- [ ] **Step 2: Run — expect FAIL**, then run the probe to confirm the rows live: `node scripts/probe-espn-leagues.mjs eng.2 eng.3 eng.4 eng.5` (expected: all OK — ids 3914/3915/3916/3917, 24 teams each; paste the probe output into the PR description).
- [ ] **Step 3: Add the entries** to `SPORTS_CATALOG` (labels: `"EFL Championship"`, `"EFL League One"`, `"EFL League Two"`, `"National League"`; all `kind: "league"`, `marquee: false`, `standingsShape: "table"`, `espnSport: "soccer"`, `espnLeague` = slug, `confederation: "UEFA"`).
- [ ] **Step 4: Run full unit suite — expect PASS:** `pnpm vitest run tests/unit`
- [ ] **Step 5: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/sports/src/source/catalog.ts tests/unit/sports-catalog.test.ts
git commit -m "feat(sports): full English football pyramid is followable (#907)

Championship, League One, League Two, and the National League join the
Premier League — follow any English club down to the fifth tier.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Slice 3 — Americas + UEFA top flights

**Files:**

- Modify: `packages/sports/src/source/catalog.ts`
- Test: `tests/unit/sports-catalog.test.ts`

**Interfaces:** data only. All slugs below are already probe-verified (spec §4.6 table) — re-run the probe anyway and paste its output into the PR.

- [ ] **Step 1: Probe:** `node scripts/probe-espn-leagues.mjs esp.1 ger.1 ita.1 fra.1 ned.1 por.1 sco.1 tur.1 bel.1 gre.1 sui.1 aut.1 den.1 mex.1 crc.1 bra.1 arg.1 col.1 chi.1 uru.1` — expected all OK (`ita.1`/`fra.1` were not individually probed during spec review; if either fails, drop it here and chase alternates in Task 10).
- [ ] **Step 2: Update the catalog test expectation first** (the full sorted key list grows to ~32; also assert confederation spot-checks):

```ts
expect(catalogEntry("bra.1")?.confederation).toBe("CONMEBOL");
expect(catalogEntry("mex.1")?.confederation).toBe("CONCACAF");
expect(catalogEntry("esp.1")?.confederation).toBe("UEFA");
```

- [ ] **Step 3: Add entries** from the probe's paste-ready rows. Confederations: UEFA — esp/ger/ita/fra/ned/por/sco/tur/bel/gre/sui/aut/den; CONCACAF — mex, crc; CONMEBOL — bra, arg, col, chi, uru. Prefer ESPN's own display names as labels (probe emits them), shortened where obviously verbose (e.g. "Spanish LaLiga" → "LaLiga").
- [ ] **Step 4: Run full unit suite — expect PASS**, and check the file-size gate: `pnpm vitest run tests/unit && pnpm check:file-size` (if `catalog.ts` were ever to near 1000 lines, split rows into `packages/sports/src/source/catalog-data.ts` re-exported from `catalog.ts`).
- [ ] **Step 5: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/sports/src/source/catalog.ts tests/unit/sports-catalog.test.ts
git commit -m "feat(sports): follow clubs across Europe and the Americas (#907)

LaLiga, Bundesliga, Serie A, Ligue 1, Liga MX, Brasileirão, Argentina and a
dozen more top flights are now followable, grouped by region in the picker.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Slice 4 — AFC, CAF, OFC + alt-slug chase

**Files:**

- Modify: `packages/sports/src/source/catalog.ts`
- Test: `tests/unit/sports-catalog.test.ts`

**Interfaces:** data only.

- [ ] **Step 1: Probe the verified set:** `node scripts/probe-espn-leagues.mjs jpn.1 ksa.1 chn.1 aus.1 rsa.1` — expected all OK.
- [ ] **Step 2: Chase alternates for the known-failing slugs** (`kor.1`, `egy.1`, `mar.1`, `nzl.1` — spec §4.6): probe candidate alternates (e.g. different iso codes or tier suffixes; check the slugs ESPN's own soccer index pages use). Also probe remaining Appendix A candidates: `ecu.1 par.1 per.1 bol.1 ven.1 hon.1 gua.1 slv.1 pan.1 uae.1 qat.1 irn.1 tha.1 alg.1 tun.1`. **Drop anything that fails** — a league ESPN doesn't serve cannot be in the catalog; list the dropped leagues in the PR description so the gap is explicit, per the spec's no-silent-caps rule.
- [ ] **Step 3: Update the catalog test key list first** (exact final list = whatever survived probing), plus:

```ts
expect(catalogEntry("jpn.1")?.confederation).toBe("AFC");
expect(catalogEntry("rsa.1")?.confederation).toBe("CAF");
expect(catalogEntry("ksa.1")).toBeDefined(); // the sau.1 trap — spec §4.6
```

- [ ] **Step 4: Add the surviving entries** (AFC — jpn, ksa, chn, aus, + survivors; CAF — rsa + survivors; OFC — only if anything probes OK). Run: `pnpm vitest run tests/unit && pnpm check:file-size`
- [ ] **Step 5: Gate + commit:**

```bash
pnpm verify:foundation
git add packages/sports/src/source/catalog.ts tests/unit/sports-catalog.test.ts
git commit -m "feat(sports): Asian and African top flights join the follow picker (#907)

J.League, Saudi Pro League, Chinese Super League, A-League and more — every
confederation with ESPN coverage is now browsable and followable.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (before PR)

- [ ] `pnpm verify:foundation` — full gate green, record exit code.
- [ ] Manual pass over LAN (`--host` dev servers): picker browse across confederations, expand several leagues, search a lower-league English club ("wrexham") and a CONMEBOL club, follow one, see it on /sports overview; both themes.
- [ ] Confirm zero `/teams` requests on picker open (browser network tab).
- [ ] PR to `main` titled `feat(sports): follow clubs across all federations + full English pyramid (#907)`, body includes probe outputs, the dropped-league list, a user-facing "What's new" summary, and `Closes #907`. End body with the standard generated-with footer.
