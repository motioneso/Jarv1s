# Sports Module (page-first, loader-ready) — Implementation Plan

> **For agentic workers:** This repo's superpowers execution skills are **disabled by design**. Do
> not use `subagent-driven-development` / `executing-plans`. Execute with the project's build engine
> (background Workflow or inline Agent dispatch) per the `/start` build-engine heuristic. Steps use
> checkbox (`- [ ]`) syntax for tracking. Build agents run on **Sonnet**; each task commits green with
> the `Co-Authored-By: Claude` trailer; `git add` only that task's files.

**Spec:** `docs/superpowers/specs/2026-06-30-sports-module.md` (approved). **Issue:** #656 · Part of
#216 · Milestone 16.

**Goal:** Ship `@jarv1s/sports` — a page-first, loader-ready Jarvis module: a `/sports` page showing
the user's followed teams highlighted (latest result + next game) with general scores, headlines, and
standings below (useful any day), backed by ESPN's unofficial JSON behind a swappable `SportsSource`
adapter + in-memory TTL cache, with per-user private follows (owner-only RLS) and a briefing hook.

**Architecture:** Copy the **weather** module's external-fetch shape (adapter + injectable `fetchFn` +
in-memory `SportsCache`, no cache table, no worker) for public sports data, and the **wellness**
module's owner-only-RLS + manifest-surface shape for the one private table (`app.sports_follows`). The
module contributes through its **manifest only**; every forced composition-root hand-wire is tagged
`// LOADER-SEAM(sports):` and enumerated in the README. The briefing hook is realized as one
`risk:"read"` assistant tool (`sports.followedFactsToday`) plus three hardcoded edits to
`packages/briefings/src/compose.ts` — the platform's only briefing-contribution mechanism.

**Tech Stack:** TypeScript (ESM), Fastify 5, Kysely + branded `DataContextDb`, `@jarv1s/module-sdk`
manifest contract, `@tanstack/react-query` + authored `jds-*`/`sp-*` CSS on the web, Vitest.

## Global Constraints

_Every task's requirements implicitly include this section. Values copied verbatim from the spec +
CLAUDE.md Hard Invariants._

- **Private by default / RLS everywhere.** `app.sports_follows` is **owner-only**: `ENABLE`+`FORCE ROW
LEVEL SECURITY`, four policies (select/insert/update/delete) all `USING`/`WITH CHECK (owner_user_id =
app.current_actor_user_id())`, granted to `jarvis_app_runtime`. No admin bypass, no `BYPASSRLS`.
- **DataContextDb only.** All repository/route I/O flows through `dataContext.withDataContext(...)`;
  repositories call `assertDataContextDb(scopedDb)` first. Never a root Kysely handle, never raw `fs`.
- **AccessContext shape.** `{ actorUserId, requestId }` only. Do not add fields.
- **Secrets never escape.** ESPN needs no key. No secrets in this module. (A future keyed source would
  be AES-256-GCM at rest, never to frontend/logs/job payloads/exports/AI prompts.)
- **Never edit applied migrations.** New `sql/` file only, in `packages/sports/sql/`. Migration number
  is **global-by-landing-order**; local high-water is **0129**, so this plan uses **0130**. **VERIFY at
  build time** (Task 3) and bump if origin landed a higher number.
- **Module isolation.** Contribute only via the manifest + declared public API. No importing another
  module's internals, no querying another module's tables.
- **Shared bundle is browser-safe.** `packages/shared/src/sports-api.ts` must have **no `node:*`
  imports** (Vite-bundled). DTO interfaces + `as const` JSON schemas only.
- **Design system.** Extend authored `jds-*`; raw colors only in `apps/web/src/styles/tokens.css`;
  **result colors NEVER red** (win=`--pine-*`, draw=`--steel-*`, loss=neutral); **no curved colored
  left-border card accent** (highlight = `--pine-soft` fill + full border + `--radius-card`); authored
  empty/loading states; live pulse respects `prefers-reduced-motion`; page CSS files **< 1000 lines**
  (split + preserve import order).
- **Provider-agnostic data.** The data source is reached only through the `SportsSource` interface; no
  route/service/manifest hardcodes ESPN. The concrete source is constructed in the composition root.
- **Green per commit.** Run the relevant gate before each commit. Final gate: `pnpm verify:foundation`
  - `pnpm audit:release-hardening`, verified directly (not by agent self-report).

## Coordination note

Another session may be building on this shared tree (issues #629/#642/#650/#651/#659). **Stage only
this module's explicit paths** — never `git add -A`/`.`. Do not `checkout`/`stash`/`reset` the tree
while another build is mid-run. Branch off `main` only when the tree is clean.

## File Structure

**New package `packages/sports/`:**

| File                             | Responsibility                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `package.json`                   | `@jarv1s/sports`; deps + `./` and `./settings` exports                           |
| `tsconfig.json`                  | extends repo base (mirror `packages/weather/tsconfig.json`)                      |
| `sql/0130_sports_follows.sql`    | owner-only table + RLS + grant                                                   |
| `src/index.ts`                   | public exports (manifest, id, `registerSportsRoutes`, sql dir, briefing execute) |
| `src/manifest.ts`                | `JarvisModuleManifest` + `sqlMigrationDirectory` export                          |
| `src/source/sports-source.ts`    | `SportsSource` interface + shared source types                                   |
| `src/source/catalog.ts`          | `competition_key` → ESPN `{sport, league}` + league/tournament flag              |
| `src/source/espn-source.ts`      | ESPN impl, `fetchFn`-injectable                                                  |
| `src/source/__fixtures__/*.json` | recorded ESPN responses for tests                                                |
| `src/sports-cache.ts`            | in-memory TTL cache (copy of `WeatherCache`)                                     |
| `src/repository.ts`              | `sports_follows` CRUD via `DataContextDb`                                        |
| `src/sports-service.ts`          | compose `/overview` + rationale + briefing facts                                 |
| `src/briefing-tool.ts`           | `sports.followedFactsToday` assistant-tool `execute`                             |
| `src/routes.ts`                  | `registerSportsRoutes(server, deps)`                                             |
| `src/settings/index.tsx`         | follow-picker settings pane (default export)                                     |
| `README.md`                      | the 6 loader-seams, greppable                                                    |

**Shared + core edits (LOADER-SEAMs):**

| File                                                  | Edit                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/shared/src/sports-api.ts` (new)             | DTOs + route schemas                                                    |
| `packages/shared/src/index.ts`                        | re-export `./sports-api.js`                                             |
| `packages/module-registry/src/index.ts`               | `BUILT_IN_MODULES` entry (SEAM 1+2)                                     |
| `packages/briefings/src/compose.ts`                   | `gatherToolSection` + `sections.push` + trust-boundary channel (SEAM 3) |
| `packages/briefings/src/routes.ts`                    | add tool to `defaultToolNamesFor` (SEAM 3)                              |
| `tests/integration/foundation.test.ts`                | append `0130` migration row (SEAM 6)                                    |
| `apps/web/src/app-route-metadata.ts`                  | `sports` id + `webRoutes` entry + `SECTION_OF` (SEAM 4)                 |
| `apps/web/src/app.tsx`                                | lazy import + `<Route>` (SEAM 4)                                        |
| `apps/web/src/api/query-keys.ts`                      | `sports` key block                                                      |
| `apps/web/src/api/sports-client.ts` (new)             | typed fetch wrappers                                                    |
| `apps/web/src/sports/*` (new)                         | `sports-page.tsx` + subcomponents                                       |
| `apps/web/src/styles/sports-1.css` (+ `-2` if needed) | ported `sp-*` design language (SEAM 5 is shared-api; CSS is web)        |

---

## Task 1: Package scaffold + shared contract file

**Files:**

- Create: `packages/sports/package.json`
- Create: `packages/sports/tsconfig.json`
- Create: `packages/sports/src/index.ts` (temporary stub)
- Create: `packages/shared/src/sports-api.ts`
- Modify: `packages/shared/src/index.ts` (add one re-export line)
- Test: `packages/sports/src/__tests__/scaffold.test.ts`

**Interfaces:**

- Produces: the `@jarv1s/sports` package resolvable by pnpm; all DTOs/schemas below, consumed by every
  later task and by the frontend.

DTO/type contract (produced by `sports-api.ts`, consumed everywhere):

```ts
// packages/shared/src/sports-api.ts — BROWSER-SAFE. No node:* imports.
export type IsoDate = string; // "YYYY-MM-DD"

export interface TeamRef {
  readonly teamKey: string; // stable within a competition, e.g. "dal" or ESPN team id
  readonly competitionKey: string;
  readonly name: string;
  readonly shortName: string;
  readonly crestUrl: string | null;
}

export interface GameSummary {
  readonly id: string;
  readonly competitionKey: string;
  readonly startsAt: string; // ISO instant
  readonly state: "pre" | "live" | "final";
  readonly statusDetail: string; // "7:20 PM", "Q3 4:12", "FT"
  readonly home: GameSide;
  readonly away: GameSide;
}
export interface GameSide {
  readonly teamKey: string;
  readonly name: string;
  readonly shortName: string;
  readonly crestUrl: string | null;
  readonly score: number | null; // null pre-game
  readonly record: string | null; // "10-2"
  readonly winner: boolean;
}

export interface StandingsRow {
  readonly teamKey: string;
  readonly name: string;
  readonly rank: number;
  readonly points: number | null; // soccer
  readonly wins: number;
  readonly losses: number;
  readonly draws: number | null;
  readonly qualifies: boolean; // advancement/qualification marker
}

export interface Headline {
  readonly id: string;
  readonly competitionKey: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
}

export interface CompetitionRef {
  readonly competitionKey: string;
  readonly label: string; // "NFL", "Premier League"
  readonly kind: "league" | "tournament";
  readonly marquee: boolean; // World Cup flag
}

export interface SportsFollowDto {
  readonly id: string;
  readonly competitionKey: string;
  readonly teamKey: string | null; // null = whole competition
  readonly createdAt: string;
}

// Composed page (GET /api/sports/overview)
export type OverviewHero =
  | {
      readonly mode: "gameday";
      readonly game: GameSummary;
      readonly rationale: string;
      readonly alsoToday: string | null;
    }
  | { readonly mode: "story"; readonly headline: Headline | null };

export interface FollowedTeamCard {
  readonly teamKey: string;
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly name: string;
  readonly crestUrl: string | null;
  readonly status: "live" | "today" | "news";
  readonly primary: string; // "MIN 21 – 14 DAL", "W 4–2 vs NYR", or a headline title
  readonly form: readonly ("W" | "D" | "L")[];
  readonly standing: string | null;
  readonly nextMatch: string | null;
  readonly rationale: string;
}

export interface ScoreboardGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly games: readonly GameSummary[];
}
export interface StandingsGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly rows: readonly StandingsRow[];
}

export interface SportsOverviewResponse {
  readonly hero: OverviewHero;
  readonly followed: readonly FollowedTeamCard[];
  readonly scoreboard: readonly ScoreboardGroup[];
  readonly headlines: readonly Headline[];
  readonly standings: readonly StandingsGroup[];
  readonly followedTeamKeys: readonly string[]; // for is-you marking on the client
  readonly degraded: boolean; // source failed → cached/empty
}

export interface SportsCatalogResponse {
  readonly competitions: readonly (CompetitionRef & { readonly teams: readonly TeamRef[] })[];
}
export interface SportsFollowsResponse {
  readonly follows: readonly SportsFollowDto[];
}
export interface CreateSportsFollowRequest {
  readonly competitionKey: string;
  readonly teamKey?: string | null;
}
```

Route JSON schemas (Fastify) — mirror `weather-api.ts` shape (`as const`, `additionalProperties:
false`, response `200` + `errorResponseSchema`). Provide one `as const` schema per route:
`sportsCatalogResponseSchema`, `sportsFollowsResponseSchema`, `createSportsFollowRequestSchema`,
`createSportsFollowResponseSchema` (a single follow), `deleteSportsFollowResponseSchema` (`{ ok:
boolean }`), `sportsOverviewResponseSchema`. Import `errorResponseSchema` from the same
`./schema-fragments.js` weather uses. **Read `packages/shared/src/weather-api.ts` first** and copy its
exact schema-object style.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sports/src/__tests__/scaffold.test.ts
import { describe, expect, it } from "vitest";
import { SPORTS_MODULE_ID } from "../index.js";
import type { SportsOverviewResponse } from "@jarv1s/shared";

describe("sports scaffold", () => {
  it("exposes the module id", () => {
    expect(SPORTS_MODULE_ID).toBe("sports");
  });
  it("shared overview type is importable", () => {
    const empty: SportsOverviewResponse = {
      hero: { mode: "story", headline: null },
      followed: [],
      scoreboard: [],
      headlines: [],
      standings: [],
      followedTeamKeys: [],
      degraded: false
    };
    expect(empty.degraded).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @jarv1s/sports test`
Expected: FAIL — `@jarv1s/sports` unresolved / `SPORTS_MODULE_ID` not exported.

- [ ] **Step 3: Create scaffold**

`packages/sports/package.json` (mirror `packages/weather/package.json` — read it first for exact
versions):

```json
{
  "name": "@jarv1s/sports",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./settings": "./src/settings/index.tsx"
  },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@jarv1s/db": "workspace:*",
    "@jarv1s/module-sdk": "workspace:*",
    "@jarv1s/shared": "workspace:*",
    "@jarv1s/structured-state": "workspace:*",
    "fastify": "^5.6.2",
    "kysely": "catalog:"
  },
  "devDependencies": { "vitest": "catalog:" }
}
```

Copy `packages/weather/tsconfig.json` verbatim to `packages/sports/tsconfig.json`. Add the
`packages/shared/src/sports-api.ts` file (all types + schemas above). Append to
`packages/shared/src/index.ts`:

```ts
export * from "./sports-api.js";
```

`packages/sports/src/index.ts` (stub — replaced in Task 13):

```ts
export const SPORTS_MODULE_ID = "sports";
```

- [ ] **Step 4: Install + verify pass**

Run: `pnpm install && pnpm --filter @jarv1s/sports test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/package.json packages/sports/tsconfig.json packages/sports/src/index.ts \
        packages/sports/src/__tests__/scaffold.test.ts packages/shared/src/sports-api.ts \
        packages/shared/src/index.ts pnpm-lock.yaml
git commit -m "feat(sports): package scaffold + shared REST contracts"
```

---

## Task 2: Competition catalog

**Files:**

- Create: `packages/sports/src/source/catalog.ts`
- Test: `packages/sports/src/source/__tests__/catalog.test.ts`

**Interfaces:**

- Produces: `SPORTS_CATALOG: readonly CatalogEntry[]`, `catalogEntry(competitionKey): CatalogEntry |
undefined`, `type CatalogEntry = { competitionKey; label; kind; marquee; espnSport; espnLeague }`.
- Consumes: `CompetitionRef` from `@jarv1s/shared`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sports/src/source/__tests__/catalog.test.ts
import { describe, expect, it } from "vitest";
import { SPORTS_CATALOG, catalogEntry } from "../catalog.js";

describe("sports catalog", () => {
  it("covers the eight approved competitions", () => {
    expect(SPORTS_CATALOG.map((c) => c.competitionKey).sort()).toEqual(
      ["eng.1", "fifa.world", "mlb", "nba", "nfl", "nhl", "uefa.champions", "usa.1"].sort()
    );
  });
  it("maps nfl to ESPN football/nfl as a league", () => {
    const e = catalogEntry("nfl");
    expect(e?.espnSport).toBe("football");
    expect(e?.espnLeague).toBe("nfl");
    expect(e?.kind).toBe("league");
  });
  it("flags the World Cup as a marquee tournament", () => {
    const e = catalogEntry("fifa.world");
    expect(e?.kind).toBe("tournament");
    expect(e?.marquee).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @jarv1s/sports test catalog` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/sports/src/source/catalog.ts
export interface CatalogEntry {
  readonly competitionKey: string;
  readonly label: string;
  readonly kind: "league" | "tournament";
  readonly marquee: boolean;
  readonly espnSport: string;
  readonly espnLeague: string;
}

export const SPORTS_CATALOG: readonly CatalogEntry[] = [
  {
    competitionKey: "nfl",
    label: "NFL",
    kind: "league",
    marquee: false,
    espnSport: "football",
    espnLeague: "nfl"
  },
  {
    competitionKey: "nba",
    label: "NBA",
    kind: "league",
    marquee: false,
    espnSport: "basketball",
    espnLeague: "nba"
  },
  {
    competitionKey: "nhl",
    label: "NHL",
    kind: "league",
    marquee: false,
    espnSport: "hockey",
    espnLeague: "nhl"
  },
  {
    competitionKey: "mlb",
    label: "MLB",
    kind: "league",
    marquee: false,
    espnSport: "baseball",
    espnLeague: "mlb"
  },
  {
    competitionKey: "eng.1",
    label: "Premier League",
    kind: "league",
    marquee: false,
    espnSport: "soccer",
    espnLeague: "eng.1"
  },
  {
    competitionKey: "usa.1",
    label: "MLS",
    kind: "league",
    marquee: false,
    espnSport: "soccer",
    espnLeague: "usa.1"
  },
  {
    competitionKey: "uefa.champions",
    label: "Champions League",
    kind: "tournament",
    marquee: false,
    espnSport: "soccer",
    espnLeague: "uefa.champions"
  },
  {
    competitionKey: "fifa.world",
    label: "FIFA World Cup",
    kind: "tournament",
    marquee: true,
    espnSport: "soccer",
    espnLeague: "fifa.world"
  }
];

const BY_KEY = new Map(SPORTS_CATALOG.map((e) => [e.competitionKey, e]));
export function catalogEntry(competitionKey: string): CatalogEntry | undefined {
  return BY_KEY.get(competitionKey);
}
```

- [ ] **Step 4: Verify pass** — `pnpm --filter @jarv1s/sports test catalog` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/source/catalog.ts packages/sports/src/source/__tests__/catalog.test.ts
git commit -m "feat(sports): competition catalog (US-4 + soccer + World Cup)"
```

---

## Task 3: Migration `0130_sports_follows` + foundation test row

**Files:**

- Create: `packages/sports/sql/0130_sports_follows.sql`
- Modify: `tests/integration/foundation.test.ts:302` (append row after `0129`)
- Test: the existing `tests/integration/foundation.test.ts` migration-list assertion + a new
  owner-isolation integration test `packages/sports/src/__tests__/follows-rls.itest.ts` is deferred to
  Task 6's repository test (which runs under the real DB). Here we assert the migration list.

> **VERIFY NUMBER FIRST.** Run
> `ls packages/*/sql infra/postgres/migrations 2>/dev/null | grep -oE '^[0-9]{4}' | sort -n | tail -1`.
> If the result is `≥ 0130`, this migration and every `0130` reference below (filename,
> `foundation.test.ts` row, `manifest.migrations`) must be bumped to `max+1`.

**Interfaces:**

- Produces: table `app.sports_follows` with owner-only RLS, granted to `jarvis_app_runtime`.

- [ ] **Step 1: Write the failing test** — append to the `toEqual([...])` list in
      `tests/integration/foundation.test.ts` (after the `0129` entry at line 302):

```ts
        { version: "0129", name: "0129_yolo_action_audit_mode.sql" },
        { version: "0130", name: "0130_sports_follows.sql" }
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:integration -- foundation` (or the repo's integration runner).
Expected: FAIL — DB has no `0130` migration; asserted list ≠ applied list.

- [ ] **Step 3: Create the migration** (copy the pattern from
      `packages/wellness/sql/0082_wellness_checkins.sql`):

```sql
-- packages/sports/sql/0130_sports_follows.sql
-- Owner-only, user-private follow list. RLS classification: owner-only (== wellness_checkins).
CREATE TABLE app.sports_follows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  competition_key text NOT NULL,
  team_key        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, competition_key, team_key)
);

CREATE INDEX sports_follows_owner_idx
  ON app.sports_follows (owner_user_id, created_at DESC);

ALTER TABLE app.sports_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sports_follows FORCE ROW LEVEL SECURITY;

CREATE POLICY sports_follows_select ON app.sports_follows
  FOR SELECT TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());
CREATE POLICY sports_follows_insert ON app.sports_follows
  FOR INSERT TO jarvis_app_runtime
  WITH CHECK (owner_user_id = app.current_actor_user_id());
CREATE POLICY sports_follows_update ON app.sports_follows
  FOR UPDATE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
CREATE POLICY sports_follows_delete ON app.sports_follows
  FOR DELETE TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON app.sports_follows TO jarvis_app_runtime;
```

> **NULL-uniqueness note:** Postgres treats `NULL` as distinct in a `UNIQUE` constraint, so
> `(owner, 'nfl', NULL)` is not deduped against a second identical whole-competition follow. The
> repository (Task 5) guards whole-competition duplicates with an explicit existence check before
> insert. Do not add `NULLS NOT DISTINCT` (raises the PG version floor).

- [ ] **Step 4: Register the Kysely type.** Add `app.sports_follows` to the `JarvisDatabase` interface
      where module tables are declared (grep `wellness_checkins` in `packages/db/src/`; add the sibling
      interface + table entry):

```ts
export interface SportsFollowsTable {
  id: Generated<string>;
  owner_user_id: string;
  competition_key: string;
  team_key: string | null;
  created_at: Generated<Date>;
}
// in JarvisDatabase: "app.sports_follows": SportsFollowsTable;
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test:integration -- foundation`
Expected: PASS — migration applies, list matches, RLS roles unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/sports/sql/0130_sports_follows.sql tests/integration/foundation.test.ts \
        packages/db/src/<file-with-JarvisDatabase>.ts
git commit -m "feat(sports): app.sports_follows owner-only table + RLS (migration 0130)"
```

---

## Task 4: `SportsSource` interface + in-memory cache

**Files:**

- Create: `packages/sports/src/source/sports-source.ts`
- Create: `packages/sports/src/sports-cache.ts`
- Test: `packages/sports/src/__tests__/sports-cache.test.ts`

**Interfaces:**

- Produces: `interface SportsSource` (the adapter seam), `class SportsCache<T>` with `get(key)`,
  `set(key,value,ttlMs)`, `delete(key)`, `clear()`.
- Consumes: `TeamRef`, `GameSummary`, `StandingsRow`, `Headline`, `IsoDate` from `@jarv1s/shared`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sports/src/__tests__/sports-cache.test.ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { SportsCache } from "../sports-cache.js";

afterEach(() => vi.useRealTimers());

describe("SportsCache", () => {
  it("returns a value before TTL and undefined after", () => {
    vi.useFakeTimers();
    const cache = new SportsCache<number>();
    cache.set("k", 42, 1000);
    expect(cache.get("k")).toBe(42);
    vi.advanceTimersByTime(1001);
    expect(cache.get("k")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @jarv1s/sports test sports-cache` → FAIL.

- [ ] **Step 3: Implement.** `sports-cache.ts` is a copy of `packages/weather/src/weather-cache.ts`
      renamed `SportsCache`. `sports-source.ts`:

```ts
// packages/sports/src/source/sports-source.ts
import type { GameSummary, Headline, IsoDate, StandingsRow, TeamRef } from "@jarv1s/shared";

// LOADER-SEAM(sports): the swappable data-source contract (D3). ESPN today; a keyed
// provider later is a one-file change. No route/service/manifest may bypass this.
export interface SportsSource {
  listTeams(competitionKey: string): Promise<TeamRef[]>;
  getScoreboard(competitionKey: string, day: IsoDate): Promise<GameSummary[]>;
  getSchedule(teamKey: string, competitionKey: string): Promise<GameSummary[]>;
  getStandings(competitionKey: string): Promise<StandingsRow[]>;
  getHeadlines(competitionKey: string): Promise<Headline[]>;
}
```

- [ ] **Step 4: Verify pass** — `pnpm --filter @jarv1s/sports test sports-cache` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/source/sports-source.ts packages/sports/src/sports-cache.ts \
        packages/sports/src/__tests__/sports-cache.test.ts
git commit -m "feat(sports): SportsSource adapter interface + in-memory TTL cache"
```

---

## Task 5: `sports_follows` repository

**Files:**

- Create: `packages/sports/src/repository.ts`
- Test: `packages/sports/src/__tests__/repository.itest.ts` (integration — real DB, RLS isolation)

**Interfaces:**

- Consumes: `DataContextDb`, `assertDataContextDb` from `@jarv1s/db`.
- Produces: `class SportsFollowsRepository` with `list(scopedDb): Promise<SportsFollowDto[]>`,
  `create(scopedDb, input: CreateSportsFollowRequest): Promise<SportsFollowDto>`,
  `remove(scopedDb, id: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing test** — mirror an existing wellness repository integration test
      (grep `withDataContext` in `packages/wellness/src/__tests__`). Assert: (a) create→list round-trips
      for the owner; (b) a second actor's `list` does **not** see the first actor's follow (RLS); (c)
      duplicate whole-competition follow (`teamKey: null` twice) does not create a second row.

```ts
// packages/sports/src/__tests__/repository.itest.ts (shape — fill DB harness like wellness itests)
it("isolates follows per owner", async () => {
  await dataContext.withDataContext(userA, (db) =>
    repo.create(db, { competitionKey: "nfl", teamKey: "dal" })
  );
  const asB = await dataContext.withDataContext(userB, (db) => repo.list(db));
  expect(asB).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify it fails** — integration runner → FAIL (repo missing).

- [ ] **Step 3: Implement** (copy `packages/wellness/src/repository.ts` idioms — `assertDataContextDb`
      first, `owner_user_id: sql\`app.current_actor_user_id()\`` on insert):

```ts
// packages/sports/src/repository.ts
import { sql } from "kysely";
import { assertDataContextDb, type DataContextDb } from "@jarv1s/db";
import type { CreateSportsFollowRequest, SportsFollowDto } from "@jarv1s/shared";

function toDto(row: {
  id: string;
  competition_key: string;
  team_key: string | null;
  created_at: Date;
}): SportsFollowDto {
  return {
    id: row.id,
    competitionKey: row.competition_key,
    teamKey: row.team_key,
    createdAt: row.created_at.toISOString()
  };
}

export class SportsFollowsRepository {
  async list(scopedDb: DataContextDb): Promise<SportsFollowDto[]> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.sports_follows")
      .select(["id", "competition_key", "team_key", "created_at"])
      .orderBy("created_at", "desc")
      .execute();
    return rows.map(toDto);
  }

  async create(
    scopedDb: DataContextDb,
    input: CreateSportsFollowRequest
  ): Promise<SportsFollowDto> {
    assertDataContextDb(scopedDb);
    const teamKey = input.teamKey ?? null;
    // Guard whole-competition duplicates (UNIQUE treats NULL as distinct).
    const existing = await scopedDb.db
      .selectFrom("app.sports_follows")
      .select(["id", "competition_key", "team_key", "created_at"])
      .where("competition_key", "=", input.competitionKey)
      .where("team_key", teamKey === null ? "is" : "=", teamKey as never)
      .executeTakeFirst();
    if (existing) return toDto(existing);

    const row = await scopedDb.db
      .insertInto("app.sports_follows")
      .values({
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        competition_key: input.competitionKey,
        team_key: teamKey
      })
      .returning(["id", "competition_key", "team_key", "created_at"])
      .executeTakeFirstOrThrow();
    return toDto(row);
  }

  async remove(scopedDb: DataContextDb, id: string): Promise<boolean> {
    assertDataContextDb(scopedDb);
    const result = await scopedDb.db
      .deleteFrom("app.sports_follows")
      .where("id", "=", id)
      .executeTakeFirst();
    return (result.numDeletedRows ?? 0n) > 0n;
  }
}
```

- [ ] **Step 4: Verify pass** — integration runner → PASS (owner isolation holds).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/repository.ts packages/sports/src/__tests__/repository.itest.ts
git commit -m "feat(sports): owner-scoped sports_follows repository"
```

---

## Task 6: ESPN source implementation (fixtures, no live network)

**Files:**

- Create: `packages/sports/src/source/espn-source.ts`
- Create: `packages/sports/src/source/__fixtures__/nfl-scoreboard.json`,
  `eng1-standings.json`, `nfl-news.json`, `nfl-teams.json` (trimmed real ESPN payloads)
- Test: `packages/sports/src/source/__tests__/espn-source.test.ts`

**Interfaces:**

- Consumes: `SportsSource`, `catalogEntry`, `fetchFn` (injectable, default global `fetch`).
- Produces: `class EspnSportsSource implements SportsSource`, `createEspnSportsSource(fetchFn?):
SportsSource`.

ESPN endpoints (`site.api.espn.com`, no key):

- Scoreboard: `/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD`
- News: `/apis/site/v2/sports/{sport}/{league}/news`
- Teams: `/apis/site/v2/sports/{sport}/{league}/teams`
- Team schedule: `/apis/site/v2/sports/{sport}/{league}/teams/{teamId}/schedule`
- Standings: `/apis/v2/sports/{sport}/{league}/standings` (note the different `/apis/v2` base)

- [ ] **Step 1: Write the failing test** (fixture-driven — inject a `fetchFn` returning the fixture):

```ts
// packages/sports/src/source/__tests__/espn-source.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEspnSportsSource } from "../espn-source.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`../__fixtures__/${name}`, import.meta.url)), "utf8")
  );
}
const okFetch = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("EspnSportsSource", () => {
  it("parses a scoreboard into GameSummary[]", async () => {
    const src = createEspnSportsSource(okFetch(fixture("nfl-scoreboard.json")));
    const games = await src.getScoreboard("nfl", "2026-01-04");
    expect(games.length).toBeGreaterThan(0);
    expect(games[0].home.teamKey).toBeTypeOf("string");
    expect(["pre", "live", "final"]).toContain(games[0].state);
  });
  it("throws a typed error on non-200 (caller degrades)", async () => {
    const failFetch = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const src = createEspnSportsSource(failFetch);
    await expect(src.getScoreboard("nfl", "2026-01-04")).rejects.toThrow(/ESPN/);
  });
  it("rejects an unknown competition before fetching", async () => {
    const src = createEspnSportsSource(okFetch({}));
    await expect(src.getScoreboard("cricket.ipl", "2026-01-04")).rejects.toThrow(
      /unknown competition/i
    );
  });
});
```

Record fixtures once with `curl 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'

> nfl-scoreboard.json`(trim to 1–2 events to stay small), likewise for news/teams and the`/apis/v2`
> standings URL. Commit the trimmed JSON so CI never hits the network.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @jarv1s/sports test espn-source` → FAIL.

- [ ] **Step 3: Implement** (`fetchFn` default `fetch`; map ESPN `competitions[0].competitors[]` →
      `GameSide`, `status.type.state` `"pre"|"in"|"post"` → `"pre"|"live"|"final"`, `status.type.detail` →
      `statusDetail`; `!response.ok` → `throw new Error(\`ESPN {league} scoreboard {status}\`)`; unknown
`competitionKey`via`catalogEntry`→ throw`unknown competition`). Follow `open-meteo.ts` structure.

- [ ] **Step 4: Verify pass** — `pnpm --filter @jarv1s/sports test espn-source` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/source/espn-source.ts packages/sports/src/source/__fixtures__/
git add packages/sports/src/source/__tests__/espn-source.test.ts
git commit -m "feat(sports): ESPN SportsSource impl with fixtures (no live network)"
```

---

## Task 7: Sports service (overview composition + rationale + briefing facts)

**Files:**

- Create: `packages/sports/src/sports-service.ts`
- Test: `packages/sports/src/__tests__/sports-service.test.ts`

**Interfaces:**

- Consumes: `SportsSource`, `SportsCache`, `SportsFollowsRepository`, `DataContextRunner`,
  `catalogEntry`.
- Produces: `class SportsService` with:
  - `getCatalog(): Promise<SportsCatalogResponse>`
  - `getOverview(accessContext): Promise<SportsOverviewResponse>`
  - `getFollowedFactsForToday(scopedDb, actorUserId): Promise<{ facts: FollowedFact[] }>` (briefing)
  - `type FollowedFact = { competitionKey: string; text: string }`

Composition rules (from spec §4.6a): read the actor's follows; fetch scoreboard/standings/headlines
per followed competition through the cache; build `hero` (`gameday` if a followed team plays today,
else `story` from the top followed-competition headline); build `FollowedTeamCard[]` (status
live/today/news, form from recent schedule W/D/L, rationale string); group scoreboard + standings;
`degraded: true` and empty authored fallbacks if the source throws (never propagate a 500). Cache TTLs:
scoreboards `SCOREBOARD_TTL_MS = 3 * 60 * 1000`, standings/headlines `10 * 60 * 1000`.

- [ ] **Step 1: Write the failing test** (inject a fake `SportsSource` returning canned data + a fake
      follows repo):

```ts
// packages/sports/src/__tests__/sports-service.test.ts (key assertions)
it("returns a gameday hero when a followed team plays today", async () => {
  const overview = await service.getOverview(userA); // fake source: DAL plays today
  expect(overview.hero.mode).toBe("gameday");
  expect(overview.followedTeamKeys).toContain("dal");
});
it("falls back to a story hero on a quiet day", async () => {
  /* no games today */ expect(overview.hero.mode).toBe("story");
});
it("degrades (no throw) when the source fails", async () => {
  const bad = {
    getScoreboard: async () => {
      throw new Error("ESPN down");
    } /* ... */
  };
  const overview = await badService.getOverview(userA);
  expect(overview.degraded).toBe(true);
});
it("getFollowedFactsForToday returns compact non-sensitive strings", async () => {
  const { facts } = await service.getFollowedFactsForToday(scopedDb, userA.actorUserId);
  expect(facts[0].text).toMatch(/play|won|lost|tied/i);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (service missing).

- [ ] **Step 3: Implement** `SportsService` per the composition rules. Wrap every `SportsSource` call
      in try/catch that records `degraded = true` and continues with empties. `getOverview` opens
      `dataContext.withDataContext(accessContext, (db) => repo.list(db))` for follows, then does its
      (public) source fetches outside the DB context. Keep the rationale strings short and factual.

- [ ] **Step 4: Verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/sports-service.ts packages/sports/src/__tests__/sports-service.test.ts
git commit -m "feat(sports): overview composition, rationale, and briefing-facts service"
```

---

## Task 8: Routes (`registerSportsRoutes`)

**Files:**

- Create: `packages/sports/src/routes.ts`
- Test: `packages/sports/src/__tests__/routes.test.ts` (Fastify `inject`, fake deps)

**Interfaces:**

- Consumes: `DataContextRunner`, `resolveAccessContext`, a constructed `SportsSource`, `handleRouteError`
  from `@jarv1s/module-sdk`, schemas from `@jarv1s/shared`.
- Produces: `registerSportsRoutes(server, deps: SportsRoutesDependencies)`, where
  `SportsRoutesDependencies = { dataContext; resolveAccessContext; source: SportsSource; fetchFn? }`.

Routes (spec §4.5), each `try { const accessContext = await deps.resolveAccessContext(request); ... }
catch (error) { return handleRouteError(error, reply); }` (weather pattern):

- `GET /api/sports/catalog` → `service.getCatalog()`
- `GET /api/sports/follows` → `withDataContext` → `repo.list`
- `POST /api/sports/follows` (body `createSportsFollowRequestSchema`) → `repo.create`
- `DELETE /api/sports/follows/:id` → `repo.remove` → `{ ok }`
- `GET /api/sports/overview` → `service.getOverview(accessContext)`

- [ ] **Step 1: Write the failing test** — `inject` GET `/api/sports/overview` with a stub
      `resolveAccessContext` + fake source → expect `200` and a body matching
      `sportsOverviewResponseSchema` shape; POST `/api/sports/follows` persists via a fake repo.

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `registerSportsRoutes`, constructing `SportsService` from `deps.source` +
      a module-level `SportsCache` + `new SportsFollowsRepository()`.

- [ ] **Step 4: Verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/routes.ts packages/sports/src/__tests__/routes.test.ts
git commit -m "feat(sports): REST routes (catalog, follows CRUD, overview)"
```

---

## Task 9: Briefing tool + manifest + package index

**Files:**

- Create: `packages/sports/src/briefing-tool.ts`
- Create: `packages/sports/src/manifest.ts`
- Modify: `packages/sports/src/index.ts` (replace stub with real exports)
- Test: `packages/sports/src/__tests__/manifest.test.ts`

**Interfaces:**

- Produces: `sportsFollowedFactsTodayExecute: ToolExecute` (returns `{ data: { facts: FollowedFact[] }
}`), `sportsModuleManifest satisfies JarvisModuleManifest`, `SPORTS_MODULE_ID`,
  `sportsModuleSqlMigrationDirectory`, `registerSportsRoutes`, `SportsSource`,
  `createEspnSportsSource`.

> **Reconciliation of spec §4.7/§4.8 (flagged as the primary integration risk).** The briefings engine
> has **no provider registry**; a section can only be produced by a `risk:"read"` `assistantTool` whose
> `execute` is found via `findExecute` over `manifest.assistantTools`, plus hardcoded edits in
> `compose.ts` (Task 11). Therefore MVP declares **exactly one** assistant tool,
> `sports.followedFactsToday`, whose sole intended consumer is the briefing. It is mechanically visible
> to the chat tool-registry (the platform has no "briefing-only" flag today) — this is the honest cost
> and the one deviation from §4.8's "no assistantTools." It is **not** the rich `sports.scores`/
> `sports.schedule` chat experience that §2 bars; keep its output to compact today-facts only. If Ben
> vetoes any chat visibility, that requires a platform change (briefing-only tool filtering) — out of
> scope; note it in the README.

- [ ] **Step 1: Write the failing test**

```ts
// packages/sports/src/__tests__/manifest.test.ts
import { describe, expect, it } from "vitest";
import { sportsModuleManifest } from "../manifest.js";

describe("sports manifest", () => {
  it("declares owner-only table + nav + settings + routes", () => {
    expect(sportsModuleManifest.database.ownedTables).toEqual(["app.sports_follows"]);
    expect(sportsModuleManifest.navigation[0].path).toBe("/sports");
    expect(sportsModuleManifest.settings[0].path).toBe("/settings/modules/sports");
    expect(sportsModuleManifest.routes.map((r) => r.path)).toContain("/api/sports/overview");
  });
  it("exposes exactly one read-risk briefing tool", () => {
    expect(sportsModuleManifest.assistantTools).toHaveLength(1);
    expect(sportsModuleManifest.assistantTools[0].name).toBe("sports.followedFactsToday");
    expect(sportsModuleManifest.assistantTools[0].risk).toBe("read");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement.** `briefing-tool.ts` exports `sportsFollowedFactsTodayExecute` (narrows the
      `unknown` scopedDb via the repo + service; returns `{ data: { facts } }`). `manifest.ts` mirrors
      `packages/wellness/src/manifest.ts`: `id/name/version/publisher/lifecycle:"user-toggleable"/
compatibility/availability{defaultEnabled:true,required:false,supportsUserDisable:true}/database{
migrations:["sql/0130_sports_follows.sql"], migrationDirectories:["packages/sports/sql"],
ownedTables:["app.sports_follows"]}/navigation[{id:"sports",label:"Sports",path:"/sports",
icon:"trophy",order:35,permissionId:"sports.view"}]/settings[{id:"sports.follows",label:"Sports",
path:"/settings/modules/sports",scope:"user",order:35,permissionId:"sports.view",entry:"./settings"}]/
permissions[sports.view(view), sports.follow(create,delete)]/routes(§4.5)/assistantTools[
{name:"sports.followedFactsToday",risk:"read",permissionId:"sports.view",
inputSchema:{type:"object",properties:{}},execute:sportsFollowedFactsTodayExecute}]`. Export
      `sportsModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url))`. Replace
      `index.ts` stub with the real re-exports.

- [ ] **Step 4: Verify pass** — PASS. Also run `pnpm --filter @jarv1s/sports typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/briefing-tool.ts packages/sports/src/manifest.ts packages/sports/src/index.ts \
        packages/sports/src/__tests__/manifest.test.ts
git commit -m "feat(sports): manifest + briefing-only followedFactsToday read tool"
```

---

## Task 10: Register in `module-registry` (LOADER-SEAM 1 + 2)

**Files:**

- Modify: `packages/module-registry/src/index.ts` (import + `BUILT_IN_MODULES` entry; add
  `@jarv1s/sports` to `packages/module-registry/package.json` deps)
- Test: extend the registry's consistency test (grep the test that calls
  `assertModuleRegistryConsistency` / lists built-in module ids) to expect `"sports"`.

**Interfaces:**

- Consumes: `sportsModuleManifest`, `sportsModuleSqlMigrationDirectory`, `registerSportsRoutes`,
  `createEspnSportsSource` from `@jarv1s/sports`.

- [ ] **Step 1: Write the failing test** — add `"sports"` to the expected built-in-module-id list in
      the registry test.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @jarv1s/module-registry test` → FAIL.

- [ ] **Step 3: Implement** — add the dep, import, and this entry to the `BUILT_IN_MODULES` array
      (mirroring the weather entry at line 763):

```ts
  {
    // LOADER-SEAM(sports) 1: static import + registration object (manifest, sql dir, routes).
    manifest: sportsModuleManifest,
    sqlMigrationDirectories: [sportsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      // LOADER-SEAM(sports) 2: DI wiring + construction of the SportsSource adapter in the
      // composition root (which concrete source lives here, not in the manifest).
      registerSportsRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        source: createEspnSportsSource(deps.fetchFn)
      })
  },
```

- [ ] **Step 4: Verify pass** — `pnpm --filter @jarv1s/module-registry test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/index.ts packages/module-registry/package.json pnpm-lock.yaml \
        packages/module-registry/src/__tests__/<registry-consistency-test>.ts
git commit -m "feat(sports): register @jarv1s/sports in BUILT_IN_MODULES (loader-seams 1+2)"
```

---

## Task 11: Wire the briefing section (LOADER-SEAM 3)

> **Briefing is load-bearing (Ben, 2026-07-01):** the "day's followed-team facts in the briefing" is a
> primary success criterion, not a nice-to-have. Task 11 therefore has **two** guards — the section
> renders, AND it is in the **default** tool set so a `defaultToolNamesFor` regression fails CI (not
> only the hand-selected path).

**Files:**

- Modify: `packages/briefings/src/compose.ts` (three edits)
- Modify: `packages/briefings/src/routes.ts` (add tool to `defaultToolNamesFor`)
- Test: `packages/briefings/src/__tests__/<compose-test>.ts` — two cases: (a) a `sports` section renders
  when `sports.followedFactsToday` returns facts; (b) `defaultToolNamesFor(...)` includes
  `sports.followedFactsToday` for a user with the sports module enabled + `sports.view`.

**Interfaces:**

- Consumes: the manifest's `sports.followedFactsToday` tool (already reachable via
  `getBuiltInModuleManifests()` — no module-registry change needed for briefings).

- [ ] **Step 1: Write the failing tests**

```ts
// (a) section renders when the tool returns facts
it("renders a sports section from followedFactsToday", async () => {
  // seed a fake sports.followedFactsToday execute →
  //   { data: { facts: [{ competitionKey: "nfl", text: "Cowboys play tonight 7:20pm" }] } }
  const briefing = await compose(/* definition selecting sports.followedFactsToday */);
  expect(briefing).toContain('<external_source type="sports">');
  expect(briefing).toContain("Cowboys play tonight 7:20pm");
});

// (b) DEFAULT inclusion — the load-bearing guard. Regression here fails CI.
it("includes sports.followedFactsToday in the default briefing tool set", () => {
  const names = defaultToolNamesFor(/* user: sports module enabled, has sports.view */);
  expect(names).toContain("sports.followedFactsToday");
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL (no `sports` section; tool not in defaults).

- [ ] **Step 3: Implement — three edits in `compose.ts`** (mirror the `goals` block at lines 682-700):

1. Add a `gatherToolSection` call (after the goals block, ~line 698):

```ts
const sports = await gatherToolSection({
  toolName: "sports.followedFactsToday",
  arrayKey: "facts",
  label: "SPORTS",
  sectionKey: "sports",
  // Allow-list: emit only the compact fact string. No URLs, no scores object passthrough.
  format: (row) => sanitizeExternal(String((row as { text?: unknown }).text ?? ""))
  // no localDayField — the tool already returns today-only facts
});
```

2. Push into the hardcoded `sections` array (line 700), gated on selection like `goals`:

```ts
if (definition.selected_tool_names.includes("sports.followedFactsToday")) sections.push(sports);
```

3. Reserve `"sports"` in the trust-boundary channel enumeration (the `TRUST_BOUNDARY` /
   `SYNTHESIS_INSTRUCTIONS_*` constants, ~lines 859-880) alongside the existing channels (precedent:
   `web_research`). Add `sports` to the untrusted-external-channel list so the section text is inside
   the declared boundary.

In `routes.ts`, add `"sports.followedFactsToday"` to `defaultToolNamesFor(...)` (~line 529) so the
briefing includes it by default. (`requiredReadToolNames` already accepts any `risk:"read"` tool, so
selection needs no route change.)

- [ ] **Step 4: Verify pass** — briefings test → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/briefings/src/compose.ts packages/briefings/src/routes.ts \
        packages/briefings/src/__tests__/<compose-test>.ts
git commit -m "feat(sports): briefing section via followedFactsToday (loader-seam 3)"
```

---

## Task 12: Web registration — route, nav metadata, query keys, API client (LOADER-SEAM 4)

**Files:**

- Modify: `apps/web/src/app-route-metadata.ts` (id union + `webRoutes` entry + `SECTION_OF`)
- Modify: `apps/web/src/app.tsx` (lazy import + `<Route>` under `ModuleGatedRoute`)
- Modify: `apps/web/src/api/query-keys.ts` (`sports` block)
- Create: `apps/web/src/api/sports-client.ts`
- Modify: `apps/web/package.json` (add `@jarv1s/sports` dep for the settings pane import path)
- Test: `apps/web/src/api/__tests__/sports-client.test.ts` (mock `requestJson`, assert paths)

**Interfaces:**

- Produces: `getSportsOverview()`, `getSportsCatalog()`, `listSportsFollows()`,
  `createSportsFollow(input)`, `deleteSportsFollow(id)` in `sports-client.ts`; `queryKeys.sports.*`.

- [ ] **Step 1: Write the failing test** — assert `getSportsOverview` calls `requestJson` with
      `/api/sports/overview`; `createSportsFollow` POSTs `/api/sports/follows`.

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement.**
  - `sports-client.ts` — mirror `apps/web/src/api/weather-client.ts` (`requestJson` from `./client.js`,
    `credentials: "include"`), typed to the `@jarv1s/shared` sports DTOs.
  - `query-keys.ts` — add:
    ```ts
    sports: {
      overview: ["sports", "overview"] as const,
      catalog: ["sports", "catalog"] as const,
      follows: ["sports", "follows"] as const
    },
    ```
  - `app-route-metadata.ts` — add `"sports"` to the id union (lines 16-21); add to `SECTION_OF`:
    `sports: "You"`; add the `webRoutes` entry:
    ```ts
    { id: "sports", path: "/sports", title: "Sports",
      subtitle: () => "FOLLOWED", match: (p) => p.startsWith("/sports") },
    ```
  - `app.tsx` — `const SportsPage = lazy(() => import("./sports/sports-page").then((m) => ({ default: m.SportsPage })));`
    `const sportsGate = myModulesEnabled("sports");` and:
    ```tsx
    <Route
      path={webRoutePath("sports")}
      element={
        <ModuleGatedRoute gate={sportsGate}>
          <SportsPage />
        </ModuleGatedRoute>
      }
    />
    ```

- [ ] **Step 4: Verify pass** — `pnpm --filter @jarv1s/web test sports-client` → PASS.
      (The nav item + settings pane appear automatically from the manifest; verify at the end via the app.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app-route-metadata.ts apps/web/src/app.tsx apps/web/src/api/query-keys.ts \
        apps/web/src/api/sports-client.ts apps/web/src/api/__tests__/sports-client.test.ts \
        apps/web/package.json pnpm-lock.yaml
git commit -m "feat(sports): web route + nav metadata + api client + query keys (loader-seam 4)"
```

---

## Task 13: Sports page UI + CSS (implements §4.6a)

**Files:**

- Create: `apps/web/src/sports/sports-page.tsx` (exports `SportsPage`)
- Create: `apps/web/src/sports/` subcomponents: `sports-hero.tsx`, `followed-card.tsx`,
  `scoreboard.tsx`, `headlines-rail.tsx`, `standings-rail.tsx`, `sports-empty.tsx`
- Create: `apps/web/src/styles/sports-1.css` (+ `sports-2.css` if > 1000 lines)
- Test: `apps/web/src/sports/__tests__/sports-page.test.tsx` (React Testing Library, mocked query)

**Interfaces:**

- Consumes: `getSportsOverview` + `queryKeys.sports.overview`; `SportsOverviewResponse` DTO.

> **CSS is a PORT, not net-new authoring.** The `sp-*` taxonomy is fully authored in the Claude Design
> project "Jarvis Design System" (`ui_kits/jarvis-app/sports.css` + `Sports.jsx`). Port those classes
> into `sports-1.css`, mapping every color to a `tokens.css` `var(--…)` (the mock-up already uses only
> tokens). Enforce §4.6a hard rules while porting: result colors never red; highlight = `--pine-soft`
> fill + full border + `--radius-card` (no colored left stripe); `sp-livedot` pulse wrapped in
> `@media (prefers-reduced-motion: no-preference)`. Split at < 1000 lines/file, import order preserved.

Page structure to bind (spec §4.6a): `sp-top` header → `sp-hero` (`--live` gameday vs `--story
--split` quiet-day, driven by `overview.hero.mode`) → `sp-fc` followed-team grid → `sp-split`
(`sp-board` scoreboard with `sp-chip` league filters + `sp-rail` headlines) → `sp-standings` rail →
`sp-empty` + follow-picker entry when `overview.followed.length === 0`. Mark followed teams with
`is-you`/`is-mine` using `overview.followedTeamKeys`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/sports/__tests__/sports-page.test.tsx (key cases)
it("renders a gameday hero", async () => {
  /* mock overview.hero.mode = "gameday" */
  render(<SportsPage />);
  expect(await screen.findByText(/why you.re seeing/i)).toBeInTheDocument();
});
it("renders the empty state with no follows", async () => {
  /* followed: [] */
  render(<SportsPage />);
  expect(await screen.findByText(/follow a team/i)).toBeInTheDocument();
});
it("still renders scores + headlines on a quiet day (story hero)", async () => {
  /* hero.mode="story" */
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (page missing).

- [ ] **Step 3: Implement** the page + subcomponents (import `../styles/sports-1.css` at top; `useQuery`
      with `queryKeys.sports.overview`; `?? []` fallbacks; authored `LoadingScreen`/empty states; render
      the ported `sp-*` markup). Port CSS per the callout.

- [ ] **Step 4: Verify pass** — `pnpm --filter @jarv1s/web test sports-page` → PASS. Run
      `pnpm --filter @jarv1s/web check:file-size` to confirm CSS < 1000 lines.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/sports/ apps/web/src/styles/sports-1.css apps/web/src/styles/sports-2.css
git commit -m "feat(sports): /sports page + subcomponents + sp-* design language (§4.6a)"
```

---

## Task 14: Settings follow-picker pane

**Files:**

- Create: `packages/sports/src/settings/index.tsx` (default export `SportsSettings`)
- Test: `packages/sports/src/settings/__tests__/settings.test.tsx`

**Interfaces:**

- Consumes: `getSportsCatalog`, `listSportsFollows`, `createSportsFollow`, `deleteSportsFollow`
  (imported from the web api client via the app; in the package, use the local `requestJson` helper
  pattern like `packages/wellness/src/settings/index.tsx` — inline `["sports","follows"]` keys are the
  sanctioned exception for package-side panes).
- Produces: the `/settings/modules/sports` pane (auto-mounted by the settings-ui Vite scanner — no
  `settings-page.tsx` edit).

Renders the `sp-pick` follow picker (spec §4.6a item 6): competitions grouped, "whole league" toggle +
team grid with crests and check toggles (active = `--pine-soft` + `--accent`), `marquee` tag on the
World Cup. Uses `@jarv1s/settings-ui` primitives (`PaneHead`, `Group`, `Row`, `Switch`) like the
wellness pane.

- [ ] **Step 1: Write the failing test** — toggling a team calls `createSportsFollow`; removing calls
      `deleteSportsFollow`; renders the marquee tag for `fifa.world`.

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement** the pane (default export). Mirror `packages/wellness/src/settings/index.tsx`
      structure (local `requestJson`, `useQuery`/`useMutation` + `invalidateQueries`).

- [ ] **Step 4: Verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/settings/
git commit -m "feat(sports): settings follow-picker pane (auto-mounted via manifest)"
```

---

## Task 15: README loader-seam ledger + full-gate close-out

**Files:**

- Create: `packages/sports/README.md`

**Interfaces:** none (documentation + verification).

- [ ] **Step 1: Write `packages/sports/README.md`** listing the 6 loader-seams with exact file
      locations (grep-verify each `// LOADER-SEAM(sports)` tag is present):
  1. `BUILT_IN_MODULES` entry — `packages/module-registry/src/index.ts`
  2. `registerSportsRoutes` DI + `createEspnSportsSource` construction — same file
  3. briefings `compose.ts` section + trust-boundary channel — `packages/briefings/src/compose.ts`
  4. web nav/route — `apps/web/src/app-route-metadata.ts` + `apps/web/src/app.tsx`
  5. shared contracts — `packages/shared/src/sports-api.ts`
  6. `foundation.test.ts` migration row — `tests/integration/foundation.test.ts`
     Note the one accepted deviation (briefing-only tool is chat-visible; §4.8 reconciliation) and the
     deferred fast-follows (§9).

- [ ] **Step 2: Grep-verify the seam tags**

Run: `grep -rn "LOADER-SEAM(sports)" packages/ apps/`
Expected: at least the SEAM 1/2 tags in module-registry + SEAM 3 in compose.ts + the source-interface
tag. (SEAMs 4/5/6 are cross-file; the README is their ledger.)

- [ ] **Step 3: Full local gate**

Run: `pnpm verify:foundation`
Expected: PASS (lint, format:check, check:file-size, typecheck, unit + integration incl.
`foundation.test.ts`).

Run: `pnpm audit:release-hardening`
Expected: PASS.

- [ ] **Step 4: Manual acceptance (spec §7)** — with the dev server (`--host`): follow a team in
      settings → persists; open `/sports` on a quiet day → scores + headlines render; game day → team
      highlighted; change follows → highlighted set changes; briefing shows a followed-team fact; second
      user sees only their own follows; simulate ESPN failure (temporarily point `fetchFn` at a throwing
      stub) → page shows `degraded` authored empty state, no 500.

- [ ] **Step 5: Commit**

```bash
git add packages/sports/README.md
git commit -m "docs(sports): loader-seam ledger + close-out"
```

---

## Self-Review (writing-plans checklist)

**1. Spec coverage.**

| Spec item                                              | Task                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| §4.1 package anatomy                                   | 1, 4–9                                       |
| §4.2 `sports_follows` owner-only RLS                   | 3                                            |
| §4.3 `SportsSource` adapter + espn-source              | 4, 6                                         |
| §4.4 in-memory cache, no table/worker                  | 4, 7                                         |
| §4.5 REST contract (5 routes)                          | 1 (schemas), 8                               |
| §4.6 frontend page + query keys                        | 12, 13                                       |
| §4.6a design language (`sp-*`, no red, no left-border) | 13                                           |
| §4.6 settings follow picker                            | 14                                           |
| §4.7 briefing hook                                     | 9 (tool), 11 (wiring)                        |
| §4.8 manifest surface                                  | 9                                            |
| §5 six loader-seams                                    | 10, 11, 12, 15 (ledger)                      |
| §6/§7 exit + verification                              | 15                                           |
| §8 hard invariants                                     | Global Constraints + 3 (RLS) + 9 (isolation) |

No spec section is left without a task.

**2. Placeholder scan.** The only non-verbatim code is (a) the ESPN JSON parsing in Task 6 (bounded by
concrete endpoints, fixtures, and explicit field mappings) and (b) the CSS in Task 13 (an explicit
**port** of an existing authored source file, not invented). Both name their exact source + rules; no
"TODO/handle edge cases" placeholders remain.

**3. Type consistency.** `competitionKey`/`teamKey` naming is uniform across DTOs, repository, service,
routes, and client. `SportsSource` method names match between §4.3, Task 4, and Task 6.
`sports.followedFactsToday` is the single tool name used identically in Tasks 9, 11, and the manifest
test. Migration `0130` is referenced consistently in the SQL filename, `foundation.test.ts` row, and
`manifest.migrations` (all gated on the Task 3 verify-and-bump note).

**Open reconciliation surfaced for approval:** the briefing hook requires one chat-visible
`risk:"read"` assistant tool (Task 9 callout) — the single deviation from spec §4.8. Everything else
maps directly.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-07-01-sports-module.md`. Per `/start`, this is the **plan
gate** — no code until approval. Recommended build engine on approval: **background Workflow** (15
tasks, mostly sequential with a long backend prefix; matches the M-A1 precedent), build agents on
**Sonnet**. Await go-decision.
