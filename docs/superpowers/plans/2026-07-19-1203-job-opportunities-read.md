# #1203 Job Search opportunities read — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` and drive
> this plan directly under `coordinated-build`; repo coordination subagent execution skills are
> disabled in this repo.

**Goal:** `job-search.opportunities.list` (risk: `"read"`) must never trigger the shared host's
`forbidden_kv_mutation` rejection. Today, a missing or corrupt feed index makes
`readFeedOrRebuild` call the persisting `rebuildFeed` (which does `kv.set`), so a read-risk call
can hit `packages/module-registry/src/external/worker-rpc-host.ts:283-285` and get scrubbed to
`handler_failed` / HTTP 500.

**Root cause (confirmed on branch):** `external-modules/job-search/src/domain/feed.ts`
`readFeedOrRebuild` (lines 191-202) has both its branches (`corrupt_index` catch, and
`feed ?? rebuildFeed`) fall through to `rebuildFeed`, which persists via `writeRecord` (line 162).

**Enforcement site (verified):** `packages/module-registry/src/external/worker-rpc-host.ts`
line 283-285 — `if (input.toolRisk === "read") throw new ExternalModuleRpcError("forbidden_kv_mutation")`
on `kv.set`/`kv.delete`. This is the real shared-host RPC layer, not a module-local check.

**Regression-test gap (confirmed):** `tests/integration/external-module-job-search-kv-isolation.test.ts`
already runs `listOpportunitiesHandler` over the real RPC host (`job-search-rpc-harness.ts`
`kvForActor` → `createExternalModuleRpcHandler`), but every call site in that file's local
`kvForActor` wrapper omits `options`, so `toolRisk` defaults to `"write"` (harness default,
`job-search-rpc-harness.ts:69`). None of the existing feed-self-heal assertions (e.g. "admin actor
gets... empty feed" at line 888-903) actually exercise `toolRisk: "read"`, so they never trip the
bug. This is the missing case, not a harness rewrite — the harness already supports
`{ toolRisk: "read" }` via `KvActorOptions`.

## Architecture

Extract a pure, non-persisting index builder inside `feed.ts`. `rebuildFeed` keeps its existing
signature/behavior (compute + persist) for its three write-risk callers. `readFeedOrRebuild` calls
the pure builder directly and returns the computed index without writing.

## Global Constraints (locked decisions — do not weaken)

- `job-search.opportunities.list` stays `risk: "read"` in `jarvis.module.json` (already correct — no change needed, plan includes a confirmation step, not an edit).
- Do not touch `worker-rpc-host.ts` or weaken `forbidden_kv_mutation`.
- Missing/corrupt feed reads build and return the result without persistence.
- `rebuildFeed`'s three write-risk callers (`run.ts:227`, `decisions.ts:69`, `retention.ts:180`) keep persisting — verify unchanged behavior, don't edit those files.
- One real-RPC, `toolRisk: "read"`, empty-KV regression must prove HTTP-200-equivalent handler success and zero KV row creation.
- Stage explicit paths only; never `git add -A`; never touch `docs/coordination/`, board, milestones, shared host policy, or merge.

---

### Task 1: Red regression test — real RPC, read-risk, empty KV

**Files:**

- Modify: `tests/integration/external-module-job-search-kv-isolation.test.ts`

**Interfaces:**

- Consumes: the file's local `kvForActor` wrapper (already supports `KvActorOptions`),
  `listOpportunitiesHandler`, `makePorts`, `bootstrapJobSearchRows`. **No new test id** — reuse
  `ids.adminUser`, which owns zero job-search rows in the `describe("job-search opportunity feed +
decision isolation (#937)", ...)` block (confirmed: the existing "admin actor gets the same
  denials" test at line 888 already asserts `total: 0, opportunities: []` for admin, but calls
  `kvForActor(ids.adminUser, { admin: true })` with `toolRisk` defaulting to `"write"` — masking
  #1203). `ids` is a repo-wide shared fixture in `tests/integration/test-database.ts` — do not add
  to it.
- Produces: one new `it(...)` in that describe block, right after the existing admin-denial test,
  using `{ admin: true, toolRisk: "read" }` so `readFeedOrRebuild`'s self-heal runs under the real
  read-risk RPC path.

- [ ] **Step 1: Write the failing test**

```ts
it("read-risk actor (admin, no stored feed): list succeeds, no KV row is created (#1203)", async () => {
  const kvReadOnly = kvForActor(ids.adminUser, { admin: true, toolRisk: "read" });
  const ports = makePorts(kvReadOnly, null, T_RUN2);

  const list = await listOpportunitiesHandler(ports)({});
  expect(list).toMatchObject({ status: "ok", total: 0, opportunities: [] });

  const rows = await bootstrapJobSearchRows();
  expect(rows.some((r) => r.owner_user_id === ids.adminUser)).toBe(false);
});
```

Expected: **fails today** — `listOpportunitiesHandler` throws (the RPC host rejects the internal
`kv.set` from `rebuildFeed` with `forbidden_kv_mutation`, surfaced as a thrown
`ExternalModuleRpcError`/`handler_failed`).

Run: `pnpm vitest run tests/integration/external-module-job-search-kv-isolation.test.ts -t "#1203"`
— confirm it fails with the expected rejection before moving to Task 2.

---

### Task 2: Extract pure feed-index builder; make `readFeedOrRebuild` non-persisting

**Files:**

- Modify: `external-modules/job-search/src/domain/feed.ts`

**Interfaces:**

- New private function `buildFeedIndex(kv: JobSearchKv, now: Date): Promise<FeedIndex>` — the
  current body of `rebuildFeed` (lines 125-161: the `listOpportunities`/gate/evaluation loop, sort,
  and `FeedIndex` construction) **minus** the `writeRecord` call and `return index` stays the same
  shape.
- `rebuildFeed(kv, now)` becomes: `const index = await buildFeedIndex(kv, now); await writeRecord(kv, NS.feed, keys.feedActive, index); return index;` — behavior-identical for its three existing callers.
- `readFeedOrRebuild` calls `buildFeedIndex(kv, now)` instead of `rebuildFeed(kv, now)` in both
  branches (corrupt-index catch, and the `feed ?? ...` fallback) — no persistence on the read path.
- No public export changes needed (`buildFeedIndex` stays module-private; `index.ts` re-exports of
  `readFeed`/`readFeedOrRebuild`/`rebuildFeed` are unchanged).

- [ ] **Step 1: Extract and rewire**

Make the edit described above. Do not change `rebuildFeed`'s external signature or the three
write-risk call sites in `run.ts`, `decisions.ts`, `retention.ts` — grep them after the edit to
confirm zero diff.

Run: `pnpm vitest run tests/integration/external-module-job-search-kv-isolation.test.ts -t "#1203"`
— must now pass. Run the full kv-isolation file too (feed-dependent describes must stay green).

---

### Task 3: Rewrite the stale unit test assertion

**Files:**

- Modify: `tests/unit/external-module-job-search-kv-feed.test.ts`

**Interfaces:**

- Consumes: `readFeed`, `readFeedOrRebuild`, `createMemoryKv` (already imported).

- [ ] **Step 1: Fix `"readFeedOrRebuild recovers from a corrupt index"` (lines ~125-134)**

Replace the persistence assertion. Current (asserts the bug):

```ts
// The repaired index is persisted, not just returned.
expect((await readFeed(kv))?.entries).toHaveLength(3);
```

New — assert the opposite (no persistence on the read-recovery path):

```ts
// readFeedOrRebuild is a READ path (#1203): it repairs and returns the
// index but never persists — only rebuildFeed's write-risk callers do.
expect(await readFeed(kv)).toBeNull();
```

- [ ] **Step 2: Add the same non-persistence assertion to `"readFeedOrRebuild builds a fresh index
    when none exists"` (lines ~136-141)**

After `const feed = await readFeedOrRebuild(kv, REBUILT_AT); expect(feed.entries).toHaveLength(3);`
add:

```ts
expect(await readFeed(kv)).toBeNull();
```

- [ ] **Step 3: Confirm `rebuildFeed`'s own persistence test is untouched**

The first test in the file (`"rebuilds from canonical jobs..."`, line 80) calls `rebuildFeed`
directly and asserts persistence via `readFeed` after — leave as-is; it covers the write-risk
callers' contract.

Run: `pnpm vitest run tests/unit/external-module-job-search-kv-feed.test.ts` — all green.

---

### Task 4: Confirm write-risk callers and manifest risk are untouched

**Files:** none modified — verification only.

- [ ] **Step 1: Grep confirmation**

```bash
grep -n "rebuildFeed(" external-modules/job-search/src/worker/handlers/run.ts \
  external-modules/job-search/src/domain/decisions.ts \
  external-modules/job-search/src/domain/retention.ts
grep -n '"risk": "read"' external-modules/job-search/jarvis.module.json | grep -A1 -B4 opportunities.list
```

Expected: all three call sites still call `rebuildFeed` (persisting) unchanged, and
`job-search.opportunities.list` is still declared `risk: "read"`. No file edits in this task.

---

### Task 5: Full gate

- [ ] **Step 1:** `pnpm format:check && pnpm lint && pnpm typecheck`
- [ ] **Step 2:** `pnpm vitest run tests/unit/external-module-job-search-kv-feed.test.ts tests/unit/external-module-job-search-handlers-opportunities.test.ts tests/integration/external-module-job-search-kv-isolation.test.ts`
- [ ] **Step 3:** `pnpm verify:foundation` (fresh gate DB per CLAUDE.md — drop/create the gate DB first if a prior run left durable rows)
- [ ] **Step 4:** `git fetch origin main && git rebase origin/main`, then re-run the pre-push trio.

Exit criteria met when: the new #1203 regression is green, the rewritten unit assertions are
green, the three write-risk callers are confirmed byte-unchanged, `opportunities.list` risk is
confirmed `"read"`, and the full gate passes on a rebased branch.
