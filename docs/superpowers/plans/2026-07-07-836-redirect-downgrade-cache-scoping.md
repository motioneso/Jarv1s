# #836 Redirect Method Downgrade + Cache-Key Scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `createHostPinnedFetch` to downgrade non-GET redirect hops to GET-with-no-body on
303 (and on 301/302 for a non-GET/HEAD method) while preserving method+body on 307/308, and
document the cache-key user-scoping constraint on `buildCacheKey` plus the connector-SDK spec.

**Architecture:** Both fixes are localized to `packages/datasets/src`. Task A adds a small
pure-function decision (`shouldDowngradeToGet`) and a body/method-dropping transform
(`downgradeToGet`) inside the existing manual-redirect loop in `host-pinning.ts` — no new public
API, no change to `stripSensitiveHeaders` (an independent, already-shipped #833 concern that can
apply to the same hop). Task B is doc-only: a comment above `buildCacheKey` plus one new
paragraph in the connector-SDK spec's Architecture §4. No behavior change in Task B.

**Tech Stack:** TypeScript, Vitest, existing `packages/datasets` fetch-wrapper pattern (manual
`redirect: "manual"` loop, injectable `fetchFn` for tests).

## Global Constraints

- Issue #836 acceptance: unit test that a 303 hop issues GET with no body; same-method hops
  unchanged; `buildCacheKey` carries the scoping constraint comment; the api-key slice spec (see
  #833) references it.
- 307/308 must **never** downgrade method or body (HTTP spec requirement, explicit in the issue).
- `git add` explicit paths only, never `-A`.
- `JARVIS_PGDATABASE=jarv1s_832_datasets` for any DB/gate commands in this worktree.
- This is the last issue in the 832→833→836 chain — no further chain step follows.

---

### Task A: 303/non-GET-301/302 redirect method downgrade in `host-pinning.ts`

**Files:**

- Modify: `packages/datasets/src/host-pinning.ts:109-142` (`createHostPinnedFetch`)
- Test: `tests/unit/dataset-host-pinning.test.ts`

**Interfaces:**

- Consumes: existing `REDIRECT_STATUSES` (`Set([301, 302, 303, 307, 308])`), existing
  `stripSensitiveHeaders(init: RequestInit | undefined): RequestInit | undefined` (#833, unchanged
  and independent — do not merge its logic into the new helpers).
- Produces: two new module-private helpers in `host-pinning.ts`:
  - `shouldDowngradeToGet(status: number, method: string): boolean`
  - `downgradeToGet(init: RequestInit | undefined): RequestInit`
    Neither is exported from `host-pinning.ts` or re-exported from `packages/datasets/src/index.ts`
    — they're internal to the redirect loop, same visibility as `stripSensitiveHeaders`.

- [ ] **Step 1: Write the failing tests**

Add a new fake-fetch helper and a new `describe` block to
`tests/unit/dataset-host-pinning.test.ts`, right after the existing
`"createHostPinnedFetch — sensitive header stripping across redirects (#833)"` block (i.e. at the
end of the file, replacing the final `});` and everything after it with the content below):

```typescript
function fakeFetchCapturingRequestInit(
  responses: readonly { status: number; location?: string }[]
): {
  fetchFn: typeof fetch;
  calls: Array<{ url: string; method: string; body: unknown }>;
} {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  let i = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const headers = new Headers();
    if (r?.location) headers.set("location", r.location);
    return new Response(null, { status: r?.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

describe("createHostPinnedFetch — 303/301/302 method downgrade, 307/308 preserved (#836)", () => {
  it("downgrades a 303 hop to GET with no body, regardless of original method", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 303, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[0]).toMatchObject({ method: "POST", body: "payload" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });

  it("downgrades a non-GET 302 hop to GET with no body", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 302, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });

  it("downgrades a non-GET 301 hop to GET with no body", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 301, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "PUT", body: "payload" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });

  it("preserves method and body across a 307 hop", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 307, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[1]).toMatchObject({ method: "POST", body: "payload" });
  });

  it("preserves method and body across a 308 hop", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 308, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first", { method: "POST", body: "payload" });
    expect(calls[1]).toMatchObject({ method: "POST", body: "payload" });
  });

  it("leaves a same-method (GET) hop through 301/302 unchanged", async () => {
    const { fetchFn, calls } = fakeFetchCapturingRequestInit([
      { status: 302, location: "https://site.api.espn.com/other" },
      { status: 200 }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await pinned("https://site.api.espn.com/first");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.body).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @jarv1s/datasets exec vitest run ../../tests/unit/dataset-host-pinning.test.ts`
(or, from repo root: `pnpm vitest run tests/unit/dataset-host-pinning.test.ts`)

Expected: FAIL — the new `describe` block's tests fail because no downgrade happens yet (e.g.
`calls[1]?.method` is `"POST"` instead of `"GET"` for the 303/301/302 cases). The 307/308 and
same-method tests should already PASS (no behavior change needed there) — that's expected and
fine, only the downgrade-required assertions should be red.

- [ ] **Step 3: Implement the downgrade logic**

In `packages/datasets/src/host-pinning.ts`, add two helpers directly below the existing
`stripSensitiveHeaders` function (after line 86, before `assertHttpsAndAllowed`):

```typescript
/**
 * True when a redirect hop must downgrade to GET with no body: always for 303 (See Other, the
 * canonical "redo as GET" status), and for 301/302 only when the current method isn't already
 * GET/HEAD (legacy browser behavior downgrades those two; RFC 7231 leaves 301/302 method
 * preservation to client discretion but the safe, expected behavior is to downgrade like a
 * browser would). 307/308 must never downgrade — they exist specifically to guarantee
 * method+body preservation across a redirect (#836).
 */
function shouldDowngradeToGet(status: number, method: string): boolean {
  if (status === 303) return true;
  if (status === 301 || status === 302) return method !== "GET" && method !== "HEAD";
  return false;
}

/** Drops `method`/`body` from `init` and forces a bodyless GET for the next redirect hop. */
function downgradeToGet(init: RequestInit | undefined): RequestInit {
  const { body: _body, method: _method, ...rest } = init ?? {};
  return { ...rest, method: "GET" };
}
```

Then update `createHostPinnedFetch` (`:109-142`) to track the current method and apply the
downgrade inside the redirect loop. Replace the function body with:

```typescript
export function createHostPinnedFetch(
  allowedHosts: readonly string[],
  fetchFn: typeof fetch
): typeof fetch {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let currentUrl = resolveUrl(input);
    assertHttpsAndAllowed(currentUrl, allowed);

    let currentInit = init;
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
  }) as typeof fetch;
}
```

Note: header stripping and method downgrade are independent and both apply to the same hop when
both conditions are true (cross-host + 303) — the two `if` blocks each mutate `currentInit`
independently via spread, so this is safe (host-stripping touches `headers`, downgrade touches
`method`/`body`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/dataset-host-pinning.test.ts`

Expected: PASS — all tests in `dataset-host-pinning.test.ts`, including the new #836 block and
the pre-existing #832/#833 blocks.

- [ ] **Step 5: Commit**

```bash
git add packages/datasets/src/host-pinning.ts tests/unit/dataset-host-pinning.test.ts
git commit -m "datasets: downgrade redirect method to GET on 303/non-GET 301-302 (#836 1/2)"
```

---

### Task B: `buildCacheKey` user-scoping doc comment + spec note

**Files:**

- Modify: `packages/datasets/src/client.ts:44-54` (`buildCacheKey`, doc comment only, no
  behavior change)
- Modify: `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md` (new paragraph in
  Architecture §4, around line 126, no other section changes)

**Interfaces:**

- Consumes: nothing new — `buildCacheKey`'s signature and behavior are unchanged.
- Produces: nothing consumed by other tasks — this is documentation only, no new test is
  required (the issue's acceptance bullet for this half is "carries the scoping constraint
  comment" / spec cross-reference, not a behavior assertion).

- [ ] **Step 1: Add the doc comment above `buildCacheKey`**

In `packages/datasets/src/client.ts`, insert this comment directly above the existing
`function buildCacheKey(` (line 44), leaving the function body (lines 44-54) unchanged:

```typescript
/**
 * Builds the instance-level cache key for one dataset call: `sourceId:datasetKey:params`. There
 * is no separate user dimension — safe today because every source is `credential: "none"`
 * (public, non-personalized data). **Constraint for future per-user sources:** the deferred
 * keyed-credential slice (connector-SDK spec Architecture §4) MUST ensure any per-user dataset's
 * `params` carries the user's identity (e.g. a `userId` field), or this instance-level cache will
 * serve one user's cached response to another purely by key collision (#836).
 */
function buildCacheKey(
```

- [ ] **Step 2: Add the spec note to Architecture §4**

In `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md`, the Architecture §4
paragraph currently ends (around line 126):

```
   permanently `degraded`, never an error page) transfer to that future spec as constraints.
```

immediately followed by (around line 128):

```
5. **Sports migration (the proof):** `SportsSource`'s five methods become five dataset keys
```

Insert a new paragraph between those two, still under numbered item 4 (indented to match the
existing §4 body):

```
   **Cache-key user-scoping constraint (#836):** `DatasetClient`'s cache is instance-level, keyed
   `sourceId:datasetKey:params` with no separate user dimension (see the `buildCacheKey` doc
   comment, `packages/datasets/src/client.ts`). This is correct only because every source shipped
   so far is `credential: "none"` — public, non-personalized data. The keyed-credential slice this
   section defers MUST ensure any per-user dataset's `params` carries the user's identity (e.g. a
   `userId` field), or the instance-level cache will serve one user's cached response to another
   by key collision. This note and #833's PR-body traceability note both cover this constraint; no
   code change is required until a per-user source actually exists.
```

- [ ] **Step 3: Verify no behavior change**

Run: `pnpm vitest run tests/unit/dataset-client.test.ts tests/unit/dataset-host-pinning.test.ts`

Expected: PASS — identical results to before this task (doc-only change).

- [ ] **Step 4: Commit**

```bash
git add packages/datasets/src/client.ts docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md
git commit -m "datasets: document cache-key user-scoping constraint on buildCacheKey (#836 2/2)"
```

---

## After both tasks: pre-push + gate + wrap-up

Not part of either task's TDD cycle — done once, after Task B is committed:

1. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`
2. `git fetch origin main && git rebase origin/main`
3. Full gate against the isolated DB, redirected to a session-scoped scratchpad log (not a shared
   `/tmp/*` path):
   ```bash
   JARVIS_PGDATABASE=jarv1s_832_datasets pnpm verify:foundation
   JARVIS_PGDATABASE=jarv1s_832_datasets pnpm audit:release-hardening
   ```
4. `coordinated-wrap-up`: push, open PR ("datasets: 303 redirect method downgrade + cache-key
   user-scoping guard (#836 3/3)"), body notes this is the **last** issue in the 832→833→836
   chain (both prior issues merged), cites gate evidence. Report PR + evidence to the coordinator
   and stop — do not merge, touch the board, or close the issue.
