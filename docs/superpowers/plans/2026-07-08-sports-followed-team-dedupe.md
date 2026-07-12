# Sports followed-team dedupe (#855) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge a followed club's multiple competition-scoped `sports_follows` rows (e.g. Liverpool in
the Premier League and Champions League) into one `FollowedTeamCard` in `GET /api/sports/overview`,
instead of rendering one duplicate card per competition.

**Architecture:** Add a new pure grouping module (`packages/sports/src/followed-groups.ts`) that
resolves each followed team to a canonical club key (`espnSport:sourceTeamId`) and groups rows by that
key, picking a primary follow (league > tournament, then newest `createdAt`). Refactor
`SportsService.getOverview()`'s per-follow card-building into per-follow "bundle" fetches (unchanged
data fetching) followed by a grouping step and a new `buildGroupedCard` that merges each group's
bundles into one card. No DB schema change, no shared-API schema change — `followedTeamCardSchema`
already declares every field the merged card needs.

**Tech Stack:** TypeScript, Vitest, existing `DatasetClient`/`SportsFollowsReader` test doubles.

## Global Constraints

- No `sports_follows` migration in this slice (spec Non-goals).
- No club master-data table (spec Non-goals).
- No picker-level blocking of duplicate club follows (spec Non-goals).
- No shared-API (`packages/shared/src/sports-api.ts`) schema change — confirmed unnecessary; do not
  add one unless a task below proves a field is missing (none are expected to).
- No name-only fuzzy matching between teams — merging requires a resolved `sourceTeamId` match, never
  a name comparison (spec Non-goals, Acceptance Criteria).
- `packages/sports/src/sports-service.ts` is already at 963/1000 lines (file-size gate,
  `check:file-size`) — all new grouping/primary-selection logic goes in the new
  `packages/sports/src/followed-groups.ts` file, not more code in `sports-service.ts`.
- `pnpm verify:foundation` must pass for the implementation PR (spec Acceptance Criteria).

---

## Task 1: `followed-groups.ts` — pure grouping/primary-selection module

**Files:**

- Create: `packages/sports/src/followed-groups.ts`
- Test: `tests/unit/sports-followed-groups.test.ts`

**Interfaces:**

- Consumes: `SportsFollowDto` from `@jarv1s/shared` (`{ id, competitionKey, teamKey: string | null,
createdAt }`); `catalogEntry(competitionKey): CatalogEntry | undefined` from
  `./source/catalog.js` (`CatalogEntry.espnSport: string`, `CatalogEntry.kind: "league" | "tournament"`).
- Produces (consumed by Task 3):
  - `type ResolvedFollow = SportsFollowDto & { teamKey: string }`
  - `interface FollowedTeamGroup { readonly key: string; readonly follows: readonly ResolvedFollow[]; readonly primary: ResolvedFollow }`
  - `function canonicalClubKey(follow: ResolvedFollow, sourceTeamId: string | null): string | null`
  - `function selectPrimaryFollow(follows: readonly ResolvedFollow[]): ResolvedFollow`
  - `function groupFollowedTeams(follows: readonly ResolvedFollow[], sourceTeamIdFor: (follow: ResolvedFollow) => string | null): FollowedTeamGroup[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sports-followed-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  canonicalClubKey,
  groupFollowedTeams,
  selectPrimaryFollow,
  type ResolvedFollow
} from "../../packages/sports/src/followed-groups.js";

function follow(
  overrides: Partial<ResolvedFollow> & { id: string; teamKey: string }
): ResolvedFollow {
  return {
    competitionKey: "eng.1",
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides
  };
}

describe("canonicalClubKey", () => {
  it("combines the competition's espnSport with the source team id", () => {
    const f = follow({ id: "f1", teamKey: "liv", competitionKey: "eng.1" });
    expect(canonicalClubKey(f, "364")).toBe("soccer:364");
  });

  it("returns null when sourceTeamId is null (unresolvable → never merge)", () => {
    const f = follow({ id: "f1", teamKey: "liv", competitionKey: "eng.1" });
    expect(canonicalClubKey(f, null)).toBeNull();
  });

  it("returns null for a competition key not in the catalog", () => {
    const f = follow({ id: "f1", teamKey: "x", competitionKey: "not-in-catalog" });
    expect(canonicalClubKey(f, "1")).toBeNull();
  });
});

describe("groupFollowedTeams", () => {
  it("merges follows from different competitions sharing the same club", () => {
    const f1 = follow({ id: "f1", teamKey: "liv", competitionKey: "eng.1" });
    const f2 = follow({ id: "f2", teamKey: "livc", competitionKey: "uefa.champions" });
    const groups = groupFollowedTeams([f1, f2], () => "364");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.follows.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("keeps follows with an unresolved sourceTeamId as separate singleton groups", () => {
    const f1 = follow({ id: "f1", teamKey: "a", competitionKey: "eng.1" });
    const f2 = follow({ id: "f2", teamKey: "b", competitionKey: "usa.1" });
    const groups = groupFollowedTeams([f1, f2], () => null);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.follows.length)).toEqual([1, 1]);
  });

  it("does not merge follows from different sports even with the same source team id", () => {
    const f1 = follow({ id: "f1", teamKey: "a", competitionKey: "nfl" }); // espnSport football
    const f2 = follow({ id: "f2", teamKey: "b", competitionKey: "eng.1" }); // espnSport soccer
    const groups = groupFollowedTeams([f1, f2], () => "6");
    expect(groups).toHaveLength(2);
  });
});

describe("selectPrimaryFollow", () => {
  it("prefers a league catalog entry over a tournament, even if the tournament follow is newer", () => {
    const league = follow({
      id: "f1",
      teamKey: "liv",
      competitionKey: "eng.1",
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    const tournament = follow({
      id: "f2",
      teamKey: "livc",
      competitionKey: "uefa.champions",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    expect(selectPrimaryFollow([league, tournament])).toBe(league);
  });

  it("tie-breaks among multiple leagues by the most recently created follow", () => {
    const older = follow({
      id: "f1",
      teamKey: "a",
      competitionKey: "eng.1",
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    const newer = follow({
      id: "f2",
      teamKey: "b",
      competitionKey: "usa.1",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    expect(selectPrimaryFollow([older, newer])).toBe(newer);
  });

  it("tie-breaks among multiple tournaments by the most recently created follow when no league exists", () => {
    const older = follow({
      id: "f1",
      teamKey: "a",
      competitionKey: "uefa.champions",
      createdAt: "2026-06-01T00:00:00.000Z"
    });
    const newer = follow({
      id: "f2",
      teamKey: "b",
      competitionKey: "fifa.world",
      createdAt: "2026-06-15T00:00:00.000Z"
    });
    expect(selectPrimaryFollow([older, newer])).toBe(newer);
  });

  it("returns the single follow trivially for a singleton group", () => {
    const only = follow({ id: "f1", teamKey: "a", competitionKey: "eng.1" });
    expect(selectPrimaryFollow([only])).toBe(only);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/sports-followed-groups.test.ts`
Expected: FAIL — `Cannot find module '../../packages/sports/src/followed-groups.js'` (file doesn't
exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/sports/src/followed-groups.ts`:

```ts
import type { SportsFollowDto } from "@jarv1s/shared";

import { catalogEntry } from "./source/catalog.js";

/** A followed-team row narrowed to a real (non-null) `teamKey` — whole-competition follows
 *  (`teamKey: null`) never reach this module; the caller filters them out first (#855). */
export type ResolvedFollow = SportsFollowDto & { teamKey: string };

export interface FollowedTeamGroup {
  readonly key: string;
  readonly follows: readonly ResolvedFollow[];
  readonly primary: ResolvedFollow;
}

// ESPN team ids are scoped to a sport (`espnSport`), not globally unique — the same numeric id
// can name unrelated teams in different sports, so the canonical key must include the sport
// (spec Design §2). Null `sourceTeamId` means "unresolvable" — the caller must never merge that
// row with anything else (spec: "a duplicate card is safer than mixing unrelated clubs that
// share a name").
export function canonicalClubKey(
  follow: ResolvedFollow,
  sourceTeamId: string | null
): string | null {
  if (sourceTeamId === null) return null;
  const espnSport = catalogEntry(follow.competitionKey)?.espnSport;
  return espnSport ? `${espnSport}:${sourceTeamId}` : null;
}

// Primary competition selection (spec Design): league beats tournament outright, regardless of
// recency; only once no league is present (or several tie) does newest `createdAt` decide. ISO
// timestamps sort correctly lexicographically, so string compare is exact.
export function selectPrimaryFollow(follows: readonly ResolvedFollow[]): ResolvedFollow {
  const leagues = follows.filter((f) => catalogEntry(f.competitionKey)?.kind === "league");
  const pool = leagues.length > 0 ? leagues : follows;
  return [...pool].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
}

/** Groups followed-team rows by canonical club key. A row whose `sourceTeamId` doesn't resolve
 *  becomes its own singleton group, keyed by its own `id` so unresolved rows never accidentally
 *  merge with each other (spec Acceptance Criteria: "not merged by normalized name"). */
export function groupFollowedTeams(
  follows: readonly ResolvedFollow[],
  sourceTeamIdFor: (follow: ResolvedFollow) => string | null
): FollowedTeamGroup[] {
  const byKey = new Map<string, ResolvedFollow[]>();
  for (const follow of follows) {
    const clubKey = canonicalClubKey(follow, sourceTeamIdFor(follow));
    const key = clubKey ?? `unresolved:${follow.id}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(follow);
    else byKey.set(key, [follow]);
  }
  return [...byKey.entries()].map(([key, groupFollows]) => ({
    key,
    follows: groupFollows,
    primary: selectPrimaryFollow(groupFollows)
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/sports-followed-groups.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/followed-groups.ts tests/unit/sports-followed-groups.test.ts
git commit -m "feat(sports): add followed-team club grouping module (#855)"
```

---

## Task 2: Refactor `sports-service.ts` internals into cross-competition primitives (behavior-preserving)

Pure refactor — no observable behavior change. Safety net is the existing
`tests/unit/sports-service.test.ts` suite (866 lines) passing unmodified before and after.

**Files:**

- Modify: `packages/sports/src/sports-service.ts`
  - `lastMatchFor` (currently lines 812-819)
  - `teamStories` + `TEAM_STORY_LIMIT` (currently lines 789-807)
  - `computeForm` (currently lines 843-857)
  - `nextMatchFor` (currently lines 911-931)

**Interfaces:**

- Consumes: `GameSummary`, `FollowedNextMatch`, `FollowedTeamNews` from `@jarv1s/shared`; existing
  `sideFor`, `opponentFor`, `resultOf`, `safeHref` module-private helpers (unchanged).
- Produces (consumed by Task 3):
  - `interface ResolvedGame { readonly game: GameSummary; readonly teamKey: string }`
  - `function toResolvedGames(schedule: readonly GameSummary[], teamKey: string): ResolvedGame[]`
  - `function computeFormAcross(games: readonly ResolvedGame[]): readonly ("W" | "D" | "L")[]`
  - `function nextMatchAcross(games: readonly ResolvedGame[], now: Date): FollowedNextMatch | null`
  - `function lastMatchAcross(games: readonly ResolvedGame[]): string | null`
  - `function filterTeamHeadlines(headlines: readonly SourceHeadline[], teamKey: string): SourceHeadline[]`
  - `function toTeamStories(headlines: readonly SourceHeadline[]): FollowedTeamNews[]`
  - `computeForm`, `nextMatchFor`, `lastMatchFor`, `teamStories` keep their exact existing
    signatures and behavior (now thin wrappers) — every existing call site is unchanged.

- [ ] **Step 1: Run the existing suite to confirm the baseline is green**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: PASS (all pre-existing tests green before touching any code).

- [ ] **Step 2: Generalize the schedule-derived helpers to operate across resolved games**

In `packages/sports/src/sports-service.ts`, replace `lastMatchFor` (lines 812-819) with:

```ts
/** A schedule game paired with the literal `teamKey` it belongs to — needed once a merged card
 *  pools games from multiple competitions, each with its own competition-scoped team key. */
interface ResolvedGame {
  readonly game: GameSummary;
  readonly teamKey: string;
}

function toResolvedGames(schedule: readonly GameSummary[], teamKey: string): ResolvedGame[] {
  return schedule.map((game) => ({ game, teamKey }));
}

// Start time of the most recent completed game across one or more resolved games, from the same
// season schedule(s) that feed the form pips. The ticker treats "played within the last ten days"
// as in-season and ranks those teams ahead of idle ones (live feedback mra54n4h). Null when no
// resolved game is a final.
function lastMatchAcross(games: readonly ResolvedGame[]): string | null {
  let latest: string | null = null;
  for (const { game, teamKey } of games) {
    if (game.state !== "final" || !sideFor(game, teamKey)) continue;
    if (latest === null || game.startsAt > latest) latest = game.startsAt;
  }
  return latest;
}

function lastMatchFor(schedule: readonly GameSummary[], teamKey: string): string | null {
  return lastMatchAcross(toResolvedGames(schedule, teamKey));
}
```

Replace `teamStories` + its preceding comment/`TEAM_STORY_LIMIT` block (lines 783-807) with:

```ts
// Up to three of the club's stories, newest first, from the already-merged league + per-team
// feeds (live feedback mrb0pk1n — "three stories per team… real news for their clubs"). Replaces
// the single newest-headline pick AND the old client-side title-matching in the ticker: the
// service's teamKeys tagging (per-team ESPN feed + resolveHeadlineTeamKeys) is the one source of
// truth for "about this club". Dedup by url — the same story can arrive from both feeds under
// different ids.
const TEAM_STORY_LIMIT = 3;

function filterTeamHeadlines(
  headlines: readonly SourceHeadline[],
  teamKey: string
): SourceHeadline[] {
  return headlines.filter((h) => h.teamKeys.includes(teamKey));
}

function toTeamStories(headlines: readonly SourceHeadline[]): FollowedTeamNews[] {
  const seen = new Set<string>();
  return headlines
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
    .slice(0, TEAM_STORY_LIMIT)
    .map((h) => ({
      // publishedAt rides along so the ticker can rank idle teams by news freshness (mra54n4h);
      // imageUrl feeds the small thumbnail on the lead story (mra5xnt2).
      title: h.title,
      url: safeHref(h.url), // same javascript:/data: href guard as toPublicHeadline (#857 M2)
      publishedAt: h.publishedAt,
      imageUrl: h.imageUrl
    }));
}

function teamStories(headlines: readonly SourceHeadline[], teamKey: string): FollowedTeamNews[] {
  return toTeamStories(filterTeamHeadlines(headlines, teamKey));
}
```

Replace `computeForm` (lines 843-857) with:

```ts
function computeFormAcross(games: readonly ResolvedGame[]): readonly ("W" | "D" | "L")[] {
  return games
    .filter(({ game, teamKey }) => game.state === "final" && sideFor(game, teamKey))
    .slice()
    .sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))
    .slice(-FORM_LENGTH)
    .map(({ game, teamKey }) => {
      const side = sideFor(game, teamKey);
      const opponent = opponentFor(game, teamKey);
      return side && opponent ? resultOf(side, opponent) : "L";
    });
}

function computeForm(
  schedule: readonly GameSummary[],
  teamKey: string
): readonly ("W" | "D" | "L")[] {
  return computeFormAcross(toResolvedGames(schedule, teamKey));
}
```

Replace `nextMatchFor` (lines 911-931) with:

```ts
function nextMatchAcross(games: readonly ResolvedGame[], now: Date): FollowedNextMatch | null {
  const nowIso = now.toISOString();
  const next = games
    .filter(
      ({ game, teamKey }) =>
        game.state !== "final" && game.startsAt > nowIso && sideFor(game, teamKey)
    )
    .slice()
    .sort((a, b) => a.game.startsAt.localeCompare(b.game.startsAt))[0];
  if (!next) return null;
  const opponent = opponentFor(next.game, next.teamKey);
  if (!opponent) return null;
  return {
    opponentName: opponent.name,
    homeAway: next.game.home.teamKey === next.teamKey ? "home" : "away",
    startsAt: next.game.startsAt,
    // Footer identifies the opponent by crest, not name (live feedback mrawvc48)
    opponentCrestUrl: opponent.crestUrl
  };
}

function nextMatchFor(
  schedule: readonly GameSummary[],
  teamKey: string,
  now: Date
): FollowedNextMatch | null {
  return nextMatchAcross(toResolvedGames(schedule, teamKey), now);
}
```

- [ ] **Step 3: Run the existing suite to verify no regression**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: PASS — same test count, same results as Step 1 (behavior is byte-identical; only the
internal implementation changed).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0 (no unused-export or type errors from the new `ResolvedGame` type / functions —
they're used by their thin wrappers even before Task 3 wires the `Across` versions directly).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/sports-service.ts
git commit -m "refactor(sports): generalize per-team schedule helpers to cross-competition primitives (#855)"
```

---

## Task 3: Wire grouping into `getOverview()` — merged `FollowedTeamCard`s

**Files:**

- Modify: `packages/sports/src/sports-service.ts`
  - imports (top of file)
  - `getOverview()` cards-building block (currently lines 193-243)
  - `buildCard` method (currently lines 530-591) → replaced by `buildGroupedCard`
  - `followedTeams` filter predicate (currently line 152), `buildHero` signature (line 486),
    `rankTopStories` signature (line 698) — swap inline `SportsFollowDto & { teamKey: string }`
    for the imported `ResolvedFollow` type (no behavior change)
  - `currentTeamGame` (line 749) stays unchanged; add `currentGameAcrossGroup` after it
  - add `firstDefined` and `joinLabels` pure helpers
- Test: `tests/unit/sports-service.test.ts` (new `describe` block)

**Interfaces:**

- Consumes (from Task 1): `groupFollowedTeams`, `type ResolvedFollow`, `type FollowedTeamGroup`
  from `./followed-groups.js`.
- Consumes (from Task 2): `toResolvedGames`, `computeFormAcross`, `nextMatchAcross`,
  `lastMatchAcross`, `filterTeamHeadlines`, `toTeamStories`.
- Produces: `interface FollowedTeamBundle { follow: ResolvedFollow; sourceTeamId: string | null; scoreboard: readonly GameSummary[]; standings: StandingsTable["sections"]; headlines: readonly SourceHeadline[]; schedule: readonly GameSummary[]; teams: readonly SourceTeamRef[] }`;
  `buildGroupedCard(group: FollowedTeamGroup, bundles: ReadonlyMap<string, FollowedTeamBundle>, now: Date): FollowedTeamCard`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/sports-service.test.ts` (new `describe` block, after the existing
`describe("SportsService.getOverview", ...)` block):

```ts
describe("SportsService.getOverview — followed-team dedupe (#855)", () => {
  const livFollow: SportsFollowDto = {
    id: "f-epl",
    competitionKey: "eng.1",
    teamKey: "liv",
    createdAt: "2026-06-01T00:00:00.000Z"
  };
  const livcFollow: SportsFollowDto = {
    id: "f-ucl",
    competitionKey: "uefa.champions",
    teamKey: "livc",
    createdAt: "2026-06-15T00:00:00.000Z" // newer, but eng.1 is a league → still primary
  };

  const eplStandings: StandingsTable = {
    sections: [
      {
        label: null,
        rows: [
          {
            teamKey: "liv",
            name: "Liverpool",
            rank: 2,
            points: 58,
            wins: 18,
            losses: 3,
            draws: 4,
            winPercent: null,
            qualifies: true,
            qualificationNote: null,
            qualificationColor: null
          }
        ]
      }
    ]
  };
  const uclStandings: StandingsTable = {
    sections: [
      {
        label: "Group A",
        rows: [
          {
            teamKey: "livc",
            name: "Liverpool",
            rank: 1,
            points: 12,
            wins: 4,
            losses: 0,
            draws: 0,
            winPercent: null,
            qualifies: true,
            qualificationNote: null,
            qualificationColor: null
          }
        ]
      }
    ]
  };

  const eplNextMatch: GameSummary = {
    id: "epl-next",
    competitionKey: "eng.1",
    startsAt: "2026-07-10T19:00:00.000Z",
    state: "pre",
    statusDetail: "Fri 3:00 PM",
    home: side({ teamKey: "liv", shortName: "LIV", name: "Liverpool" }),
    away: side({ teamKey: "eve", shortName: "EVE", name: "Everton" })
  };
  const uclNextMatch: GameSummary = {
    id: "ucl-next",
    competitionKey: "uefa.champions",
    startsAt: "2026-07-05T19:00:00.000Z", // soonest across the merged group
    state: "pre",
    statusDetail: "Sun 3:00 PM",
    home: side({ teamKey: "livc", shortName: "LIV", name: "Liverpool" }),
    away: side({ teamKey: "bar", shortName: "BAR", name: "Barcelona" })
  };

  const eplHeadline: SourceHeadline = {
    id: "h-epl",
    competitionKey: "eng.1",
    competitionLabel: "Premier League",
    title: "Liverpool close in on the title",
    url: "https://example.com/liv-epl",
    publishedAt: "2026-06-30T10:00:00.000Z",
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: ["364"]
  };
  const uclHeadlineDuplicateUrl: SourceHeadline = {
    id: "h-ucl-dup",
    competitionKey: "uefa.champions",
    competitionLabel: "Champions League",
    title: "Liverpool close in on the title", // same story, same url, different feed/id
    url: "https://example.com/liv-epl",
    publishedAt: "2026-06-29T10:00:00.000Z",
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: ["364"]
  };
  const uclHeadlineUnique: SourceHeadline = {
    id: "h-ucl-unique",
    competitionKey: "uefa.champions",
    competitionLabel: "Champions League",
    title: "Liverpool through to the quarter-finals",
    url: "https://example.com/liv-ucl",
    publishedAt: "2026-07-01T09:00:00.000Z",
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: ["364"]
  };

  function makeMergedDeps(
    overrides: { follows?: SportsFollowDto[] } = {}
  ): SportsServiceDependencies {
    let scheduleCalls = 0;
    let teamHeadlineCalls = 0;
    const deps = makeDeps({
      follows: overrides.follows ?? [livFollow, livcFollow],
      source: makeDatasetClient({
        listTeams: async (competitionKey) => [
          {
            teamKey: competitionKey === "eng.1" ? "liv" : "livc",
            competitionKey,
            name: "Liverpool",
            shortName: "LIV",
            crestUrl: "https://a.espncdn.com/i/teamlogos/soccer/500/liv.png",
            sourceTeamId: "364" // same club, same ESPN soccer id, across both competitions
          }
        ],
        getScoreboard: async () => [], // no game today on either competition → status "news"
        getStandings: async (competitionKey) =>
          competitionKey === "eng.1" ? eplStandings : uclStandings,
        getSchedule: async (teamKey) => {
          scheduleCalls++;
          return teamKey === "liv" ? [eplNextMatch] : [uclNextMatch];
        },
        getHeadlines: async (competitionKey, teamKey) => {
          if (teamKey) {
            teamHeadlineCalls++;
            return competitionKey === "eng.1"
              ? [eplHeadline]
              : [uclHeadlineDuplicateUrl, uclHeadlineUnique];
          }
          return []; // league-wide feed empty for this fixture — only per-team feeds matter here
        }
      })
    });
    return Object.assign(deps, {
      __scheduleCalls: () => scheduleCalls,
      __teamHeadlineCalls: () => teamHeadlineCalls
    });
  }

  it("merges the same club followed across two competitions into one card", async () => {
    const service = new SportsService(makeMergedDeps());
    const overview = await service.getOverview(userA);
    expect(overview.followed).toHaveLength(1);
  });

  it("uses the primary (league) follow for teamKey/competitionKey/competitionLabel", async () => {
    const service = new SportsService(makeMergedDeps());
    const overview = await service.getOverview(userA);
    const card = overview.followed[0]!;
    expect(card.teamKey).toBe("liv");
    expect(card.competitionKey).toBe("eng.1");
    expect(card.competitionLabel).toBe("Premier League");
  });

  it("takes standing from the primary (league) competition only", async () => {
    const service = new SportsService(makeMergedDeps());
    const overview = await service.getOverview(userA);
    expect(overview.followed[0]!.standing).toBe("#2 · 58 pts");
  });

  it("takes nextMatch as the soonest future match across both competitions", async () => {
    const service = new SportsService(makeMergedDeps());
    const overview = await service.getOverview(userA);
    expect(overview.followed[0]!.nextMatch).toEqual({
      opponentName: "Barcelona",
      homeAway: "home",
      startsAt: "2026-07-05T19:00:00.000Z",
      opponentCrestUrl: null
    });
  });

  it("pools stories from both competitions' per-team feeds, deduped by url", async () => {
    const service = new SportsService(makeMergedDeps());
    const overview = await service.getOverview(userA);
    const urls = overview.followed[0]!.stories.map((s) => s.url);
    expect(urls).toContain("https://example.com/liv-epl");
    expect(urls).toContain("https://example.com/liv-ucl");
    expect(urls).toHaveLength(2); // the duplicate-url UCL headline did not add a third entry
  });

  it("names both followed competitions in the rationale via an Oxford join", async () => {
    const service = new SportsService(makeMergedDeps());
    const overview = await service.getOverview(userA);
    expect(overview.followed[0]!.rationale).toBe(
      "You follow Liverpool in Premier League and Champions League."
    );
  });

  it("fetches schedule/team-headlines once per followed competition, not per merged card", async () => {
    const deps = makeMergedDeps() as SportsServiceDependencies & {
      __scheduleCalls: () => number;
      __teamHeadlineCalls: () => number;
    };
    const service = new SportsService(deps);
    await service.getOverview(userA);
    expect(deps.__scheduleCalls()).toBe(2);
    expect(deps.__teamHeadlineCalls()).toBe(2);
  });

  it("does not merge a follow whose sourceTeamId is unresolved, even if it would collide", async () => {
    const unresolved: SportsFollowDto = {
      id: "f-unresolved",
      competitionKey: "usa.1",
      teamKey: "liv2",
      createdAt: "2026-06-20T00:00:00.000Z"
    };
    const service = new SportsService(
      makeDeps({
        follows: [livFollow, unresolved],
        source: makeDatasetClient({
          listTeams: async (competitionKey) =>
            competitionKey === "eng.1"
              ? [
                  {
                    teamKey: "liv",
                    competitionKey,
                    name: "Liverpool",
                    shortName: "LIV",
                    crestUrl: null,
                    sourceTeamId: "364"
                  }
                ]
              : [], // usa.1 team lookup misses → sourceTeamId resolves to null for f-unresolved
          getScoreboard: async () => [],
          getStandings: async () => ({ sections: [] }),
          getSchedule: async () => [],
          getHeadlines: async () => []
        })
      })
    );
    const overview = await service.getOverview(userA);
    expect(overview.followed).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: FAIL on the new `describe("SportsService.getOverview — followed-team dedupe (#855)", ...)`
block — e.g. `expect(overview.followed).toHaveLength(1)` receives `2` (no grouping exists yet).

- [ ] **Step 3: Implement grouping in `sports-service.ts`**

Add to the imports at the top of `packages/sports/src/sports-service.ts` (after the existing
`./news-ranking.js` import):

```ts
import {
  groupFollowedTeams,
  type FollowedTeamGroup,
  type ResolvedFollow
} from "./followed-groups.js";
```

Replace the inline narrowed type in three places with the imported `ResolvedFollow`:

- Line 152-154 (`followedTeams` declaration):

```ts
const followedTeams = follows.filter((f): f is ResolvedFollow => Boolean(f.teamKey));
```

- `buildHero`'s first parameter (line 486): `followedTeams: readonly ResolvedFollow[],`
- `rankTopStories`'s second parameter (line 698): `followedTeams: readonly ResolvedFollow[],`

Add this interface near the other module-level interfaces (after `DegradeState`, before the
`SportsService` class):

```ts
/** Everything needed to build one member of a merged `FollowedTeamCard` — the same per-follow
 *  data `buildCard` used to consume directly, now stashed so a group's members can be pooled. */
interface FollowedTeamBundle {
  readonly follow: ResolvedFollow;
  readonly sourceTeamId: string | null;
  readonly scoreboard: readonly GameSummary[];
  readonly standings: StandingsTable["sections"];
  readonly headlines: readonly SourceHeadline[];
  readonly schedule: readonly GameSummary[];
  readonly teams: readonly SourceTeamRef[];
}
```

Replace the cards-building block inside `getOverview()` (currently lines 193-243, from
`// One schedule fetch per followed team...` through the closing `);` of the `Promise.all`) with:

```ts
// One schedule fetch per followed team, also parallelized (#765 M2). Each follow's fetched
// data is stashed as a bundle rather than piped straight into a card — a merged card (#855)
// needs to pool a whole group's bundles, not just one.
const bundleList: FollowedTeamBundle[] = await Promise.all(
  followedTeams.map(async (follow) => {
    // Resolve the provider's numeric team id from the catalog: ESPN's soccer schedule
    // endpoint returns an empty payload for abbreviation slugs, which silently zeroed
    // form/next-match on every soccer card (live feedback mrawhx9c). Null falls back to
    // the abbreviation inside the source, which the US leagues accept.
    const sourceTeamId =
      (teamsByComp.get(follow.competitionKey) ?? []).find((team) => team.teamKey === follow.teamKey)
        ?.sourceTeamId ?? null;
    // The league-wide feed rarely files a story under a specific team, so most followed
    // cards showed "No recent news" while ESPN's per-team feed had plenty (live feedback
    // mraxssnf). Pull each followed team's own feed — same pattern as the gameday hero
    // block below — and merge it in for this card only; leagueNews stays league-scoped.
    const [schedule, teamFeed] = await Promise.all([
      this.cached<GameSummary[]>(
        "schedule",
        { teamKey: follow.teamKey, competitionKey: follow.competitionKey, sourceTeamId },
        [],
        state
      ),
      this.cached<SourceHeadline[]>(
        "headlines",
        { competitionKey: follow.competitionKey, teamKey: follow.teamKey },
        [],
        state
      )
    ]);
    const compTeams = teamsByComp.get(follow.competitionKey) ?? [];
    const leagueHeadlines = headlinesByComp.get(follow.competitionKey) ?? [];
    const seen = new Set(leagueHeadlines.map((h) => h.id));
    const headlines = [...leagueHeadlines];
    for (const headline of resolveHeadlineTeamKeys(teamFeed, compTeams)) {
      if (seen.has(headline.id)) continue;
      seen.add(headline.id);
      headlines.push(headline);
    }
    return {
      follow,
      sourceTeamId,
      scoreboard: scoreboardByComp.get(follow.competitionKey) ?? [],
      standings: standingsByComp.get(follow.competitionKey)?.sections ?? [],
      headlines,
      schedule,
      teams: compTeams
    };
  })
);
const bundles = new Map(bundleList.map((b) => [b.follow.id, b]));
// Group by canonical club key (espnSport:sourceTeamId) — spec's dedupe rule (#855). A follow
// whose sourceTeamId didn't resolve becomes its own singleton group (never merged by name).
const groups = groupFollowedTeams(followedTeams, (f) => bundles.get(f.id)!.sourceTeamId);
const cards: FollowedTeamCard[] = groups.map((group) =>
  this.buildGroupedCard(group, bundles, this.now())
);
```

Replace the `buildCard` method (currently lines 530-591, the whole method from
`private buildCard(` through its closing `}`) with:

```ts
  private buildGroupedCard(
    group: FollowedTeamGroup,
    bundles: ReadonlyMap<string, FollowedTeamBundle>,
    now: Date
  ): FollowedTeamCard {
    // Primary-first: the primary follow's data wins every precedence tie below (spec Design).
    const orderedFollows = [
      group.primary,
      ...group.follows.filter((f) => f.id !== group.primary.id)
    ];
    const orderedBundles = orderedFollows.map((f) => bundles.get(f.id)!);
    const primaryBundle = orderedBundles[0]!;
    const comp = group.primary.competitionKey;
    const competitionLabel = catalogEntry(comp)?.label ?? comp;

    const todayGame = currentGameAcrossGroup(
      orderedBundles.map((b) => ({ scoreboard: b.scoreboard, teamKey: b.follow.teamKey })),
      now
    );
    const todaySide = todayGame ? sideFor(todayGame.game, todayGame.teamKey) : undefined;
    const catalogTeamFor = (b: FollowedTeamBundle) =>
      b.teams.find((t) => t.teamKey === b.follow.teamKey);
    // D1: today side → catalog → schedule → last-resort uppercase key, same precedence as the
    // old single-team buildCard, now searched primary-first across the group's bundles.
    const name =
      todaySide?.name ??
      firstDefined(orderedBundles, (b) => catalogTeamFor(b)?.name) ??
      firstDefined(orderedBundles, (b) => scheduleSideFor(b.schedule, b.follow.teamKey)?.name) ??
      group.primary.teamKey.toUpperCase();
    const crestUrl =
      todaySide?.crestUrl ??
      firstDefined(orderedBundles, (b) => catalogTeamFor(b)?.crestUrl) ??
      firstDefined(
        orderedBundles,
        (b) => scheduleSideFor(b.schedule, b.follow.teamKey)?.crestUrl
      ) ??
      null;

    let status: FollowedTeamCard["status"];
    let primary: string;
    let todayGameState: FollowedTeamCard["todayGameState"];
    if (todayGame && todayGame.game.state === "live") {
      status = "live";
      primary = scoreLine(todayGame.game);
    } else if (todayGame) {
      status = "today";
      todayGameState = todayGame.game.state === "final" ? "final" : "pre";
      primary =
        todayGame.game.state === "final"
          ? resultLine(todayGame.game, todayGame.teamKey)
          : matchupLine(todayGame.game);
    } else {
      status = "news";
      primary = "";
    }

    const resolvedGames = orderedBundles.flatMap((b) =>
      toResolvedGames(b.schedule, b.follow.teamKey)
    );
    const storyPool = orderedBundles.flatMap((b) =>
      filterTeamHeadlines(b.headlines, b.follow.teamKey)
    );
    const competitionLabels = orderedBundles.map(
      (b) => catalogEntry(b.follow.competitionKey)?.label ?? b.follow.competitionKey
    );

    return {
      teamKey: group.primary.teamKey,
      competitionKey: comp,
      competitionLabel,
      name,
      crestUrl,
      status,
      primary,
      todayGameState,
      stories: toTeamStories(storyPool),
      form: computeFormAcross(resolvedGames),
      // standing comes ONLY from the primary competition (spec Design) — a Champions League
      // group table would be meaningless as "the" standing for a club whose default identity is
      // its domestic league position.
      standing: standingLine(primaryBundle.standings, group.primary.teamKey),
      nextMatch: nextMatchAcross(resolvedGames, now),
      // Crest-led result for the featured strip's score slot (Ben 2026-07-08 /sports #2). Only a
      // finished today game qualifies.
      resultMatch:
        todayGame && todayGame.game.state === "final"
          ? resultMatchFor(todayGame.game, todayGame.teamKey)
          : null,
      lastMatchAt: lastMatchAcross(resolvedGames),
      rationale:
        orderedBundles.length === 1
          ? `You follow ${name}.`
          : `You follow ${name} in ${joinLabels(competitionLabels)}.`
    };
  }
```

Add these pure helpers after `currentTeamGame` (after line 761, before `sideFor`):

```ts
/** The "today game" for a merged card, mirroring `buildHero`'s live > non-live-else-first
 *  priority (#855): a live game anywhere in the group always wins; otherwise the first bundle
 *  (primary-first order) with a qualifying today game keeps it. */
function currentGameAcrossGroup(
  bundles: readonly { scoreboard: readonly GameSummary[]; teamKey: string }[],
  now: Date
): { game: GameSummary; teamKey: string } | undefined {
  let result: { game: GameSummary; teamKey: string } | undefined;
  for (const bundle of bundles) {
    const game = currentTeamGame(bundle.scoreboard, bundle.teamKey, now);
    if (!game) continue;
    if (!result || (game.state === "live" && result.game.state !== "live")) {
      result = { game, teamKey: bundle.teamKey };
    }
  }
  return result;
}
```

Add these pure helpers near the top of the "pure helpers" section (after `unique`, before
`groupStageComplete`):

```ts
/** First non-null/non-undefined value `pick` returns over `items`, in order. Used to search a
 *  primary-first bundle list for name/crest precedence without collapsing to a single bundle. */
function firstDefined<T, R>(
  items: readonly T[],
  pick: (item: T) => R | null | undefined
): R | undefined {
  for (const item of items) {
    const value = pick(item);
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

// "A", "A and B", "A, B, and C" — the merged card's rationale names every followed competition
// (spec Design: `You follow Liverpool in Premier League and Champions League.`).
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: PASS — every pre-existing test (singleton-follow behavior is a size-1 group, reducing
to the same output the old `buildCard` produced) plus every new dedupe test in the block above.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: exit 0. (`selectPrimaryFollow` and `canonicalClubKey` from Task 1 are exercised only by
`followed-groups.test.ts`, not imported into `sports-service.ts` — expected, not a lint error.)

- [ ] **Step 6: Commit**

```bash
git add packages/sports/src/sports-service.ts tests/unit/sports-service.test.ts
git commit -m "feat(sports): merge followed-team cards across competitions by club (#855)"
```

---

## Task 4: Full gate + acceptance-criteria pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full local gate**

Run: `pnpm verify:foundation`
Expected: exit 0. (= lint + format:check + check:file-size + check:design-tokens +
check:no-ambient-dates + check:package-deps + typecheck + test:unit + db:migrate +
test:integration.)

- [ ] **Step 2: Walk every spec Acceptance Criterion and confirm a test covers it**

From `docs/superpowers/specs/2026-07-08-sports-followed-team-dedupe.md`:

- [ ] Same club in multiple competitions → one card — Task 3 "merges the same club..." test.
- [ ] Rows without `sourceTeamId` not merged by name — Task 3 "does not merge a follow whose
      sourceTeamId is unresolved..." test.
- [ ] Whole-competition follows never enter the grouping path — unchanged: `followedTeams` (the
      only input to `groupFollowedTeams`) is still filtered to `Boolean(f.teamKey)` before
      grouping; `followedLeagues` is built separately and untouched.
- [ ] No duplicate downstream calls for identical `(competitionKey, sourceTeamId)` pairs — Task 3
      "fetches schedule/team-headlines once per followed competition..." test.
- [ ] Merged card's news pooled + deduped by url — Task 3 "pools stories from both
      competitions'..." test.
- [ ] Merged nextMatch = soonest across competitions — Task 3 "takes nextMatch as the soonest
      future match..." test.
- [ ] Merged standing from the primary league — Task 3 "takes standing from the primary
      (league) competition only" test.
- [ ] Existing competition-scoped follows remain removable from Settings — unchanged: no
      `sports_follows` schema or repository/route change in this slice.
- [ ] No raw source IDs / private / cross-user data exposed — `FollowedTeamBundle.sourceTeamId`
      and `canonicalClubKey`'s key never leave `sports-service.ts`/`followed-groups.ts`; the
      response shape (`FollowedTeamCard`) is unchanged from the existing (already-reviewed)
      shared-API schema.
- [ ] `pnpm verify:foundation` passes — Step 1 above.

- [ ] **Step 3: If CI is unavailable, record the exact local commands and exit codes used**

Follow `CLAUDE.md` "Orientation" — note the `pnpm verify:foundation` exit code (and any command
substituted for it) in the PR/report handed to the coordinator.
