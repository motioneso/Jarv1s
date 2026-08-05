## Phase 0 — Core platform prerequisites

### Task 1: `ctx.embed` on the module worker contract

The designed triage needs the instance embedder, and `ModuleWorkerContext` has no embed port (D1), so
a module cannot embed anything today. This adds one — a generic capability any module doing semantic
retrieval wants, not job-search plumbing.

**Depends on:** nothing.

**Files**

- Modify: `packages/module-sdk/src/worker.ts` — the port, beside the existing `attachments` port
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — service the methods, and widen
  `ExternalModuleRpcError` with an optional `detail`
- Modify: `apps/api/src/external-module-tools.ts:44` — RPC construction site 1 of 2
- Modify: `apps/worker/src/external-module-job-handler.ts:67` — site 2 of 2, the one the scheduled
  crawl actually runs on (K5)
- Test: `tests/unit/external-module-embed-port.test.ts`

**Contracts**

Consumed, unchanged, from `packages/memory/src/embedding-provider.ts`:

```ts
export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly modelName: string;
  readonly modelVersion: string;
  /** Embed a document for indexing. The provider applies any required task prefix. */
  embedDocument(text: string): Promise<number[]>;
  /** Embed a search query. The provider applies any required task prefix. */
  embedQuery(text: string): Promise<number[]>;
}
```

Produced, reachable as `ctx.embed` on `ModuleWorkerContext`:

```ts
export interface ModuleEmbedPort {
  /** Embed postings/documents for indexing. One vector per input, same order. */
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  /** Embed a search query (criteria text). Different task prefix from documents. */
  embedQuery(text: string): Promise<number[]>;
  /** Dimensionality of the configured embedder, so callers validate their
   * pgvector column instead of hardcoding 768. */
  dimensions(): Promise<number>;
}
```

Widened, keeping the code union closed and every existing single-argument call site valid:

```ts
export class ExternalModuleRpcError extends Error {
  constructor(
    readonly code: /* …existing closed union, unchanged… */ "invalid_rpc",
    /** Human-readable reason. Never crosses the worker boundary to the module —
     * it is for host logs and tests. The module still sees only the code. */
    readonly detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ExternalModuleRpcError";
  }
}
```

Wire contract — three methods, each with the exact params and result shape the SDK port unwraps:

| Method                  | Params            | Result                     |
| ----------------------- | ----------------- | -------------------------- |
| `embed.dimensions`      | `{}`              | `{ dimensions: number }`   |
| `embed.embedQuery`      | `{ text }`        | `{ vector: number[] }`     |
| `embed.embedDocuments`  | `{ texts }`       | `{ vectors: number[][] }`  |

`EMBED_BATCH_MAX = 128`, declared once and shared by the host validation and the SDK, so one module
cannot pin the instance embedder with an unbounded batch. `embedDocuments([])` returns `[]` without
an RPC round trip.

**Constraints**

- **The document/query split is load-bearing.** nomic applies a different task prefix to each;
  collapsing them into one `embed(texts)` silently degrades retrieval. The provider takes one string
  at a time — the port batches host-side, **sequentially**, because the in-process embedder is
  CPU-bound and a 128-wide `Promise.all` would stall the worker host for every other module.
- **Serve these branches before `withDataContext`.** After `const params = record(rawParams)`
  (`worker-rpc-host.ts:~129`) and before the `withDataContext` call at `~:152` — beside
  `fetch.request`, not beside `ai.generateStructured` (`:197`), which sits inside it (K4). Embedding
  touches no table, and opening a data context for a CPU-bound transform holds a pooled connection
  for a whole batch. It is also what makes the test harness legal: `workerDataContext` is `null`
  there, so a branch inside `withDataContext` would throw on the null before any assertion runs.
- **`embeddingProvider` is a required field on the handler's input type, not optional** (K5). There
  are exactly two production construction sites; Job Search embeds during a scheduled crawl, which
  runs on the worker one. Thread the api site only and every scheduled crawl dies with `invalid_rpc`
  while every manual test passes. Required means a missed site is a `pnpm typecheck` failure.
- **Never name a provider or model here.** Both sites already resolve app services; take the provider
  from the same seam that constructs it for memory search
  (`rg "EmbeddingProvider|StubEmbeddingProvider" apps packages --files-with-matches`).
- **Validate params, throw `invalid_rpc` with a `detail`.** Follow `ai.generateStructured`'s
  discipline: reject a non-array `texts`, a batch over the cap, a non-string or empty entry, and an
  empty query — all before touching the provider.
- **Resolve the worker contract version before committing.** Read
  `MODULE_WORKER_CONTRACT_VERSION` in `packages/module-sdk/src/worker-protocol.ts` and every place
  the host compares it (`rg "MODULE_WORKER_CONTRACT_VERSION|contractVersion" packages/module-registry apps`).
  If the host only rejects a worker declaring a **higher** version, adding a context property is
  backward-compatible — leave the version alone and change nothing in finance. If it requires an
  exact match, bump it and update `external-modules/finance/jarvis.module.json` in the same commit,
  then re-run `pnpm check:external-modules`. State which branch applied in the commit body. Do not
  guess.
- **The SDK side is covered by `pnpm typecheck`, not by a unit test.** `defineModuleWorker` returns
  `void` and drives a JSON-RPC-over-stdio readline loop; there is no `__invokeForTest` and no
  exported context factory (K9). Do not invent a second test seam in the SDK.

**Tests** (`tests/unit/external-module-embed-port.test.ts`)

Harness: copy `tests/unit/external-module-attachment-port.test.ts:56-67,76` — a synthetic
`ExternalModuleDiscovery`, all seven `createExternalModuleRpcHandler` inputs including its
`null as unknown as DataContextRunner` casts, and the three-argument handler with its
secret-remembering third argument (K2).

1. **Returns one document vector per input, in order** — two texts in, two vectors out, each of the
   provider's dimensionality, and the two not equal. Catches a port that returns the batch's first
   vector for every input, or that drops order.
2. **A query routes through `embedQuery` and never through `embedDocument`** — spy on both. Fails
   against the plausible implementation that reuses the document path, which applies the wrong task
   prefix and degrades retrieval invisibly.
3. **Reports the provider's dimensionality** — `embed.dimensions` returns 768 from the stub. Catches
   a port that hardcodes a constant instead of reading the configured provider.
4. **A batch over `EMBED_BATCH_MAX` is rejected without calling the provider** — assert
   `.rejects.toMatchObject({ code: "invalid_rpc", detail: /at most 128/ })` **and** that
   `embedDocument` was never called. Assert on `detail`, never on `message`: `super(code)` makes the
   message the bare code (K3), so a message regex can never pass. The provider-not-called half is
   what proves the cap is a guard rather than a post-hoc check.
5. **A non-string entry is rejected rather than embedded as a coerced value** — `["ok", 7]` throws
   `invalid_rpc`. Catches a validator that checks only `Array.isArray`.

**Verify**

```bash
pnpm vitest run tests/unit/external-module-embed-port.test.ts   # exit 0
pnpm typecheck                                                  # exit 0
pnpm check:external-modules                                     # exit 0
```

Commit body carries the user-facing line: "Modules can now use the instance embedder for semantic
search. No user-visible change on its own."

---
