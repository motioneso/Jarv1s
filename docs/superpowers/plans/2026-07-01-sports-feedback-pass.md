# Sports Feedback Pass Implementation Plan

> **For agentic workers:** This repo's superpowers execution skills are **disabled by design**. Do
> not use `subagent-driven-development` / `executing-plans`. Execute with the project's build
> engine (background Workflow or inline Agent dispatch) per the `/start` build-engine heuristic.
> Build agents run on **Sonnet**; each task commits green with the
> `Co-Authored-By: Claude <noreply@anthropic.com>` trailer; `git add` only that task's files.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md` (approved 2026-07-01)
**Issue:** #668 (feedback pass on `/sports` after PR #666)

**Goal:** Make the `/sports` page real — real crests/photos via a CSP seam, source links
everywhere, team-tagged news relevance, full names + structured next-match dates, a ranked Top
Stories rail plus a league-news section, and competition-correct standings shapes.

**Architecture:** All provider knowledge stays behind `SportsSource`. The source gains
`imageHosts` (folded into the web CSP by the composition root — LOADER-SEAM(sports) 7) and
enriched server-only types (`SourceTeamRef.sourceTeamId`, `SourceHeadline.sourceTeamIds`); the
service joins provider team tags to `teamKeys`, composes ranked `topStories` / grouped
`leagueNews`, and emits structured `nextMatch` + `followedTeams` pairs; Fastify response schemas
(`additionalProperties: false`) strip the server-only fields. The web page renders shape-aware
standings, external story links, and photos.

**Tech Stack:** TypeScript, Fastify JSON schemas in `@jarv1s/shared`, Vitest (unit fixtures for
the ESPN adapter, SSR `renderToString` for the page), React + TanStack Query, authored `sp-*` CSS.

## Global Constraints

- **Module isolation:** sports logic only in `packages/sports`, `packages/shared/src/sports-api.ts`,
  `apps/web/src/sports/`, `apps/web/src/api/sports-client.ts`. Composition-root wiring only in
  `packages/module-registry`. `apps/api` has **no** direct `@jarv1s/sports` dependency — CSP hosts
  flow sports → module-registry → `apps/api/src/static-web.ts`.
- **Provider-agnostic:** no ESPN identifier outside `packages/sports/src/source/`. Every
  hand-wire is tagged `LOADER-SEAM(sports) <n>`.
- **No fabricated content in prod** (spec D-7): no mock images, placeholder headlines, or fake
  dates ever render; missing data falls back to authored empty states (initials swatch, "No
  recent news").
- **Secrets/leakage:** `sourceTeamId` / `sourceTeamIds` never reach responses (pinned by tests).
- **Typecheck is workspace-wide:** any DTO change must update shared + service + web + test
  fixtures in the same task/commit.
- **Design system:** `sp-*` classes, tokens only (`var(--text)`, `var(--surface)`, …); raw colors
  live only in `apps/web/src/styles/tokens.css`. Result colors never red (win=pine, draw=steel,
  loss=neutral). No curved colored left-border card accents.
- **File-size gate (1000 lines):** `sports-1.css` is at 992 — all new CSS goes to a new
  `apps/web/src/styles/sports-2.css` (imported after sports-1). New news components go in
  `apps/web/src/sports/sports-news.tsx` to keep `sports-page.tsx` under the cap.
- **Caps (spec, Ben-approved):** `topStories` cap **6**; `leagueNews` has **no hard cap**
  (bounded by one provider news page per competition). Form pips stay `FORM_LENGTH = 5`.
- **Never edit applied migrations** (none needed here — this pass touches no SQL).
- Docs use `~/Jarv1s` paths, never absolute `/home/...`.

## Coordination

The repo may host other live sessions. Stage only the exact paths listed in each task's commit
step — never `git add -A` / `git add .`. Run `pnpm verify:foundation` before the final push; if a
shared dev Postgres is contended, scope to the unit gate per task and run the full gate once in
Task 7.

## File Structure

| Path                                          | Role in this pass                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/shared/src/sports-api.ts`           | DTO + JSON-schema revisions (Headline, cards, standings, overview)                |
| `packages/sports/src/source/sports-source.ts` | Seam interface: `imageHosts`, `SourceTeamRef`, `SourceHeadline`, `StandingsTable` |
| `packages/sports/src/source/espn-source.ts`   | Adapter: image hosts, news images/tags, team ids, sectioned standings             |
| `packages/sports/src/source/catalog.ts`       | `standingsShape` per competition                                                  |
| `packages/sports/src/sports-service.ts`       | Joins, card composition, `topStories`/`leagueNews` ranking                        |
| `packages/module-registry/src/index.ts`       | `MODULE_IMAGE_CSP_HOSTS` export (LOADER-SEAM(sports) 7)                           |
| `apps/api/src/static-web.ts`                  | `SPA_CSP` composed from module image hosts (exported)                             |
| `infra/nginx/jarv1s-web.conf`                 | Mirrored `img-src` (sync pinned by test)                                          |
| `apps/web/src/sports/sports-page.tsx`         | Pair-based "You", shape-aware standings, card/news/next-match rendering           |
| `apps/web/src/sports/sports-news.tsx`         | New: `StoryHero` photo/link, `TopStoriesRail`, `LeagueNewsSection`                |
| `apps/web/src/styles/sports-2.css`            | New CSS (photos, news grid)                                                       |
| `packages/sports/src/source/__fixtures__/*`   | Augmented news fixture; new `fifa-standings.json`, `nfl-standings.json`           |
| `tests/unit/*`                                | espn-source, sports-service, sports-routes, sports-page, new static-web-csp       |

---

### Task 1: CSP image hosts (workstream A1)

**Files:**

- Modify: `packages/sports/src/source/sports-source.ts`
- Modify: `packages/sports/src/source/espn-source.ts`
- Modify: `packages/module-registry/src/index.ts` (sports section, ~line 796)
- Modify: `apps/api/src/static-web.ts` (SPA_CSP const, lines 29–32)
- Modify: `infra/nginx/jarv1s-web.conf` (line 22)
- Modify: `tests/unit/sports-service.test.ts`, `tests/unit/sports-routes.test.ts` (fake sources)
- Create: `tests/unit/static-web-csp.test.ts`

**Interfaces:**

- Produces: `SportsSource.imageHosts: readonly string[]`;
  `ESPN_IMAGE_HOSTS` in espn-source; `MODULE_IMAGE_CSP_HOSTS: readonly string[]` exported from
  `@jarv1s/module-registry`; `SPA_CSP` exported from `apps/api/src/static-web.ts`. Later tasks'
  fake `SportsSource` objects must include `imageHosts`.

- [ ] **Step 1: Write the failing CSP test**

Create `tests/unit/static-web-csp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SPA_CSP } from "../../apps/api/src/static-web.js";

const EXPECTED_IMG_SRC = "img-src 'self' data: https://a.espncdn.com https://s.secure.espncdn.com";

describe("SPA CSP image hosts", () => {
  it("folds the composed SportsSource image hosts into img-src", () => {
    expect(SPA_CSP).toContain(EXPECTED_IMG_SRC);
  });

  it("keeps every other directive unchanged", () => {
    expect(SPA_CSP).toContain("default-src 'self'");
    expect(SPA_CSP).toContain("script-src 'self'");
    expect(SPA_CSP).toContain("frame-ancestors 'none'");
  });

  it("keeps the nginx CSP img-src in sync with the API CSP", () => {
    const conf = readFileSync(
      fileURLToPath(new URL("../../infra/nginx/jarv1s-web.conf", import.meta.url)),
      "utf8"
    );
    expect(conf).toContain(EXPECTED_IMG_SRC);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/static-web-csp.test.ts`
Expected: FAIL — `static-web.js` has no export named `SPA_CSP`.

- [ ] **Step 3: Add `imageHosts` to the seam and the adapter**

In `packages/sports/src/source/sports-source.ts`, add to the `SportsSource` interface (keep the
existing LOADER-SEAM(sports) header comment):

```ts
  /**
   * LOADER-SEAM(sports) 7: https hosts that crest/photo URLs returned by this source
   * resolve to. The composition root folds these into the web CSP img-src allowlist,
   * so swapping the source updates the CSP with it.
   */
  readonly imageHosts: readonly string[];
```

In `packages/sports/src/source/espn-source.ts`, add below the `CORE_BASE` const and as a class
field on `EspnSportsSource`:

```ts
// Hosts ESPN crest/photo URLs resolve to (team.logos + article images).
export const ESPN_IMAGE_HOSTS: readonly string[] = ["a.espncdn.com", "s.secure.espncdn.com"];
```

```ts
  readonly imageHosts = ESPN_IMAGE_HOSTS;
```

- [ ] **Step 4: Update every fake `SportsSource` literal**

Find them: `grep -rn "listTeams: async" tests/unit`. In each object literal implementing
`SportsSource` (at least `tests/unit/sports-service.test.ts` `makeSource` and the fake in
`tests/unit/sports-routes.test.ts`), add as the first property:

```ts
    imageHosts: [],
```

- [ ] **Step 5: Export the hosts from the composition root**

In `packages/module-registry/src/index.ts`, next to the sports registration (~line 796) — it
already imports `createEspnSportsSource`:

```ts
// LOADER-SEAM(sports) 7: the web CSP img-src allowlist follows the constructed source.
// Built from the same factory as the route wiring below so the two can never diverge.
export const MODULE_IMAGE_CSP_HOSTS: readonly string[] = createEspnSportsSource().imageHosts;
```

- [ ] **Step 6: Compose and export `SPA_CSP` in `apps/api/src/static-web.ts`**

Replace the existing `SPA_CSP` const (lines 29–32) with:

```ts
import { MODULE_IMAGE_CSP_HOSTS } from "@jarv1s/module-registry";

// LOADER-SEAM(sports): img-src extends to the hosts the composed SportsSource declares.
// infra/nginx/jarv1s-web.conf must carry the same img-src (pinned by
// tests/unit/static-web-csp.test.ts).
const IMG_SRC = ["'self'", "data:", ...MODULE_IMAGE_CSP_HOSTS.map((h) => `https://${h}`)].join(" ");

export const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src ${IMG_SRC}`,
  "font-src 'self' data:",
  "worker-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'"
].join("; ");
```

(Place the import with the other imports at the top of the file; the
`reply.header("Content-Security-Policy", SPA_CSP)` call site at ~line 106 is unchanged.)

If any existing test asserts the old literal `img-src 'self' data:` (check:
`grep -rn "img-src" tests/`), update it to the new expected string.

- [ ] **Step 7: Mirror in nginx**

In `infra/nginx/jarv1s-web.conf` line 22, change `img-src 'self' data:` to
`img-src 'self' data: https://a.espncdn.com https://s.secure.espncdn.com` and add above it:

```nginx
    # img-src must match SPA_CSP in apps/api/src/static-web.ts
    # (sync pinned by tests/unit/static-web-csp.test.ts).
```

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/static-web-csp.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts`
Expected: PASS. Then `pnpm typecheck` — expected exit 0.

- [ ] **Step 9: Commit**

```bash
git add packages/sports/src/source/sports-source.ts packages/sports/src/source/espn-source.ts \
  packages/module-registry/src/index.ts apps/api/src/static-web.ts infra/nginx/jarv1s-web.conf \
  tests/unit/static-web-csp.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts
git commit -m "#668 feat(sports): CSP img-src follows SportsSource image hosts" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Source enrichment — story images, team tags, provider team ids (A3 + C1 source half)

**Files:**

- Modify: `packages/shared/src/sports-api.ts` (`Headline` + `headlineSchema`)
- Modify: `packages/sports/src/source/sports-source.ts`
- Modify: `packages/sports/src/source/espn-source.ts`
- Modify: `packages/sports/src/sports-service.ts` (cache/type plumbing only)
- Modify: `packages/sports/src/source/__fixtures__/nfl-news.json`
- Modify: `tests/unit/espn-source.test.ts`, `tests/unit/sports-service.test.ts`,
  `tests/unit/sports-routes.test.ts`, `tests/unit/sports-page.test.tsx` (Headline fixtures gain
  the two new fields)

**Interfaces:**

- Consumes: `SportsSource.imageHosts` from Task 1 (fakes already updated).
- Produces (used by Tasks 4–6):

```ts
// packages/shared/src/sports-api.ts
export interface Headline {
  readonly id: string;
  readonly competitionKey: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly imageUrl: string | null; // first "header" image, else first image, else null
  readonly teamKeys: readonly string[]; // filled by the service join (Task 4); source emits []
}

// packages/sports/src/source/sports-source.ts
export interface SourceTeamRef extends TeamRef {
  /** Provider-side team id — joins news team tags to catalog teams. Never serialized. */
  readonly sourceTeamId: string | null;
}
export interface SourceHeadline extends Headline {
  /** Provider-side team ids tagged on the article; the service resolves these to teamKeys. */
  readonly sourceTeamIds: readonly string[];
}
// SportsSource methods change to:
//   listTeams(competitionKey: string): Promise<SourceTeamRef[]>
//   getHeadlines(competitionKey: string): Promise<SourceHeadline[]>
```

- [ ] **Step 1: Augment the news fixture**

Replace `packages/sports/src/source/__fixtures__/nfl-news.json` with:

```json
{
  "articles": [
    {
      "id": 4567,
      "headline": "Cowboys clinch the NFC East with a Week 18 win",
      "published": "2026-01-04T22:15:00Z",
      "links": { "web": { "href": "https://www.espn.com/nfl/story/_/id/4567" } },
      "images": [
        { "type": "header", "url": "https://a.espncdn.com/photo/2026/0104/cowboys-header.jpg" },
        { "type": "inline", "url": "https://a.espncdn.com/photo/2026/0104/cowboys-inline.jpg" }
      ],
      "categories": [
        { "type": "team", "teamId": 6 },
        { "type": "league", "leagueId": 28 }
      ]
    },
    {
      "id": 4568,
      "headline": "Patriots fall short in the season finale",
      "published": "2026-01-04T22:40:00Z",
      "links": { "web": { "href": "https://www.espn.com/nfl/story/_/id/4568" } }
    }
  ]
}
```

(Article 2 deliberately has no `images`/`categories` — pins the null/empty fallbacks.)

- [ ] **Step 2: Write the failing adapter tests**

In `tests/unit/espn-source.test.ts`, extend the news test and the teams test:

```ts
it("parses news images and provider team tags", async () => {
  const src = createEspnSportsSource(okFetch(fixture("nfl-news.json")));
  const headlines = await src.getHeadlines("nfl");
  expect(headlines[0]?.imageUrl).toBe("https://a.espncdn.com/photo/2026/0104/cowboys-header.jpg");
  expect(headlines[0]?.sourceTeamIds).toEqual(["6"]);
  expect(headlines[0]?.teamKeys).toEqual([]); // the service fills these, not the source
  expect(headlines[1]?.imageUrl).toBeNull();
  expect(headlines[1]?.sourceTeamIds).toEqual([]);
});

it("carries the provider team id on listTeams", async () => {
  const src = createEspnSportsSource(okFetch(fixture("nfl-teams.json")));
  const teams = await src.listTeams("nfl");
  expect(teams[0]?.sourceTeamId).toBe("6");
});
```

(If `nfl-teams.json`'s first team's `"id"` is not `"6"`, assert the fixture's actual value.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run tests/unit/espn-source.test.ts`
Expected: FAIL — `imageUrl`/`sourceTeamIds`/`sourceTeamId` undefined.

- [ ] **Step 4: Revise shared `Headline` + schema**

In `packages/shared/src/sports-api.ts`: add `imageUrl` and `teamKeys` to `Headline` (interface
above), and in `headlineSchema` extend `required` to
`["id", "competitionKey", "title", "url", "publishedAt", "imageUrl", "teamKeys"]` and add:

```ts
    imageUrl: { type: ["string", "null"] },
    teamKeys: { type: "array", items: { type: "string" } }
```

- [ ] **Step 5: Extend the seam types**

In `packages/sports/src/source/sports-source.ts`, add `SourceTeamRef` and `SourceHeadline`
exactly as in the Interfaces block, and change the interface method signatures to return
`Promise<SourceTeamRef[]>` / `Promise<SourceHeadline[]>`.

- [ ] **Step 6: Implement in the adapter**

In `packages/sports/src/source/espn-source.ts`:

`listTeams` — return type `Promise<SourceTeamRef[]>`; in the mapped object add
`sourceTeamId: team?.id ?? null` and change `satisfies TeamRef` to `satisfies SourceTeamRef`.
Import `SourceTeamRef`, `SourceHeadline` from `./sports-source.js`.

`getHeadlines` — replace the method body with:

```ts
  async getHeadlines(competitionKey: string): Promise<SourceHeadline[]> {
    const { sport, league } = resolve(competitionKey);
    const data = (await fetchJson(
      this.fetchFn,
      `${SITE_BASE}/${sport}/${league}/news`,
      `${league} news`
    )) as {
      articles?: readonly {
        id?: number | string;
        headline?: string;
        published?: string;
        links?: { web?: { href?: string } };
        images?: readonly { type?: string; url?: string }[];
        categories?: readonly { type?: string; teamId?: number | string }[];
      }[];
    };
    return (data.articles ?? []).map((article, index) => {
      const images = article.images ?? [];
      const image = images.find((i) => i.type === "header" && i.url) ?? images.find((i) => i.url);
      return {
        id: String(article.id ?? index),
        competitionKey,
        title: article.headline ?? "",
        url: article.links?.web?.href ?? "",
        publishedAt: article.published ?? "",
        imageUrl: image?.url ?? null,
        teamKeys: [],
        sourceTeamIds: (article.categories ?? [])
          .filter((c) => c.type === "team" && c.teamId != null)
          .map((c) => String(c.teamId))
      };
    });
  }
```

- [ ] **Step 7: Plumb the types through the service (no behavior change)**

In `packages/sports/src/sports-service.ts`:

- Import `SourceHeadline`, `SourceTeamRef` from `./source/sports-source.js`.
- Change the caches: `headlines` → `new SportsCache<SourceHeadline[]>()`; `teams` →
  `new SportsCache<SourceTeamRef[]>()` (drop the `SportsCatalogResponse[...]` generic).
- Change `headlinesByComp` to `Map<string, SourceHeadline[]>` and `buildHero`'s /
  `buildCard`'s `headlines` params to `readonly SourceHeadline[]`.

Fastify's `additionalProperties: false` strips `sourceTeamIds` / `sourceTeamId` when these
objects flow into overview/catalog responses.

- [ ] **Step 8: Update every `Headline` test fixture**

Typecheck now demands `imageUrl` + `teamKeys` (and `sourceTeamIds` for source-level fakes):

- `tests/unit/sports-service.test.ts` — `nflHeadlines` becomes `SourceHeadline[]` (import the
  type from `../../packages/sports/src/source/sports-source.js`); add
  `imageUrl: null, teamKeys: [], sourceTeamIds: ["6"]` to `h1`.
- `tests/unit/sports-page.test.tsx` — every headline object in `makeOverview()` gains
  `imageUrl: null, teamKeys: []`.
- `tests/unit/sports-routes.test.ts` — the fake source's headlines/teams gain the new fields;
  add leak-pin assertions to the existing overview and catalog tests:

```ts
expect(JSON.stringify(body)).not.toContain("sourceTeamIds");
expect(JSON.stringify(body)).not.toContain("sourceTeamId");
```

- Check `tests/unit/web-sports-client.test.ts` for Headline literals and extend the same way.

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/espn-source.test.ts tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts tests/unit/sports-page.test.tsx`
Expected: PASS. Then `pnpm typecheck` — exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/sports-api.ts packages/sports/src/source/sports-source.ts \
  packages/sports/src/source/espn-source.ts packages/sports/src/sports-service.ts \
  packages/sports/src/source/__fixtures__/nfl-news.json tests/unit/espn-source.test.ts \
  tests/unit/sports-service.test.ts tests/unit/sports-routes.test.ts tests/unit/sports-page.test.tsx
git commit -m "#668 feat(sports): headline images and provider team tags through the source seam" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

(Include `tests/unit/web-sports-client.test.ts` in the `git add` if Step 8 touched it.)

---

### Task 3: Competition-correct standings (workstream F)

**Files:**

- Modify: `packages/shared/src/sports-api.ts`
- Modify: `packages/sports/src/source/catalog.ts`
- Modify: `packages/sports/src/source/sports-source.ts`
- Modify: `packages/sports/src/source/espn-source.ts`
- Modify: `packages/sports/src/sports-service.ts`
- Modify: `apps/web/src/sports/sports-page.tsx` (`StandingsRail`)
- Create: `packages/sports/src/source/__fixtures__/fifa-standings.json`,
  `packages/sports/src/source/__fixtures__/nfl-standings.json`
- Modify: `tests/unit/espn-source.test.ts`, `tests/unit/sports-service.test.ts`,
  `tests/unit/sports-routes.test.ts`, `tests/unit/sports-page.test.tsx`,
  `tests/unit/sports-catalog.test.ts` (if it pins `CatalogEntry` shape)

**Interfaces:**

- Produces (used by Tasks 4–5):

```ts
// packages/shared/src/sports-api.ts
export type StandingsShape = "table" | "groups" | "record";

export interface StandingsRow {
  // existing fields unchanged, plus:
  readonly winPercent: number | null; // US leagues; null for soccer
}

export interface StandingsSection {
  readonly label: string | null; // "Group A", "American Football Conference"; null = single table
  readonly rows: readonly StandingsRow[];
}

export interface StandingsGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly standingsShape: StandingsShape;
  readonly sections: readonly StandingsSection[]; // replaces `rows`
}

export interface CompetitionRef {
  // existing fields unchanged, plus:
  readonly standingsShape: StandingsShape;
}

// packages/sports/src/source/sports-source.ts
export interface StandingsTable {
  readonly sections: readonly {
    readonly label: string | null;
    readonly rows: readonly StandingsRow[];
  }[];
}
// SportsSource.getStandings changes to: getStandings(competitionKey): Promise<StandingsTable>
```

- [ ] **Step 1: Create the standings fixtures**

`packages/sports/src/source/__fixtures__/fifa-standings.json` (two of the twelve live groups is
enough to pin the mapping):

```json
{
  "children": [
    {
      "name": "Group A",
      "standings": {
        "entries": [
          {
            "team": { "id": "202", "abbreviation": "MEX", "displayName": "Mexico" },
            "note": { "description": "Advances to knockout stage", "color": "#2a66d1" },
            "stats": [
              { "name": "rank", "value": 1 },
              { "name": "points", "value": 7 },
              { "name": "wins", "value": 2 },
              { "name": "losses", "value": 0 },
              { "name": "ties", "value": 1 }
            ]
          }
        ]
      }
    },
    {
      "name": "Group B",
      "standings": {
        "entries": [
          {
            "team": { "id": "660", "abbreviation": "ENG", "displayName": "England" },
            "stats": [
              { "name": "rank", "value": 2 },
              { "name": "points", "value": 4 },
              { "name": "wins", "value": 1 },
              { "name": "losses", "value": 0 },
              { "name": "ties", "value": 1 }
            ]
          }
        ]
      }
    }
  ]
}
```

`packages/sports/src/source/__fixtures__/nfl-standings.json`:

```json
{
  "children": [
    {
      "name": "American Football Conference",
      "standings": {
        "entries": [
          {
            "team": { "id": "17", "abbreviation": "NE", "displayName": "New England Patriots" },
            "stats": [
              { "name": "rank", "value": 1 },
              { "name": "wins", "value": 11 },
              { "name": "losses", "value": 1 },
              { "name": "winPercent", "value": 0.917 },
              { "name": "playoffSeed", "value": 1 }
            ]
          }
        ]
      }
    },
    {
      "name": "National Football Conference",
      "standings": {
        "entries": [
          {
            "team": { "id": "6", "abbreviation": "DAL", "displayName": "Dallas Cowboys" },
            "stats": [
              { "name": "rank", "value": 1 },
              { "name": "wins", "value": 10 },
              { "name": "losses", "value": 2 },
              { "name": "winPercent", "value": 0.833 },
              { "name": "playoffSeed", "value": 1 }
            ]
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing adapter tests**

In `tests/unit/espn-source.test.ts`, rewrite the eng.1 standings test and add two:

```ts
it("parses soccer standings as a single labelled-null section", async () => {
  const src = createEspnSportsSource(okFetch(fixture("eng1-standings.json")));
  const table = await src.getStandings("eng.1");
  expect(table.sections).toHaveLength(1);
  expect(table.sections[0]?.label).toBeNull();
  expect(table.sections[0]?.rows[0]).toMatchObject({
    teamKey: "ars",
    rank: 1,
    points: 46,
    wins: 14,
    losses: 2,
    draws: 4,
    winPercent: null,
    qualifies: true
  });
  expect(table.sections[0]?.rows[1]?.qualifies).toBe(false);
});

it("keeps every tournament group as its own section", async () => {
  const src = createEspnSportsSource(okFetch(fixture("fifa-standings.json")));
  const table = await src.getStandings("fifa.world");
  expect(table.sections.map((s) => s.label)).toEqual(["Group A", "Group B"]);
  expect(table.sections[0]?.rows[0]?.qualifies).toBe(true);
});

it("parses record-league conferences with winPercent", async () => {
  const src = createEspnSportsSource(okFetch(fixture("nfl-standings.json")));
  const table = await src.getStandings("nfl");
  expect(table.sections.map((s) => s.label)).toEqual([
    "American Football Conference",
    "National Football Conference"
  ]);
  expect(table.sections[1]?.rows[0]).toMatchObject({
    teamKey: "dal",
    wins: 10,
    losses: 2,
    winPercent: 0.833,
    points: null
  });
});
```

Note on the eng.1 fixture: `eng1-standings.json` has one unnamed child, so its single section's
label is `null` — exactly the single-table case.

Run: `pnpm vitest run tests/unit/espn-source.test.ts` — expected FAIL (`sections` undefined).

- [ ] **Step 3: Shared types + schemas**

In `packages/shared/src/sports-api.ts` apply the Interfaces block above, and update schemas:

```ts
const standingsRowSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "teamKey",
    "name",
    "rank",
    "points",
    "wins",
    "losses",
    "draws",
    "winPercent",
    "qualifies"
  ],
  properties: {
    teamKey: { type: "string" },
    name: { type: "string" },
    rank: { type: "number" },
    points: { type: ["number", "null"] },
    wins: { type: "number" },
    losses: { type: "number" },
    draws: { type: ["number", "null"] },
    winPercent: { type: ["number", "null"] },
    qualifies: { type: "boolean" }
  }
} as const;

const standingsSectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "rows"],
  properties: {
    label: { type: ["string", "null"] },
    rows: { type: "array", items: standingsRowSchema }
  }
} as const;

const standingsGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "competitionLabel", "standingsShape", "sections"],
  properties: {
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    standingsShape: { type: "string", enum: ["table", "groups", "record"] },
    sections: { type: "array", items: standingsSectionSchema }
  }
} as const;
```

In `competitionRefSchema`: add `"standingsShape"` to `required` and
`standingsShape: { type: "string", enum: ["table", "groups", "record"] }` to `properties`. In
`sportsCatalogResponseSchema`'s item `required`, add `"standingsShape"` (properties already
spread from `competitionRefSchema`).

- [ ] **Step 4: Catalog shapes**

In `packages/sports/src/source/catalog.ts`, add to `CatalogEntry`:

```ts
  readonly standingsShape: StandingsShape;
```

(import `StandingsShape` from `@jarv1s/shared`) and per row: `nfl`, `nba`, `nhl`, `mlb` →
`standingsShape: "record"`; `eng.1`, `usa.1` → `standingsShape: "table"`; `uefa.champions`,
`fifa.world` → `standingsShape: "groups"`.

- [ ] **Step 5: Adapter rewrite**

In `packages/sports/src/source/espn-source.ts`, add `StandingsTable` to the
`./sports-source.js` imports, extract a row mapper next to `statValue`:

```ts
function toStandingsRow(entry: EspnStandingsEntry): StandingsRow {
  const teamKey = (entry.team?.abbreviation ?? entry.team?.id ?? "").toLowerCase();
  return {
    teamKey,
    name: entry.team?.displayName ?? teamKey,
    rank: statValue(entry.stats, "rank") ?? 0,
    points: statValue(entry.stats, "points") ?? null,
    wins: statValue(entry.stats, "wins") ?? 0,
    losses: statValue(entry.stats, "losses") ?? 0,
    draws: statValue(entry.stats, "ties") ?? null,
    winPercent: statValue(entry.stats, "winPercent") ?? null,
    qualifies: entry.note != null
  };
}
```

and replace `getStandings` with:

```ts
  async getStandings(competitionKey: string): Promise<StandingsTable> {
    const { sport, league } = resolve(competitionKey);
    const data = (await fetchJson(
      this.fetchFn,
      `${CORE_BASE}/${sport}/${league}/standings`,
      `${league} standings`
    )) as {
      children?: readonly {
        name?: string;
        abbreviation?: string;
        standings?: { entries?: readonly EspnStandingsEntry[] };
      }[];
      standings?: { entries?: readonly EspnStandingsEntry[] };
    };
    const children = data.children ?? [];
    const sections =
      children.length > 0
        ? children.map((child) => ({
            label: child.name ?? child.abbreviation ?? null,
            rows: (child.standings?.entries ?? []).map(toStandingsRow)
          }))
        : [{ label: null, rows: (data.standings?.entries ?? []).map(toStandingsRow) }];
    return { sections: sections.filter((section) => section.rows.length > 0) };
  }
```

- [ ] **Step 6: Service composition**

In `packages/sports/src/sports-service.ts`:

- Cache: `private readonly standings = new SportsCache<StandingsTable>();` (import the type),
  and use fallback `EMPTY_STANDINGS` — add near the TTL consts:

```ts
const EMPTY_STANDINGS: StandingsTable = { sections: [] };
```

- `standingsByComp` becomes `Map<string, StandingsTable>` (fallback `EMPTY_STANDINGS` in the
  `cached(...)` call).
- The `standings` groups block becomes:

```ts
const standings: StandingsGroup[] = competitionKeys
  .map((key) => ({
    competitionKey: key,
    competitionLabel: catalogEntry(key)?.label ?? key,
    standingsShape: catalogEntry(key)?.standingsShape ?? "table",
    sections: standingsByComp.get(key)?.sections ?? []
  }))
  .filter((group) => group.sections.some((section) => section.rows.length > 0));
```

- `buildCard`'s `standings` argument: pass the flattened rows so `standingLine` keeps working:

```ts
          (standingsByComp.get(follow.competitionKey)?.sections ?? []).flatMap((s) => s.rows),
```

- `getCatalog()` pushes `standingsShape: entry.standingsShape` alongside `kind`/`marquee`.

- [ ] **Step 7: Shape-aware `StandingsRail`**

In `apps/web/src/sports/sports-page.tsx`, replace the `<table className="sp-tbl">…</table>`
block inside `StandingsRail` with a per-section render (component signature unchanged for now —
Task 4 swaps the follow-matching):

```tsx
{
  group.sections.map((section) => (
    <table className="sp-tbl" key={section.label ?? "all"}>
      <thead>
        <tr>
          {group.standingsShape !== "record" ? <th className="pos">#</th> : null}
          <th className="tm">{section.label ?? group.competitionLabel}</th>
          {group.standingsShape === "record" ? (
            <>
              <th>W-L</th>
              <th>{section.rows.some((r) => r.points !== null) ? "Pts" : "Pct"}</th>
            </>
          ) : (
            <th>Pts</th>
          )}
        </tr>
      </thead>
      <tbody>
        {section.rows.map((row) => (
          <tr
            key={row.teamKey}
            className={props.followedKeys.has(row.teamKey) ? "is-you" : undefined}
          >
            {group.standingsShape !== "record" ? (
              <td className="pos">
                {row.qualifies ? <span className="sp-tbl__adv" /> : null}
                {row.rank}
              </td>
            ) : null}
            <td className="tm">
              <span className="nm">{row.name}</span>
            </td>
            {group.standingsShape === "record" ? (
              <>
                <td>{recordLine(row)}</td>
                <td>{row.points ?? formatPct(row.winPercent)}</td>
              </>
            ) : (
              <td>{row.points ?? "–"}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  ));
}
```

with two module-level helpers next to `StandingsRail`:

```tsx
function recordLine(row: StandingsRow): string {
  return row.draws !== null && row.draws > 0
    ? `${row.wins}-${row.losses}-${row.draws}`
    : `${row.wins}-${row.losses}`;
}

function formatPct(winPercent: number | null): string {
  return winPercent === null ? "–" : winPercent.toFixed(3).replace(/^0/, "");
}
```

(import `StandingsRow` from `@jarv1s/shared` in the page's type import list.)

- [ ] **Step 8: Update the remaining fixtures/assertions**

- `tests/unit/sports-service.test.ts`: `nflStandings` becomes a `StandingsTable`:

```ts
const nflStandings: StandingsTable = {
  sections: [
    {
      label: "National Football Conference",
      rows: [
        {
          teamKey: "dal",
          name: "Dallas Cowboys",
          rank: 1,
          points: null,
          wins: 10,
          losses: 2,
          draws: null,
          winPercent: 0.833,
          qualifies: true
        }
      ]
    }
  ]
};
```

(import `StandingsTable` from the source module; drop the `StandingsRow` import if unused.)
Add an assertion in the live-card test:
`expect(overview.standings[0]?.standingsShape).toBe("record");` and
`expect(overview.standings[0]?.sections[0]?.label).toBe("National Football Conference");`.

- `tests/unit/sports-routes.test.ts`: fake source `getStandings` returns a `StandingsTable`;
  overview expectations move from `rows` to `sections`.
- `tests/unit/sports-page.test.tsx`: `makeOverview()` standings group gains
  `standingsShape: "record"` + `sections` wrapper; add render assertions:

```ts
expect(html).toContain("W-L");
expect(html).not.toContain(">#<"); // record leagues drop the rank column
```

and for the catalog-typed fixtures anywhere (`settings-sports-pane.test.tsx`,
`web-sports-client.test.ts`): add `standingsShape` to `CompetitionRef` literals
(`grep -rln "marquee: " tests/unit apps/web/src` to find them).

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm vitest run tests/unit` then `pnpm typecheck`
Expected: both exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/sports-api.ts packages/sports/src/source/catalog.ts \
  packages/sports/src/source/sports-source.ts packages/sports/src/source/espn-source.ts \
  packages/sports/src/sports-service.ts apps/web/src/sports/sports-page.tsx \
  packages/sports/src/source/__fixtures__/fifa-standings.json \
  packages/sports/src/source/__fixtures__/nfl-standings.json tests/unit
git commit -m "#668 feat(sports): competition-correct standings shapes (table/groups/record)" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

(`git add tests/unit` is safe here only because every file under it that changed belongs to this
task — verify with `git status --short` first; if anything unrelated is dirty, list files
explicitly.)

---

### Task 4: Relevance — teamKeys join + followed-team pair matching (C1 service half, C3)

**Files:**

- Modify: `packages/shared/src/sports-api.ts`
- Modify: `packages/sports/src/sports-service.ts`
- Modify: `apps/web/src/sports/sports-page.tsx`
- Modify: `tests/unit/sports-service.test.ts`, `tests/unit/sports-routes.test.ts`,
  `tests/unit/sports-page.test.tsx`

**Interfaces:**

- Consumes: `SourceHeadline.sourceTeamIds`, `SourceTeamRef.sourceTeamId` (Task 2).
- Produces (used by Tasks 5–6):

```ts
// packages/shared/src/sports-api.ts
export interface FollowedTeamRef {
  readonly competitionKey: string;
  readonly teamKey: string;
}
// SportsOverviewResponse: `followedTeamKeys: readonly string[]` is REPLACED by
//   readonly followedTeams: readonly FollowedTeamRef[];

// packages/sports/src/sports-service.ts (private, reused by Task 5)
//   private teamsFor(competitionKey: string, state: DegradeState): Promise<readonly SourceTeamRef[]>
// module helper (reused by Task 6 ranking):
//   function resolveHeadlineTeamKeys(headlines, teams): SourceHeadline[]
```

- [ ] **Step 1: Write the failing service tests**

In `tests/unit/sports-service.test.ts`:

```ts
it("emits followed teams as competition-scoped pairs", async () => {
  const service = new SportsService(makeDeps());
  const overview = await service.getOverview(userA);
  expect(overview.followedTeams).toEqual([{ competitionKey: "nfl", teamKey: "dal" }]);
});

it("joins provider team tags to teamKeys on headlines", async () => {
  const service = new SportsService(
    makeDeps({
      source: makeSource({
        listTeams: async (competitionKey) => [
          {
            teamKey: "dal",
            competitionKey,
            name: "Dallas Cowboys",
            shortName: "Cowboys",
            crestUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
            sourceTeamId: "6"
          }
        ]
      })
    })
  );
  const overview = await service.getOverview(userA);
  const tagged = overview.topStories ?? overview.headlines; // Task 6 renames; use `headlines` until then
  expect(tagged[0]?.teamKeys).toEqual(["dal"]);
});
```

(Until Task 6 lands, write the second assertion against `overview.headlines[0]?.teamKeys`.)
Also update the existing first test's `followedTeamKeys` assertion to
`overview.followedTeams.map((f) => f.teamKey)`.

Run: `pnpm vitest run tests/unit/sports-service.test.ts` — expected FAIL.

- [ ] **Step 2: Shared DTO + schema**

In `packages/shared/src/sports-api.ts`: add `FollowedTeamRef` (above); in
`SportsOverviewResponse` replace `followedTeamKeys` with
`readonly followedTeams: readonly FollowedTeamRef[];`. In `sportsOverviewResponseSchema`:
replace `"followedTeamKeys"` with `"followedTeams"` in `required` and the property with:

```ts
        followedTeams: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["competitionKey", "teamKey"],
            properties: {
              competitionKey: { type: "string" },
              teamKey: { type: "string" }
            }
          }
        },
```

- [ ] **Step 3: Service join + pairs**

In `packages/sports/src/sports-service.ts`:

Add the cache accessor (below `cached`):

```ts
  private async teamsFor(
    competitionKey: string,
    state: DegradeState
  ): Promise<readonly SourceTeamRef[]> {
    return this.cached(
      this.teams,
      competitionKey,
      TEAMS_TTL_MS,
      () => this.source.listTeams(competitionKey),
      [],
      state
    );
  }
```

(Refactor `getCatalog()` to call `this.teamsFor(entry.competitionKey, throwaway)`.)

Add a pure helper next to the others:

```ts
function resolveHeadlineTeamKeys(
  headlines: readonly SourceHeadline[],
  teams: readonly SourceTeamRef[]
): SourceHeadline[] {
  const byId = new Map<string, string>();
  for (const team of teams) {
    if (team.sourceTeamId !== null) byId.set(team.sourceTeamId, team.teamKey);
  }
  return headlines.map((headline) => ({
    ...headline,
    teamKeys: headline.sourceTeamIds
      .map((id) => byId.get(id))
      .filter((key): key is string => key !== undefined)
  }));
}
```

In `getOverview`, inside the per-competition loop, fetch teams and join before storing
headlines:

```ts
const teams = await this.teamsFor(key, state);
headlinesByComp.set(
  key,
  resolveHeadlineTeamKeys(
    await this.cached(
      this.headlines,
      key,
      HEADLINES_TTL_MS,
      () => this.source.getHeadlines(key),
      [],
      state
    ),
    teams
  )
);
```

And in the return object replace `followedTeamKeys: …` with:

```ts
      followedTeams: followedTeams.map((f) => ({
        competitionKey: f.competitionKey,
        teamKey: f.teamKey
      })),
```

- [ ] **Step 4: Pair matching on the page**

In `apps/web/src/sports/sports-page.tsx`:

Replace the `followedKeys` memo in `SportsPage` with:

```tsx
const followedPairs = useMemo(
  () => new Set((data?.followedTeams ?? []).map((f) => `${f.competitionKey}:${f.teamKey}`)),
  [data?.followedTeams]
);
```

Thread `followedPairs` (a `ReadonlySet<string>`) everywhere `followedKeys` went, and add a
module helper:

```tsx
function isFollowed(pairs: ReadonlySet<string>, competitionKey: string, teamKey: string) {
  return pairs.has(`${competitionKey}:${teamKey}`);
}
```

- `GameRow` / `GameSideRow`: rename the prop to `followedPairs`; `GameRow` computes
  `mine = isFollowed(props.followedPairs, game.competitionKey, game.home.teamKey) || isFollowed(props.followedPairs, game.competitionKey, game.away.teamKey)`
  and passes `competitionKey={game.competitionKey}` down to `GameSideRow`, which uses
  `isFollowed(props.followedPairs, props.competitionKey, props.side.teamKey)`.
- `StandingsRail`: rows use `isFollowed(props.followedPairs, group.competitionKey, row.teamKey)`.
- `HeadlinesRail`: delete the `youComps` competition-level memo; the "You" chip becomes
  team-level:

```tsx
{
  headline.teamKeys.some((k) => isFollowed(props.followedPairs, headline.competitionKey, k)) ? (
    <span className="sp-hl__you">
      <span className="d" />
      You
    </span>
  ) : null;
}
```

(`HeadlinesRail` gains a `followedPairs: ReadonlySet<string>` prop; `SplitSection` /
`EmptyState` pass it through and their own prop renames from `followedKeys`.)

- [ ] **Step 5: Update page/routes fixtures + collision pin**

- `tests/unit/sports-page.test.tsx`: `makeOverview()` replaces
  `followedTeamKeys: ["min"]` with `followedTeams: [{ competitionKey: "nfl", teamKey: "min" }]`.
  Add a collision test: extend the overview with an `eng.1` standings group containing a row
  `teamKey: "min"` and assert the rendered `eng.1` row has no `is-you` class while the nfl game
  side keeps `is-mine`.
- `tests/unit/sports-routes.test.ts`: overview expectation moves to `followedTeams` pairs.

- [ ] **Step 6: Run tests + typecheck, commit**

Run: `pnpm vitest run tests/unit && pnpm typecheck` — expected exit 0.

```bash
git add packages/shared/src/sports-api.ts packages/sports/src/sports-service.ts \
  apps/web/src/sports/sports-page.tsx tests/unit/sports-service.test.ts \
  tests/unit/sports-routes.test.ts tests/unit/sports-page.test.tsx
git commit -m "#668 feat(sports): team-level relevance — headline teamKeys join and followed-team pairs" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Followed-team cards — real names/crests, linked news, structured next match (A2, B card half, C2, D1, D2)

**Files:**

- Modify: `packages/shared/src/sports-api.ts`
- Modify: `packages/sports/src/sports-service.ts`
- Modify: `apps/web/src/sports/sports-page.tsx` (`FollowedCard`)
- Modify: `tests/unit/sports-service.test.ts`, `tests/unit/sports-page.test.tsx`,
  `tests/unit/sports-routes.test.ts`

**Interfaces:**

- Consumes: `SourceHeadline.teamKeys` (joined in Task 4), `SourceTeamRef` (Task 2),
  `teamsFor(competitionKey, state)` (Task 4).
- Produces:

```ts
// packages/shared/src/sports-api.ts
export interface FollowedTeamNews {
  readonly title: string;
  readonly url: string;
}

export interface FollowedNextMatch {
  readonly opponentName: string; // full name, resolved per D1
  readonly homeAway: "home" | "away";
  readonly startsAt: string; // ISO instant; formatted client-side in the viewer's locale
}

export interface FollowedTeamCard {
  // existing fields unchanged, except:
  readonly news: FollowedTeamNews | null; // NEW — status "news" content
  readonly nextMatch: FollowedNextMatch | null; // WAS string | null
}
```

- [ ] **Step 1: Write the failing service tests**

In `tests/unit/sports-service.test.ts` (the `listTeams` override matches Task 4's — team name
"Dallas Cowboys", `sourceTeamId: "6"`,
`crestUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png"`):

```ts
it("returns a structured next match with the full opponent name", async () => {
  const service = new SportsService(makeDeps());
  const overview = await service.getOverview(userA);
  const card = overview.followed.find((c) => c.teamKey === "dal");
  expect(card?.nextMatch).toEqual({
    opponentName: "Green Bay Packers",
    homeAway: "home",
    startsAt: "2026-07-05T20:00:00.000Z"
  });
});

it("links the newest team-tagged headline on a news-status card", async () => {
  const service = new SportsService(
    makeDeps({
      source: makeSource({
        getScoreboard: async () => [],
        listTeams: async (competitionKey) => [
          {
            teamKey: "dal",
            competitionKey,
            name: "Dallas Cowboys",
            shortName: "Cowboys",
            crestUrl: "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
            sourceTeamId: "6"
          }
        ]
      })
    })
  );
  const overview = await service.getOverview(userA);
  const card = overview.followed.find((c) => c.teamKey === "dal");
  expect(card?.status).toBe("news");
  expect(card?.news).toEqual({
    title: "Cowboys clinch the division",
    url: "https://example.com/h1"
  });
  // D1/A2: name and crest resolve from the catalog even with no game today
  expect(card?.name).toBe("Dallas Cowboys");
  expect(card?.crestUrl).toContain("dal.png");
});

it("shows the authored empty-news state instead of an unrelated story", async () => {
  const service = new SportsService(
    makeDeps({
      source: makeSource({
        getScoreboard: async () => [],
        getHeadlines: async () => [
          { ...nflHeadlines[0]!, sourceTeamIds: ["17"] } // tagged to NE, not dal
        ]
      })
    })
  );
  const overview = await service.getOverview(userA);
  const card = overview.followed.find((c) => c.teamKey === "dal");
  expect(card?.status).toBe("news");
  expect(card?.news).toBeNull();
});
```

Delete the now-obsolete assertion `expect(card?.nextMatch).toContain("GB")` from the existing
live-card test (replaced by the first test above).

Run: `pnpm vitest run tests/unit/sports-service.test.ts` — expected FAIL.

- [ ] **Step 2: Shared DTO + schema**

In `packages/shared/src/sports-api.ts`: add `FollowedTeamNews` and `FollowedNextMatch` (above);
in `FollowedTeamCard` add `news` and retype `nextMatch`. In `followedTeamCardSchema`: add
`"news"` to `required` and replace/add the two properties:

```ts
    news: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["title", "url"],
          properties: {
            title: { type: "string" },
            url: { type: "string" }
          }
        }
      ]
    },
    nextMatch: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["opponentName", "homeAway", "startsAt"],
          properties: {
            opponentName: { type: "string" },
            homeAway: { type: "string", enum: ["home", "away"] },
            startsAt: { type: "string" }
          }
        }
      ]
    },
```

- [ ] **Step 3: Service — teamsByComp map + card composition**

In `packages/sports/src/sports-service.ts`:

Keep the per-competition teams fetched in Task 4 in a map. Where Task 4 added
`const teams = await this.teamsFor(key, state);` inside the per-competition loop, declare above
the loop:

```ts
const teamsByComp = new Map<string, readonly SourceTeamRef[]>();
```

and inside the loop, right after the fetch:

```ts
teamsByComp.set(key, teams);
```

Update the cards loop to pass the teams as the final `buildCard` argument:

```ts
teamsByComp.get(follow.competitionKey) ?? [];
```

Replace `buildCard` entirely:

```ts
  private buildCard(
    follow: SportsFollowDto & { teamKey: string },
    games: readonly GameSummary[],
    standings: readonly StandingsRow[],
    headlines: readonly SourceHeadline[],
    schedule: readonly GameSummary[],
    teams: readonly SourceTeamRef[]
  ): FollowedTeamCard {
    const { teamKey } = follow;
    const comp = follow.competitionKey;
    const competitionLabel = catalogEntry(comp)?.label ?? comp;
    const todayGame = findTeamGame(games, teamKey);
    const todaySide = todayGame ? sideFor(todayGame, teamKey) : undefined;
    const catalogTeam = teams.find((t) => t.teamKey === teamKey);
    const scheduleSide = scheduleSideFor(schedule, teamKey);
    // D1: today side → catalog → schedule → last-resort uppercase key (fully degraded only)
    const name =
      todaySide?.name ?? catalogTeam?.name ?? scheduleSide?.name ?? teamKey.toUpperCase();
    // A2: same precedence for the crest
    const crestUrl =
      todaySide?.crestUrl ?? catalogTeam?.crestUrl ?? scheduleSide?.crestUrl ?? null;

    let status: FollowedTeamCard["status"];
    let primary: string;
    if (todayGame && todayGame.state === "live") {
      status = "live";
      primary = scoreLine(todayGame);
    } else if (todayGame) {
      status = "today";
      primary =
        todayGame.state === "final" ? resultLine(todayGame, teamKey) : matchupLine(todayGame);
    } else {
      status = "news";
      primary = "";
    }

    return {
      teamKey,
      competitionKey: comp,
      competitionLabel,
      name,
      crestUrl,
      status,
      primary,
      news: newestTeamHeadline(headlines, teamKey),
      form: computeForm(schedule, teamKey),
      standing: standingLine(standings, teamKey),
      nextMatch: nextMatchFor(schedule, teamKey, this.now()),
      rationale: `You follow ${name}.`
    };
  }
```

Replace the `teamNameFromSchedule` helper with:

```ts
function scheduleSideFor(schedule: readonly GameSummary[], teamKey: string): GameSide | undefined {
  for (const game of schedule) {
    const side = sideFor(game, teamKey);
    if (side) return side;
  }
  return undefined;
}
```

Add below it:

```ts
function newestTeamHeadline(
  headlines: readonly SourceHeadline[],
  teamKey: string
): FollowedTeamNews | null {
  const newest = headlines
    .filter((h) => h.teamKeys.includes(teamKey))
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  return newest ? { title: newest.title, url: newest.url } : null;
}
```

Replace `nextMatchLine` entirely with:

```ts
function nextMatchFor(
  schedule: readonly GameSummary[],
  teamKey: string,
  now: Date
): FollowedNextMatch | null {
  const nowIso = now.toISOString();
  const next = schedule
    .filter((g) => g.state !== "final" && g.startsAt > nowIso && sideFor(g, teamKey))
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!next) return null;
  const opponent = opponentFor(next, teamKey);
  if (!opponent) return null;
  return {
    opponentName: opponent.name,
    homeAway: next.home.teamKey === teamKey ? "home" : "away",
    startsAt: next.startsAt
  };
}
```

`teamNameFromSchedule` and `nextMatchLine` are deleted — nothing may keep referencing them
(confirm: `grep -rn "nextMatchLine\|teamNameFromSchedule" packages apps tests`). Import
`FollowedTeamNews` and `FollowedNextMatch` from `@jarv1s/shared`.

- [ ] **Step 4: Frontend — linked card news + localized next match**

In `apps/web/src/sports/sports-page.tsx`, inside `FollowedCard` replace the `.sp-fc__primary`
contents:

```tsx
{
  card.status === "news" ? (
    <>
      <span className="sp-fc__newsic">
        <NewsIcon />
      </span>
      {card.news ? (
        <a className="sp-fc__newstx" href={card.news.url} target="_blank" rel="noreferrer">
          {card.news.title}
        </a>
      ) : (
        <span className="sp-fc__newstx">No recent news</span>
      )}
    </>
  ) : (
    <span className="sp-fc__resscore">{card.primary}</span>
  );
}
```

and the next-match line becomes:

```tsx
<span className="sp-fc__nextmatch">{formatNextMatch(card.nextMatch)}</span>
```

Add at module level (near the other helpers), importing `FollowedNextMatch` from
`@jarv1s/shared`:

```tsx
const NEXT_MATCH_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric"
});
const NEXT_MATCH_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});

// "vs Green Bay Packers · Sat, Jul 4 · 3:00 PM" — browser locale + timezone (spec D2)
function formatNextMatch(next: FollowedNextMatch): string {
  const at = new Date(next.startsAt);
  return `${next.homeAway === "home" ? "vs" : "at"} ${next.opponentName} · ${NEXT_MATCH_DATE.format(
    at
  )} · ${NEXT_MATCH_TIME.format(at)}`;
}
```

(`new Date(next.startsAt)` is parameterized — it does not trip `check:no-ambient-dates`.)

- [ ] **Step 5: Update page/routes fixtures**

- `tests/unit/sports-page.test.tsx`: every `FollowedTeamCard` literal gains `news: null` (or a
  `{ title, url }` object for the news-card case) and `nextMatch` becomes the structured object
  (e.g.
  `{ opponentName: "Green Bay Packers", homeAway: "home", startsAt: "2026-07-05T20:00:00.000Z" }`).
  Add assertions — TZ-safe (never assert the formatted time):

```ts
expect(html).toContain("vs Green Bay Packers");
expect(html).toContain('href="https://example.com/h1"'); // card news is a link
```

- `tests/unit/sports-routes.test.ts`: fake overview cards gain `news` and the structured
  `nextMatch`.

- [ ] **Step 6: Run tests + typecheck, commit**

Run: `pnpm vitest run tests/unit && pnpm typecheck` — expected exit 0.

```bash
git add packages/shared/src/sports-api.ts packages/sports/src/sports-service.ts \
  apps/web/src/sports/sports-page.tsx tests/unit/sports-service.test.ts \
  tests/unit/sports-page.test.tsx tests/unit/sports-routes.test.ts
git commit -m "#668 feat(sports): card names/crests via catalog, linked team news, structured next match" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Top Stories rail + league news grid + linked photo hero (E, B hero half, A3 render)

**Files:**

- Modify: `packages/shared/src/sports-api.ts`
- Modify: `packages/sports/src/sports-service.ts`
- Create: `apps/web/src/sports/sports-news.tsx`
- Create: `apps/web/src/styles/sports-2.css`
- Modify: `apps/web/src/sports/sports-page.tsx`
- Modify: `tests/unit/sports-service.test.ts`, `tests/unit/sports-page.test.tsx`,
  `tests/unit/sports-routes.test.ts`

**Interfaces:**

- Consumes: `Headline.imageUrl` / `SourceHeadline.teamKeys` (Tasks 2/4), `followedPairs` +
  `isFollowed` matching (Task 4).
- Produces:

```ts
// packages/shared/src/sports-api.ts
export interface LeagueNewsGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly headlines: readonly Headline[]; // no hard cap — bounded by the source fetch
}
// SportsOverviewResponse: `headlines: readonly Headline[]` is REPLACED by:
//   readonly topStories: readonly Headline[];   // ranked, capped at 6
//   readonly leagueNews: readonly LeagueNewsGroup[];

// apps/web/src/sports/sports-news.tsx exports:
//   StoryHero(props: { headline: Headline | null })
//   TopStoriesRail(props: { headlines: readonly Headline[]; followedPairs: ReadonlySet<string> })
//   LeagueNewsSection(props: { groups: readonly LeagueNewsGroup[] })
//   isFollowed(pairs: ReadonlySet<string>, competitionKey: string, teamKey: string): boolean
//   NewsIcon()   — isFollowed + NewsIcon MOVE here from sports-page.tsx (single definition,
//                  one-direction import, no cycle)
```

- [ ] **Step 1: Write the failing service tests**

In `tests/unit/sports-service.test.ts`:

```ts
it("ranks team-tagged stories first, caps top stories at six, dedupes league news", async () => {
  // 9 stories, all tagged to dal ("6"), publishedAt ascending → newest is h8
  const manyHeadlines = Array.from({ length: 9 }, (_, i) => ({
    id: `h${i}`,
    competitionKey: "nfl",
    title: `Story ${i}`,
    url: `https://example.com/h${i}`,
    publishedAt: `2026-07-01T0${i}:00:00.000Z`,
    imageUrl: null,
    teamKeys: [],
    sourceTeamIds: ["6"]
  }));
  const service = new SportsService(
    makeDeps({
      source: makeSource({
        getHeadlines: async () => manyHeadlines,
        listTeams: async (competitionKey) => [
          {
            teamKey: "dal",
            competitionKey,
            name: "Dallas Cowboys",
            shortName: "Cowboys",
            crestUrl: null,
            sourceTeamId: "6"
          }
        ]
      })
    })
  );
  const overview = await service.getOverview(userA);
  expect(overview.topStories).toHaveLength(6);
  expect(overview.topStories[0]?.id).toBe("h8"); // newest tagged story first
  const topIds = new Set(overview.topStories.map((h) => h.id));
  expect(overview.leagueNews).toHaveLength(1);
  expect(overview.leagueNews[0]?.competitionLabel).toBe("NFL");
  expect(overview.leagueNews[0]?.headlines.map((h) => h.id)).toEqual(["h2", "h1", "h0"]);
  for (const group of overview.leagueNews) {
    for (const h of group.headlines) expect(topIds.has(h.id)).toBe(false);
  }
});

it("uses the top-ranked story for the story hero", async () => {
  const service = new SportsService(
    makeDeps({ source: makeSource({ getScoreboard: async () => [] }) })
  );
  const overview = await service.getOverview(userA);
  expect(overview.hero.mode).toBe("story");
  if (overview.hero.mode === "story") {
    expect(overview.hero.headline?.id).toBe(overview.topStories[0]?.id);
  }
});
```

Also rewrite Task 4's transitional assertion
(`overview.headlines[0]?.teamKeys`) to `overview.topStories[0]?.teamKeys`.

Run: `pnpm vitest run tests/unit/sports-service.test.ts` — expected FAIL (`topStories`
undefined).

- [ ] **Step 2: Shared DTO + schema**

In `packages/shared/src/sports-api.ts`: add `LeagueNewsGroup` (above); in
`SportsOverviewResponse` replace `headlines` with `topStories` + `leagueNews`. In
`sportsOverviewResponseSchema`: replace `"headlines"` in `required` with `"topStories"` and
`"leagueNews"`, and swap the property (reusing the same headline item schema const the old
`headlines` array pointed at; if it is inlined today, extract it to
`const headlineSchema = { ... } as const;` and reference it from both places):

```ts
    topStories: { type: "array", items: headlineSchema },
    leagueNews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["competitionKey", "competitionLabel", "headlines"],
        properties: {
          competitionKey: { type: "string" },
          competitionLabel: { type: "string" },
          headlines: { type: "array", items: headlineSchema }
        }
      }
    },
```

- [ ] **Step 3: Service — ranking + grouping**

In `packages/sports/src/sports-service.ts`, add near the TTL consts:

```ts
const TOP_STORIES_CAP = 6; // Ben 2026-07-01
```

In `getOverview`, replace
`const headlines = competitionKeys.flatMap((key) => headlinesByComp.get(key) ?? []);` with:

```ts
const topStories = rankTopStories(headlinesByComp, followedTeams);
const topStoryIds = new Set(topStories.map((h) => h.id));
const leagueNews: LeagueNewsGroup[] = competitionKeys
  .map((key) => ({
    competitionKey: key,
    competitionLabel: catalogEntry(key)?.label ?? key,
    headlines: [...(headlinesByComp.get(key) ?? [])]
      .sort(byNewest)
      .filter((h) => !topStoryIds.has(h.id))
  }))
  .filter((group) => group.headlines.length > 0);
```

and in the return object replace `headlines,` with `topStories,` and `leagueNews,`.

Change `buildHero`'s last two parameters — delete `competitionKeys` and `headlinesByComp`,
accept `topStories: readonly Headline[]`, and replace its final two lines with:

```ts
return { mode: "story", headline: topStories[0] ?? null };
```

(update the call site to pass `topStories`; compute `topStories` before the `buildHero` call).

Add the pure helpers next to the others:

```ts
function byNewest(a: Headline, b: Headline): number {
  return b.publishedAt.localeCompare(a.publishedAt);
}

// Spec §E ranking: (1) headlines tagged with a followed team, newest first;
// (2) the newest headline of each followed competition not already included; cap 6.
function rankTopStories(
  headlinesByComp: ReadonlyMap<string, readonly SourceHeadline[]>,
  followedTeams: readonly (SportsFollowDto & { teamKey: string })[]
): SourceHeadline[] {
  const pairs = new Set(followedTeams.map((f) => `${f.competitionKey}:${f.teamKey}`));
  const picked: SourceHeadline[] = [];
  const pickedIds = new Set<string>();
  const all = [...headlinesByComp.values()].flat().sort(byNewest);
  for (const headline of all) {
    if (
      headline.teamKeys.some((k) => pairs.has(`${headline.competitionKey}:${k}`)) &&
      !pickedIds.has(headline.id)
    ) {
      picked.push(headline);
      pickedIds.add(headline.id);
    }
  }
  for (const comp of unique(followedTeams.map((f) => f.competitionKey))) {
    const newest = [...(headlinesByComp.get(comp) ?? [])]
      .sort(byNewest)
      .find((h) => !pickedIds.has(h.id));
    if (newest) {
      picked.push(newest);
      pickedIds.add(newest.id);
    }
  }
  return picked.slice(0, TOP_STORIES_CAP);
}
```

Import `LeagueNewsGroup` from `@jarv1s/shared`. Run
`pnpm vitest run tests/unit/sports-service.test.ts` — expected PASS.

- [ ] **Step 4: Create `apps/web/src/sports/sports-news.tsx`**

Full file — `NewsIcon` moves here **verbatim** from `sports-page.tsx` (its existing SVG body,
not shown here) and `isFollowed` moves from Task 4; delete both from `sports-page.tsx` and
import them from this file instead:

```tsx
import type { Headline, LeagueNewsGroup } from "@jarv1s/shared";

export function isFollowed(
  pairs: ReadonlySet<string>,
  competitionKey: string,
  teamKey: string
): boolean {
  return pairs.has(`${competitionKey}:${teamKey}`);
}

export function NewsIcon() {
  /* moved verbatim from sports-page.tsx */
}

const PUBLISHED_FMT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/* ------------------------------------------------------------- Story hero */

export function StoryHero(props: { headline: Headline | null }) {
  const { headline } = props;
  return (
    <section className="sp-hero sp-hero--story sp-hero--split" aria-label="Top story">
      {headline?.imageUrl ? (
        <img
          className="sp-photo sp-photo--herostory sp-photo--img"
          src={headline.imageUrl}
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="sp-photo sp-photo--herostory" aria-hidden="true" />
      )}
      <div className="sp-hero__storybody">
        <span className="sp-hero__comp">
          {headline ? headline.competitionKey.toUpperCase() : "Sports"}
        </span>
        <h2 className="sp-hero__headline">
          {headline ? (
            <a className="sp-hero__link" href={headline.url} target="_blank" rel="noreferrer">
              {headline.title}
            </a>
          ) : (
            "No followed game today"
          )}
        </h2>
        <p className="sp-hero__dek">
          No followed team is playing right now — here&rsquo;s the story worth reading, with scores
          and headlines below.
        </p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- Top stories rail */

export function TopStoriesRail(props: {
  headlines: readonly Headline[];
  followedPairs: ReadonlySet<string>;
}) {
  if (props.headlines.length === 0) return null;
  return (
    <section className="sp-rail" aria-label="Top stories">
      <div className="sp-rail__hd">
        <NewsIcon />
        Top stories
      </div>
      <div className="sp-rail__list">
        {props.headlines.map((headline) => (
          <a
            key={headline.id}
            className="sp-hl"
            href={headline.url}
            target="_blank"
            rel="noreferrer"
          >
            <div className="sp-hl__top">
              <span className="sp-hl__comp">{headline.competitionKey.toUpperCase()}</span>
              {headline.teamKeys.some((k) =>
                isFollowed(props.followedPairs, headline.competitionKey, k)
              ) ? (
                <span className="sp-hl__you">
                  <span className="d" />
                  You
                </span>
              ) : null}
            </div>
            <div className="sp-hl__title">{headline.title}</div>
          </a>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------- League news grid */

export function LeagueNewsSection(props: { groups: readonly LeagueNewsGroup[] }) {
  if (props.groups.length === 0) return null;
  return (
    <section className="sp-sec" aria-label="League news">
      <div className="sp-sec__head">
        <h2 className="sp-sec__title">League news</h2>
      </div>
      {props.groups.map((group) => (
        <div key={group.competitionKey} className="sp-news__grp">
          <span className="sp-news__comp">{group.competitionLabel}</span>
          <div className="sp-news__grid">
            {group.headlines.map((headline) => (
              <a
                key={headline.id}
                className="sp-news__card"
                href={headline.url}
                target="_blank"
                rel="noreferrer"
              >
                {headline.imageUrl ? (
                  <img className="sp-news__img" src={headline.imageUrl} alt="" loading="lazy" />
                ) : null}
                <span className="sp-news__title">{headline.title}</span>
                <span className="sp-news__date">
                  {PUBLISHED_FMT.format(new Date(headline.publishedAt))}
                </span>
              </a>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
```

Pinned by the spec: the rail stays **text-only** (no thumbnails — §A3); thumbnails and serif
linked titles belong to the grid cards; the "Editorial photo" placeholder caption is deleted
(no fabricated content) — the empty `sp-photo` swatch alone is the no-image fallback.

- [ ] **Step 5: Create `apps/web/src/styles/sports-2.css`**

```css
/* Sports feedback pass (#668) — story photos + league news grid.           */
/* Tokens only; loaded after sports-1.css (sports-1 is at the size gate).   */

.sp-photo--img {
  object-fit: cover;
  border-radius: var(--radius-card);
}

.sp-hero__link {
  color: inherit;
  text-decoration: none;
}

.sp-hero__link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.sp-news__grp {
  margin-top: 16px;
}

.sp-news__comp {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.sp-news__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 8px;
}

.sp-news__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  text-decoration: none;
  transition: var(--transition-control);
}

.sp-news__card:hover {
  border-color: var(--border);
  background: var(--surface-2);
}

.sp-news__img {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: calc(var(--radius-card) - 4px);
  background: var(--surface-2);
}

.sp-news__title {
  font-family: var(--font-serif);
  font-size: 15px;
  line-height: 1.35;
  color: var(--text);
}

.sp-news__date {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-faint);
}
```

Import it directly after `sports-1.css`: `grep -rn "sports-1.css" apps/web/src` and add
`import "./styles/sports-2.css";` on the next line (adjust the relative path to match the
importing file). No raw colors, no left-border accents.

- [ ] **Step 6: Wire the page**

In `apps/web/src/sports/sports-page.tsx`:

- Delete the local `StoryHero`, `NewsIcon`, `isFollowed`, and `HeadlinesRail` definitions; add
  `import { StoryHero, TopStoriesRail, LeagueNewsSection, NewsIcon, isFollowed } from "./sports-news";`
  (`NewsIcon` is still used by `FollowedCard`).
- `SplitSection` rail column becomes:

```tsx
<div className="sp-railcol">
  <TopStoriesRail headlines={props.data.topStories} followedPairs={props.followedPairs} />
  <StandingsRail groups={props.data.standings} followedPairs={props.followedPairs} />
</div>
```

- Render the news grid full-width directly after `<SplitSection … />` in the main followed
  layout:

```tsx
<LeagueNewsSection groups={data.leagueNews} />
```

- `EmptyState`: `hasSlate` becomes

```tsx
const hasSlate =
  props.data.scoreboard.length > 0 ||
  props.data.topStories.length > 0 ||
  props.data.leagueNews.length > 0;
```

its rail becomes
`<TopStoriesRail headlines={props.data.topStories} followedPairs={props.followedPairs} />`,
and add `<LeagueNewsSection groups={props.data.leagueNews} />` after the `sp-emptyboard` div,
inside the `hasSlate` fragment.

- [ ] **Step 7: Update page/routes fixtures + render assertions**

- `tests/unit/sports-page.test.tsx`: `makeOverview()` replaces `headlines: [...]` with
  `topStories: [...]` (same headline literals) and
  `leagueNews: [{ competitionKey: "nfl", competitionLabel: "NFL", headlines: [...] }]`. Add:

```ts
expect(html).toContain("Top stories");
expect(html).toContain("League news");
```

and for the story-hero case (give the hero headline
`imageUrl: "https://a.espncdn.com/photo/2026/story.jpg"`):

```ts
expect(html).toContain('src="https://a.espncdn.com/photo/2026/story.jpg"');
expect(html).toContain('href="https://example.com/h1"'); // hero title links out
```

- `tests/unit/sports-routes.test.ts`: fake overview replaces `headlines` with
  `topStories`/`leagueNews`; the Task 2 leak pins
  (`expect(JSON.stringify(body)).not.toContain("sourceTeamIds")`) must still pass against the
  new shape.
- Remaining overview consumers: `grep -rn "\.headlines" apps/web/src tests/unit` and update any
  stragglers (e.g. `web-sports-client.test.ts` fixtures).

- [ ] **Step 8: Run tests + typecheck, commit**

Run: `pnpm vitest run tests/unit && pnpm typecheck` — expected exit 0.

```bash
git add packages/shared/src/sports-api.ts packages/sports/src/sports-service.ts \
  apps/web/src/sports/sports-news.tsx apps/web/src/styles/sports-2.css \
  apps/web/src/sports/sports-page.tsx tests/unit/sports-service.test.ts \
  tests/unit/sports-page.test.tsx tests/unit/sports-routes.test.ts
git commit -m "#668 feat(sports): top stories rail, league news grid, linked photo hero" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

(If the `sports-1.css` import line lives in a file not listed above, add that file to the
`git add` list explicitly.)

---

### Task 7: Docs + full gate + manual LAN verification

**Files:**

- Modify: `packages/sports/README.md`

**Interfaces:** none produced; this task closes out the pass.

- [ ] **Step 1: Update the seam list in `packages/sports/README.md`**

The README documents the LOADER-SEAM(sports) wires. Extend the list with seam 7 (adjust
numbering/format to the file's existing style):

```markdown
7. **CSP image hosts** — `SportsSource.imageHosts` → `MODULE_IMAGE_CSP_HOSTS`
   (`packages/module-registry`) → `img-src` in `apps/api/src/static-web.ts`, mirrored in
   `infra/nginx/jarv1s-web.conf`. A new source with different CDNs updates its `imageHosts`
   and the nginx mirror (sync pinned by `tests/unit/static-web-csp.test.ts`).
```

Also document, in the same file's data-flow notes: headlines carry `sourceTeamIds` and teams
carry `sourceTeamId` **inside the module only** — the service joins them into
`Headline.teamKeys`, and Fastify response schemas (`additionalProperties: false`) strip the
provider ids from every response; standings flow as `StandingsTable.sections` with a
per-competition `standingsShape` declared in the catalog.

- [ ] **Step 2: Run the full gate**

Run: `pnpm verify:foundation`
Expected: exit 0 (lint, format:check, check:file-size, check:design-tokens,
check:no-ambient-dates, typecheck, test:unit, db:migrate, test:integration all green). If
`format:check` fails on files this pass created, run
`pnpm exec prettier --write <those files>` and re-run the gate.

- [ ] **Step 3: Manual LAN verification (spec §8)**

Start the stack with LAN access (Vite must run with `--host` — headless box) and check from a
browser on another machine, with at least one followed team in each of an NFL and a soccer
competition:

- Crests/emblems render as real images — no CSP violations in the browser console; the initials
  swatch appears only when a crest URL is genuinely absent.
- The story hero shows a photo when the top story has one, and its title opens the source
  article in a new tab; followed-card news lines and every rail/grid story link out likewise.
- "You" markers appear only for the actual followed (competition, team) pairs — verify an
  abbreviation-collision case (e.g. follow NFL `min`, confirm a soccer `min` row is not
  marked).
- Next match reads `vs/at <full name> · <local date> · <local time>` — no raw team keys
  anywhere on the page.
- Standings: soccer shows a points table, World Cup/UCL show labelled groups, NFL/NBA show
  conference records with W-L and Pct — and no `#` rank column on record leagues.
- Top stories capped at 6; the League news grid groups by competition below Scores.

Record pass/fail per bullet in the PR description.

- [ ] **Step 4: Commit**

```bash
git add packages/sports/README.md
git commit -m "#668 docs(sports): document CSP image-host seam and team-tag data flow" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Plan Self-Check (for the executing engineer)

- Every task ends green: `pnpm vitest run tests/unit && pnpm typecheck` before each commit;
  Task 7 runs the full `pnpm verify:foundation`.
- `sourceTeamId` / `sourceTeamIds` must never appear in any serialized API response — the
  route-level `JSON.stringify` pins from Task 2 guard this; do not delete them.
- No `git add -A` at any point — this tree may be shared; stage the listed paths only.
