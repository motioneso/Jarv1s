## Phase 3 — Source adapters

### Task 11: Portal interface and the freehire adapter

`freehire.me` first: it is the widest source (~50 ATS boards behind one declared host), so it proves
the interface before LinkedIn.

**Depends on:** Task 5 (`Posting`, `FailureCause`, `describeFailure`, `SearchCriteria`).

**Files**

- Create: `external-modules/job-search/src/adapters/types.ts`
- Create: `external-modules/job-search/src/adapters/freehire.ts`
- Create: `tests/fixtures/job-search/freehire-data.json` (captured, trimmed to three postings)
- Test: `tests/unit/job-search-adapter-freehire.test.ts`

**Probe results (live `curl`, 2026-07-27) — these are decisions, not background**

- `GET /api/jobs` → **404**. It does not exist.
- `GET /api/v1/jobs` → 200, `{data, meta:{limit,offset,total}}`, no key, `limit` capped at 100, good
  field mapping — but **it accepts no filters at all**. Every parameter tried (`search, q, query,
keyword(s), title, text, country, countries, work_mode, regions, is_tech, collections, per_page`)
  returned the byte-identical unfiltered first page of `total: 3,278,266`. Useless as a targeted
  source.
- `GET /__data.json` → the SvelteKit SSR route, and **the only thing that filters**. `work_mode` and
  `regions` narrow 3.28M → ~600; free-text `q` works but is fuzzy (`q=nurse` → 478,
  `q=zzzznotarealterm` → 3 against a 624 baseline, `q=kubernetes` → 608).

So the adapter targets `__data.json` and treats it as **a fragile internal route, not a public API**.
Two consequences: it must not trust the server's relevance (over-fetch; Task 6 and Task 8 do the
narrowing), and an unrecognised envelope is a `parse_failed` that **disables the portal**, never an
empty result set that reads as "no jobs matched your search".

**Contracts**

```ts
/** The adapter-facing fetch. This is NOT the host port and NOT WHATWG fetch — the real
 * `ctx.fetch` takes one `ModuleFetchRequest` object and resolves
 * `{status, headers, bodyBase64}` with no `ok` and no `text()`. Task 13's `toFetchLike`
 * bridges the two so base64 decoding lives in one place instead of in every adapter.
 * Adapters must be written against this type and tested with a plain `vi.fn()`. */
export interface FetchLike {
  (
    url: string,
    init?: { headers?: Record<string, string> }
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface CrawlResult {
  postings: Posting[];
  /** Present when the crawl stopped early. Partial results above are still kept. */
  failure: FailureCause | null;
}

export interface Portal {
  readonly id: string;
  readonly label: string;
  readonly host: string;
  crawl(args: {
    fetch: FetchLike;
    criteria: SearchCriteria;
    lastOkAt: string | null;
    now: string;
    /** Absolute epoch ms. Check `Date.now() >= deadlineAt` BEFORE each page fetch and return
     * what you already have with `failure: "deadline"`. Task 2e ships this to the worker as
     * `ctx.deadlineAt` and Task 14 narrows it per portal.
     *
     * There is deliberately no `signal` here. A worker-side `AbortSignal` cannot cancel an
     * in-flight `ctx.fetch` — the request crosses JSON-RPC and `ModuleFetchRequest` carries no
     * signal field (`packages/module-sdk/src/index.ts:682`). Cancelling a request already in
     * the host's hands is the host's job (Task 2e); a portal's whole share of it is this
     * cooperative check between fetches. Do not add a `signal` parameter to make the two look
     * symmetrical — it would be a parameter nothing could honour. */
    deadlineAt: number;
    /** Test seam only. Defaults to `Date.now`. Production callers (Task 14's `runCrawl`) pass
     * nothing. It exists so deadline cases are deterministic without `vi.useFakeTimers()`. */
    clock?: () => number;
  }): Promise<CrawlResult>;
}

/** One mapping for every adapter. 401/403 is the login wall: by policy we stop and disable
 * rather than trying to get around it. */
export function statusToKind(status: number): FailureKind;

export const PAGE_CAP = 10;
```

**Constraints**

- **Capture the fixture before writing the parser.** `__data.json` is SvelteKit's own serialization
  format: `{"type":"data","nodes":[…]}` where a node's `data` is a **flat array** and every object
  value inside it is an _integer index into that same array_. A hand-written expectation will be
  wrong. Capture with the module's own User-Agent, trim to three postings, strip cookies / session
  ids / tracking parameters; the fixture is committed, so treat it as public.
- Record in the adapter's header comment which node index holds the job list and which keys carry
  title / company / location / url / description / posted date. Those are the parser's only
  dependencies, and naming them makes the next `parse_failed` a five-minute fix.
- Index resolution is defensive: a value that is not a valid index into the flat array is a payload
  we do not understand, and the caller turns that into a disabling `parse_failed`, never a posting
  with a blank company name.
- `id: ""` on emitted postings is intentional — the store assigns the uuid; the adapter must not
  invent one.
- User-Agent is plain and descriptive (`Jarvis-JobSearch/0.1 (personal use)`). Do not impersonate a
  browser version string and do not rotate identities.
- **Must not fall back to `/api/v1/jobs`** when `__data.json` fails: that endpoint ignores filters,
  so the "fallback" is 3.28M mostly-irrelevant rows presented as search results.
- **Must not narrow on server relevance.** Over-fetch and let Task 6 and Task 8 filter.

**Tests** (`tests/unit/job-search-adapter-freehire.test.ts`)

Every case that is not about the deadline passes a `FAR_FUTURE` deadline, so a slow CI box cannot
turn an unrelated assertion into a flake.

1. **Maps the captured `__data.json` payload onto `Posting` records.** Three postings from the
   fixture; `id === ""`, `sourceId === "freehire"`, and `externalId` / `title` / `company` all
   non-empty, `url` https, `body` longer than 20 chars. Fails against an implementation that reads a
   job object's fields directly — those are integers, and the "no empty strings" assertions are what
   catches an index read as a value.
2. **Sends `q`, `work_mode` and `regions` — the only three parameters that filter.** Asserts the
   request path is `/__data.json` and specifically **not** `/api/`. Fails against a "fixed" URL that
   points at the documented API, which would silently return 3.28M unfiltered rows.
3. **429 → structured `rate_limited`, partial results kept.** First page succeeds, second 429s;
   asserts three postings survive, `kind === "rate_limited"`, `retrieved === 3`, `disabled === false`.
   Fails against an implementation that throws away partials on failure.
4. **401/403 → `login_required` and disables itself.** Fails against a generic error path that
   retries a login wall forever.
5. **Unrecognised envelope disables rather than reporting zero jobs.** A well-formed but
   non-matching payload must yield `postings: []`, `kind === "parse_failed"`, `disabled === true`,
   and a summary naming freehire. This is the misleading-silence case: "0 postings" reads to the
   user as "nothing matched your search".
6. **Non-JSON body → `parse_failed`, no postings.** Fails against a `JSON.parse` that is allowed to
   throw out of `crawl`.
7. **Deadline expires between pages → returns what it has.** Clock crosses `deadlineAt` after the
   first page; asserts exactly one fetch, page one's postings kept, `kind === "deadline"`, and
   `disabled === false` — a slow run must never disable a portal. Fails against a check placed after
   the fetch instead of before it.
8. **Deadline already passed → fetches nothing at all.** Asserts zero fetch calls and a `deadline`
   failure. Fails against a do-while shape that always fetches once.
9. **Stops paging at `PAGE_CAP`.** Fails against an unbounded pager on an endpoint that never
   reports a total.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-adapter-freehire.test.ts   # exit 0
```
