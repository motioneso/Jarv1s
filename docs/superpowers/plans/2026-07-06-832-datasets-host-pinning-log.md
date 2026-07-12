# Datasets Host-Pinning Violation Logging Implementation Plan (#832)

> **For agentic workers:** Drive task-by-task with TDD (`superpowers:test-driven-development`);
> `executing-plans`/`subagent-driven-development` are disabled in this repo — no subagent
> delegation for the steps below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/datasets/src/client.ts`'s `catch {}` around `adapter.fetchDataset` folds
host-pinning violations (SSRF-allowlist rejections thrown by `createHostPinnedFetch` in
`host-pinning.ts`) into the same silent `degraded: true` path as ordinary network blips. Make
pinning violations distinguishable and log them (source id + blocked host) before degrading,
with zero change to the degrade path's return values or ordinary-error behavior.

**Architecture:** One new exported error class (`HostPinningViolationError`, carries the blocked
`host`) thrown from `host-pinning.ts`'s two enforcement points (disallowed host, non-https). One
new minimal structured-logger seam in `client.ts` (`DatasetLogger`, mirrors the established
`SyncLogger`/`NOOP_SYNC_LOGGER` pattern in `packages/connectors/src/sync-jobs.ts:113-124` — same
`warn(data, message)` shape, defaults to a silent no-op so callers that don't inject a logger see
no behavior change). One one-line composition-root wiring change so the real sports registration
actually gets a logger in production (`packages/module-registry/src/index.ts`, `server.log` via
`createModuleLogger`, already imported there).

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- Handoff: `docs/coordination/handoffs/2026-07-06-832-833-836-datasets-chain.md`. Coordinator
  label `Coordinator` (confirm via `herdr pane list`, exactly one pane). This is issue 1 of 3 in
  a sequential chain in this one worktree — #833 and #836 are NOT started until this PR merges
  and the branch is rebased.
- Spec: `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md` (already-implemented
  sports migration confirmed current on this branch — `module-registry/index.ts:1133-1188` wires
  `createDatasetClient`/`configureSportsBriefingService` as described).
- Exclusive file ownership for the whole 3-issue run: `packages/datasets/src/host-pinning.ts`,
  `packages/datasets/src/client.ts`. This plan also makes a single one-line addition to
  `packages/module-registry/src/index.ts` (not exclusively owned, but confirmed disjoint from
  every other agent active in this run per the #837 handoff's collision notes) — needed so the
  new logging seam is actually wired in production, not just plumbed and unused.
- No behavior change to ordinary (non-pinning) error handling or to any existing test's expected
  return values.
- `git add` by explicit path only. Full gate before PR: `pnpm format:check && pnpm lint && pnpm typecheck`,
  then `pnpm verify:foundation`.

---

### Task 1: `HostPinningViolationError` class + throw sites in `host-pinning.ts`

**Files:**

- Modify: `packages/datasets/src/host-pinning.ts`
- Modify: `tests/unit/dataset-host-pinning.test.ts`

**Interfaces:**

- Produces: `export class HostPinningViolationError extends Error { readonly host: string }` —
  consumed by Task 2 (`client.ts`'s catch block) and Task 3 (`index.ts` export).

Current `assertHttpsAndAllowed` (host-pinning.ts):

```ts
function assertHttpsAndAllowed(url: URL, allowed: ReadonlySet<string>): void {
  if (url.protocol !== "https:") {
    throw new Error(
      `Dataset runtime host pinning: only https is allowed, got "${url.protocol}" for ${url.hostname}`
    );
  }
  if (!allowed.has(url.hostname.toLowerCase())) {
    throw new Error(
      `Dataset runtime host pinning: host "${url.hostname}" is not in the allowed list`
    );
  }
}
```

- [ ] **Step 1 (test first): add failing assertions to `tests/unit/dataset-host-pinning.test.ts`**

  Update the two existing rejection tests in `describe("createHostPinnedFetch", ...)` to assert
  the thrown error is a `HostPinningViolationError` carrying the attempted host:

  ```ts
  it("rejects a request to a host not in the allow list", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://evil.example.com/")).rejects.toMatchObject({
      name: "HostPinningViolationError",
      host: "evil.example.com"
    });
  });

  it("rejects a plain-http request even to an allowed host", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("http://site.api.espn.com/")).rejects.toMatchObject({
      name: "HostPinningViolationError",
      host: "site.api.espn.com"
    });
  });

  it("blocks a redirect that escapes to a disallowed host (SSRF guard)", async () => {
    const { fetchFn } = fakeFetch([
      { status: 302, location: "https://internal.metadata.example/secret" }
    ]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://site.api.espn.com/first")).rejects.toMatchObject({
      name: "HostPinningViolationError",
      host: "internal.metadata.example"
    });
  });
  ```

  Add an explicit `instanceof` test too:

  ```ts
  it("throws a HostPinningViolationError instance (not a plain Error) on rejection", async () => {
    const { fetchFn } = fakeFetch([{ status: 200 }]);
    const pinned = createHostPinnedFetch(["site.api.espn.com"], fetchFn);
    await expect(pinned("https://evil.example.com/")).rejects.toBeInstanceOf(
      HostPinningViolationError
    );
  });
  ```

  Update the import line to add `HostPinningViolationError`. Run
  `pnpm --filter @jarv1s/datasets test` (or the repo's vitest invocation for this file) — confirm
  these new/updated assertions fail against current code (still throws plain `Error`).

- [ ] **Step 2: implement in `host-pinning.ts`**

  Add near the top (after `REDIRECT_STATUSES`):

  ```ts
  /**
   * Thrown when a dataset-runtime fetch (initial request or any redirect hop) targets a host
   * outside the source's declared `fetchHosts`, or downgrades off https. Distinct from ordinary
   * fetch/network failures so `client.ts` can log the SSRF-allowlist rejection distinctly instead
   * of folding it into silent degrade (#832).
   */
  export class HostPinningViolationError extends Error {
    readonly host: string;

    constructor(host: string, message: string) {
      super(message);
      this.name = "HostPinningViolationError";
      this.host = host;
    }
  }
  ```

  Change `assertHttpsAndAllowed` to throw it:

  ```ts
  function assertHttpsAndAllowed(url: URL, allowed: ReadonlySet<string>): void {
    if (url.protocol !== "https:") {
      throw new HostPinningViolationError(
        url.hostname,
        `Dataset runtime host pinning: only https is allowed, got "${url.protocol}" for ${url.hostname}`
      );
    }
    if (!allowed.has(url.hostname.toLowerCase())) {
      throw new HostPinningViolationError(
        url.hostname,
        `Dataset runtime host pinning: host "${url.hostname}" is not in the allowed list`
      );
    }
  }
  ```

  Leave the `MAX_REDIRECTS`-exceeded throw in `createHostPinnedFetch` as a plain `Error` — that's
  a redirect-loop bound, not an allowlist-escape attempt, so it stays out of scope for #832 (same
  silent-degrade treatment as today).

  Run the test file again — confirm all pass (red → green).

---

### Task 2: `DatasetLogger` seam + distinct logging in `client.ts`

**Files:**

- Modify: `packages/datasets/src/client.ts`
- Modify: `tests/unit/dataset-client.test.ts`

**Interfaces:**

- Consumes: `HostPinningViolationError` from Task 1.
- Produces: `export interface DatasetLogger { warn(data: Record<string, unknown>, message: string): void }`
  added to `DatasetClientDeps.logger?: DatasetLogger` — consumed by Task 3's `index.ts` export and
  by the composition-root wiring in Task 4.

- [ ] **Step 1 (test first): add failing tests to `tests/unit/dataset-client.test.ts`**

  Add a tiny recording fake logger and two new tests in `describe("createDatasetClient", ...)`:

  ```ts
  function fakeLogger(): {
    logger: DatasetLogger;
    warnings: Array<[Record<string, unknown>, string]>;
  } {
    const warnings: Array<[Record<string, unknown>, string]> = [];
    return { logger: { warn: (data, message) => warnings.push([data, message]) }, warnings };
  }
  ```

  ```ts
  it("logs a host-pinning violation with source id + blocked host, still returns degraded", async () => {
    const { logger, warnings } = fakeLogger();
    const client = createDatasetClient(
      source({ fetchHosts: ["site.api.espn.com"] }),
      adapterFrom(async (_key, _params, _ctx) => {
        throw new HostPinningViolationError(
          "evil.example.com",
          'Dataset runtime host pinning: host "evil.example.com" is not in the allowed list'
        );
      }),
      { logger }
    );
    const envelope = await client.getDataset("widgets", {}, { fallback: { empty: true } });
    expect(envelope).toEqual({
      data: { empty: true },
      degraded: true,
      fetchedAt: expect.any(String)
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toMatchObject({ sourceId: "fixture", host: "evil.example.com" });
  });

  it("does not log ordinary (non-pinning) fetch errors — stays silent-degrade", async () => {
    const { logger, warnings } = fakeLogger();
    const client = createDatasetClient(
      source(),
      adapterFrom(async () => {
        throw new Error("upstream down");
      }),
      { logger }
    );
    const envelope = await client.getDataset("widgets", {}, { fallback: { empty: true } });
    expect(envelope).toMatchObject({ data: { empty: true }, degraded: true });
    expect(warnings).toHaveLength(0);
  });
  ```

  Add `HostPinningViolationError` and `DatasetLogger` to the test file's import line (from
  `@jarv1s/datasets`). Run the datasets test suite — confirm these two fail (no `logger` dep or
  distinct handling exists yet; TS will also fail to compile until `DatasetLogger`/
  `HostPinningViolationError` are exported — expected red state).

- [ ] **Step 2: implement in `client.ts`**

  Add the import and the logger seam (mirrors
  `packages/connectors/src/sync-jobs.ts:112-124`'s `SyncLogger`/`NOOP_SYNC_LOGGER` exactly):

  ```ts
  import { createHostPinnedFetch, HostPinningViolationError } from "./host-pinning.js";

  /** Sanitized structured logging for dataset-runtime observability (never secrets/body). */
  export interface DatasetLogger {
    warn(data: Record<string, unknown>, message: string): void;
  }

  const NOOP_DATASET_LOGGER: DatasetLogger = {
    // Silent — production composition roots inject a real logger (server.log adapter). Noop
    // (not console) so a forgotten injection degrades quietly instead of spamming unstructured
    // console output (observability spec).
    warn: () => undefined
  };
  ```

  Add `readonly logger?: DatasetLogger;` to `DatasetClientDeps`. Inside `createDatasetClient`,
  alongside the existing `now`/`cache`/`pinnedFetch` locals:

  ```ts
  const logger = deps.logger ?? NOOP_DATASET_LOGGER;
  ```

  Change the catch block from:

  ```ts
      } catch {
        if (hit) {
  ```

  to:

  ```ts
      } catch (error) {
        if (error instanceof HostPinningViolationError) {
          logger.warn(
            { sourceId: source.id, datasetKey, host: error.host },
            "dataset host-pinning violation: blocked fetch outside allowed hosts"
          );
        }
        if (hit) {
  ```

  No other lines in the catch block change — the existing stale-hit / fallback return statements
  are untouched, satisfying "no behavior change to the degrade path itself".

  Run the datasets test suite — confirm all pass.

---

### Task 3: export the new symbols from `packages/datasets/src/index.ts`

**Files:**

- Modify: `packages/datasets/src/index.ts`

- [ ] **Step 1:** add `HostPinningViolationError` to the existing host-pinning export line, and
      `type DatasetLogger` to the existing client export block:

  ```ts
  export {
    createDatasetClient,
    type DatasetClient,
    type DatasetClientDeps,
    type DatasetEnvelope,
    type DatasetLogger,
    type GetDatasetOptions
  } from "./client.js";
  ...
  export {
    assertValidFetchHosts,
    createHostPinnedFetch,
    HostPinningViolationError,
    isPinnableHost
  } from "./host-pinning.js";
  ```

  No test needed for this step alone — Task 1/2's tests already import these symbols from
  `@jarv1s/datasets` and will fail to compile until this export exists; re-run the full datasets
  suite here as the checkpoint.

---

### Task 4: wire a real logger at the sports composition root

**Files:**

- Modify: `packages/module-registry/src/index.ts` (single call site, ~line 1173)

**Interfaces:**

- Consumes: `createModuleLogger` (already imported at `index.ts:124`), `server.log`
  (`FastifyInstance`, always present — no optional-chaining needed, unlike the worker-path
  `deps.logger?`).

- [ ] **Step 1:** in the sports `registerRoutes` callback, change:

  ```ts
  const datasetClient = createDatasetClient(espnSource, createEspnDatasetAdapter(), {
    fetchFn: deps.fetchFn
  });
  ```

  to:

  ```ts
  const datasetClient = createDatasetClient(espnSource, createEspnDatasetAdapter(), {
    fetchFn: deps.fetchFn,
    logger: createModuleLogger(server.log, "sports")
  });
  ```

  `FastifyBaseLogger.warn(obj, msg)` structurally satisfies `DatasetLogger` — no adapter/wrapper
  needed. No new test here (no existing test suite exercises this composition-root line directly
  with a fake host-pinning failure); covered by the datasets-package unit tests plus this repo's
  existing sports route/integration suites staying green (they don't assert on logger calls, so
  this is a pure additive no-op for them).

  Run `pnpm --filter @jarv1s/module-registry typecheck` (or the workspace-wide typecheck) —
  confirm no type errors.

---

### Task 5: full gate + PR

- [ ] Run `pnpm format:check && pnpm lint && pnpm typecheck`.
- [ ] Run `pnpm verify:foundation`.
- [ ] `git fetch origin main && git rebase origin/main` (should be a no-op / fast-forward — no
      other agent in this run touches these files).
- [ ] Hand off to `coordinated-wrap-up` for PR + report against issue #832.
