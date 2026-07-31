### Task 14: Crawl stage

**This produces a function, not a handler.** Nothing in this task appears in the manifest. A worker
handler cannot enqueue anything — `ModuleWorkerContext` has no jobs port — so crawl and score cannot
be two queued steps handing off to each other. They are two _stage functions_ composed inside one
invocation by Task 15, which is what lets each be unit-tested against a fake store with no SDK, no
network and no model. The directory name `stages/` is load-bearing: a file in `handlers/` is
something the manifest names, and this is not.

**Depends on:** Task 5 (`FailureCause`), Task 6 (`applyHardExcludes`), Task 7 (`dedupePostings`),
Task 11 (`Portal`, `FetchLike`), Task 13 (`JobSearchStore`).

**Files**

- Create: `external-modules/job-search/src/worker/stages/crawl.ts`
- Test: `tests/unit/job-search-crawl-stage.test.ts`

**Contracts**

```ts
/** The embedding dependency, structurally typed so the unit test passes a plain object.
 * These three names are Task 1's `ModuleEmbedPort` verbatim — `ctx.embed` satisfies this
 * without an adapter, and the document/query split must survive down to here because nomic
 * applies a different task prefix to each. */
export interface EmbedPort {
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  dimensions(): Promise<number>;
}

export async function runCrawl(deps: {
  store: JobSearchStore;
  portals: readonly Portal[];
  fetch: FetchLike;
  embed: EmbedPort;
  profileId: string;
  now: string;
  /** Epoch millis after which the stage stops STARTING new work and returns what it has.
   * Task 15 sets it so that scoring still gets a share of the invocation. */
  deadlineAt: number;
  /** Injected, not `Date.now()`, so the deadline test is deterministic. */
  clock: () => number;
}): Promise<{
  found: number;
  kept: number;
  degraded: FailureCause[];
  /** True when the deadline cut the stage short. Task 15 turns this into a visible
   * "checked 1 of 2 boards" state rather than letting it look like a clean pass. */
  truncated: boolean;
}>;
```

**Sequence**

Per profile: list enabled portals → walk them **one at a time**, checking the deadline before each →
`dedupePostings` with priority `["freehire", "linkedin"]` → `applyHardExcludes` → `upsertPostings` →
`embedDocuments` in batches of 128 → `setEmbedding`. Write every portal's `PortalState` back, healthy
or not.

**Constraints**

- **Sequential, not `Promise.allSettled`.** `allSettled` starts every portal in the same tick, which
  makes the deadline check unreachable — portal two is already in flight before the clock is ever
  consulted, so test 7 cannot pass. Isolation comes from the `try`/`catch` inside the loop, not from
  the combinator. Concurrency would also put both boards' full paging load on the wire at once
  against a shared deadline: the slow portal gets no more wall-clock than it does here, and the fast
  one gets less headroom to finish cleanly.
- **Each portal gets an equal share of what is left, recomputed every iteration**, not divided once
  up front: `Math.min(deadlineAt, clock() + Math.floor((deadlineAt - clock()) / remainingPortals))`
  where `remainingPortals = portals.length - index`. Dividing once lets portal one consume the whole
  window and hands portal two a slice that has already expired. A portal that finishes early donates
  its unused time to the ones after it.
- **Name every argument to `portal.crawl`. Do not spread.** An earlier revision wrote
  `portal.crawl({ ...input, deadlineAt })` against an `input` this function does not have — not
  implementable, and it would have hidden a missing field behind a structurally-satisfied type.
- **No `signal`.** `Portal.crawl` has no such parameter and could not honour one (Task 11). The
  pre-fetch clock check plus the per-portal number are the module's entire share of cancellation.
- **The per-portal deadline is cooperative, and that is the limit of the isolation claim.** A portal
  that ignores its `deadlineAt`, or that blocks inside a single host fetch, overruns its share and
  eats the next portal's time; nothing here can preempt it. Either the platform grows a generic
  host-clamped per-request `timeoutMs` on `ModuleFetchRequest` — a core change, out of this module's
  scope — or the plan does not claim hard isolation between portals. **It does not.** Say
  "cooperative per-portal budget", never "isolated", in comments and in any user-facing copy derived
  from this.
- **`truncated` is true if any portal was skipped for time _or_ any `CrawlResult.failure.kind ===
"deadline"`.** A portal that stopped at its own slice with partial postings is still a truncated
  stage; Task 15 has to be able to say "checked 1 of 2 boards".
- **Write portal state before returning, even on the truncated path.** A skipped portal keeps its
  previous state; a failed portal records its cause. Losing this write is how the board ends up
  claiming a source is healthy when it has been failing for a week.
- **A rejected `crawl` promise is a `network` cause, never zero postings.** `ctx.fetch` throws
  `invalid_rpc` when `fetchHosts` does not cover the URL; reporting that as "no jobs matched" is the
  misleading-silence failure.

**Tests** (`tests/unit/job-search-crawl-stage.test.ts`, against an in-memory fake `JobSearchStore`)

1. **A clean crawl stores deduped postings and records `lastOkAt` for each portal.**
2. **One portal failing does not lose the others' results** — a `rate_limited` LinkedIn alongside a
   healthy freehire stores freehire's postings and records LinkedIn's cause in `degraded`.
3. **A `login_required` portal is written back with `enabled: false`.**
4. **A disabled portal is not crawled on the next pass** — asserts its `crawl` was never called.
   Fails against a stage that filters on nothing and relies on the portal to refuse.
5. **Postings are embedded through `embedDocuments` in batches of ≤128** (Task 1's cap), and
   **`embedQuery` is never called here.** The criteria embedding belongs to the triage stage; calling
   the wrong one silently degrades retrieval, because nomic applies a different task prefix to each
   and nothing throws.
6. **The stage never writes a `fit` or `want` value.** Crawling and scoring are separate stages, and
   a crawled-but-unscored posting must be visibly `unscored` rather than silently absent.
7. **Stops starting portals past the deadline and reports that it did.** Two portals; a clock that
   jumps past `deadlineAt` during the first. Asserts the second portal's `crawl` was never called,
   the first portal's postings were still stored, and `truncated === true`. Fails against a check
   placed after the crawl instead of before it — which is the outcome that matters, because a slow
   first portal would otherwise leave the user with fresh postings, no scores, and a board where
   every row reads "unscored".
8. **A portal that throws does not prevent later portals from running**, and its `PortalState.cause`
   records the failure. This is case 2 one level lower: case 2 covers a portal that _reports_ a
   failure, this one a portal that _rejects_. Asserts the second portal's `crawl` was called, its
   postings were stored, and the thrower's state carries a cause rather than a healthy `lastOkAt`.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-crawl-stage.test.ts   # exit 0, eight cases
```
