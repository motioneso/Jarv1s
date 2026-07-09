# 858 Sports Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out issue #858 — (a) key/dedup every sports story identity on the stable
cross-feed `url` instead of the ESPN `id` (which is not globally unique) across the web and
service layers, and (b) add a request timeout to the shared dataset-runtime fetch path so a
degraded upstream can't hold a connection forever.

**Architecture:** Two independent, mechanical hardening slices sharing one PR. 858b (timeout)
touches only `packages/datasets` (the shared fetch wrapper every connector runs through). 858a
(id→url) touches `packages/sports` only — 7 React `key={}`/id-based-cap call sites in the web tier
plus 3 id-keyed caps in the service tier that #855's followed-card restructure didn't touch. No
new abstractions: every fix mirrors an already-correct sibling pattern in the same file
(`followedStoryUrls` at L294, `story.url` keys in `sports-ticker.tsx`).

**Tech Stack:** TypeScript, Vitest (`renderToString`/`createElement` for the React-less web-tier
tests), no new dependencies.

## Global Constraints

- **Coordinator condition (858a):** mechanical key-swaps only — no restructuring of the
  #855-landed followed-card/followed-groups split. Do not touch `followed-card.ts`,
  `followed-groups.ts`, or the L256-260 per-follow-team `seen`/`headlines` merge in
  `sports-service.ts` (already url-deduped downstream; touching it is the "double-fix" the
  coordinator's condition warned against).
- **Coordinator condition (858a):** TDD per spot — every fix gets its own RED test first.
- **Coordinator condition (858a):** the plan and the PR body must both call out all 3
  service-layer fixes by line reference (Tasks 4, 5, 6 below).
- **858b default timeout:** `DEFAULT_FETCH_TIMEOUT_MS = 15_000`. Rationale: this is the shared
  path every connector runs through, not just fast ESPN JSON endpoints — 15s is generous enough
  for a slow-but-legit source while still bounding the worst-case hold on a degraded upstream.
- **858b design invariant:** one `AbortController` per outer `createHostPinnedFetch` call, created
  once and reused across every redirect hop (not reset per-hop) — a slow multi-hop chain must not
  evade the deadline by having each individual hop resolve fast.
- Out of scope (confirmed unaffected by #855, do not touch): `sports-ticker.tsx:325,448` (already
  `story.url`-keyed), `game.id`/`f.id`/`entry.competitionKey` keys elsewhere (issue is specifically
  about story/headline id collisions), the L377 `{ articleId: feature.id }` cache key (a
  cache-key concern, not a React/list-identity concern).

---

## Task 1: 858b — fetch timeout in `createHostPinnedFetch`

**Files:**

- Modify: `packages/datasets/src/host-pinning.ts:129-167` (current `createHostPinnedFetch`)
- Modify: `packages/datasets/src/index.ts` (export block, add `DEFAULT_FETCH_TIMEOUT_MS`)
- Test: `tests/unit/dataset-host-pinning.test.ts` (new `describe` block)

**Interfaces:**

- Produces: `DEFAULT_FETCH_TIMEOUT_MS` (exported `number` constant, value `15_000`) and a new 3rd
  parameter on `createHostPinnedFetch(allowedHosts, fetchFn, timeoutMs?)` — Task 2 consumes both.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/dataset-host-pinning.test.ts` (new file-local helper + new `describe` block —
place after the existing `describe("createHostPinnedFetch — 303/301/302 method downgrade...")`
block; none of the existing `fakeFetch*` helpers in this file honor `init.signal`):

```ts
function fakeFetchTimed(
  responses: readonly { status: number; location?: string; delayMs?: number }[]
): { fetchFn: typeof fetch; signals: (AbortSignal | undefined)[] } {
  const signals: (AbortSignal | undefined)[] = [];
  let i = 0;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    signals.push(init?.signal ?? undefined);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        const headers = new Headers();
        if (r?.location) headers.set("location", r.location);
        resolve(new Response(null, { status: r?.status ?? 200, headers }));
      }, r?.delayMs ?? 0);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }) as unknown as typeof fetch;
  return { fetchFn, signals };
}

describe("createHostPinnedFetch — fetch timeout (#858)", () => {
  it("aborts and rejects when the fetch exceeds timeoutMs", async () => {
    const { fetchFn } = fakeFetchTimed([{ status: 200, delayMs: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn, 20);
    await expect(pinned("https://site.api.espn.com/slow")).rejects.toMatchObject({
      name: "AbortError"
    });
  });

  it("does not abort a fetch that completes well within timeoutMs", async () => {
    const { fetchFn } = fakeFetchTimed([{ status: 200, delayMs: 5 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn, 5_000);
    const res = await pinned("https://site.api.espn.com/fast");
    expect(res.status).toBe(200);
  });

  it("passes the SAME AbortSignal instance to every fetchFn call across redirect hops (deadline is not reset per-hop)", async () => {
    const { fetchFn, signals } = fakeFetchTimed([
      { status: 302, location: "https://site.api.espn.com/b" },
      { status: 302, location: "https://site.api.espn.com/c" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn, 5_000);
    await pinned("https://site.api.espn.com/a");
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[1]).toBe(signals[2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/dataset-host-pinning.test.ts`
Expected: the first new test FAILs (`delayMs: 200` currently just resolves after 200ms with
status 200 — no timeout exists yet, so `.rejects` never fires). The third test also fails
(no `signal` is ever passed, so `signals` is `[undefined, undefined, undefined]`, not 3 equal
`AbortSignal` instances).

- [ ] **Step 3: Implement the timeout**

In `packages/datasets/src/host-pinning.ts`, add the exported constant immediately before
`createHostPinnedFetch` (currently starts at L129):

```ts
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
```

Replace the current `createHostPinnedFetch` function body (L129-167) with:

```ts
export function createHostPinnedFetch(
  allowedHosts: readonly string[],
  fetchFn: typeof fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): typeof fetch {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let currentUrl = resolveUrl(input);
    assertHttpsAndAllowed(currentUrl, allowed);

    const controller = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let currentInit: RequestInit | undefined = { ...init, signal: controller.signal };
      let currentMethod = (init?.method ?? "GET").toUpperCase();
      let response = await fetchFn(currentUrl.toString(), { ...currentInit, redirect: "manual" });
      let hops = 0;

      while (REDIRECT_STATUSES.has(response.status) && hops < MAX_REDIRECTS) {
        const location = response.headers.get("location");
        if (!location) break;
        const previousHost = currentUrl.hostname.toLowerCase();
        currentUrl = resolveUrl(location, currentUrl);
        assertHttpsAndAllowed(currentUrl, allowed);
        if (currentUrl.hostname.toLowerCase() !== previousHost) {
          currentInit = stripSensitiveHeaders(currentInit);
        }
        if (shouldDowngradeToGet(response.status, currentMethod)) {
          currentInit = downgradeToGet(currentInit);
          currentMethod = "GET";
        }
        response = await fetchFn(currentUrl.toString(), { ...currentInit, redirect: "manual" });
        hops += 1;
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        throw new Error(`Dataset runtime host pinning: exceeded ${MAX_REDIRECTS} redirects`);
      }

      return response;
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}
```

Note: `stripSensitiveHeaders`/`downgradeToGet` both spread `...init` internally, so they preserve
the `signal` set on `currentInit` untouched across every hop.

In `packages/datasets/src/index.ts`, add `DEFAULT_FETCH_TIMEOUT_MS` to the existing
`host-pinning.js` export block:

```ts
export {
  assertValidFetchHosts,
  createHostPinnedFetch,
  DEFAULT_FETCH_TIMEOUT_MS,
  HostPinningViolationError,
  isPinnableHost
} from "./host-pinning.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/dataset-host-pinning.test.ts`
Expected: PASS (all tests in the file, including the pre-existing ones — confirms no regression
to redirect/header/downgrade behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/datasets/src/host-pinning.ts packages/datasets/src/index.ts tests/unit/dataset-host-pinning.test.ts
git commit -m "feat(datasets): add request timeout to createHostPinnedFetch (#858)"
```

---

## Task 2: 858b — thread `fetchTimeoutMs` through `DatasetClientDeps`

**Files:**

- Modify: `packages/datasets/src/client.ts:37-42` (`DatasetClientDeps`), `:88` (the
  `createHostPinnedFetch` call site)
- Test: `tests/unit/dataset-client.test.ts` (new test)

**Interfaces:**

- Consumes: `createHostPinnedFetch(allowedHosts, fetchFn, timeoutMs?)` from Task 1.
- Produces: `DatasetClientDeps.fetchTimeoutMs?: number`, threaded into every `DatasetClient` built
  by `createDatasetClient`.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/dataset-client.test.ts` (needs `ExternalSourceAdapterContext`, already imported
as a type in this file; also needs `source(...)` — check the file's existing fixture helper name
for building a `ModuleExternalSourceManifest`; if it's not already named `source`, use whatever
local factory this file already uses for the first argument to `createDatasetClient` elsewhere in
the file and pass `{ fetchHosts: ["example.com"] }`-equivalent overrides):

```ts
function adapterCallingFetch(url: string): ExternalSourceAdapter {
  return {
    fetchDataset: async (_datasetKey, _params, ctx: ExternalSourceAdapterContext) => {
      const res = await ctx.fetchFn(url);
      return res.json();
    }
  };
}

it("threads fetchTimeoutMs through to the underlying pinned fetch (#858)", async () => {
  const hangingFetch = (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("{}", { status: 200 })), 200);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as unknown as typeof fetch;

  const client = createDatasetClient(
    source({ fetchHosts: ["example.com"] }),
    adapterCallingFetch("https://example.com/widgets"),
    { fetchFn: hangingFetch, fetchTimeoutMs: 20 }
  );
  const start = performance.now();
  const envelope = await client.getDataset("widgets", {}, { fallback: { empty: true } });
  const elapsed = performance.now() - start;
  expect(envelope).toMatchObject({ data: { empty: true }, degraded: true });
  expect(elapsed).toBeLessThan(150); // well under the 200ms hang → the 20ms timeout fired
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/dataset-client.test.ts`
Expected: FAIL — either a TypeScript error (`fetchTimeoutMs` not on `DatasetClientDeps`) or, once
that's stubbed, the assertion on `elapsed` fails because nothing aborts the hanging fetch and the
call takes ~200ms instead of ~20ms (or the whole `await` just hangs past the test timeout).

- [ ] **Step 3: Implement the threading**

In `packages/datasets/src/client.ts`, add the field to `DatasetClientDeps` (currently L37-42):

```ts
export interface DatasetClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
  readonly maxEntriesPerSource?: number;
  readonly logger?: DatasetLogger;
  readonly fetchTimeoutMs?: number;
}
```

Change the call site (currently L88):

```ts
const pinnedFetch = createHostPinnedFetch(
  source.fetchHosts,
  deps.fetchFn ?? fetch,
  deps.fetchTimeoutMs
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/dataset-client.test.ts`
Expected: PASS (full file — confirms no regression to existing `createDatasetClient` behavior).

- [ ] **Step 5: Commit**

```bash
git add packages/datasets/src/client.ts tests/unit/dataset-client.test.ts
git commit -m "feat(datasets): thread fetchTimeoutMs through DatasetClientDeps (#858)"
```

---

## Task 3: 858a — web-layer `key={}` id→url fixes (mechanical, 7 sites) + regression test

**Files:**

- Modify: `packages/sports/src/web/sports-news.tsx:159,175,209,316,358-368,395,403`
- Test: `tests/unit/sports-newsband.test.tsx` (new `describe` block)

**Interfaces:**

- Consumes: `Headline` from `@jarv1s/shared` (`imageUrl: string | null`, not `undefined` — use
  `null` when overriding to "no image" in test fixtures).
- No new exports; this task only changes internal list-identity keys.

- [ ] **Step 1: Write the failing regression test**

Add to `tests/unit/sports-newsband.test.tsx` (new `describe` block; existing `headline()`/
`group()` helpers at the top of the file stay unchanged — `group()` only wraps one headline, so
build this 5-item group inline):

```ts
describe("NewsBand majors/mosaic url-keying (#858)", () => {
  it("keys majors/mosaic by url, not id, so a same-id different-story headline isn't wrongly promoted to major", () => {
    const items: Headline[] = [
      headline({
        id: "a0",
        url: "https://www.espn.com/nfl/story/_/id/a0",
        imageUrl: null,
        summary: ""
      }),
      headline({
        id: "dup",
        url: "https://www.espn.com/nfl/story/_/id/dup-1",
        summary: "",
        title: "Story One"
      }),
      headline({
        id: "b",
        url: "https://www.espn.com/nfl/story/_/id/b",
        summary: "",
        title: "Story Two"
      }),
      headline({
        id: "dup",
        url: "https://www.espn.com/nfl/story/_/id/dup-2",
        summary: "",
        title: "Story Three Distinct"
      }),
      headline({
        id: "d",
        url: "https://www.espn.com/nfl/story/_/id/d",
        summary: "",
        title: "Story Four"
      })
    ];
    const html = renderToString(
      createElement(NewsBand, {
        groups: [{ competitionKey: "nfl", competitionLabel: "NFL", headlines: items }],
        followedPairs: new Set<string>()
      })
    );
    // item0: no imageUrl/no summary, feedRank-0 bonus alone = weight 2 (< BIG_STORY_WEIGHT 4) →
    // never becomes `feature`. items 1-4: default imageUrl (truthy) from headline(), no summary,
    // feedRank!=0 = weight 2 each, tied with item0 → stable sort keeps insertion order.
    // MAJORS_CAP=2 picks the first two image-bearing items in that order: item1 ("dup") + item2
    // ("b"). item3 shares item1's id ("dup") but has a DIFFERENT url — before the fix, id-keyed
    // majorIds/mosaicIds wrongly re-admits item3 as a THIRD major (3 occurrences); after the
    // url-keyed fix, exactly 2.
    const majorCount = html.split("sp-newsband__art--major").length - 1;
    expect(majorCount).toBe(2);
    expect(html).toContain("Story Three Distinct");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/sports-newsband.test.tsx`
Expected: FAIL — `majorCount` is `3` on the current id-keyed code (item3's colliding id "dup"
wrongly re-admits it as a third major).

- [ ] **Step 3: Apply the 7 mechanical key swaps in `packages/sports/src/web/sports-news.tsx`**

3a. HeroSlide (currently L159, inside the carousel `slides.map((headline, i) => (...))`):

```tsx
{
  slides.map((headline, i) => (
    <HeroSlide key={headline.url} headline={headline} active={i === active} />
  ));
}
```

3b. Carousel dot (currently L175, the second `slides.map((headline, i) => (...))`):

```tsx
{
  slides.map((headline, i) => (
    <button
      key={headline.url}
      type="button"
      className="sp-carousel__dot"
      aria-label={`Story ${i + 1} of ${count}`}
      aria-current={i === active || undefined}
      onClick={() => setIndex(i)}
    />
  ));
}
```

3c. `LatestColumn` list item (currently L209):

```tsx
          <li className="sp-latest__item" key={headline.url}>
```

3d. `FeatureArticle` paragraph key (currently L316):

```tsx
          headline.body.split("\n\n").map((paragraph, index) => (
            <p
              className="sp-newsband__blurb sp-newsband__blurb--feature"
              key={`${headline.url}-p${index}`}
            >
```

3e. `majorIds`/`flow`/`mosaicIds`/`mosaic` (currently L358-368) — rebuild the same sets from
`.url` instead of `.id` (variable names unchanged, per the coordinator's mechanical-only
condition — only the keyed property changes):

```tsx
const majorIds = new Set(
  rest
    .filter((s) => s.headline.imageUrl)
    .slice(0, MAJORS_CAP)
    .map((s) => s.headline.url)
);
const flow = rest.filter((s) => !majorIds.has(s.headline.url));
const standards = flow.slice(0, STANDARDS_CAP);
const mosaicIds = new Set([...majorIds, ...standards.map((s) => s.headline.url)]);
// Weight order preserved across both tiers so the page reads big → small.
const mosaic = rest.filter((s) => mosaicIds.has(s.headline.url));
const briefs = flow.slice(STANDARDS_CAP, STANDARDS_CAP + BRIEFS_CAP);
```

3f. `NewsArticle` mosaic render (currently L395):

```tsx
{
  mosaic.map(({ headline }) => (
    <NewsArticle key={headline.url} headline={headline} major={majorIds.has(headline.url)} />
  ));
}
```

3g. Briefs list item (currently L403):

```tsx
            {briefs.map(({ headline }) => (
              <li className="sp-newsband__brief" key={headline.url}>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/sports-newsband.test.tsx`
Expected: PASS (both the new test and every existing test in the file — confirms the feature-body
rendering and existing majors/mosaic behavior are unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/web/sports-news.tsx tests/unit/sports-newsband.test.tsx
git commit -m "fix(sports): key NewsBand list identity by url, not id (#858)"
```

---

## Task 4: 858a service-layer fix 1/3 — `topStoryIds` → `topStoryUrls` (`sports-service.ts:300,342`)

**Files:**

- Modify: `packages/sports/src/sports-service.ts:300` (declaration), `:342` (consumer)
- Test: `tests/unit/sports-service.test.ts` (new `describe`/`it` block)

**Interfaces:**

- Consumes: `SourceHeadline` (from `./source/sports-source.js`), `makeDeps`/`makeSource`/`userA`
  exported by `tests/unit/sports-service.test.ts` (already used this way by
  `sports-service-dedupe.test.ts`).
- No signature changes — internal rename + rekey only.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/sports-service.test.ts` (new `it`, e.g. inside a new
`describe("id→url story keying (#858)")` block placed after the existing top-stories tests):

```ts
describe("id→url story keying (#858)", () => {
  it("does not drop a distinct same-id story from leagueNews just because a different story with the same id became a top story", async () => {
    const nflLeagueFollow: SportsFollowDto = {
      id: "f1",
      competitionKey: "nfl",
      teamKey: null,
      createdAt: "2026-06-01T00:00:00.000Z"
    };
    const h0: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "Editorial lead (becomes the top story)",
      url: "https://example.com/dup-a",
      publishedAt: `${TODAY}T10:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const h1: SourceHeadline = {
      id: "dup",
      competitionKey: "nfl",
      competitionLabel: "NFL",
      title: "Distinct story, colliding id",
      url: "https://example.com/dup-b",
      publishedAt: `${TODAY}T11:00:00.000Z`,
      imageUrl: null,
      summary: "",
      teamKeys: [],
      sourceTeamIds: []
    };
    const service = new SportsService(
      makeDeps({
        follows: [nflLeagueFollow],
        source: makeSource({
          getHeadlines: async (competitionKey) => (competitionKey === "nfl" ? [h0, h1] : [])
        })
      })
    );
    const overview = await service.getOverview(userA);
    expect(overview.topStories.map((h) => h.url)).toContain("https://example.com/dup-a");
    const nflGroup = overview.leagueNews.find((g) => g.competitionKey === "nfl");
    expect(nflGroup?.headlines.map((h) => h.title)).toEqual(["Distinct story, colliding id"]);
  });
});
```

`TODAY` is the file's existing top-level constant (`"2026-07-01"`); `SportsFollowDto` is already
imported from `@jarv1s/shared` at the top of this file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: FAIL — on current code, `nflGroup` is `undefined` (both `h0` and `h1` share id "dup",
so the id-keyed filter drops both from `leagueNews`, leaving the whole nfl group empty and
therefore excluded entirely by the trailing `.filter((group) => group.headlines.length > 0)`).

- [ ] **Step 3: Implement the fix**

In `packages/sports/src/sports-service.ts`, rename the declaration (currently L300):

```ts
const topStoryUrls = new Set(rankedTopStories.map((h) => h.url));
```

And its consumer (currently L342, inside the `leagueNews` map):

```ts
headlines: (headlinesByComp.get(key) ?? []).filter((h) => !topStoryUrls.has(h.url));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: PASS (full file — confirms no regression to the existing "ranks by editorial feed
position" and whole-league-follow tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/sports-service.ts tests/unit/sports-service.test.ts
git commit -m "fix(sports): key topStoryIds by url, not id (#858)"
```

---

## Task 5: 858a service-layer fix 2/3 — feature-body splice by url (`sports-service.ts:376-384`)

**Files:**

- Modify: `packages/sports/src/sports-service.ts:376-384`
- Test: `tests/unit/sports-service.test.ts` (new `it`)

**Interfaces:**

- Consumes: `topStoryUrls`-fixed behavior from Task 4 (this task's fixture relies on it: a
  non-top-story headline in a second competition survives into `leagueNews`).
- No signature changes.

- [ ] **Step 1: Write the failing test**

Add to the `describe("id→url story keying (#858)")` block from Task 4:

```ts
it("does not splice the featured article's body onto an unrelated headline that happens to share its id", async () => {
  const nflFollow: SportsFollowDto = {
    id: "f1",
    competitionKey: "nfl",
    teamKey: null,
    createdAt: "2026-06-01T00:00:00.000Z"
  };
  const nbaFollow: SportsFollowDto = {
    id: "f2",
    competitionKey: "nba",
    teamKey: null,
    createdAt: "2026-06-01T00:00:00.000Z"
  };
  // nfl feed: an editorial lead (tier-1 top story, excluded from leagueNews) followed by the
  // heavy story that will become the feature — image + summary + first-in-its-(filtered)-group
  // bonus clears BIG_STORY_WEIGHT (4): 2 + 1 + 2 = 5.
  const nflLead: SourceHeadline = {
    id: "nfl-lead",
    competitionKey: "nfl",
    competitionLabel: "NFL",
    title: "NFL editorial lead",
    url: "https://example.com/nfl-lead",
    publishedAt: `${TODAY}T09:00:00.000Z`,
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: []
  };
  const nflFeature: SourceHeadline = {
    id: "dup",
    competitionKey: "nfl",
    competitionLabel: "NFL",
    title: "NFL feature story",
    url: "https://example.com/nfl-dup",
    publishedAt: `${TODAY}T10:00:00.000Z`,
    imageUrl: "https://img.example.com/nfl.jpg",
    summary: "NFL summary text",
    teamKeys: [],
    sourceTeamIds: []
  };
  // nba feed: its own editorial lead (tier-1 top story, excluded), then a second, unrelated
  // story that happens to share `nflFeature`'s id "dup" but has a completely different url.
  const nbaLead: SourceHeadline = {
    id: "nba-lead",
    competitionKey: "nba",
    competitionLabel: "NBA",
    title: "NBA editorial lead",
    url: "https://example.com/nba-lead",
    publishedAt: `${TODAY}T08:00:00.000Z`,
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: []
  };
  const nbaOther: SourceHeadline = {
    id: "dup",
    competitionKey: "nba",
    competitionLabel: "NBA",
    title: "NBA distinct story (colliding id)",
    url: "https://example.com/nba-other",
    publishedAt: `${TODAY}T07:00:00.000Z`,
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: []
  };
  const service = new SportsService(
    makeDeps({
      follows: [nflFollow, nbaFollow],
      source: makeSource({
        getHeadlines: async (competitionKey) => {
          if (competitionKey === "nfl") return [nflLead, nflFeature];
          if (competitionKey === "nba") return [nbaLead, nbaOther];
          return [];
        },
        getArticleBody: async () => "Fetched real article body."
      })
    })
  );
  const overview = await service.getOverview(userA);
  const nflGroup = overview.leagueNews.find((g) => g.competitionKey === "nfl");
  expect(nflGroup?.headlines.find((h) => h.title === "NFL feature story")?.body).toBe(
    "Fetched real article body."
  );
  const nbaGroup = overview.leagueNews.find((g) => g.competitionKey === "nba");
  expect(
    nbaGroup?.headlines.find((h) => h.title === "NBA distinct story (colliding id)")?.body
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: FAIL — on current code, `nbaOther.body` is `"Fetched real article body."` (the id-keyed
splice at L384 wrongly stamps it onto every headline sharing `feature.id`, including a distinct
story from another competition).

- [ ] **Step 3: Implement the fix**

In `packages/sports/src/sports-service.ts`, change the splice predicate (currently L376-384) —
only the comparison inside the inner `.map` changes; the cache key on the line above stays
`{ articleId: feature.id }` untouched (out of scope, a cache-key concern not a list-identity one):

```ts
const leagueNewsWithBody =
  feature && featureBody
    ? publicLeagueNews.map((group) => ({
        ...group,
        headlines: group.headlines.map((h) =>
          h.url === feature.url ? { ...h, body: featureBody } : h
        )
      }))
    : publicLeagueNews;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: PASS (full file).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/sports-service.ts tests/unit/sports-service.test.ts
git commit -m "fix(sports): splice the featured article body by url, not id (#858)"
```

---

## Task 6: 858a service-layer fix 3/3 — `rankTopStories`'s `pickedIds` → `pickedUrls` (`sports-service.ts:773,783,785,798,801`)

**Files:**

- Modify: `packages/sports/src/sports-service.ts:773-801` (`rankTopStories` function body)
- Test: `tests/unit/sports-service.test.ts` (new `it`)

**Interfaces:**

- No signature changes to `rankTopStories` (still `(headlinesByComp, followedTeams,
followedCompetitionKeys) => SourceHeadline[]`) — internal rename + rekey only.

- [ ] **Step 1: Write the failing test**

Add to the `describe("id→url story keying (#858)")` block:

```ts
it("does not let a tier-1 lead's id block a distinct, team-matched story from tier 2 just because the ids collide", async () => {
  const dalFollow: SportsFollowDto = {
    id: "f1",
    competitionKey: "nfl",
    teamKey: "dal",
    createdAt: "2026-06-01T00:00:00.000Z"
  };
  // h0 is the tier-1 pick (front of feed, unconditional) — not tagged to any team.
  const h0: SourceHeadline = {
    id: "dup",
    competitionKey: "nfl",
    competitionLabel: "NFL",
    title: "Editorial lead",
    url: "https://example.com/a",
    publishedAt: `${TODAY}T10:00:00.000Z`,
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: []
  };
  // h1 shares h0's id ("dup") but is a distinct story (different url) tagged to the followed
  // team (sourceTeamIds "6" → resolves to "dal" via the listTeams override below) — tier 2
  // should pick it up.
  const h1: SourceHeadline = {
    id: "dup",
    competitionKey: "nfl",
    competitionLabel: "NFL",
    title: "Distinct dal story, colliding id",
    url: "https://example.com/b",
    publishedAt: `${TODAY}T11:00:00.000Z`,
    imageUrl: null,
    summary: "",
    teamKeys: [],
    sourceTeamIds: ["6"]
  };
  const service = new SportsService(
    makeDeps({
      follows: [dalFollow],
      source: makeSource({
        getHeadlines: async (competitionKey, teamKey) => {
          if (competitionKey !== "nfl") return [];
          if (teamKey) return []; // isolate: no per-team feed noise for this test
          return [h0, h1];
        },
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
  expect(overview.topStories.map((h) => h.url)).toContain("https://example.com/b");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: FAIL — on current code, tier 2's `!pickedIds.has(headline.id)` check sees `h1.id ===
"dup"` already recorded by tier 1's `h0`, so `h1` never gets added even though it's a distinct,
team-matched story; `overview.topStories` contains only `h0`'s url.

- [ ] **Step 3: Implement the fix**

In `packages/sports/src/sports-service.ts`, rename `pickedIds` → `pickedUrls` and rekey every
read/write by `.url` throughout `rankTopStories` (currently L766-802-ish, tier-1 block ~L773-787,
tier-2 block ~L795-801):

```ts
function rankTopStories(
  headlinesByComp: ReadonlyMap<string, readonly SourceHeadline[]>,
  followedTeams: readonly ResolvedFollow[],
  followedCompetitionKeys: readonly string[]
): SourceHeadline[] {
  const pairs = new Set(followedTeams.map((f) => `${f.competitionKey}:${f.teamKey}`));
  const picked: SourceHeadline[] = [];
  const pickedUrls = new Set<string>();

  for (const comp of followedCompetitionKeys) {
    const lead = (headlinesByComp.get(comp) ?? [])[0];
    if (lead && !pickedUrls.has(lead.url)) {
      picked.push(lead);
      pickedUrls.add(lead.url);
    }
  }

  const all = [...headlinesByComp.values()]
    .flatMap((list) => list.map((headline, feedRank) => ({ headline, feedRank })))
    .sort((a, b) => a.feedRank - b.feedRank || byNewest(a.headline, b.headline));
  for (const { headline } of all) {
    if (
      headline.teamKeys.some((k) => pairs.has(`${headline.competitionKey}:${k}`)) &&
      !pickedUrls.has(headline.url)
    ) {
      picked.push(headline);
      pickedUrls.add(headline.url);
    }
  }
  return picked.slice(0, TOP_STORIES_CAP);
}
```

Only the `pickedIds`→`pickedUrls` rename and the `.id`→`.url` swaps on the `has`/`add` calls
change; every comment, `pairs` construction, and the surrounding tier-1/tier-2 control flow stays
as-is.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/sports-service.test.ts`
Expected: PASS (full file — confirms the "ranks by editorial feed position, caps top stories at
six" test and the whole-league-follow test both still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/sports/src/sports-service.ts tests/unit/sports-service.test.ts
git commit -m "fix(sports): key rankTopStories' picked-story dedup by url, not id (#858)"
```

---

## Final gate (before wrap-up)

- [ ] Run the full unit suite once more: `pnpm test:unit`. Expected: PASS, no regressions outside
      the files touched above.
- [ ] Run the pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`.
- [ ] `git fetch origin main && git rebase origin/main`.
- [ ] Proceed to `coordinated-wrap-up`. PR body must cite Tasks 4/5/6 by line reference (per the
      coordinator's approval condition) and note the 858b default timeout value + rationale.
