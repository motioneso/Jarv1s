# Relay 3 — 858-sports-hardening (context 71%, still zero code/plan)

Same branch/worktree/coordinator as `relay.md` (issue body + approval, verbatim) and `relay2.md`
(858b design decision). Read both if you haven't. **This round: re-verified every line number
firsthand (all still exact, zero drift), and fully designed every test's fixture/assertions —
plan-writing should now be pure transcription, no more research.** Go straight to
`superpowers:writing-plans`.

## Re-verified this round (all exact, cite these line numbers with confidence)

- `packages/sports/src/sports-service.ts`: L294 `followedStoryUrls` (pattern to mirror), L300
  `topStoryIds`, L342 consumer, L376-384 feature-body splice (L377 cache key stays untouched,
  L384 `h.id === feature.id` is the only line to change), L773 `pickedIds` decl, L783/L785 tier-1,
  L798/L801 tier-2. `toPublicHeadline` (L723-750) passes `url`/`id` straight through — the
  `feature` object handed to the splice already carries `.url`. `TOP_STORIES_CAP = 6` (L93).
- `packages/sports/src/web/sports-news.tsx`: L159, L175, L209, L316, L358-368 (majorIds/flow/
  standards/mosaicIds/mosaic), L395, L403 all confirmed unchanged. `NewsArticle`'s className
  build is L252-255: `["sp-newsband__art", major ? "sp-newsband__art--major" : null, major &&
  isWrittenArticle(headline) ? "sp-newsband__art--longform" : null]` — so counting occurrences of
  the substring `"sp-newsband__art--major"` in rendered HTML is a clean, false-positive-free way
  to assert how many items got the major treatment (longform is an additive suffix, doesn't
  collide).
- `packages/datasets/src/host-pinning.ts`: full current source read (168 lines) — confirmed no
  existing timeout/AbortController logic, confirmed `currentInit`/`currentMethod` mutation shape
  the timeout patch slots into.
- `packages/datasets/src/client.ts`: `DatasetClientDeps` L37-42 (`fetchFn?`, `now?`,
  `maxEntriesPerSource?`, `logger?`), `createHostPinnedFetch(source.fetchHosts, deps.fetchFn ??
  fetch)` call at L88 — the one line to extend with a 3rd arg.

## Full designed diff for 858b (paste into plan verbatim)

`host-pinning.ts` — add before `createHostPinnedFetch`:
```ts
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
```
Change signature + body (one `AbortController` per outer call, reused across every hop — set
`signal` once before the loop; `stripSensitiveHeaders`/`downgradeToGet` both spread `...init` so
they preserve it untouched; `clearTimeout` in `finally` wraps the whole hop loop):
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
`index.ts`: add `DEFAULT_FETCH_TIMEOUT_MS` to the existing host-pinning.js export block.
`client.ts`: add `readonly fetchTimeoutMs?: number;` to `DatasetClientDeps`; change L88 to
`createHostPinnedFetch(source.fetchHosts, deps.fetchFn ?? fetch, deps.fetchTimeoutMs)`.

## Fully designed tests (paste into plan verbatim)

**`tests/unit/dataset-host-pinning.test.ts`** — new `describe("createHostPinnedFetch — fetch
timeout (#858)")`, new local fake (none of the existing `fakeFetch*` helpers honor `init.signal`):
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
```
Note: test 1 is the RED-first test (fails against current code — no timeout exists at all, so
`delayMs: 200` would just resolve after 200ms with status 200, and `.rejects` would fail). Write
it first, confirm it fails, then implement.

**`tests/unit/dataset-client.test.ts`** — new adapter that actually calls `ctx.fetchFn` (unlike
`adapterFrom`, which bypasses it):
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
Needs `ExternalSourceAdapterContext` imported (already imported as a type in this file).

**`tests/unit/sports-newsband.test.tsx`** — new test in a new `describe("NewsBand majors/mosaic
url-keying (#858)")` block (existing `headline()`/`group()` helpers stay; build a 5-item group
inline since `group()` only supports one headline):
```ts
it("keys majors/mosaic by url, not id, so a same-id different-story headline isn't wrongly promoted to major", () => {
  const items: Headline[] = [
    headline({ id: "a0", url: "https://www.espn.com/nfl/story/_/id/a0", imageUrl: undefined, summary: "" }),
    headline({ id: "dup", url: "https://www.espn.com/nfl/story/_/id/dup-1", summary: "", title: "Story One" }),
    headline({ id: "b", url: "https://www.espn.com/nfl/story/_/id/b", summary: "", title: "Story Two" }),
    headline({ id: "dup", url: "https://www.espn.com/nfl/story/_/id/dup-2", summary: "", title: "Story Three Distinct" }),
    headline({ id: "d", url: "https://www.espn.com/nfl/story/_/id/d", summary: "", title: "Story Four" })
  ];
  const html = renderToString(
    createElement(NewsBand, {
      groups: [{ competitionKey: "nfl", competitionLabel: "NFL", headlines: items }],
      followedPairs: new Set<string>()
    })
  );
  // item0: no imageUrl/no summary, feedRank-0 bonus alone = weight 2 (< BIG_STORY_WEIGHT 4) →
  // never becomes `feature`. items 1-4: imageUrl set, no summary, feedRank!=0 = weight 2 each,
  // tied with item0 → stable sort keeps insertion order. MAJORS_CAP=2 picks the first two
  // image-bearing items in that order: item1 ("dup") + item2 ("b"). item3 shares item1's id
  // ("dup") but has a DIFFERENT url — before the fix, id-keyed majorIds/mosaicIds wrongly
  // re-admits item3 as a THIRD major (3 occurrences); after the url-keyed fix, exactly 2.
  const majorCount = html.split("sp-newsband__art--major").length - 1;
  expect(majorCount).toBe(2);
  expect(html).toContain("Story Three Distinct");
});
```
Note: `headline()`'s default `imageUrl`/`summary` are both truthy — override `imageUrl: undefined,
summary: ""` on item0 only; items 1-4 need `summary: ""` override (keep default `imageUrl`) so
their weight is exactly 2, not 3. Check `Headline` type allows `imageUrl?: string` (optional) —
confirm at use; if the type requires `string | null` instead of `undefined`, use `null` there
instead (grep `interface Headline` in `packages/shared` before writing this step for real).

## Next steps for successor (unchanged target, just resume here)

1. `[ -d node_modules ] || pnpm install` (already present, skip).
2. Write the plan via `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-09-858-sports-hardening.md`.
   Everything needed — file paths, line numbers, full diffs, full test code — is now in this doc
   (858b) plus `relay.md`/`relay2.md` (858a exact line list + coordinator's verbatim approval
   conditions). Task order per `relay2.md`: 858b timeout → 858b threading → 858a web-layer
   (regression test + 7 key swaps, one task) → 858a service-layer (3 fixes, call out all 3 by line
   ref in plan + PR body per coordinator condition).
3. Message coordinator (label `Coordinator`, **resolve pane fresh by label+session id via `herdr
   pane list`, never a cached `…-N`**) with the plan path. **STOP and wait for approval before
   writing any code.**
4. Build via `superpowers:test-driven-development` once approved, one task per commit, `git add`
   explicit paths only.
5. Pre-push trio (`format:check && lint && typecheck` + rebase on `origin/main`) before push.
6. `coordinated-wrap-up` — PR body must call out all 3 service-layer fixes with line refs.

## Bootstrap for successor (herdr-handoff)

Same worktree/branch. Bootstrap: "continue 858-sports-hardening; `[ -d node_modules ] ||
pnpm install`; read `docs/superpowers/handoffs/2026-07-09-858-sports-hardening-relay3.md` IN FULL
(skip relay.md/relay2.md unless you want the original issue body verbatim — relay3 has everything
needed to write the plan), then resume via `coordinated-build` starting at 'Next steps for
successor' step 2 — go straight to writing the plan, all research and test design is done."
