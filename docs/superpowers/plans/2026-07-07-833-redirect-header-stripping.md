# Constrain Header Forwarding Across Host-Pinned Redirect Hops Implementation Plan (#833)

> **For agentic workers:** Drive task-by-task with TDD (`superpowers:test-driven-development`);
> `executing-plans`/`subagent-driven-development` are disabled in this repo — no subagent
> delegation for the steps below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `createHostPinnedFetch` (`packages/datasets/src/host-pinning.ts`) currently re-sends the
original `init` — headers included — unchanged on every redirect hop, regardless of whether the
hop changed hostname. Harmless today (no credentialed sources exist yet — `credential: "api-key"`
is rejected at registration per the connector-SDK spec §4), but this is a blocker for that future
slice: an `authorization` header set for host A would silently forward to an allowlisted host B on
a cross-host redirect. Strip sensitive headers the moment a redirect hop changes hostname; keep
them on same-host hops.

**Architecture:** One new module-level constant (`SENSITIVE_REDIRECT_HEADER_NAMES`, currently just
`authorization` — extend when the deferred api-key slice defines its header name) and one new
helper (`stripSensitiveHeaders`) in `host-pinning.ts`. `createHostPinnedFetch`'s redirect loop
tracks a mutable `currentInit` (starts as the caller's `init`, unchanged) and compares the
hostname before/after resolving each redirect's `location`; the moment a hop's hostname differs
from the previous hop's, `currentInit` is replaced by the stripped version for all subsequent
fetches in that call. The initial request is never stripped (it's not a redirect hop). Once
stripped, headers stay stripped even if a later hop redirects back to the original host — no
speculative "re-add" logic, since the caller's original `init` object is still available in the
outer closure but deliberately not restored (matches the conservative posture the issue asks for:
never let a set-once auth header travel anywhere except the host it was set for).

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- Handoff: this worktree/branch continues in place (`832-datasets-host-pinning` pane, label
  `datasets-chain-3`). Coordinator label `Coordinator` (confirm via `herdr pane list`, exactly one
  pane). Issue 2 of 3 in the sequential chain (#832 → #833 → #836); #836 not started until this
  PR merges and the branch is rebased.
- Spec: `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md`, Architecture §2
  ("Host pinning ... redirects re-checked") and §4 (api-key deferred — this issue is a named
  blocker for that future slice). Issue: #833 (part of #798).
- **Risk tier: sensitive** (touches the redirect-header guard path per the coordinator's
  manifest risk-tier basis) — this PR gets cross-model QA + Ben merge sign-off, same bar as #832.
  Build defensively: no silent fallback that re-adds a stripped header, no case-sensitivity gap
  (`Headers` is case-insensitive by spec — rely on that, don't hand-roll casing logic).
- Exclusive file ownership for this task: `packages/datasets/src/host-pinning.ts`,
  `tests/unit/dataset-host-pinning.test.ts`. No other file changes.
- Zero behavior change to: host allowlist enforcement, https-only enforcement, `MAX_REDIRECTS`
  bounding, or any existing passing test's expectations (only additive test coverage, no existing
  assertions altered).
- `git add` by explicit path only. Full gate before PR: `pnpm format:check && pnpm lint && pnpm typecheck`,
  then `pnpm verify:foundation` (against `JARVIS_PGDATABASE=jarv1s_832_datasets` — already created
  and migrated in this worktree, avoids the shared default DB's concurrent-agent contention).

---

### Task 1: Strip sensitive headers on cross-host redirect hops

**Files:**

- Modify: `packages/datasets/src/host-pinning.ts`
- Modify: `tests/unit/dataset-host-pinning.test.ts`

**Interfaces:**

- Produces: no new exports. `createHostPinnedFetch`'s public signature and behavior are unchanged
  except for header handling across cross-host hops — callers (`client.ts`'s
  `createDatasetClient`, unchanged, not touched by this task) see no API difference.

Current `createHostPinnedFetch` (`host-pinning.ts:91-119`):

```ts
export function createHostPinnedFetch(
  allowedHosts: readonly string[],
  fetchFn: typeof fetch
): typeof fetch {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));

  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let currentUrl = resolveUrl(input);
    assertHttpsAndAllowed(currentUrl, allowed);

    let response = await fetchFn(currentUrl.toString(), { ...init, redirect: "manual" });
    let hops = 0;

    while (REDIRECT_STATUSES.has(response.status) && hops < MAX_REDIRECTS) {
      const location = response.headers.get("location");
      if (!location) break;
      currentUrl = resolveUrl(location, currentUrl);
      assertHttpsAndAllowed(currentUrl, allowed);
      response = await fetchFn(currentUrl.toString(), { ...init, redirect: "manual" });
      hops += 1;
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      throw new Error(`Dataset runtime host pinning: exceeded ${MAX_REDIRECTS} redirects`);
    }

    return response;
  }) as typeof fetch;
}
```

- [ ] **Step 1 (test first): add a header-capturing fetch fixture + failing assertions to
      `tests/unit/dataset-host-pinning.test.ts`**

  Add a second fixture alongside the existing `fakeFetch` (keep `fakeFetch` as-is — other tests
  depend on its `calls: string[]` shape). Place it directly below `fakeFetch`:

  ```ts
  function fakeFetchCapturingHeaders(responses: readonly { status: number; location?: string }[]): {
    fetchFn: typeof fetch;
    calls: Array<{ url: string; headers: Record<string, string> }>;
  } {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    let i = 0;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key] = value;
      });
      calls.push({ url: String(input), headers });
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      const responseHeaders = new Headers();
      if (r?.location) responseHeaders.set("location", r.location);
      return new Response(null, { status: r?.status ?? 200, headers: responseHeaders });
    }) as unknown as typeof fetch;
    return { fetchFn, calls };
  }
  ```

  Add a new `describe` block after the existing `describe("createHostPinnedFetch", ...)` block
  (do not modify any existing `it` inside that block):

  ```ts
  describe("createHostPinnedFetch — sensitive header stripping across redirects (#833)", () => {
    it("keeps sensitive headers on a same-host redirect hop", async () => {
      const { fetchFn, calls } = fakeFetchCapturingHeaders([
        { status: 302, location: "https://site.api.espn.com/other" },
        { status: 200 }
      ]);
      const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
      await pinned("https://site.api.espn.com/first", {
        headers: { authorization: "Bearer secret" }
      });
      expect(calls[0]?.headers.authorization).toBe("Bearer secret");
      expect(calls[1]?.headers.authorization).toBe("Bearer secret");
    });

    it("drops sensitive headers the moment a redirect hop changes hostname", async () => {
      const { fetchFn, calls } = fakeFetchCapturingHeaders([
        { status: 302, location: "https://cdn.espn.com/asset" },
        { status: 200 }
      ]);
      const pinned = createHostPinnedFetch(["site.api.espn.com", "cdn.espn.com"], fetchFn);
      await pinned("https://site.api.espn.com/first", {
        headers: { authorization: "Bearer secret" }
      });
      expect(calls[0]?.headers.authorization).toBe("Bearer secret");
      expect(calls[1]?.headers.authorization).toBeUndefined();
    });

    it("keeps headers same-host then drops them cross-host, and does not restore them if a later hop returns to the original host", async () => {
      const { fetchFn, calls } = fakeFetchCapturingHeaders([
        { status: 302, location: "https://site.api.espn.com/second" },
        { status: 302, location: "https://cdn.espn.com/asset" },
        { status: 302, location: "https://site.api.espn.com/third" },
        { status: 200 }
      ]);
      const pinned = createHostPinnedFetch(["site.api.espn.com", "cdn.espn.com"], fetchFn);
      await pinned("https://site.api.espn.com/first", {
        headers: { authorization: "Bearer secret" }
      });
      expect(calls[0]?.headers.authorization).toBe("Bearer secret"); // initial
      expect(calls[1]?.headers.authorization).toBe("Bearer secret"); // same-host hop
      expect(calls[2]?.headers.authorization).toBeUndefined(); // cross-host hop
      expect(calls[3]?.headers.authorization).toBeUndefined(); // back to original host, stays stripped
    });

    it("leaves non-sensitive headers untouched across a cross-host redirect", async () => {
      const { fetchFn, calls } = fakeFetchCapturingHeaders([
        { status: 302, location: "https://cdn.espn.com/asset" },
        { status: 200 }
      ]);
      const pinned = createHostPinnedFetch(["site.api.espn.com", "cdn.espn.com"], fetchFn);
      await pinned("https://site.api.espn.com/first", {
        headers: { "x-request-id": "abc123", authorization: "Bearer secret" }
      });
      expect(calls[1]?.headers["x-request-id"]).toBe("abc123");
      expect(calls[1]?.headers.authorization).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: run tests to verify the new ones fail**

  Run: `npx vitest run tests/unit/dataset-host-pinning.test.ts`
  Expected: the 4 new tests in the `#833` describe block FAIL (headers forwarded unchanged on
  every hop today); all pre-existing tests in the file still PASS.

- [ ] **Step 3: implement stripping in `host-pinning.ts`**

  Add the constant and helper directly after the `HostPinningViolationError` class (before
  `isPinnableHost`):

  ```ts
  /**
   * Headers stripped the moment a redirect hop changes hostname (#833) — a value set for host A
   * (e.g. an auth token) must never reach allowlisted host B just because both are pinned.
   * Extend this list when the deferred api-key credential slice (connector-SDK spec Architecture
   * §4) lands and defines its header name. `Headers` matching is case-insensitive by spec, so
   * casing here doesn't matter.
   */
  const SENSITIVE_REDIRECT_HEADER_NAMES = ["authorization"];

  function stripSensitiveHeaders(init: RequestInit | undefined): RequestInit | undefined {
    if (!init?.headers) return init;
    const headers = new Headers(init.headers);
    for (const name of SENSITIVE_REDIRECT_HEADER_NAMES) {
      headers.delete(name);
    }
    return { ...init, headers };
  }
  ```

  Replace `createHostPinnedFetch`'s body to track a mutable `currentInit` and strip it on hostname
  change:

  ```ts
  export function createHostPinnedFetch(
    allowedHosts: readonly string[],
    fetchFn: typeof fetch
  ): typeof fetch {
    const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));

    return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let currentUrl = resolveUrl(input);
      assertHttpsAndAllowed(currentUrl, allowed);

      let currentInit = init;
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

- [ ] **Step 4: run tests to verify everything passes**

  Run: `npx vitest run tests/unit/dataset-host-pinning.test.ts`
  Expected: all tests in the file PASS (pre-existing tests + the 4 new `#833` tests).

- [ ] **Step 5: commit**

  ```bash
  git add packages/datasets/src/host-pinning.ts tests/unit/dataset-host-pinning.test.ts
  git commit -m "datasets: strip sensitive headers on cross-host redirect hops (#833)"
  ```

---

## Verification (Exit Criteria)

- [ ] `npx vitest run tests/unit/dataset-host-pinning.test.ts` — all tests green (pre-existing +
      new).
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck` — clean.
- [ ] `git fetch origin main && git rebase origin/main` — clean or trivial fast-forward.
- [ ] `JARVIS_PGDATABASE=jarv1s_832_datasets pnpm verify:foundation` — full gate green (isolated
      DB; the shared default DB may be under concurrent-agent contention per Fleet-Ops convention).
- [ ] Both issue acceptance criteria met: cross-host redirect drops sensitive headers; same-host
      redirect keeps them; unit test asserts header sets per hop (all four new tests above cover
      this).
- [ ] PR body notes this is 2/3 of the datasets chain (#832 done/merged, #836 to follow) and that
      the future api-key credential spec must reference #833 as a satisfied prerequisite (issue's own
      acceptance bullet — no code action needed here, just PR-body traceability).
