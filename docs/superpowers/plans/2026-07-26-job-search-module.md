# Job Search Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-26-job-search-module-design.md` (read it first — it holds the rulings this plan implements)
**UI reference:** `apps/web/src/job-search-prototype/`, variant `?v=flow` (throwaway; direction approved, visual style not locked)

**Goal:** Ship a Job Search external module that crawls public job portals, scores every posting on two independent axes (Fit and Want), and surfaces the results through a board, a notification, a nav badge, and the daily briefing.

**Architecture:** An external module at `external-modules/job-search/`, built exactly like `external-modules/finance/` — a `jarvis.module.json` manifest plus a worker bundle and a web bundle, owning five Postgres tables reached through `ctx.db`. Logic lives in a pure `src/domain/` layer with no SDK imports so it unit-tests without a runtime; the worker layer is a thin adapter that wires SDK ports into those functions. Six small core-platform additions are prerequisites (Phase 0) — each is a generic seam every module gets, not job-search plumbing.

**Platform facts this plan is built on** (verified against the tree on 2026-07-26 — do not re-derive, and do not assume otherwise if a task looks like it needs more):

| Fact                                                                                                                                                         | Consequence for this plan                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Owned-table RLS column is **always `owner_user_id`** (`packages/db/src/module-rls-emitter.ts` hardcodes it)                                                  | Task 4 names every column `owner_user_id`; the module authors **no** RLS/policy/grant SQL      |
| Module SQL: **exactly one statement per file**, applied by `installModule()` — never `pnpm db:migrate`, never the core catalog                               | Task 4 is one DDL statement per file; the install test models `finance-tables-install.test.ts` |
| A worker handler **cannot enqueue anything** — `ModuleWorkerContext` has no jobs port                                                                        | crawl → triage → score collapses into ONE handler (Task 15 composes Tasks 14+15)               |
| Every invocation is capped at **30 s of wall clock that counts host RPC time**, and invocations are **serialized per module** (`worker-runtime.ts:62,88-92`) | One pass cannot fit today. Phase 0 Task 2e turns it into a stall budget + a per-queue ceiling  |
| The only enqueue path is `POST /api/modules/:id/queues/:name/run`, gated on `queue.allowManualRun`                                                           | The board's "Search now" button is a real enqueue with `params: {profileId}`                   |
| Schedules fan out **one job per active user** with the manifest's static params — no per-row scheduling                                                      | The scheduled entry is a `crawl.sweep` handler that lists the actor's own profiles             |
| `ctx.ai.generateStructured` returns an **envelope** and is capped at **8 calls per invocation**                                                              | Task 15 unwraps `object`, handles five typed errors, and chunks scoring to ≤8 calls            |
| The manifest validator **silently drops unknown top-level keys**                                                                                             | Any new manifest block (briefing, notify) needs a `validate.ts` change in the same task        |
| External modules **cannot reach briefings at all** today (`findExecute` needs an in-process `execute`)                                                       | Phase 0 Task 2 adds an injected invoker on `ComposeDeps`                                       |
| Chat surfaces **already exist end-to-end** — only `app-shell.tsx` is single-stream                                                                           | Phase 0 Task 2c is bounded shell wiring, not a new subsystem                                   |
| External web `Root` props are **`{hostActions, assistantSurface?}`** only                                                                                    | No web test may render `<Root profile={…}/>`; state comes from tool calls                      |

**Tech Stack:** TypeScript (ES2022, `moduleResolution: bundler`), `@jarv1s/module-sdk/worker`, plain `fetch` via `ctx.fetch`, Postgres + pgvector (768-dim, nomic-embed-text-v1.5), Vitest for unit and integration, Playwright for e2e, `scripts/build-external-module.ts` for packaging.

## Global Constraints

Every task's requirements implicitly include this section.

- **`pnpm test:integration <file>` does not narrow to that file.** The script is
  `tsx scripts/test-integration.ts tests/integration` (`package.json:49`) and it forwards
  `process.argv.slice(2)` straight into `vitest run` (`scripts/test-integration.ts:68,97`), so the
  baked-in directory arrives as a filter alongside yours and matches everything. Every
  `pnpm test:integration …` command below therefore runs the **whole** integration suite — that is
  expected, not a mistake, and it takes minutes. Name the file anyway: it documents what the step is
  actually checking. To iterate on one file, take the runner's own passthrough branch
  (`test-integration.ts:19-21`) by setting `JARVIS_PGDATABASE` yourself and calling vitest directly —
  and remember that skips the per-run database isolation, so use a scratch database, never the shared
  dev one.
- **Two axes, never one score.** No screen, API response, export, tool result, or briefing line may present a blended, weighted, or averaged Fit/Want number. The two travel together and travel labelled.
- **Render from records, never from model prose.** Every UI element is built from a stored field. No screen region is "whatever the model wrote."
- **Structured failure causes.** Every failure carries portal id, kind (`rate_limited | login_required | parse_failed | network`), what was retrieved before it stopped, when the portal last worked, and what happens next. Never a bare "failed".
- **The triage score never reaches the screen.** It is a cost-control device. Only Fit and Want are displayed.
- **Recall protection.** The triage cut reserves a slice for postings outside the user's stated criteria but relevant to their broader profile. Filtering strictly to stated criteria is a spec violation.
- **No login-walled or paywalled sources.** A portal that demands an account hard-stops and disables itself with cause `login_required`. Never sign in to a job board.
- **No autonomous application submission.** Per-item human approval only.
- **`actorUserId` envelope trap.** The host spreads `actorUserId` onto every external tool input. Every strict validator MUST strip it at the worker boundary or the call dies with `unknown key: actorUserId`.
- **Metadata-only job payloads.** Queue payloads carry actor id, resource ids, job kind, idempotency key, small command params. Never posting bodies, prompts, résumé content, or secrets.
- **Secrets never escape** to frontend responses, logs, pg-boss payloads, exports, or AI prompts.
- **All module tables FORCE RLS, owner-only**, including for admins. No `BYPASSRLS`.
- **Provider-agnostic AI.** Capability requests only. No hardcoded provider or model.
- **Never edit an applied migration.** Module SQL lives in `external-modules/job-search/sql/`, never `infra/postgres/migrations/`.
- **Design tokens only.** `apps/web/src/styles/tokens.css` is the only file permitted hex/rgb literals. `--font-sans` and `--font-display` only — no mono (retired 2026-07-08), no serif (sports nameplate only).
- **1000-line cap** on every source file including CSS (`pnpm check:file-size`).
- **No module-level chat button.** The core header already has one. The module must not add its own.
- **Module id is `job-search`, display name "Job Search".** The word "Compass" appears nowhere in code, UI, or docs.
- **Every task ends green on its own gate**, and the milestone ends green on `pnpm verify:foundation` with a real exit code — never `| tail`.

## Decision required before Phase 1 (Ben)

Spec §10.1 — **dynamic per-user fetch-host grants** are a hard blocker for "add your own job portal." `packages/host-fetch/src/policy.ts:assertValidFetchHosts` requires literal lowercase hostnames validated at manifest load, so a module physically cannot fetch a host the user names at runtime.

**This plan assumes that capability is DEFERRED.** v1 ships the three declared sources; `freehire.me` still covers ~50 ATS boards under one declared host. User-nominated portals become their own spec + milestone. If Ben wants them in v1, this plan grows a Phase 0 task and the milestone gets materially bigger — that is his call, not the implementer's.

**Second decision — Phase 0 is five core changes, not two.** Grounding the plan against the tree turned up three more genuine platform gaps behind features Ben asked for by name: an in-app notification port (`ModuleWorkerContext` has no `notify`), a nav badge (`navigation[]` entries are `{id,label,path,icon?,order?}` — no badge field), and per-profile chat threads (surfaces are fully built server-side; only `apps/web/src/shell/app-shell.tsx` hardcodes one stream). All three are generic seams every module would use, which is the bar Ben set for touching core — "if it's something that would make sense to add to the core and then expose it to this new module, that's fine." Weighed against his other ruling — "the module should just touch the module, not the core" — this is his call to confirm, not the implementer's. If he declines any of them, cut the corresponding module feature rather than faking it inside the module.

Everything else in the spec is in scope here.

---

## File Structure

**Phase 0 — core (all additive; every one is a generic seam, none is job-search-specific):**

| File                                                        | Responsibility                                                                                     | Task  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| `packages/module-sdk/src/worker.ts`                         | add `ctx.embed` to `ModuleWorkerContext`                                                           | 1     |
| `packages/module-registry/src/external/worker-rpc-host.ts`  | service `embed.*` and `notify.post` RPC methods                                                    | 1, 2b |
| `packages/module-sdk/src/index.ts`                          | `briefing` + `navigation[].badge` on `JsonJarvisModuleManifest` (L740 — there is no `manifest.ts`) | 2, 2d |
| `packages/module-registry/src/external/validate.ts`         | keep those blocks through manifest reconstruction (it drops unknowns)                              | 2, 2d |
| `packages/briefings/src/compose-shared.ts`                  | `ComposeDeps.invokeExternalBriefing?` injected invoker                                             | 2     |
| `apps/api/src/…` composition root                           | wire the invoker to the module runtime                                                             | 2     |
| `packages/module-sdk/src/worker.ts` + notifications package | `ctx.notify` port → existing in-app notification store                                             | 2b    |
| `apps/web/src/shell/chat-surface-key.ts` (new)              | hash (moduleId, key) into a surface that passes `CHAT_SURFACE_PATTERN`                             | 2c    |
| `apps/web/src/shell/app-shell.tsx`                          | honour the surface argument the seam already anticipates                                           | 2c    |
| `packages/notifications/src/repository.ts` + `routes.ts`    | per-module unread counts (`unreadByModule`) beside the existing total                              | 2d    |
| `packages/shared/src/notifications-api.ts`                  | `unreadByModule` on the DTO **and the response schema**                                            | 2d    |
| `apps/web/src/shell/…nav`                                   | render the module's unread count on a nav entry that opts in                                       | 2d    |
| `packages/module-registry/src/external/worker-runtime.ts`   | stall budget + hard ceiling + queue/tool lanes                                                     | 2e    |

**Phase 1+ — the module:**

| File                                                        | Responsibility                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `external-modules/job-search/jarvis.module.json`            | manifest: tools, queues, schedules, storage, tables, hosts |
| `external-modules/job-search/package.json`                  | artifact package metadata                                  |
| `external-modules/job-search/tsconfig.json`                 | copy of finance's, `jsx: react`, `jsxFactory: h`           |
| `external-modules/job-search/sql/0001…0006_*.sql`           | five tables + pgvector column, all FORCE RLS owner-only    |
| `src/domain/records.ts`                                     | every record type + `FailureCause`. No logic.              |
| `src/domain/criteria.ts`                                    | conversation output → structured `SearchCriteria`          |
| `src/domain/excludes.ts`                                    | stage-1 hard-exclude filter                                |
| `src/domain/triage.ts`                                      | stage-2 embedding cut, incl. the reserved recall slice     |
| `src/domain/score.ts`                                       | stage-3 prompt construction + Fit/Want result validation   |
| `src/domain/dedupe.ts`                                      | cross-portal posting identity                              |
| `src/domain/surface.ts`                                     | new-match counting + briefing payload shaping              |
| `src/domain/store-port.ts`                                  | storage interface the handlers are written against         |
| `src/adapters/types.ts`                                     | `Portal`, `CrawlResult`, `CrawlFailure`                    |
| `src/adapters/{freehire,linkedin}.ts`                       | one file per source                                        |
| `src/worker/index.ts`                                       | `defineModuleWorker` registration only                     |
| `src/worker/ports.ts`                                       | per-invocation dependency set (finance `ports.ts` pattern) |
| `src/worker/validate.ts`                                    | strict input validation; strips `actorUserId`              |
| `src/worker/store-sql.ts`                                   | `ctx.db` implementation of `store-port`                    |
| `src/worker/stages/{crawl,score}.ts`                        | the two pass stages — pure functions, never registered     |
| `src/worker/handlers/*.ts`                                  | the handlers actually named in the manifest                |
| `src/web/index.ts`                                          | web entrypoint                                             |
| `src/web/root.tsx`                                          | onboarding-vs-board branch                                 |
| `src/web/screens/{onboarding,board,inspector,settings}.tsx` | one screen each                                            |
| `src/web/styles.css`                                        | module styles, tokens only                                 |

**Tests:**

| File                                   | Covers                                      |
| -------------------------------------- | ------------------------------------------- |
| `tests/unit/job-search-*.test.ts`      | the whole domain layer, no SDK, no network  |
| `tests/integration/job-search.test.ts` | RLS, payload shape, `actorUserId` stripping |
| `tests/e2e/job-search.spec.ts`         | the required real-UI path                   |

---

## Phase 0 — Core platform prerequisites

### Task 1: `ctx.embed` on the module worker contract

The designed triage needs the instance embedder. `ModuleWorkerContext` exposes `input/auth/fetch/kv/ai/db/attachments` and nothing else, so a module cannot embed anything today. This is reusable platform capability — any module doing semantic retrieval wants it.

**Files:**

- Modify: `packages/module-sdk/src/worker.ts` (add the port next to the existing `attachments` port)
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — service the methods beside
  `fetch.request` (~:130), **before** the `withDataContext` call at :152; also widen
  `ExternalModuleRpcError` with an optional `detail`
- Modify: `apps/api/src/external-module-tools.ts:44` — rpc construction site 1 of 2
- Modify: `apps/worker/src/external-module-job-handler.ts:67` — rpc construction site 2 of 2, the
  one the scheduled crawl actually runs on
- Test: `tests/unit/external-module-embed-port.test.ts`

**Interfaces:**

- Consumes: `EmbeddingProvider` from `packages/memory/src/embedding-provider.ts` — **verbatim**:

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

  The document/query split is **load-bearing** — nomic applies a different task prefix to each, and
  collapsing them into one `embed(texts)` silently degrades retrieval quality. The module port keeps
  the distinction. The provider takes one string at a time; the port batches on the host side.

- Produces:
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
  reachable as `ctx.embed` on `ModuleWorkerContext`.

**Test harness note — read before Step 1.** `defineModuleWorker` returns `void` and drives a
JSON-RPC-over-stdio readline loop; there is **no `__invokeForTest`** and no exported context
factory. The SDK side is therefore covered by `pnpm typecheck`, and the behavioural test goes
against the **host** RPC handler, exactly like the existing
`tests/unit/external-module-attachment-port.test.ts` does for `attachments.readText`. Copy that
file's harness shape (`createExternalModuleRpcHandler` from `@jarv1s/module-registry/node`, a
synthetic `ExternalModuleDiscovery`, an `rpcFor(actorUserId, …)` helper). Do not invent a second
test seam in the SDK.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/external-module-embed-port.test.ts
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DataContextRunner } from "@jarv1s/db";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";
import { StubEmbeddingProvider } from "@jarv1s/memory";

describe("external worker embed port", () => {
  const actorUserId = randomUUID();
  const module = {
    id: "job-search",
    dir: "/unused",
    manifest: {
      schemaVersion: 1,
      id: "job-search",
      name: "Job Search",
      version: "1.0.0",
      publisher: "Jarvis",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.0.0" }
    },
    manifestHash: "sha256:a",
    packageHash: "sha256:a"
  } satisfies ExternalModuleDiscovery;

  // createExternalModuleRpcHandler has SEVEN required inputs (worker-rpc-host.ts:89-97) and
  // returns a THREE-arg handler `(method, params, rememberSecret)`. Copy the real harness at
  // tests/unit/external-module-attachment-port.test.ts:56-65 exactly — the null casts below are
  // that file's own device for the deps an embed-only test never reaches. Drop any of the seven
  // and this file does not typecheck.
  const handlerFor = (provider = new StubEmbeddingProvider()) =>
    createExternalModuleRpcHandler({
      module,
      toolRisk: "read",
      actorUserId,
      requestId: randomUUID(),
      workerDataContext: null as unknown as DataContextRunner,
      cipher: null as never,
      isActorAdmin: async () => false,
      embeddingProvider: provider
    });

  // The third arg is the secret-remembering callback. Every call site must pass it.
  const noSecrets = () => undefined;

  it("returns one document vector per input, in order", async () => {
    const rpc = handlerFor();
    const res = (await rpc("embed.embedDocuments", { texts: ["alpha", "beta"] }, noSecrets)) as {
      vectors: number[][];
    };
    expect(res.vectors).toHaveLength(2);
    expect(res.vectors[0]).toHaveLength(768);
    expect(res.vectors[0]).not.toEqual(res.vectors[1]);
  });

  it("routes a query through embedQuery, not embedDocument", async () => {
    // The task prefix differs between the two; a module asking for a query embedding
    // must not silently get a document embedding.
    const provider = new StubEmbeddingProvider();
    const embedQuery = vi.spyOn(provider, "embedQuery");
    const embedDocument = vi.spyOn(provider, "embedDocument");
    const rpc = handlerFor(provider);

    await rpc("embed.embedQuery", { text: "staff platform engineer, remote" }, noSecrets);

    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(embedDocument).not.toHaveBeenCalled();
  });

  it("reports the provider's dimensionality", async () => {
    const res = (await handlerFor()("embed.dimensions", {}, noSecrets)) as { dimensions: number };
    expect(res.dimensions).toBe(768);
  });

  it("rejects a batch larger than the contract cap without calling the provider", async () => {
    const provider = new StubEmbeddingProvider();
    const embedDocument = vi.spyOn(provider, "embedDocument");
    // Asserting on `.detail`, not on the message: ExternalModuleRpcError does `super(code)`
    // (worker-rpc-host.ts:43), so `message` is the bare code string and a /at most 128/ match
    // on the message can never pass. Step 3 adds the optional `detail` this reads.
    await expect(
      handlerFor(provider)("embed.embedDocuments", { texts: new Array(129).fill("x") }, noSecrets)
    ).rejects.toMatchObject({ code: "invalid_rpc", detail: /at most 128/ });
    expect(embedDocument).not.toHaveBeenCalled();
  });

  it("rejects a non-string entry rather than embedding a coerced value", async () => {
    await expect(
      handlerFor()("embed.embedDocuments", { texts: ["ok", 7] }, noSecrets)
    ).rejects.toMatchObject({ code: "invalid_rpc" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/external-module-embed-port.test.ts`
Expected: FAIL — the handler rejects `embed.embedDocuments` as an unknown method.

- [ ] **Step 3: Service the RPC host-side**

In `packages/module-registry/src/external/worker-rpc-host.ts`.

**Placement: beside `fetch.request` — after `const params = record(rawParams)` (:129) and _before_
the `input.workerDataContext.withDataContext(...)` call at :152.** Not next to
`ai.generateStructured` (:197), which is inside that call. Embedding touches no table, and opening a
data context to run a CPU-bound transform would hold a pooled connection for a whole 128-text batch.
This is also what makes the test harness above legal: `workerDataContext` is `null` there, so an
embed branch inside `withDataContext` would throw on the null before reaching any assertion.

**First, give the error a detail.** `ExternalModuleRpcError` (:26-45) does `super(code)`, so today
the message _is_ the code and no branch can say why it rejected. Add an optional second parameter,
keeping the code union closed and every existing `new ExternalModuleRpcError("x")` call site valid:

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

// Local shorthand; there is no existing `invalidRpc` helper in this file.
const invalidRpc = (detail: string) => new ExternalModuleRpcError("invalid_rpc", detail);
```

Then the branches. Follow `ai.generateStructured`'s discipline: validate the params, never let a
provider or model name cross the boundary, throw `invalid_rpc` on a malformed shape.

```ts
/** Max texts per embed call. Bounded like every other module port so one module
 * cannot pin the instance embedder with an unbounded batch. Matches the SDK constant. */
const EMBED_BATCH_MAX = 128;

if (method === "embed.dimensions") {
  return { dimensions: input.embeddingProvider.dimensions };
}
if (method === "embed.embedQuery") {
  const text = (params as { text?: unknown }).text;
  if (typeof text !== "string" || text.length === 0) throw invalidRpc("embed.embedQuery: text");
  return { vector: await input.embeddingProvider.embedQuery(text) };
}
if (method === "embed.embedDocuments") {
  const texts = (params as { texts?: unknown }).texts;
  if (!Array.isArray(texts)) throw invalidRpc("embed.embedDocuments: texts");
  if (texts.length > EMBED_BATCH_MAX) {
    throw invalidRpc(`embed.embedDocuments: at most ${EMBED_BATCH_MAX} texts per call`);
  }
  if (texts.some((t) => typeof t !== "string" || t.length === 0)) {
    throw invalidRpc("embed.embedDocuments: texts must be non-empty strings");
  }
  // Sequential, not Promise.all: the in-process embedder is CPU-bound and a
  // 128-wide fan-out would stall the worker host for every other module.
  const vectors: number[][] = [];
  for (const t of texts as string[]) vectors.push(await input.embeddingProvider.embedDocument(t));
  return { vectors };
}
```

Add `readonly embeddingProvider: EmbeddingProvider;` to the handler's input type — **required, not
optional**. There are exactly **two** production construction sites and a module port that reaches
only one of them is worse than no port at all:

- `apps/api/src/external-module-tools.ts:44` — assistant tools, the interactive path
- `apps/worker/src/external-module-job-handler.ts:67` — queued jobs, the background path

Job Search embeds during a **scheduled crawl**, which runs on the second one. Thread the api site
only and every scheduled crawl dies with `invalid_rpc` while every manual test passes. Making the
field required means missing either site is a `pnpm typecheck` failure, not a runtime surprise.

Both sites already resolve app services; get the provider from the same seam that constructs it for
memory search (`rg "EmbeddingProvider|StubEmbeddingProvider" apps packages --files-with-matches`).
Do **not** name a provider or model here.

The same "both sites" rule applies to every port added in Phase 0 — `ctx.notify` in Task 2b included.

- [ ] **Step 4: Add the port to the SDK**

```ts
// packages/module-sdk/src/worker.ts — alongside the existing ai/db/kv/attachments ports
export interface ModuleEmbedPort {
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  dimensions(): Promise<number>;
}

const embed: ModuleEmbedPort = {
  embedDocuments: async (texts) =>
    texts.length === 0
      ? []
      : (
          (await callParent("embed.embedDocuments", { texts: [...texts] })) as {
            vectors: number[][];
          }
        ).vectors,
  embedQuery: async (text) =>
    ((await callParent("embed.embedQuery", { text })) as { vector: number[] }).vector,
  dimensions: async () =>
    ((await callParent("embed.dimensions", {})) as { dimensions: number }).dimensions
};
```

Add `readonly embed: ModuleEmbedPort;` to `ModuleWorkerContext` and include `embed` in the context
object handed to handlers.

- [ ] **Step 5: Run the test and the typecheck**

Run: `pnpm vitest run tests/unit/external-module-embed-port.test.ts && pnpm typecheck`
Expected: PASS (all five cases); typecheck clean.

- [ ] **Step 6: Resolve the worker contract version**

Read `MODULE_WORKER_CONTRACT_VERSION` in `packages/module-sdk/src/worker-protocol.ts` and every
place the host compares it (`rg "MODULE_WORKER_CONTRACT_VERSION|contractVersion" packages/module-registry apps`).

- If the host only rejects a worker declaring a **higher** version than it supports, adding a
  context property is backward-compatible: leave the version alone, change nothing in finance.
- If the host requires an exact match, bump it and update `external-modules/finance/jarvis.module.json`
  in the same commit, then re-run `pnpm check:external-modules`.

Write which branch applied into the commit body. Do not guess.

- [ ] **Step 7: Gate and commit**

```bash
pnpm vitest run tests/unit/external-module-embed-port.test.ts && pnpm typecheck && pnpm check:external-modules
git add packages/module-sdk/src/worker.ts packages/module-registry/src/external/worker-rpc-host.ts \
  apps/api/src/external-module-tools.ts apps/worker/src/external-module-job-handler.ts \
  tests/unit/external-module-embed-port.test.ts
git commit -m "feat(module-sdk): add ctx.embed port for module semantic retrieval"
```

Commit body must include a user-facing line: "Modules can now use the instance embedder for
semantic search. No user-visible change on its own."

---

### Task 2: Generic module→briefing contribution seam

**Why this is genuinely missing, verified.** Core modules contribute by registering an in-process
assistant tool the composer resolves and calls directly:

```ts
// packages/briefings/src/compose-shared.ts:165
export function findExecute(manifests: readonly JarvisModuleManifest[], toolName: string) {
  return manifests.flatMap((m) => m.assistantTools ?? []).find((t) => t.name === toolName);
}
// …:307
const tool = findExecute(deps.moduleManifests, args.toolName);
if (!tool?.execute) { gaps.push({ source: args.key, reason: "tool_failed" }); … }
const result = await tool.execute(scopedDb, args.toolInput ?? {}, ctxFor(definition, input), toolServices);
```

An external module ships a **JSON** manifest — it has no `execute` function and can never have one,
so today it cannot reach a briefing by any route. The fix is an **injected invoker** on
`ComposeDeps`, following the existing optional-dependency precedent there (`focusReadiness`,
`connectorSyncAt`, `resolveUserName` are all injected the same way). Ben approved this core change
explicitly.

**There is no `packages/modules/` package.** The manifest type lives in
`packages/module-sdk/src/index.ts` as `JsonJarvisModuleManifest`.

**Files:**

- Read first: `packages/briefings/src/compose-shared.ts` (lines 23–48 for `ComposeDeps`, 160–175 for
  `findExecute`, 295–340 for the section helper), and `packages/briefings/src/jobs.ts:121`
  (`defaultComposeDeps`)
- Modify: `packages/module-sdk/src/index.ts` — add the `briefing` block to `JsonJarvisModuleManifest`
- Modify: `packages/module-registry/src/external/validate.ts` — validate it **and** re-emit it in the
  reconstruction literal at the bottom of the file (it drops unknown keys silently; a `briefing`
  block that is not re-emitted vanishes while validation still returns `ok: true`)
- Create: `packages/briefings/src/external-contributions.ts`
- Modify: `packages/briefings/src/compose-shared.ts` — add `invokeExternalBriefing?` and
  `externalBriefingManifests?` to `ComposeDeps`
- Modify: `packages/briefings/src/compose.ts` and `compose-evening.ts` — append external sections
- Modify: `packages/module-registry/src/index.ts:~1306-1345` — the **only** call site of
  `registerBriefingsJobWorkers`; widen the briefings `registerWorkers` deps and pass both new fields
  through into the `composeDeps` literal that is already there
- Modify: `apps/worker/src/worker.ts` — the only place that has both external-module discovery and
  the external worker runtime; build the invoker here and hand it down
- Test: `tests/unit/module-briefing-seam.test.ts`,
  `tests/unit/external-module-briefing-manifest.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: a manifest block

  ```jsonc
  "briefing": {
    "handler": "briefing.contribute",     // worker handler name
    "sections": ["morning", "evening"],   // which briefings it may appear in
    "toolName": "job-search.briefing"     // the name the user selects in briefing settings
  }
  ```

  **There is no `worker.handlers` list to cross-check against.** Verified: the worker block
  validates only `queues`, `schedules`, and `reconcileJobs` (`validate.ts:100–243`); handler names
  are declared inline on queue and assistant-tool entries and are never enumerated. So the
  validator checks that `handler` is a well-formed non-empty handler name and that
  `runtime.workerEntrypoint` is present — a briefing handler with no worker to run it is the real
  error case.

  There is deliberately **no `briefingOnly` flag**. An external briefing handler is a worker handler,
  not an `assistantTools` entry, so it is already invisible to the chat tool registry — the flag
  would describe a property the shape already guarantees. (`packages/sports/src/briefing-tool.ts`
  needs such a flag precisely because core briefing tools _are_ assistant tools; that mismatch is a
  pre-existing core issue and out of scope here.)

  ```ts
  // packages/briefings/src/external-contributions.ts
  export interface BriefingContribution {
    /** Module id, so the composer can attribute and the user can mute per module. */
    readonly moduleId: string;
    /** Short headline the composer may use verbatim. Rendered from records. */
    readonly headline: string;
    /** Zero or more structured items. The composer decides how many to include based on
     * the user's configured detail level; the module sends its full set and never
     * pre-truncates. Hard-capped at MAX_ITEMS so one module cannot flood a briefing. */
    readonly items: readonly {
      readonly id: string;
      readonly title: string;
      readonly detail: string;
      readonly href?: string;
    }[];
  }

  export type ExternalBriefingInvoker = (args: {
    readonly moduleId: string;
    readonly handler: string;
    readonly actorUserId: string;
    readonly requestId: string;
    readonly section: "morning" | "evening";
  }) => Promise<unknown>;

  export function collectExternalBriefingContributions(args: {
    readonly manifests: readonly JsonJarvisModuleManifest[];
    readonly selectedToolNames: readonly string[];
    readonly section: "morning" | "evening";
    readonly actorUserId: string;
    readonly requestId: string;
    readonly invoke: ExternalBriefingInvoker;
  }): Promise<BriefingContribution[]>;
  ```

  and on `ComposeDeps`: `readonly invokeExternalBriefing?: ExternalBriefingInvoker;`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/module-briefing-seam.test.ts
import { describe, expect, it, vi } from "vitest";

import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";
import { collectExternalBriefingContributions } from "../../packages/briefings/src/external-contributions.js";

const manifest = (id: string, briefing?: unknown) =>
  ({
    schemaVersion: 1,
    id,
    name: id,
    version: "1.0.0",
    publisher: "Jarvis",
    lifecycle: "optional",
    compatibility: { jarv1s: ">=0.0.0" },
    ...(briefing ? { briefing } : {})
  }) as JsonJarvisModuleManifest;

const BRIEFING = {
  handler: "briefing.contribute",
  sections: ["morning"],
  toolName: "job-search.briefing"
};

const call = (over: Partial<Parameters<typeof collectExternalBriefingContributions>[0]> = {}) =>
  collectExternalBriefingContributions({
    manifests: [manifest("job-search", BRIEFING), manifest("finance")],
    selectedToolNames: ["job-search.briefing"],
    section: "morning",
    actorUserId: "11111111-1111-4111-8111-111111111111",
    requestId: "req-1",
    invoke: vi.fn().mockResolvedValue({
      headline: "3 new matches",
      items: [{ id: "m1", title: "Staff Engineer", detail: "Fit 82 · Want 91" }]
    }),
    ...over
  });

describe("collectExternalBriefingContributions", () => {
  it("invokes only modules that declare a briefing handler", async () => {
    const invoke = vi.fn().mockResolvedValue({ headline: "3 new matches", items: [] });
    const out = await call({ invoke });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith({
      moduleId: "job-search",
      handler: "briefing.contribute",
      actorUserId: "11111111-1111-4111-8111-111111111111",
      requestId: "req-1",
      section: "morning"
    });
    expect(out.map((c) => c.moduleId)).toEqual(["job-search"]);
  });

  it("skips a module the user has not selected in briefing settings", async () => {
    // Same user control as every core briefing section — selected_tool_names is the gate.
    const invoke = vi.fn();
    expect(await call({ selectedToolNames: [], invoke })).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips a module that does not declare this section", async () => {
    const invoke = vi.fn();
    expect(await call({ section: "evening", invoke })).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("drops a module whose handler throws, without failing the briefing", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("worker down"));
    expect(await call({ invoke })).toEqual([]);
  });

  it("drops a contribution whose shape is wrong rather than trusting it", async () => {
    expect(await call({ invoke: vi.fn().mockResolvedValue({ headline: 42 }) })).toEqual([]);
  });

  it("drops one bad item without discarding the whole contribution", async () => {
    const out = await call({
      invoke: vi.fn().mockResolvedValue({
        headline: "2 new matches",
        items: [
          { id: "m1", title: "Staff Engineer", detail: "Fit 82 · Want 91" },
          { id: "m2", title: 7, detail: "bad" }
        ]
      })
    });
    expect(out[0]?.items.map((i) => i.id)).toEqual(["m1"]);
  });

  it("caps items so one module cannot flood the briefing", async () => {
    const out = await call({
      invoke: vi.fn().mockResolvedValue({
        headline: "many",
        items: Array.from({ length: 40 }, (_, i) => ({
          id: `m${i}`,
          title: "t",
          detail: "d"
        }))
      })
    });
    expect(out[0]?.items).toHaveLength(20);
  });

  it("drops a non-http href rather than emitting a javascript: link", async () => {
    const out = await call({
      invoke: vi.fn().mockResolvedValue({
        headline: "one",
        items: [{ id: "m1", title: "t", detail: "d", href: "javascript:alert(1)" }]
      })
    });
    expect(out[0]?.items[0]).not.toHaveProperty("href");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/module-briefing-seam.test.ts`
Expected: FAIL — `packages/briefings/src/external-contributions.js` does not exist.

- [ ] **Step 3: Implement the collector**

```ts
// packages/briefings/src/external-contributions.ts
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

/** One module cannot flood a briefing: the composer's detail level trims further,
 * but this is the hard ceiling regardless of what the module returns. */
const MAX_ITEMS = 20;
const MAX_HEADLINE = 200;
const MAX_TITLE = 200;
const MAX_DETAIL = 500;

export interface BriefingContribution {
  readonly moduleId: string;
  readonly headline: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly href?: string;
  }[];
}

export type ExternalBriefingInvoker = (args: {
  readonly moduleId: string;
  readonly handler: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly section: "morning" | "evening";
}) => Promise<unknown>;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

/** Only absolute http(s) or same-origin app paths. A module is sandboxed content;
 * a javascript:/data: href in a briefing line would be an injection vector. */
const safeHref = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : null;
  } catch {
    return null;
  }
};

function parseContribution(moduleId: string, raw: unknown): BriefingContribution | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const headline = str(r.headline, MAX_HEADLINE);
  if (headline === null) return null;
  if (!Array.isArray(r.items)) return null;

  const items: { id: string; title: string; detail: string; href?: string }[] = [];
  for (const entry of r.items) {
    if (items.length >= MAX_ITEMS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const id = str(e.id, 200);
    const title = str(e.title, MAX_TITLE);
    const detail = str(e.detail, MAX_DETAIL);
    // One malformed item must not cost the user the whole section.
    if (id === null || title === null || detail === null) continue;
    const href = safeHref(e.href);
    items.push({ id, title, detail, ...(href !== null ? { href } : {}) });
  }
  return { moduleId, headline, items };
}

export async function collectExternalBriefingContributions(args: {
  readonly manifests: readonly JsonJarvisModuleManifest[];
  readonly selectedToolNames: readonly string[];
  readonly section: "morning" | "evening";
  readonly actorUserId: string;
  readonly requestId: string;
  readonly invoke: ExternalBriefingInvoker;
}): Promise<BriefingContribution[]> {
  const declaring = args.manifests.filter((m) => {
    const b = m.briefing;
    if (!b?.handler) return false;
    if (!b.sections.includes(args.section)) return false;
    // Same user control as every core section: the briefing definition's
    // selected_tool_names decides whether this contribution runs at all.
    return args.selectedToolNames.includes(b.toolName);
  });

  const settled = await Promise.allSettled(
    declaring.map(async (m) =>
      parseContribution(
        m.id,
        await args.invoke({
          moduleId: m.id,
          handler: m.briefing!.handler,
          actorUserId: args.actorUserId,
          requestId: args.requestId,
          section: args.section
        })
      )
    )
  );
  // A module that cannot answer must never take the whole briefing down with it —
  // the user still gets every other section.
  return settled.flatMap((s) => (s.status === "fulfilled" && s.value !== null ? [s.value] : []));
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/module-briefing-seam.test.ts`
Expected: PASS (all eight).

- [ ] **Step 5: Add the manifest block and make the validator keep it**

Add to `JsonJarvisModuleManifest` in `packages/module-sdk/src/index.ts`:

```ts
/** Briefing contribution (external modules cannot register an in-process assistant
 * tool, so the composer reaches them through an injected worker invoker instead). */
readonly briefing?: ExternalModuleBriefingDeclaration;

export interface ExternalModuleBriefingDeclaration {
  /** Worker handler name. Requires runtime.workerEntrypoint. */
  readonly handler: string;
  readonly sections: readonly ("morning" | "evening")[];
  /** The name the user selects in briefing settings; conventionally `<moduleId>.briefing`. */
  readonly toolName: string;
}
```

In `packages/module-registry/src/external/validate.ts`, validate positively (`handler` is a
non-empty string and `runtime.workerEntrypoint` is present; `sections` is a non-empty subset of
`["morning","evening"]`; `toolName` matches `/^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/`) **and add it
to the reconstruction literal at the end of the function**:

```ts
...(briefing !== undefined ? { briefing } : {}),
```

Missing that line is the whole failure mode this step exists to prevent.

- [ ] **Step 6: Prove the validator keeps it**

```ts
// tests/unit/external-module-briefing-manifest.test.ts
import { describe, expect, it } from "vitest";
import { validateExternalModuleManifest } from "@jarv1s/module-registry";

const base = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.0.0",
  publisher: "Jarvis",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 }
};

describe("briefing manifest block", () => {
  it("survives manifest reconstruction", () => {
    // The validator rebuilds the manifest from an explicit field allowlist and silently
    // drops anything not re-emitted, so this asserts through the validator, never raw JSON.
    const res = validateExternalModuleManifest({
      ...base,
      briefing: {
        handler: "briefing.contribute",
        sections: ["morning"],
        toolName: "job-search.briefing"
      }
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.manifest.briefing).toEqual({
      handler: "briefing.contribute",
      sections: ["morning"],
      toolName: "job-search.briefing"
    });
  });

  it("rejects a briefing block on a module with no worker", () => {
    const { runtime: _drop, ...noWorker } = base;
    const res = validateExternalModuleManifest({
      ...noWorker,
      briefing: {
        handler: "briefing.contribute",
        sections: ["morning"],
        toolName: "job-search.briefing"
      }
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown section", () => {
    const res = validateExternalModuleManifest({
      ...base,
      briefing: {
        handler: "briefing.contribute",
        sections: ["lunchtime"],
        toolName: "job-search.briefing"
      }
    });
    expect(res.ok).toBe(false);
  });
});
```

Run: `pnpm vitest run tests/unit/external-module-briefing-manifest.test.ts`

- [ ] **Step 7: Add the injected invoker to `ComposeDeps` and call it from both composers**

In `packages/briefings/src/compose-shared.ts`, next to the other optional injected deps:

```ts
/** External modules ship JSON manifests with no in-process `execute`, so the composer
 * cannot resolve them through findExecute(). The composition root injects a worker
 * invoker instead. Absent in tests and in defaultComposeDeps → no external sections. */
readonly invokeExternalBriefing?: ExternalBriefingInvoker;

/** External manifests, injected separately — NOT read off `moduleManifests`.
 * `moduleManifests` is `readonly JarvisModuleManifest[]` and its only production supplier is
 * `getBuiltInModuleManifests()` (module-registry/src/index.ts:1311,1318). An external module's
 * JSON manifest never enters it, so filtering that array for `m.briefing` matches zero modules
 * forever — and silently, because every unit test below hand-injects manifests. This is exactly
 * the "wired, not just defined" failure: green tests, dead production path, invisible until UAT. */
readonly externalBriefingManifests?: readonly JsonJarvisModuleManifest[];
```

In `compose.ts` (morning) and `compose-evening.ts`, after the existing sections are built:

```ts
const externalSections = deps.invokeExternalBriefing
  ? (
      await collectExternalBriefingContributions({
        manifests: deps.externalBriefingManifests ?? [],
        selectedToolNames: definition.selected_tool_names,
        section: "morning", // "evening" in compose-evening.ts
        actorUserId: input.actorUserId,
        requestId: input.requestId,
        invoke: deps.invokeExternalBriefing
      })
    ).map((c) => ({
      key: `module:${c.moduleId}`,
      label: c.headline,
      // Render from records — the composer builds the line, the module supplies fields.
      lines: c.items.map((i) => `${i.title} — ${i.detail}`),
      count: c.items.length,
      rawItems: [...c.items]
    }))
  : [];
```

Append `externalSections` to the section list. Leave `defaultComposeDeps` in
`packages/briefings/src/jobs.ts:121` unchanged — it has no module runtime, so it correctly produces
no external sections.

- [ ] **Step 8: Wire the real invoker at the composition root**

`registerBriefingsJobWorkers` has exactly **one** call site, and it is not in `apps/` — it is
`packages/module-registry/src/index.ts:~1306`, inside the briefings module's own `registerWorkers`,
which already passes a large `composeDeps` object literal (~:1318-1345) built from
`getBuiltInModuleManifests()`. That literal is the injection point; no new plumbing into
`packages/briefings` is needed.

But that call site has **neither** of the two things the seam needs. External-module discovery and
the external worker runtime both live in `apps/worker/src/worker.ts`; `packages/module-registry` has
access to neither, and importing them there would import a module's internals across a package
boundary — a module-isolation violation. So both must arrive as _dependencies_ of `registerWorkers`,
not be constructed inside it:

1. Widen the briefings module's `registerWorkers` dependency object with two optional fields:

   ```ts
   /** Supplied by apps/worker; absent in tests and in any host with no external modules. */
   readonly externalBriefingManifests?: readonly JsonJarvisModuleManifest[];
   readonly invokeExternalBriefing?: ExternalBriefingInvoker;
   ```

   Optional, not required: a host with zero external modules installed must still boot, and every
   existing unit test constructs this object without them.

2. Pass both straight through into the existing `composeDeps` literal at ~:1318. One line each; the
   literal already spreads the built-in manifests, so nothing else moves.

3. **Extract the trust gate into a helper, then build the invoker on top of it.** Reusing the same
   `ExternalModuleWorkerRuntime` instance buys nothing on its own, and believing otherwise is how a
   disabled module ends up in the user's briefing. The runtime does **not** verify anything: it takes
   a discovery and starts it (`packages/module-registry/src/external/worker-runtime.ts:55`). Every
   check lives in the _job handler_ — active-user membership, `status !== "enabled"`, and both
   `manifest_hash` and `package_hash` against the on-disk discovery
   (`apps/worker/src/external-module-job-handler.ts:50-61`) — and the actor-scoped RPC with its
   `toolRisk`, cipher, and admin probe is constructed there too (`:66-84`). Call `runtime.invoke`
   directly from the briefing adapter and a disabled, stale, or tampered module still contributes
   briefing content, under a correctly scoped RPC, with nothing failing.

   So: new file `apps/worker/src/external-module-invoke.ts` exporting
   `createVerifiedExternalModuleInvoker(deps)`, where `deps` is the same set the job handler already
   receives (`workerDb`, `discoveryById`, `dataContext`, `cipher`, `ai`, `runtime`,
   `listActiveUserIds`). It returns one function:

   ```ts
   type VerifiedInvoke = (args: {
     readonly moduleId: string;
     readonly handler: string;
     readonly actorUserId: string;
     readonly requestId: string;
     readonly jobKind: string;
     readonly idempotencyKey: string;
     readonly params: Record<string, unknown>;
     readonly lane: WorkerLane; // Task 2e; see below
     readonly toolRisk: "read" | "write";
     readonly timeoutMs?: number;
     /** Returned instead of thrown when the module fails a trust check, so the caller can decide.
      *  The briefing composer drops the section; the queue handler returns without acking a retry. */
   }) => Promise<
     | { ok: true; result: unknown }
     | { ok: false; reason: "not-active" | "not-discovered" | "not-enabled" | "hash-mismatch" }
   >;
   ```

   It performs, in this order and in one place: the `listActiveUserIds` membership check, the
   `discoveryById` lookup, the `app.external_modules` row read, the `status`/`manifest_hash`/
   `package_hash` comparison, `createExternalModuleRpcHandler` with the actor-scoped data context,
   and only then `runtime.invoke`. `createExternalModuleJobHandler` is rewritten to call it and
   keeps its existing "return quietly" behaviour on `ok: false` — this is a refactor of the job
   path, not an addition beside it, and that is the point: two copies of a trust gate is one copy
   that rots.

   The briefing invoker is then a thin adapter over the same helper:

   ```ts
   {
     moduleId,
     handler: manifest.briefing.handler,
     actorUserId,
     requestId,
     jobKind: manifest.briefing.handler,
     idempotencyKey: `${moduleId}:briefing:${requestId}`,
     params: { section },
     lane: "briefing",
     toolRisk: "read" // a briefing contribution reads; it does not get the queue's write risk
   }
   ```

   Filter the discovered manifests to those with a `briefing` block and pass that array as
   `externalBriefingManifests`.

   **Integration tests, against a real database, one per trust condition — all three, on the
   briefing path specifically**, because the job path passing proves nothing about the new caller:
   a module whose row is `status = 'disabled'`, one whose stored `package_hash` differs from the
   discovery's, and one whose stored `manifest_hash` differs. Each must yield **no section at all**
   in the composed briefing, and must not throw — `collectExternalBriefingContributions` already
   swallows a rejection, so a test asserting only "did not throw" is green against a module that
   contributed anyway. Assert on the composed output. Add a fourth: the happy path, asserting the
   section IS present, or all three could pass against an invoker that never invokes anything.

**Why the manifests are threaded rather than filtered in place:** the obvious shortcut is to filter
`deps.moduleManifests` for `m.briefing` inside the composer. That array is
`readonly JarvisModuleManifest[]` and its only production supplier is `getBuiltInModuleManifests()`,
so no external manifest is ever in it — the filter matches zero modules forever. Every unit test in
this task hand-injects manifests, so all eight stay green and the dead path only shows up in UAT.

Do not migrate sports and news to this seam in this task — that is a separate cleanup with its own
issue.

- [ ] **Step 9: Gate and commit**

```bash
pnpm vitest run tests/unit/module-briefing-seam.test.ts tests/unit/external-module-briefing-manifest.test.ts && pnpm typecheck
git add packages/briefings/src/external-contributions.ts packages/briefings/src/compose-shared.ts \
  packages/briefings/src/compose.ts packages/briefings/src/compose-evening.ts \
  packages/module-sdk/src/index.ts packages/module-registry/src/external/validate.ts \
  packages/module-registry/src/index.ts apps/worker/src/worker.ts \
  tests/unit/module-briefing-seam.test.ts tests/unit/external-module-briefing-manifest.test.ts
git commit -m "feat(briefings): let external modules contribute briefing sections"
```

---

### Task 2b: `ctx.notify` port for in-app notifications

Ben asked for an in-app notification when new matches land. `ModuleWorkerContext` has no `notify`
port, so a module worker currently has no way to tell the user anything. This is a generic seam —
finance would use it for a sync failure, news for a breaking story.

**Files:**

- Read first: `rg -n "notification" packages/notifications/src --files-with-matches` — find the
  existing in-app notification store and the shape the shell already renders
- Modify: `packages/module-sdk/src/worker.ts` — add the port
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — service `notify.post`
- Test: `tests/unit/external-module-notify-port.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface ModuleNotifyPort {
    /** Post an in-app notification for the invoking actor. Rendered from these
     * fields — never from model prose. Rate-limited host-side per module. */
    post(input: {
      /** Stable per-event key. Re-posting the same key updates rather than duplicates. */
      readonly key: string;
      readonly title: string;
      readonly body: string;
      /** In-app route to open. Same-origin path only. */
      readonly href?: string;
    }): Promise<void>;
  }
  ```

  reachable as `ctx.notify`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/external-module-notify-port.test.ts
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DataContextRunner } from "@jarv1s/db";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import { createExternalModuleRpcHandler } from "@jarv1s/module-registry/node";

describe("external worker notify port", () => {
  // Same synthetic discovery object as Task 1's test; `id: "job-search"` is what the
  // host stamps onto the notification, which is why the assertions below can check it.
  const module = {
    /* …identical to tests/unit/external-module-embed-port.test.ts… */
  } as ExternalModuleDiscovery;

  // All seven required inputs (worker-rpc-host.ts:89-97). `postNotification` is injected the
  // same way `readAttachmentText` is — it takes an AccessContext and opens its own data
  // context internally, which is what lets notify.post be served before `withDataContext`
  // and lets `workerDataContext` stay null here.
  const rpcFor = (actorUserId: string, store: { post: ReturnType<typeof vi.fn> }) =>
    createExternalModuleRpcHandler({
      module,
      toolRisk: "write",
      actorUserId,
      requestId: randomUUID(),
      workerDataContext: null as unknown as DataContextRunner,
      cipher: null as never,
      isActorAdmin: async () => false,
      postNotification: store.post
    });

  const noSecrets = () => undefined;

  it("writes a notification scoped to the invoking actor", async () => {
    const store = { post: vi.fn().mockResolvedValue(undefined) };
    const actorUserId = randomUUID();
    await rpcFor(actorUserId, store)(
      "notify.post",
      {
        key: "new-matches:profile-1",
        title: "3 new matches",
        body: "Staff Engineer at Acme and 2 others",
        href: "/modules/job-search?profile=profile-1"
      },
      noSecrets
    );

    // Two arguments, not one: `(access, input)`. And the second one carries `eventKey` — the
    // repository's field name — even though the wire parameter is `key`. Asserting `key` here
    // would pass against a host that forwards a field the repository ignores, which is the whole
    // failure mode this case exists to catch.
    expect(store.post).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId }),
      expect.objectContaining({
        moduleId: "job-search",
        eventKey: "new-matches:profile-1",
        title: "3 new matches"
      })
    );
    expect(store.post.mock.calls[0]![1]).not.toHaveProperty("key");
  });

  it("rejects a cross-origin href rather than posting it", async () => {
    const store = { post: vi.fn() };
    await expect(
      rpcFor(randomUUID(), store)(
        "notify.post",
        { key: "k", title: "t", body: "b", href: "https://evil.example/steal" },
        noSecrets
      )
    ).rejects.toMatchObject({ code: "invalid_rpc" });
    expect(store.post).not.toHaveBeenCalled();
  });

  it("rejects an over-long body rather than truncating silently", async () => {
    const store = { post: vi.fn() };
    await expect(
      rpcFor(randomUUID(), store)(
        "notify.post",
        { key: "k", title: "t", body: "x".repeat(2001) },
        noSecrets
      )
    ).rejects.toMatchObject({ code: "invalid_rpc" });
    expect(store.post).not.toHaveBeenCalled();
  });

  it("caps notifications per invocation", async () => {
    const store = { post: vi.fn().mockResolvedValue(undefined) };
    const rpc = rpcFor(randomUUID(), store);
    for (let i = 0; i < 5; i++) {
      await rpc("notify.post", { key: `k${i}`, title: "t", body: "b" }, noSecrets);
    }
    await expect(
      rpc("notify.post", { key: "k5", title: "t", body: "b" }, noSecrets)
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(store.post).toHaveBeenCalledTimes(5);
  });

  it("gives each invocation its own budget", async () => {
    // The counter must live in the per-invocation factory closure, beside `aiCalls`
    // (worker-rpc-host.ts:113). Inside the returned function it resets every call and the
    // cap never trips; at module scope it leaks across invocations and the second crawl of
    // the day is silenced. Only a second handler from the same factory catches both.
    const store = { post: vi.fn().mockResolvedValue(undefined) };
    const first = rpcFor(randomUUID(), store);
    for (let i = 0; i < 5; i++) {
      await first("notify.post", { key: `k${i}`, title: "t", body: "b" }, noSecrets);
    }
    const second = rpcFor(randomUUID(), store);
    await expect(
      second("notify.post", { key: "fresh", title: "t", body: "b" }, noSecrets)
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/external-module-notify-port.test.ts`
Expected: FAIL — unknown method `notify.post`.

- [ ] **Step 3: Service the RPC host-side**

Beside `attachments.readText` (~:117) in `worker-rpc-host.ts`, **before** the `withDataContext` call
at :152 — the injected `postNotification` scopes itself, exactly as `readAttachmentText` does. Same
discipline: validate params, reject rather than coerce, cap per invocation.

**Add `rate_limited` to the `ExternalModuleRpcError` code union** (:26-45). It is a closed union
today and none of the existing codes means "you asked too often". Task 1 already widened the class
with an optional `detail`; this adds one member. `requireString` and `rateLimited` below are local
helpers this task introduces — neither exists in the file:

```ts
const rateLimited = (detail: string) => new ExternalModuleRpcError("rate_limited", detail);

/** Reject rather than coerce or truncate: silently shortening a module's copy would make the
 * tray disagree with what the module thinks it said. */
const requireString = (value: unknown, max: number, detail: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw invalidRpc(detail);
  }
  return value;
};
```

The counter goes in the **per-invocation factory closure**, on the same lines as `resolvedSecrets`
and `aiCalls` (worker-rpc-host.ts:110-113) — _not_ inside the returned `async (method, …) =>`
function, where it would reset on every call and never trip, and _not_ at module scope, where it
would leak across invocations and silence the second crawl of the day.

```ts
/** Five notifications per invocation. A crawl summarises; it does not narrate. */
const NOTIFY_PER_INVOCATION_CAP = 5;
let notifyCount = 0; // ← beside `let aiCalls = 0;` at :113, inside the factory

if (method === "notify.post") {
  if (++notifyCount > NOTIFY_PER_INVOCATION_CAP) throw rateLimited("notify.post");
  const p = params as Record<string, unknown>;
  const key = requireString(p.key, 200, "notify.post: key");
  const title = requireString(p.title, 200, "notify.post: title");
  const body = requireString(p.body, 2000, "notify.post: body");
  // Same-origin app paths only: a module is sandboxed content and must not be able to
  // plant an off-site link in the user's notification tray.
  let href: string | undefined;
  if (p.href !== undefined) {
    if (typeof p.href !== "string" || !p.href.startsWith("/") || p.href.startsWith("//")) {
      throw invalidRpc("notify.post: href must be a same-origin path");
    }
    href = p.href;
  }
  // The module-facing name is `key`; the repository field is `eventKey`
  // (`packages/notifications/src/repository.ts` — see Step 3b). The rename happens HERE, at the
  // host boundary, and nowhere else. Do not "simplify" by renaming the wire parameter: `key` is
  // what the SDK's `notify.post` port declares, and the module SDK is a published surface.
  await input.postNotification(
    { actorUserId: input.actorUserId, requestId: input.requestId },
    {
      moduleId: input.module.id,
      eventKey: key,
      title,
      body,
      ...(href !== undefined ? { href } : {})
    }
  );
  return {};
}
```

Add
`readonly postNotification?: (access: AccessContext, input: CreateNotificationInput) => Promise<void>;`
to the handler input type — typed against the repository's real input type, imported from
`@jarv1s/notifications`, not against an inline `{…}`. An inline shape is exactly how `key` and
`eventKey` drifted apart in an earlier revision of this plan: both sides typechecked and the field
silently vanished. Thread it and thread it at **both** rpc construction sites named in Task 1
(`apps/api/src/external-module-tools.ts:44` and
`apps/worker/src/external-module-job-handler.ts:67`) — the crawl that posts these notifications runs
on the worker one. Optional here rather than required (unlike `embeddingProvider`) because the
`if (!input.postNotification) throw invalidRpc(...)` guard is what the api-side path wants if a host
ever chooses not to offer the tray; state that guard explicitly in the branch.

- [ ] **Step 3b: Give the notifications store the fields and the grants this port needs**

`CreateNotificationInput` in `packages/notifications/src/repository.ts` is today
`{ moduleId; title; body?; metadata?; urgency? }` — **no event key and no href** — and every create
inserts a fresh `randomUUID()` row. So `key` and `href` above have nowhere to land, and a pass that
runs every six hours would post a new "N new matches" row every six hours forever. This is a core
change, specified here rather than left to the implementer to discover:

1. **Migration** — a new file in `packages/notifications/sql/`, never an edit to an applied one and
   never in `infra/postgres/migrations/` (module SQL lives in the owning module's `sql/` directory).
   The runner discovers it by scanning that directory
   (`packages/notifications/src/manifest.ts:38-40`); the manifest's `database.migrations` array is
   **not** the gate — `0166` and `0170` are live and absent from it. What _is_ a gate:
   `tests/integration/foundation-schema-catalog.test.ts` asserts the full catalog with `toEqual`
   (`:289`), so the new `{version, name}` row must be added there or the gate fails.

   The migration does six things, and **four of them are grant-and-policy pairs that do not exist
   today**. (Multiple statements in one file is correct here: `validateModuleMigrationSql`'s
   one-statement rule applies to _external_ module migrations, and the live
   `0071_notifications_worker_insert_grant.sql` is itself a grant plus two policies in one file.)
   - `ALTER TABLE app.notifications` add `event_key text`, `href text`, and
     `updated_at timestamptz NOT NULL DEFAULT now()`.
   - The partial unique index on `(recipient_user_id, module_id, event_key)`
     `where event_key is not null`. Partial, so the existing keyless behaviour is untouched.
   - `GRANT UPDATE ON app.notifications TO jarvis_app_runtime` **and** a `notifications_update`
     policy. There is no UPDATE grant and no UPDATE policy on that table today — the grant is
     `SELECT, INSERT` (`packages/notifications/sql/0008_notifications_module.sql:24`) and the only
     two policies are `notifications_select` and `notifications_insert` (`:39`, `:48`). Without
     both, `ON CONFLICT … DO UPDATE` fails with a permission error. Mirror the insert predicate:
     `recipient_user_id = app.current_actor_user_id()` in both `USING` and `WITH CHECK`.
   - `GRANT DELETE ON app.notification_reads TO jarvis_app_runtime` **and** a
     `notification_reads_delete` policy. Same story — the grant is `SELECT, INSERT, UPDATE` (`:25`)
     and there are exactly three policies (`:61`, `:75`, `:89`). Copy `notification_reads_update`'s
     `USING` clause verbatim, including the `EXISTS` guard against a visible parent notification.
   - **The same two grants and two policies again for `jarvis_worker_runtime`, or none of this runs
     in production.** The app role is not the role that posts these notifications — the crawl does,
     from the worker, and the worker's grants today are `SELECT, INSERT` on `app.notifications`
     (`packages/notifications/sql/0071_notifications_worker_insert_grant.sql:16`) and `SELECT` only
     on `app.notification_reads` (`packages/notifications/sql/0166_worker_notification_reads_grant.sql:5`).
     The upsert CTE below needs `UPDATE` on the parent and `DELETE` on the read row, so under the
     worker role it fails on the very first keyed notification — the api-side path would pass every
     test while the only path that matters is dead. Add
     `GRANT UPDATE ON app.notifications TO jarvis_worker_runtime` with a `notifications_update_worker`
     policy and `GRANT DELETE ON app.notification_reads TO jarvis_worker_runtime` with a
     `notification_reads_delete_worker` policy. `0071` is the template to copy, including its reason
     for granting `SELECT` alongside: `RETURNING *` requires `SELECT` privilege on the returned
     columns, and without it the statement errors and poisons the worker's transaction. Mirror the
     app-role predicates exactly — `recipient_user_id = app.current_actor_user_id()` on the parent in
     both `USING` and `WITH CHECK`, and `notification_reads_update`'s `EXISTS` guard on the child —
     so the recipient-only invariant is identical for both roles. Widening it for the worker would be
     a privilege escalation dressed as a grant.

2. **Repository** — `CreateNotificationInput` gains `eventKey?: string` and `href?: string`. When
   `eventKey` is present the insert becomes an upsert on that index. **Ruling: an update returns the
   row to unread.** A re-fired event is new information — three new matches this afternoon is not
   "already seen" because you read this morning's two. Task 2d's badge count and Task 22's badge
   test both derive from this sentence, so it is a decision, not an implementation detail.

3. **"Returns to unread" is a DELETE in a different table, and it must be the same statement.** Read
   state is not a column on `app.notifications`; it is a row in `app.notification_reads`, and unread
   is defined by that row's _absence_ — left join, `where reads.notification_id is null`
   (`packages/notifications/src/repository.ts:355-369`). Updating the notification row therefore
   leaves the read row intact and the badge stays cleared, which is precisely the bug this ruling
   was written to prevent. Two separate statements are not good enough either: a failure between
   them leaves a refreshed notification that still reads as seen, and there is no reconciliation
   pass to fix it. One modifying CTE, the shape `markRead` already uses (`:249-257`):

   ```sql
   WITH upserted AS (
     INSERT INTO app.notifications
       (id, module_id, actor_user_id, recipient_user_id, title, body, metadata, href,
        event_key, urgency, deferred_until, created_at, updated_at)
     VALUES ($1, $2, app.current_actor_user_id(), app.current_actor_user_id(), $3, $4, $5, $6,
             $7, $8, $9, now(), now())
     ON CONFLICT (recipient_user_id, module_id, event_key) WHERE event_key IS NOT NULL
     DO UPDATE SET title = excluded.title,
                   body = excluded.body,
                   metadata = excluded.metadata,
                   href = excluded.href,
                   urgency = excluded.urgency,
                   deferred_until = excluded.deferred_until,
                   updated_at = now()
     RETURNING *
   ),
   cleared AS (
     DELETE FROM app.notification_reads
     WHERE notification_id IN (SELECT id FROM upserted)
       AND user_id = app.current_actor_user_id()
   )
   SELECT * FROM upserted;
   ```

   Three details that are easy to get wrong. `created_at` is **not** in the `DO UPDATE` list, which
   is why `updated_at` has to exist: the tray orders by `created_at DESC`
   (`0008_notifications_module.sql:18`), so a refreshed notification would stay buried where it
   was. Ordering becomes `coalesce(updated_at, created_at) desc` with a matching index; `updated_at`
   does not need to reach the DTO. `deferred_until` is **recomputed** on the re-fire exactly as
   `create` computes it today (`repository.ts:193-201`) — a keyed event re-firing inside quiet hours
   must not ping. And the `user_id` predicate on the delete is load-bearing: without it the
   statement would clear other actors' read rows if the policy ever widened.

4. **The refresh and a concurrent `markRead` must not interleave.** The CTE above and `markRead`
   (`packages/notifications/src/repository.ts:249-257`) touch the same two tables in opposite
   directions and take no lock, so under READ COMMITTED they can produce a notification that is
   refreshed **and** marked read: `markRead`'s `SELECT n.id FROM app.notifications` reads the row,
   the refresh runs to completion and clears the read row, and `markRead`'s insert then lands
   after it. The badge clears for an event the user never saw the new version of. This is not
   theoretical — a crawl finishing while the tray is open is the ordinary case.

   Fix it on the `markRead` side, because that is the statement that reads the parent before
   writing the child: add `FOR UPDATE` to the CTE's selection of the notification row.

   ```sql
   INSERT INTO app.notification_reads (notification_id, user_id, read_at)
   SELECT n.id, app.current_actor_user_id(), now()
   FROM (
     SELECT id FROM app.notifications
      WHERE id = $1::uuid
      FOR UPDATE
   ) n
   ON CONFLICT (notification_id, user_id) DO UPDATE SET read_at = excluded.read_at
   RETURNING notification_id, read_at
   ```

   The subquery is required: `FOR UPDATE` is not allowed directly on a `SELECT` that also feeds
   an aggregate or a join in some shapes, and isolating it keeps the lock scoped to exactly the
   one row. The refresh CTE's `ON CONFLICT … DO UPDATE` takes the same row lock, so whichever
   statement arrives second blocks and then sees the first's committed effect. `markRead`'s
   "absent === denied" behaviour is preserved — a row that is absent or RLS-invisible still
   yields zero rows from the subquery, so the insert emits nothing and the join returns
   `undefined`, exactly as the existing comment at `:246` requires.

   **Test it on two connections, or it proves nothing.** Both statements on one connection
   serialize for free. Open two data contexts for the same actor, `markRead` on one inside an
   explicit transaction held open, fire the refresh on the other, then commit; assert the
   notification ends **unread** and that neither statement errored. A single-connection version
   of this test passes against the unlocked SQL.

5. **`href` is first-class, not smuggled through `metadata`.** Validate it as a same-origin relative
   path — starts with `/`, never `//`, no scheme — and reject anything else. A module-supplied
   absolute URL in a notification is an open-redirect surface, and the rpc-host guard above is the
   second belt, not the only one.

6. Files: the new `packages/notifications/sql/*.sql`,
   `tests/integration/foundation-schema-catalog.test.ts`,
   `packages/notifications/src/repository.ts`, `packages/notifications/src/routes.ts`,
   `packages/shared/src/notifications-api.ts` (**the response schema — an undeclared field is
   silently dropped by the Fastify serializer, so `href` would vanish between the database and the
   browser with nothing failing**), the module RPC host that exposes `postNotification`, and the web
   notification list component.

7. Tests: the same `eventKey` twice yields one row; different `eventKey` yields two rows; an absent
   `eventKey` always creates a new row (unchanged behaviour); an absolute or protocol-relative
   `href` is rejected; and `href` survives the REST response schema — asserted through `app.inject`,
   not against the repository return. Then the two that this ruling actually turns on, both against
   a real database because a mocked repository exercises neither the CTE nor the policies:
   - **Return-to-unread, run under the worker role.** Post the event, mark it read, repost the
     identical `event_key`, and assert the unread count is back to one **at both tiers** — the
     repository count and the REST response — because the failure mode is a projection that
     disagrees with the row. Run the repost through a real worker data context
     (`jarvis_worker_runtime`), not only the app role: an app-role-only test is green against a
     migration that forgot the worker grants entirely, which is the exact defect this step exists to
     prevent. Assert the app-role path too, since the tray's own mark-read still runs there.
   - **Read rows belong to their reader.** With actor A's read row present, run the upsert as actor
     B and assert A's row survives.

**Task 2d depends on `notifications.module_id` being populated**, so this write path must set it;
that column already exists (`NotificationDto.moduleId`,
`packages/shared/src/notifications-api.ts:20`).

- [ ] **Step 4: Add the port to the SDK**

```ts
const notify: ModuleNotifyPort = {
  post: async (i) => void (await callParent("notify.post", i))
};
```

Add `readonly notify: ModuleNotifyPort;` to `ModuleWorkerContext` and include it in the context.

- [ ] **Step 5: Gate and commit**

```bash
pnpm vitest run tests/unit/external-module-notify-port.test.ts && pnpm typecheck
git add packages/module-sdk/src/worker.ts packages/module-registry/src/external/worker-rpc-host.ts \
  packages/notifications/src packages/notifications/sql packages/shared/src/notifications-api.ts \
  tests/integration/foundation-schema-catalog.test.ts apps/web/src/notifications \
  apps/api/src/external-module-tools.ts apps/worker/src/external-module-job-handler.ts \
  tests/unit/external-module-notify-port.test.ts
git commit -m "feat(module-sdk): add ctx.notify port for in-app module notifications"
```

---

### Task 2c: Honour the chat surface the shell already anticipates

**Read this before assuming scope.** Per-surface chat is **already built end-to-end**. Verified:

- `packages/shared/src/chat-api.ts` — `ChatSurface` is a branded string, `DEFAULT_CHAT_SURFACE = "drawer"`, `normalizeChatSurface()`, and `sendChatTurn(text, attachmentIds?, controlContext?, surface?)` posts the surface.
- `apps/web/src/…/use-chat-stream.ts` — `useChatStream(surface)` opens `new EventSource(chatStreamUrl(surface))` and calls `listChatThreads(surface)` / `listChatThreadMessages(threadId, surface)`.
- `packages/chat/src/live-routes.ts` — the turn route and privacy start/end/state all read the surface.
- `packages/chat/src/gateway-notifier.ts` — sessions and subscriptions are keyed by **actor + surface**, so there is no cross-surface transcript path.
- Migration `sql/0174_chat_surface.sql` shipped, listed in `packages/chat/src/manifest.ts`.

The **only** gap is `apps/web/src/shell/app-shell.tsx`, which calls `useChatStream()` with no surface
and returns `recordsForSurface: () => records`. Its own comment says so:

```ts
// The shell owns exactly one stream today (the drawer). `subscribeRecords`/`recordsForSurface`
// still take a surface so a future module can be given its own shell-owned stream without
// reshaping the host contract — but no surface-specific branch lives here.
```

This task closes that one file. It is bounded shell wiring, not a new subsystem.

**Files:**

- Create: `apps/web/src/shell/chat-surface-key.ts`
- Modify: `apps/web/src/shell/app-shell.tsx` (lines ~100–190)
- Modify: `apps/web/src/app.tsx` — `ExternalModuleMount` currently binds the surface handle to the
  module id alone; accept a module-supplied surface suffix
- Modify: `apps/web/src/chat/assistant-surface/{contracts.ts,handle.ts}` — add `setSurfaceKey` and
  `seedContext` to `AssistantSurfaceHandleV1`
- Modify: `packages/chat/src/live-routes.ts` — add the generic seed route
- Modify: `packages/shared/src/chat-api.ts` — add the client function for it
- Test: `tests/unit/app-shell-chat-surface.test.tsx`
- Test: `tests/unit/chat-seed-route.test.ts`

**The surface string is not free-form — read this before writing any of it.**
`packages/shared/src/chat-api.ts:14` constrains every surface to `/^[a-z][a-z0-9-]{1,31}$/`: 2–32
characters, lowercase, digits and hyphens only, **no colons**, and it must start with a letter. Every
chat route runs `normalizeChatSurface` (chat-api.ts:16–21), which throws `Invalid chat surface` on a
mismatch, so an obvious-looking composed value such as `module:job-search:profile-1` would 400 every
single turn. Module ids do not help: `MODULE_ID_RE` (`validate.ts:28`) is
`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` — unbounded length, may start with a digit — and the
module-supplied key is arbitrary text. Neither can be concatenated into a legal surface.

So the **shell derives the wire surface by hashing**, and the module never supplies one:

```ts
// apps/web/src/shell/chat-surface-key.ts
// Hash rather than concatenate: neither the module id nor the module-supplied key is guaranteed to
// fit CHAT_SURFACE_PATTERN (chat-api.ts:14), and a bad surface 400s every chat turn.
// 64-bit FNV-1a rather than sha256 because this runs in a synchronous render path and
// `crypto.subtle` is async. Collision resistance is not a security boundary here — surfaces are
// namespaces inside one user's own account and both inputs are host-known.
export function moduleChatSurface(moduleId: string, key: string): string {
  // `:` is a safe separator: MODULE_ID_RE forbids it in a module id, so (id, key) cannot alias.
  const input = `${moduleId}:${key}`;
  let hi = 0x811c9dc5;
  let lo = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hi = Math.imul(hi ^ input.charCodeAt(i), 0x01000193) >>> 0;
    lo = Math.imul(lo ^ input.charCodeAt(input.length - 1 - i), 0x01000193) >>> 0;
  }
  // `m-` guarantees the required leading lowercase letter; 16 hex chars → 18 total, under the 32 cap.
  return `m-${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}`;
}
```

This keeps the #1196 host-controlled binding rule (`apps/web/src/app.tsx:353`: "the surface name comes
from the host mount, never from module code") — the module supplies only the key. It is deterministic
across reloads, so a profile's transcript stays re-findable. The surface is opaque on the wire; the
human-readable scope pill in the drawer header comes from the module's label, not the surface string.

**Interfaces:**

- Produces: `assistantSurface.setSurfaceKey(key: string | null): void` on `AssistantSurfaceHandleV1`.
  The module calls it when the active profile changes; `null` returns the shell to the drawer.
- Produces: `moduleChatSurface(moduleId: string, key: string): string` from
  `apps/web/src/shell/chat-surface-key.ts`.
- Produces: `assistantSurface.seedContext(seed: string, idempotencyKey: string): Promise<void>` on
  `AssistantSurfaceHandleV1`. Frames the thread on that surface **before** the user's first turn.

**Why the surface needs a seed seam, and why it is this one.** A module-owned thread that opens
with no framing is a generic assistant that happens to be rendered inside Job Search — it does not
know what the profile is for or which tools record an answer. The three things that already exist
are each wrong for this:

- `hostActions.openAssistant({starterPrompt})` inserts an **editable draft** in the composer
  (`apps/web/src/external-modules/host-actions.ts:19-24` → `app-shell.tsx:117`). The user reads it
  as text they typed, and can delete it. Fine for a one-line "help me tighten this search"; wrong
  for framing.
- `seedComposer` on the handle is the same mechanism, same problem.
- `submitTurn` posts the seed as a visible user message.

The right one already exists server-side and is already surface-aware:
`ChatSessionManager.seedContext(actorUserId, userName, seed, idempotencyKey?, surface?)`
(`packages/chat/src/live/chat-session-manager.ts:376-392`). It submits the seed to the engine
without creating a visible user turn, and **`idempotencyKey` makes it a no-op on re-seed** —
`session.seededContextKeys` — so a remount cannot re-frame a live conversation. Its only caller
today is the evening-interview route (`live-routes.ts:387-402`), which is a _dedicated_ route for
one feature. Generalise it rather than copying it:

```ts
// packages/chat/src/live-routes.ts — beside /api/chat/evening-interview
// Generic counterpart to the evening-interview route: any surface owner frames its own thread.
// Same rate-limit bucket as the other chat mutations. The seed is submitted to the engine as
// context, not as a user turn, and `idempotencyKey` makes a repeat call a no-op.
server.post(
  "/api/chat/seed",
  {
    config: {
      rateLimit: {
        max: CHAT_MUTATION_MAX,
        timeWindow: "1 minute",
        keyGenerator: sessionRateLimitKey
      }
    }
  },
  async (request, reply) => {
    const access = await resolveOr401(dependencies, request, reply);
    if (!access) return reply;
    const body = request.body as { seed?: unknown; idempotencyKey?: unknown; surface?: unknown };
    // Bounded: a seed is framing, not a document. The cap is a DoS bound on engine input, and it
    // is checked here rather than in the browser because the browser is not the trust boundary.
    if (typeof body?.seed !== "string" || body.seed.length === 0 || body.seed.length > 8000) {
      return reply.code(400).send({ error: "Invalid seed" });
    }
    if (
      typeof body?.idempotencyKey !== "string" ||
      body.idempotencyKey.length === 0 ||
      body.idempotencyKey.length > 128
    ) {
      return reply.code(400).send({ error: "Invalid idempotencyKey" });
    }
    try {
      const userName = await runtime.resolveUserName(access.actorUserId);
      // normalizeChatSurface throws on a bad surface; handleLiveRouteError maps it to a 400.
      await runtime.manager.seedContext(
        access.actorUserId,
        userName,
        body.seed,
        body.idempotencyKey,
        body.surface as string | undefined
      );
      return reply.code(204).send();
    } catch (error) {
      return handleLiveRouteError(error, reply);
    }
  }
);
```

**Trust note, state it in the code comment too:** the seed is module-authored text entering the
model's context. It carries exactly the authority a user turn carries — no more. It must not be
described anywhere as a system prompt, and the host must not grant it one, or an installed module
becomes a way to rewrite the assistant's instructions.

`handle.ts` curries the scoped surface into `seedContext` the same way it already does for
`submitTurn`, so the module never names a surface.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/app-shell-chat-surface.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { normalizeChatSurface } from "@jarv1s/shared/chat-api";
import { moduleChatSurface } from "../../apps/web/src/shell/chat-surface-key";

// Mock useChatStream so the assertion is on the surface argument the shell passes, not on SSE
// behaviour (packages/chat already covers that). NOTE the path: app-shell.tsx:43 imports
// `../chat/use-chat-stream` — there is no `shell/use-chat-stream`. Mocking the wrong specifier
// silently does nothing and the real hook opens an EventSource in jsdom.
const useChatStream = vi.fn(() => ({ records: [], clearRecords: vi.fn(), streamErrorCount: 0 }));
vi.mock("../../apps/web/src/chat/use-chat-stream", () => ({ useChatStream }));

describe("app shell chat surface", () => {
  it("opens the drawer surface by default", () => {
    render(<AppShell />);
    expect(useChatStream).toHaveBeenCalledWith("drawer");
  });

  it("switches to the module surface when a module sets a surface key", () => {
    const { handle } = renderWithModuleMount("job-search");
    act(() => handle.setSurfaceKey("profile-1"));
    expect(useChatStream).toHaveBeenLastCalledWith(moduleChatSurface("job-search", "profile-1"));
  });

  it("derives a surface the server will actually accept", () => {
    // Not mocked, and deliberately not a golden string: this asserts against the real validator
    // that rejected the original `module:<id>:<key>` scheme.
    const surface = moduleChatSurface("job-search", "profile-1");
    expect(() => normalizeChatSurface(surface)).not.toThrow();
  });

  it("derives a legal surface from hostile inputs", () => {
    const long = "9" + "a-b".repeat(40);
    expect(() => normalizeChatSurface(moduleChatSurface(long, "Profile One!! 🙂"))).not.toThrow();
  });

  it("gives two profiles of the same module different surfaces", () => {
    expect(moduleChatSurface("job-search", "profile-1")).not.toBe(
      moduleChatSurface("job-search", "profile-2")
    );
  });

  it("keeps module records out of the drawer transcript", () => {
    // Ben's ruling: a job-search thread must never appear in the main drawer.
    const { handle, recordsForSurface } = renderWithModuleMount("job-search");
    act(() => handle.setSurfaceKey("profile-1"));
    expect(recordsForSurface("drawer")).toEqual([]);
  });

  it("returns to the drawer surface when the module unmounts", () => {
    const { unmount } = renderWithModuleMount("job-search");
    unmount();
    expect(useChatStream).toHaveBeenLastCalledWith("drawer");
  });
});
```

Write the helper `renderWithModuleMount` inline in the test file against the real `app-shell.tsx`
exports; do not add a test-only export to production code.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/app-shell-chat-surface.test.tsx`
Expected: FAIL — `chat-surface-key` does not resolve, and `useChatStream` is called with no argument.

- [ ] **Step 3: Wire the surface through the shell**

Create `chat-surface-key.ts` exactly as shown. Hold the active surface in shell state (default
`DEFAULT_CHAT_SURFACE`), pass it to `useChatStream(activeSurface)`, and make
`recordsForSurface(surface)` return `records` only when `surface === activeSurface` and `[]`
otherwise. Add `setSurfaceKey` to the handle built by `createAssistantSurfaceHandle` in
`apps/web/src/app.tsx` — it calls `moduleChatSurface(moduleId, key)` with the **host-held** module id,
and resets to `DEFAULT_CHAT_SURFACE` on `null` and on unmount.

- [ ] **Step 4: Write the failing seed-route test**

```ts
// tests/unit/chat-seed-route.test.ts
// app.inject against the real route. NOTE: Fastify's response schema silently drops any field
// the schema does not declare (fast-json-stringify), which is why this route returns 204 with no
// body — there is nothing to lose.
describe("POST /api/chat/seed", () => {
  it("seeds the requested surface and returns 204", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/seed",
      headers: auth,
      payload: {
        seed: "You are helping with a job search.",
        idempotencyKey: "k1",
        surface: "m-0123456789abcdef"
      }
    });
    expect(res.statusCode).toBe(204);
    expect(manager.seedContext).toHaveBeenCalledWith(
      actorUserId,
      expect.any(String),
      "You are helping with a job search.",
      "k1",
      "m-0123456789abcdef"
    );
  });

  it("is a no-op on a repeat with the same idempotency key", async () => {
    // Guards the real failure: a module remount re-framing a conversation already in progress.
    // The manager owns the dedupe (`seededContextKeys`); this asserts the key reaches it.
    for (const _ of [0, 1]) {
      await app.inject({
        method: "POST",
        url: "/api/chat/seed",
        headers: auth,
        payload: { seed: "s", idempotencyKey: "same", surface: "m-0123456789abcdef" }
      });
    }
    expect(manager.seedContext).toHaveBeenNthCalledWith(
      2,
      actorUserId,
      expect.any(String),
      "s",
      "same",
      "m-0123456789abcdef"
    );
  });

  it("rejects an oversized seed", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/seed",
      headers: auth,
      payload: { seed: "x".repeat(8001), idempotencyKey: "k" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an illegal surface with a 400, not a 500", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/seed",
      headers: auth,
      payload: { seed: "s", idempotencyKey: "k", surface: "module:job-search:p1" }
    });
    expect(res.statusCode).toBe(400);
  });

  it("401s an unauthenticated call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/seed",
      payload: { seed: "s", idempotencyKey: "k" }
    });
    expect(res.statusCode).toBe(401);
  });
});
```

Then add the route and the `chat-api.ts` client function, and add `seedContext` to
`AssistantSurfaceHandleV1` in `contracts.ts` and to the wrapper in `handle.ts` (currying
`scopedSurface`, exactly as `submitTurn` already does).

- [ ] **Step 5: Run both tests, then the web gate**

Run: `pnpm vitest run tests/unit/app-shell-chat-surface.test.tsx tests/unit/chat-seed-route.test.ts && pnpm --filter @jarv1s/web typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shell/chat-surface-key.ts apps/web/src/shell/app-shell.tsx apps/web/src/app.tsx \
        apps/web/src/chat/assistant-surface/contracts.ts apps/web/src/chat/assistant-surface/handle.ts \
        packages/chat/src/live-routes.ts packages/shared/src/chat-api.ts \
        tests/unit/app-shell-chat-surface.test.tsx tests/unit/chat-seed-route.test.ts
git commit -m "feat(web): let a module own and frame a shell chat surface"
```

---

### Task 2d: Manifest-declared nav badge, counted from the module's own notifications

Ben asked for a count badge on the Job Search nav entry. `navigation[]` entries validate to
`{id, label, path, icon?, order?}` only — there is no badge field, and the validator would drop one.

**Where the count comes from — read this before designing anything.** An earlier draft of this task
had the shell poll a module assistant tool (`badge.toolName` + `countField`) for the number. That
cannot work: a module tool's structured result never reaches the browser. `packages/ai/src/gateway/gateway.ts`
emits `action_result` with `{actionRequestId, toolName, outcome}` and **never populates `result`**;
the field exists on the wire (`packages/chat/src/live/types.ts:23`, forwarded by
`gateway-notifier.ts:52`) and nothing fills it. A module surface reading `record.result` gets
`undefined` forever, silently. Building that opt-in is a core project in its own right, and it is not
needed here.

The count the badge wants is _already_ a first-class core concept. Task 2b gives the module
`ctx.notify.post`, and `NotificationDto` already carries `moduleId`
(`packages/shared/src/notifications-api.ts:20`). So the badge is simply **this module's unread
notification count** — no polling, no new channel, and the badge and the notification bell can never
disagree, which is the behaviour a user expects anyway. The only core addition is a per-module
breakdown of a number the API already computes.

**Files:**

- Modify: `packages/notifications/src/repository.ts` — `countUnreadByModule` beside `countUnread`
  (:355) and return it from `listVisible` (:153)
- Modify: `packages/notifications/src/routes.ts` — pass it through the list handler
- Modify: `packages/shared/src/notifications-api.ts` — `unreadByModule` on `ListNotificationsResult`
  / `ListNotificationsResponse` **and on the response schema** (near the `required` list at :93)
- Modify: `packages/module-sdk/src/index.ts` — `ExternalModuleNavigationEntry.badge?`
- Modify: `packages/module-registry/src/external/validate.ts` — validate it and re-emit it in the
  navigation entry literal (around line 640)
- Modify: the shell nav renderer (`rg -n "navigation" apps/web/src/shell --files-with-matches`)
- Test: `tests/unit/external-module-nav-badge.test.ts`
- Test: `tests/integration/notifications-unread-by-module.test.ts`

**Interfaces:**

- Produces, on `ExternalModuleNavigationEntry`:
  ```ts
  readonly badge?: {
    /**
     * Closed enum with one member today. A badge is always derived from a core-owned count —
     * never from module-supplied text or a module tool result — so the module can only choose
     * *which* core count, never the number itself.
     */
    readonly source: "notifications";
  };
  ```
- Produces, on `ListNotificationsResponse`: `readonly unreadByModule: Readonly<Record<string, number>>`
  — unread counts keyed by `module_id` across **all** of the actor's visible notifications, not just
  the returned page. Core notifications (`module_id IS NULL`) are excluded from the map; they are
  already covered by the existing top-level `unreadCount`.

- [ ] **Step 1: Write the failing manifest test**

```ts
// tests/unit/external-module-nav-badge.test.ts
import { describe, expect, it } from "vitest";
import { validateExternalModuleManifest } from "@jarv1s/module-registry";

// Shape copied from external-modules/finance/jarvis.module.json — assistantTools entries require
// `permissionId`, `risk`, and `handler` (validate.ts:436-450), and declaring any assistant tool
// makes the `runtime` block required (validate.ts:425). Omitting them fails the manifest before
// the badge logic is ever reached, which makes a badge test look like a badge bug.
const base = {
  schemaVersion: 1,
  id: "job-search",
  name: "Job Search",
  version: "1.0.0",
  publisher: "Jarvis",
  lifecycle: "optional",
  compatibility: { jarv1s: ">=0.0.0" },
  runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
  assistantTools: [
    {
      name: "job-search.board.list",
      permissionId: "job-search.board.list",
      description: "List the board.",
      risk: "read",
      inputSchema: { type: "object", additionalProperties: false },
      handler: "board.list"
    }
  ]
};
const nav = (badge?: unknown) => ({
  ...base,
  navigation: [
    {
      id: "job-search",
      label: "Job Search",
      path: "/modules/job-search",
      ...(badge ? { badge } : {})
    }
  ]
});

describe("navigation badge", () => {
  it("survives manifest reconstruction", () => {
    const res = validateExternalModuleManifest(nav({ source: "notifications" }));
    expect(res.ok).toBe(true);
    expect(res.ok && res.manifest.navigation?.[0]?.badge).toEqual({ source: "notifications" });
  });

  it("rejects an unknown badge source", () => {
    // Closed enum: a future source must be added deliberately, not accepted because it is a string.
    expect(validateExternalModuleManifest(nav({ source: "tool" })).ok).toBe(false);
  });

  it("rejects a badge that is not an object", () => {
    expect(validateExternalModuleManifest(nav("notifications")).ok).toBe(false);
  });

  it("accepts a navigation entry with no badge", () => {
    expect(validateExternalModuleManifest(nav()).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/external-module-nav-badge.test.ts`
Expected: FAIL — `badge` is dropped by the validator, so the first assertion gets `undefined`.

- [ ] **Step 3: Write the failing count test**

```ts
// tests/integration/notifications-unread-by-module.test.ts
// Integration, not unit: the count is a SQL aggregate under RLS, and the thing most likely to be
// wrong is the join to notification_reads, which a mocked repository would not exercise.
it("counts unread notifications per module for the actor only", async () => {
  const owner = await seedUser();
  const other = await seedUser();
  await postNotification(owner, { moduleId: "job-search", title: "Two new matches" });
  await postNotification(owner, { moduleId: "job-search", title: "One more" });
  await postNotification(owner, { moduleId: "news", title: "Digest" });
  await postNotification(owner, { moduleId: null, title: "Core" });
  await postNotification(other, { moduleId: "job-search", title: "Not yours" });

  const read = await postNotification(owner, { moduleId: "job-search", title: "Already seen" });
  await markRead(owner, read.id);

  const result = await listNotifications(owner);
  // "news": 1 proves the map is keyed, not a single filtered count.
  // No "job-search": 4 — the read one and the other user's one must both be excluded.
  expect(result.unreadByModule).toEqual({ "job-search": 2, news: 1 });
  // module_id IS NULL stays out of the map but still counts toward the bell.
  expect(result.unreadCount).toBe(4);
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `pnpm vitest run --config vitest.integration.config.ts tests/integration/notifications-unread-by-module.test.ts`
Expected: FAIL — `unreadByModule` is `undefined`.

- [ ] **Step 5: Implement the count**

Add to `packages/notifications/src/repository.ts`, mirroring `countUnread` (:355) exactly — same
left join to `notification_reads`, same `deferred_until` guard — but grouped:

```ts
private async countUnreadByModule(scopedDb: DataContextDb): Promise<Record<string, number>> {
  const rows = await scopedDb.db
    .selectFrom("app.notifications as notifications")
    .leftJoin("app.notification_reads as reads", (join) =>
      join
        .onRef("reads.notification_id", "=", "notifications.id")
        .on("reads.user_id", "=", sql<string>`app.current_actor_user_id()`)
    )
    .select(({ fn }) => [
      "notifications.module_id as module_id",
      fn.count<string>("notifications.id").as("unread_count")
    ])
    .where("reads.notification_id", "is", null)
    // Core notifications have no module to badge; the bell already covers them.
    .where("notifications.module_id", "is not", null)
    .where(
      sql<SqlBool>`(notifications.deferred_until IS NULL OR now() >= notifications.deferred_until)`
    )
    .groupBy("notifications.module_id")
    .execute();

  return Object.fromEntries(rows.map((row) => [row.module_id as string, Number(row.unread_count)]));
}
```

Add it to the `Promise.all` in `listVisible` (:156) and return it. Thread it through
`packages/notifications/src/routes.ts`.

**Add `unreadByModule` to the response schema in `packages/shared/src/notifications-api.ts`, not just
the TypeScript interface.** Fastify's `fast-json-stringify` silently drops any emitted field the
response schema does not declare — a recurring trap in this repo. Declare it as
`{ type: "object", additionalProperties: { type: "integer", minimum: 0 } }` and leave it out of
`required` only if you also default it to `{}` on the client.

- [ ] **Step 6: Implement the manifest field and the render**

Validate `badge` positively in the navigation loop — object, exactly the key `source`, value strictly
`"notifications"` — and add `...(badge !== undefined ? { badge } : {})` to the `validated.push({…})`
literal. In the shell nav, for an entry whose badge source is `notifications`, render
`unreadByModule[moduleId] ?? 0` from the notifications query the shell already runs
(`apps/web/src/shell/app-shell.tsx:227`), reusing `formatUnreadCount` (:386) so 100+ renders as `99+`
exactly like the bell. Render nothing at 0 or while the query is loading. **Never** render a badge
from any module-supplied value.

- [ ] **Step 7: Gate and commit**

```bash
pnpm vitest run tests/unit/external-module-nav-badge.test.ts \
  && pnpm vitest run --config vitest.integration.config.ts tests/integration/notifications-unread-by-module.test.ts \
  && pnpm typecheck
git add packages/notifications/src/repository.ts packages/notifications/src/routes.ts packages/shared/src/notifications-api.ts packages/module-sdk/src/index.ts packages/module-registry/src/external/validate.ts apps/web/src/shell tests/unit/external-module-nav-badge.test.ts tests/integration/notifications-unread-by-module.test.ts
git commit -m "feat(modules): nav count badge from a module's unread notifications"
```

---

### Task 2e: Invocation stall budget, per-lane isolation, and a deadline the module can see

**This is a blocker for Phase 4, not a nice-to-have.** `ExternalModuleWorkerRuntime.run()` caps
every external-module invocation at **30 s of wall clock** (`worker-runtime.ts:88-92`,
`this.options.invocationTimeoutMs ?? 30_000`, and neither construction site overrides it —
`apps/api/src/external-module-tools.ts:38`, `apps/worker/src/worker.ts:211`). That clock keeps
running while the **host** services the module's own RPCs back to it: every `fetch.request`, every
`ai.generateStructured`. A handler that is doing nothing but waiting for the host is charged for
the wait and then killed.

Two consequences, both fatal to the Phase 4 design as written:

- **One pass cannot fit.** Because a worker handler cannot enqueue, crawl → triage → score must run
  in a single invocation (Task 15). That invocation makes up to ten HTTP requests per portal and up
  to eight `ai.generateStructured` calls. A single reasoning-tier structured call routinely takes
  10–30 s on its own. The pass is killed long before it finishes, and it is killed _at a different
  point every time_, because whether it trips depends only on model latency.
- **The failure is invisible.** The tell is an audit row of `failed / handler_error` with **nothing
  in the API log** — `runHandler` in `packages/ai/src/gateway/gateway.ts` swallows handler throws
  with a bare `catch {}`. You confirm it by comparing timestamps: if the audit `occurred_at` is
  _earlier_ than the matching `ai.structured usage` line, the AI finished after the invocation was
  already dead. Do not go looking for a bug in the module; there isn't one.

Two more problems get fixed in the same pass, because all three are the same seam:

- **Every call to a module shares one lane.** `invoke()` serializes on one promise chain per module
  id (`worker-runtime.ts:61-63`). While a six-hourly crawl is running, the user's own chat tool
  calls queue behind it. With the stall budget in place a crawl can legitimately run for minutes, so
  this stops being a curiosity and starts being "the assistant hangs when I ask about my job
  search".
- **Nothing tells the module how long it has.** The invocation envelope built in
  `apps/worker/src/external-module-job-handler.ts` is exactly four fields — `actorUserId`,
  `jobKind`, `idempotencyKey`, `params`. `ModuleWorkerContext` (`packages/module-sdk/src/worker.ts`)
  exposes `input`, `auth`, `fetch`, `kv`, `ai`, `db`, `attachments` and **no deadline and no
  signal**. So a module cannot budget its own time and cannot stop cleanly before the kill. Task
  14's per-portal deadline and Task 15's `CRAWL_SHARE` both depend on a value that does not
  currently exist anywhere in the protocol.
- **And the module could not cancel host work even if it had a signal.** `ModuleFetchRequest`
  (`packages/module-sdk/src/index.ts:682`) and the worker-facing `generateStructured` input
  (`worker.ts:38`) have no signal field, and an `AbortSignal` does not survive JSON-RPC. So when the
  host kills the child, whatever HTTP request or provider call it had asked for keeps running,
  unowned. The deadline the module can see and the cancellation of work the host is holding are two
  different problems, and Step 5 fixes both — the second one host-side.

**Files:**

- Modify: `packages/module-registry/src/external/worker-runtime.ts` — the timeout in `run()`
  (:88-92), the per-module maps in `invoke()`/`run()`/`start()`/`failProcess()`, and the
  `module.invoke` params written to stdin (:100-102)
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` — signal RPC start/finish to
  the runtime so the budget can be suspended, and accept the invocation's host-side `AbortSignal` as
  a fourth handler argument, forwarding it into the pinned fetch call (:134) and into the AI request
- Modify: `packages/module-sdk/src/worker.ts` — read `deadlineAt` off the invoke params and put
  `deadlineAt` (a number, and nothing else) on `ModuleWorkerContext`
- Modify: `apps/worker/src/external-module-job-handler.ts` — pass `lane: "queue"` and the queue's
  declared ceiling
- Modify: `apps/api/src/external-module-tools.ts` — pass `lane: "tool"`
- Modify: `apps/worker/src/external-module-invoke.ts` (the trusted invoker Task 2 Step 8 extracts) —
  it becomes the **only** caller of `runtime.invoke` on the worker, and it forwards the `lane` its
  own caller passed. The job handler passes `"queue"`, the briefing adapter passes `"briefing"`.
- Modify: `packages/module-registry/src/external/validate.ts` — accept, validate, and clamp
  `queues[].timeoutMs` (the validator drops unknown keys, so this is required, not optional)
- Modify: `packages/module-sdk/src/index.ts` — `timeoutMs?: number` on the queue declaration type
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts` (same file, second concern) —
  `ExternalModuleAiRequest` gains an optional host-side `signal`, forwarded into the injected AI
  callback. This is not decoration: `packages/ai`'s `generateStructured` already accepts
  `input.signal` and already returns `"aborted"`, so this one field is the difference between the
  `aborted` error being a documented member of the union and being reachable in production
- Test: `tests/unit/external-module-invocation-budget.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // worker-runtime.ts — replaces the single `invocationTimeoutMs` option.
  export interface ExternalModuleWorkerRuntimeOptions {
    /** Max time the module may go WITHOUT progress. Suspended while a host RPC is in
     *  flight, so host latency is never charged to the module. Default 30_000. */
    readonly invocationStallMs?: number;
    /** Absolute ceiling on one invocation regardless of progress. Default 120_000. */
    readonly invocationHardTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly logger?: { warn(data: Record<string, unknown>, message?: string): void };
  }

  /** A lane is a SEPARATE CHILD PROCESS, not a separate promise chain over a shared one.
   *  See Step 4 — sharing a child across lanes is a cross-actor leak, not a queuing nicety.
   *
   *  THREE lanes, not two. `briefing` exists because Task 2's briefing invoker is a third caller
   *  of `invoke()` and it must not sit behind the queue lane: briefing composition is on a user's
   *  morning path, and a six-hourly crawl in the queue lane can legitimately hold that lane for
   *  minutes. Putting it in `tool` instead would be cheaper by one warm child, but it would let a
   *  slow briefing delay the assistant's own tool calls, which is the exact failure this task was
   *  opened to fix. */
  export type WorkerLane = "queue" | "tool" | "briefing";

  /** `options` is REQUIRED, and `lane` is required within it. There is no default: a
   *  silently-defaulted lane is how a background job ends up in the foreground lane and the
   *  isolation this task buys is quietly given back. */
  invoke(
    module: ExternalModuleDiscovery,
    handler: string,
    input: Record<string, unknown>,
    rpc: Rpc,
    options: { readonly lane: WorkerLane; readonly timeoutMs?: number }
  ): Promise<unknown>;
  ```

  ```ts
  // module-sdk/src/worker.ts — ModuleWorkerContext gains the two forms of the deadline.
  interface ModuleWorkerContext {
    // …existing ports: input, auth, fetch, kv, ai, db, attachments…
    /** Absolute epoch ms after which the host will hard-kill this invocation. This is the
     *  form every stage budget in Phase 4 is written against: compare it to a clock. */
    readonly deadlineAt: number;
    /** There is deliberately NO `ctx.signal`. An earlier revision of this plan added a
     *  worker-local `AbortSignal` derived from `deadlineAt`; it is removed, and adding one
     *  back is a change to this task, not a local convenience.
     *
     *  Reasons, so nobody re-adds it: no module port accepts a signal — `ctx.fetch` takes a
     *  `ModuleFetchRequest` of `{url, method?, headers?, bodyBase64?}`
     *  (`packages/module-sdk/src/index.ts:682`) and `ctx.ai.generateStructured` takes
     *  `{schema, prompt, maxOutputTokens?, tierHint?}` (`worker.ts:38`); an `AbortSignal`
     *  cannot be serialized across JSON-RPC; and a signal that can only cancel the module's
     *  own `await`s, while looking like it cancels the RPC it is passed beside, is a trap.
     *  A module that wants to stop its own loop compares `Date.now()` to `deadlineAt`.
     *  Cancelling work already in the host's hands is the HOST's job (Step 5), through the
     *  per-invocation `AbortController` the host never exposes to the child. */
  }
  ```

  ```jsonc
  // manifest: a queue may raise its own ceiling, bounded by the host.
  { "name": "job-search.crawl-run", "handler": "crawl.run", "timeoutMs": 600000 }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/external-module-invocation-budget.test.ts
import { describe, expect, it, vi } from "vitest";

describe("external module invocation budget", () => {
  it("does not kill an invocation that is blocked on a slow host RPC", async () => {
    // The regression this whole task exists for. The module makes one RPC; the host takes
    // 45s to answer it; the module then returns immediately. Under the old flat 30s
    // wall-clock timer this invocation dies at 30s having done nothing wrong.
    vi.useFakeTimers();
    const runtime = new ExternalModuleWorkerRuntime({
      invocationStallMs: 30_000,
      invocationHardTimeoutMs: 120_000
    });
    const rpc = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
      return { ok: true };
    });
    const result = await runtime.invoke(module, "slow", {}, rpc, { lane: "tool" });
    expect(result).toEqual({ done: true });
  });

  it("kills an invocation that goes quiet for longer than the stall budget", async () => {
    // The budget must still bite. A module stuck in a `while (true)` makes no RPCs, so
    // nothing suspends the clock and it dies on schedule.
    vi.useFakeTimers();
    const runtime = new ExternalModuleWorkerRuntime({ invocationStallMs: 30_000 });
    const call = runtime.invoke(module, "spin", {}, vi.fn(), { lane: "tool" });
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(call).rejects.toThrow(/timeout/);
  });

  it("kills an invocation that exceeds the hard ceiling even while making progress", async () => {
    // Without this, a module that RPCs every 29s runs forever. The stall budget alone is
    // not a bound; it only measures silence.
    vi.useFakeTimers();
    const runtime = new ExternalModuleWorkerRuntime({
      invocationStallMs: 30_000,
      invocationHardTimeoutMs: 120_000
    });
    const rpc = vi.fn(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      return { ok: true };
    });
    const call = runtime.invoke(module, "chatty", {}, rpc, { lane: "tool" });
    await vi.advanceTimersByTimeAsync(130_000);
    await expect(call).rejects.toThrow(/timeout/);
  });

  it("honours a queue's declared ceiling but clamps it to the host maximum", async () => {
    // A manifest is module-authored input. `timeoutMs: 86400000` must not pin a worker
    // process open for a day; the host's own maximum wins.
    const runtime = new ExternalModuleWorkerRuntime({ invocationHardTimeoutMs: 120_000 });
    expect(runtime.resolveHardTimeout({ timeoutMs: 600_000 })).toBe(600_000);
    expect(runtime.resolveHardTimeout({ timeoutMs: 86_400_000 })).toBe(MAX_INVOCATION_MS);
  });

  // --- lane isolation. These three are the point of the lane change; a test that only
  // --- asserts "the fast call returned first" passes against the broken shared-child
  // --- design too, because the bug is whose context the RPCs run under, not the ordering.

  it("runs two lanes of one module in two separate child processes", async () => {
    // Actor A's queue-lane handler issues a data RPC and awaits a host-controlled latch;
    // actor B's tool-lane handler runs to completion meanwhile.
    const runtime = new ExternalModuleWorkerRuntime({});
    const latch = createLatch();
    const queueRpc = vi.fn(async () => {
      await latch.promise;
      return { ok: true };
    });
    const slow = runtime.invoke(module, "crawl.run", {}, queueRpc, { lane: "queue" });
    const fast = await runtime.invoke(module, "profile.list", {}, toolRpc, { lane: "tool" });

    expect(fast).toEqual({ profiles: [] });
    // (a) A's RPC was dispatched under A's context, not B's — this is the leak the shared
    //     `state.current` slot causes, and it is the whole reason a lane is a process.
    expect(queueRpc.mock.calls[0]?.[0]).toMatchObject({ actorUserId: OWNER_A });
    // (c) two distinct child pids.
    expect(runtime.debugPids(module.id)).toHaveLength(2);
    latch.release();
    // (b) A still resolves normally after the latch releases.
    await expect(slow).resolves.toBeDefined();
  });

  it("does not queue a foreground tool call behind a running background job", async () => {
    // Six-hourly crawls now legitimately run for minutes. If the lanes shared a child, the
    // user asking their assistant a question waits for the crawl to finish.
    const runtime = new ExternalModuleWorkerRuntime({});
    const slow = runtime.invoke(module, "crawl.run", {}, neverResolvingRpc, { lane: "queue" });
    const fast = await runtime.invoke(module, "profile.list", {}, quickRpc, { lane: "tool" });
    expect(fast).toEqual({ profiles: [] });
    void slow;
  });

  it("kills only the timing-out lane's child", async () => {
    // A ten-minute crawl hitting its ceiling must not take down the user's in-flight chat
    // tool call. Under one shared child, `stop(state)` kills both.
    vi.useFakeTimers();
    const runtime = new ExternalModuleWorkerRuntime({ invocationHardTimeoutMs: 5_000 });
    const doomed = runtime.invoke(module, "crawl.run", {}, silentRpc, {
      lane: "queue",
      timeoutMs: 5_000
    });
    const survivor = runtime.invoke(module, "profile.list", {}, latchedRpc, { lane: "tool" });
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(doomed).rejects.toThrow(/timeout/);
    releaseLatch();
    await expect(survivor).resolves.toEqual({ profiles: [] });
  });

  // --- deadline transport

  it("ships an absolute deadline in the invoke params, inside the hard ceiling", async () => {
    // Assert on what actually crosses the wire — the JSON written to the child's stdin —
    // not on a runtime getter, because the bug this prevents is the field never being sent.
    const runtime = new ExternalModuleWorkerRuntime({ invocationHardTimeoutMs: 120_000 });
    const written = await captureStdinFrame(runtime, module, "crawl.run", { lane: "queue" });
    expect(written.method).toBe("module.invoke");
    expect(written.params.deadlineAt).toBeGreaterThan(Date.now());
    expect(written.params.deadlineAt).toBeLessThanOrEqual(
      Date.now() + 120_000 - DEADLINE_MARGIN_MS
    );
  });

  it("still kills at the ceiling a handler that ignores its deadline", async () => {
    // The deadline is cooperative. The ceiling is the actual bound, and it stays.
    vi.useFakeTimers();
    const runtime = new ExternalModuleWorkerRuntime({ invocationHardTimeoutMs: 10_000 });
    const call = runtime.invoke(module, "ignores-deadline", {}, silentRpc, { lane: "queue" });
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(call).rejects.toThrow(/timeout/);
  });

  it("defaults deadlineAt when the host does not send one", async () => {
    // SDK-side. An older host omits the field; the child must not compute a deadline of
    // NaN and abort every fetch immediately. This is the only reason the field is optional.
    const ctx = buildWorkerContext({ handler: "x", input: {} }); // no deadlineAt
    expect(ctx.deadlineAt).toBeGreaterThan(Date.now() + 29_000);
    // And the context exposes no signal at all — the sole cancellation surface is the number.
    expect("signal" in (ctx as Record<string, unknown>)).toBe(false);
  });

  // --- manifest validation. The clamp, not the passthrough: unknown queue keys already
  // --- survive validation today (validate.ts spreads `...queue`), so a test asserting
  // --- "timeoutMs survives" is green before a line is written and proves nothing.

  it("rejects a queue whose timeoutMs is not a positive integer", async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, "600000", null]) {
      const result = validateExternalModuleManifest(manifestWithQueueTimeout(bad));
      expect(result.ok, `timeoutMs: ${String(bad)} was accepted`).toBe(false);
    }
  });

  it("clamps a timeoutMs above the platform ceiling on the normalized output", async () => {
    // Mirrors the existing retryLimit clamp in validate.ts. Assert on the RETURNED manifest:
    // validate.ts reassembles `worker` from its normalized queue array, so the clamped value
    // is what every caller sees.
    const result = validateExternalModuleManifest(manifestWithQueueTimeout(86_400_000));
    expect(result.ok).toBe(true);
    expect(result.manifest?.worker?.queues?.[0]?.timeoutMs).toBe(MAX_INVOCATION_MS);
  });

  it("passes the queue's normalized timeoutMs into runtime.invoke", async () => {
    // The end of the chain. A validated, clamped ceiling that the job handler never reads
    // is the same as no ceiling at all.
    const invoke = vi.fn(async () => ({}));
    await createExternalModuleJobHandler({ ...deps, runtime: { invoke } })(job);
    expect(invoke.mock.calls[0]?.[4]).toEqual({ lane: "queue", timeoutMs: 600_000 });
  });

  it("invokes with the default ceiling when a queue declares no timeoutMs", async () => {
    const invoke = vi.fn(async () => ({}));
    await createExternalModuleJobHandler({
      ...deps,
      queue: queueWithoutTimeout,
      runtime: { invoke }
    })(job);
    expect(invoke.mock.calls[0]?.[4]).toEqual({ lane: "queue" });
  });

  // --- the third caller. Task 2's briefing invoker is production wiring, and a lane it never
  // passes is a lane it silently defaults — which the signature above is specifically designed to
  // make impossible. Assert it through the REAL adapter, not a hand-built options object: an
  // assertion on a literal proves only that the literal was typed correctly.
  it("invokes a briefing contribution on the briefing lane", async () => {
    const invoke = vi.fn(async () => briefingPayload);
    const invokeBriefing = createBriefingInvokerForTest({ ...deps, runtime: { invoke } });
    await invokeBriefing({
      moduleId: module.id,
      handler: "briefing.morning",
      actorUserId: ACTOR,
      requestId: "req-1",
      section: "morning"
    });
    expect(invoke.mock.calls[0]?.[4]).toEqual({ lane: "briefing" });
    // …and never the queue lane, where a running crawl would hold it.
    expect(invoke.mock.calls[0]?.[4]).not.toMatchObject({ lane: "queue" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/external-module-invocation-budget.test.ts`
Expected: FAIL — `invocationStallMs` is not an option, `resolveHardTimeout` does not exist, `invoke`
takes no required `options`, and nothing writes `deadlineAt`.

- [ ] **Step 3: Implement the stall budget**

Replace the single `setTimeout` in `run()` with two timers and a suspend/resume pair the RPC host
calls around every host-serviced request:

```ts
/** Ceiling on any queue's declared `timeoutMs`. A manifest is module-authored input, so the
 * host's maximum wins over whatever it asks for. Ten minutes is chosen to fit the worst
 * realistic job-search pass — two portals at ten pages each, then eight structured calls —
 * with room to spare, and to still be short enough that a wedged worker is noticed the same
 * afternoon rather than the next morning. */
export const MAX_INVOCATION_MS = 600_000;

/** The stall budget measures SILENCE, not duration. It is cleared when the module asks the host
 * for something and restarted when the host answers, because time spent waiting on the host is
 * the host's fault, not the module's. The hard ceiling is the actual bound and is never
 * suspended — without it, a module that pings the host every 29 seconds runs forever. */
```

Suspension must be **reference-counted**, not a boolean: a handler may have a `fetch` and an
`ai.generateStructured` in flight at once, and a boolean lets the first one to finish restart the
clock while the second is still blocked.

- [ ] **Step 4: Give each lane its own child process**

**A lane is a separate child process.** This is the ruling; the rest of the step is mechanical.

The runtime today keeps **one process per module id** and **one in-flight invocation per process**:
`states` is `Map<string, ProcessState>` keyed by `module.id` (:43, :85, :143), and
`ProcessState.current` is a single `Invocation` slot (:31) set at :95 and cleared in `finally` at
:107. Every child→host RPC is dispatched through that slot — `const invocation = state.current`
(:183), then `invocation.rpc(...)` with `invocation.secrets` (:194-195).

So splitting **only** the serialization map (the `queues` map at :44, :61-66) while both lanes share
one child is not a smaller version of this change — it is a security bug:

- Lane B's `state.current = invocation` (:95) overwrites lane A's while A is still running. Every
  RPC A issues afterwards executes under **B's** `rpc` closure — B's actor, B's data context, B's
  secret set. That is a cross-actor leak inside one module, and it defeats the `containsSecret`
  redaction (:188, :212), because A's secrets are no longer the set being checked.
- Whichever lane finishes first clears the slot (`state.current = undefined`, :107), so the other
  lane's next RPC hits `if (!invocation)` at :184 and **kills the process** as a protocol violation.
- `capture` (:219) and `flushLogs` (:224) attribute stdout and stderr to whatever occupies the slot,
  so logs cross lanes too.
- The invocation timeout (:88-92) `stop()`s the whole child, so a ten-minute crawl lane timing out
  kills the user's in-flight chat tool call, and vice versa.

Every map and lifecycle hook keyed by `module.id` becomes keyed by a composite lane key:

```ts
export type WorkerLane = "queue" | "tool";

// key for both `states` and `queues`
const laneKey = (moduleId: string, lane: WorkerLane) => `${moduleId}:${lane}`;
```

The exact call sites, so this does not have to be re-derived — they are all in
`worker-runtime.ts`:

| Line (current) | Today                                                  | Must become                                        |
| -------------- | ------------------------------------------------------ | -------------------------------------------------- |
| :61-66         | `this.queues.get/set/delete(module.id)`                | `laneKey(module.id, lane)`                         |
| :85            | `this.states.get(module.id) ?? this.start(module)`     | `this.states.get(key) ?? this.start(module, lane)` |
| :90            | `this.states.delete(module.id)` (timeout)              | `this.states.delete(key)`                          |
| :106           | `this.flushLogs(module.id, invocation)`                | log the lane alongside `moduleId`                  |
| :108-113       | idle timer re-arm / `states.delete(module.id)`         | keyed by `key`                                     |
| :143           | `this.states.set(module.id, state)`                    | `this.states.set(key, state)`                      |
| :146-153       | `onStdout(module.id, …)` / `failProcess(module.id, …)` | pass `key`; keep `moduleId` separately for logging |
| :240           | `if (this.states.get(moduleId) === state)`             | `if (this.states.get(key) === state)`              |

`invoke()` takes the lane explicitly — **no inference from the handler name and no default.** There
are **three** callers, not two — Task 2 added the third — and all three change in this same commit or
one of them silently lands in the wrong lane:

- `apps/worker/src/external-module-invoke.ts` — Task 2's trusted invoker, which by then owns both
  worker-side call sites. It takes `lane` as a required argument and forwards it; it never defaults
  one. Its two callers supply it: the job handler passes `"queue"`, the briefing adapter passes
  `"briefing"`.
- `apps/worker/src/external-module-job-handler.ts` passes `lane: "queue"` plus the queue's declared
  (validated, clamped) `timeoutMs`.
- `apps/api/src/external-module-tools.ts` — the assistant-tool gateway path — passes `lane: "tool"`
  and leaves `timeoutMs` unset, so a user waiting on a chat response keeps the short default rather
  than inheriting a ten-minute ceiling.

**The cost, stated so nobody is surprised by it:** up to **two child processes per module** while
both lanes are warm, each released by the existing 60 s idle timer (:112). That is bounded, and it
is the price of real isolation. Keep the per-lane serialization — one in-flight invocation per lane
— so N concurrent jobs still cannot spawn N processes.

The alternative was considered and rejected: tagging each RPC with an invocation id and
multiplexing inside the child would need a protocol version bump in `@jarv1s/module-sdk` and
concurrency inside `defineModuleWorker`, and it _still_ leaves one crashed lane taking down the
other. Process-per-lane is the smaller change and isolates memory and crashes as well as context.

- [ ] **Step 5: Ship the deadline to the module**

The host computes an **absolute deadline** and ships it in the invoke params. Host and child are the
same machine — the child is spawned by the host process (`worker-runtime.ts:124`) — so epoch
milliseconds are directly comparable on both sides. Do not propose a relative duration: it starts
drifting the moment the child is slow to read stdin.

Runtime side, in `run()`, alongside the hard-ceiling timer:

```ts
/** The module gets a deadline strictly inside the hard kill, so it can persist partial results
 * and return cleanly instead of being SIGKILLed mid-write. */
const DEADLINE_MARGIN_MS = 5_000;
const ceilingMs = this.resolveHardTimeout(options);
const deadlineAt = Date.now() + Math.max(1_000, ceilingMs - DEADLINE_MARGIN_MS);

state.child.stdin.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "module.invoke",
    params: { handler, input, deadlineAt }
  })}\n`
);
```

SDK side, `defineModuleWorker` reads `deadlineAt` off the invoke params and puts **that number, and
only that number**, on the context:

```ts
const deadlineAt =
  typeof params.deadlineAt === "number" && Number.isFinite(params.deadlineAt)
    ? params.deadlineAt
    : Date.now() + 30_000; // older host: keep existing modules working
// Put `deadlineAt` on the context. Do NOT also derive an `AbortSignal` from it here: a
// worker-local signal aborts only this process's own awaits, cannot reach a fetch or an AI
// generation already running inside the host, and cannot be passed to any module-facing port
// (none accept one). Adding it back invites callers to believe cancellation they do not have.
```

That default is the **only** reason `deadlineAt` is not a mandatory protocol field. Say so in the
code comment, so it is not later "cleaned up" into a required field that breaks version skew.

**The host half — without this, cancellation is a comment, not a behaviour.** The worker's signal
stops nothing that matters: every expensive thing a module does (`ctx.fetch`, `ctx.ai`) is an RPC
the **host** executes on its behalf, `ModuleFetchRequest` has no signal field
(`packages/module-sdk/src/index.ts:682`), `generateStructured`'s worker-facing input has none
(`packages/module-sdk/src/worker.ts:38`), and an `AbortSignal` cannot be JSON-serialized regardless.
So at the ceiling the child is killed while its outbound HTTP request and its provider call keep
running to completion, unattended. Fix that at the source of truth:

1. `run()` creates one `AbortController` per invocation and aborts it when the hard-ceiling timer
   fires, immediately before killing the child.
2. The RPC callback gains that signal as a fourth argument — it is host-side state and never
   crosses the wire:

   ```ts
   // worker-rpc-host.ts — the returned handler already takes (method, params, rememberSecret).
   (method: string, params: unknown, rememberSecret: (v: string) => void, hostSignal?: AbortSignal)
   ```

3. `fetch.request` passes it straight through — the call site already builds the request options:
   `(input.createFetch ?? createHostPinnedFetch)(hosts)(request.url, { …, signal: hostSignal })`
   (`worker-rpc-host.ts:134`).
4. `ExternalModuleAiRequest` gains an optional `signal`, host-side only, forwarded into
   `generateStructured` — which already accepts `input.signal` and already returns
   `{ok: false, error: "aborted"}` for it (`packages/ai/src/structured/generate-structured.ts:130`
   and `:156`). This is what makes the `aborted` member of the worker-facing error union
   **reachable at all**; today nothing in this tree can produce it for an external module.

Both construction sites are in-repo and pass nothing new
(`apps/worker/src/external-module-job-handler.ts:67`, `apps/api/src/external-module-tools.ts:44`) —
the signal is supplied by the runtime at `invoke`, not by the caller, so neither call site changes.

Add two tests to Step 1's list, and they must be **wire-level**, not fake-timer assertions about
intent:

```
- at the hard ceiling, an in-flight fetch.request rejects/aborts rather than resolving after the
  child is killed (assert against a real deferred HTTP handler, not a spy)
- at the hard ceiling, an in-flight ai RPC resolves { ok: false, error: "aborted" }
```

Downstream consumers, named here so the tasks that depend on this do not each invent their own
transport. **No module-facing port takes a signal** — the deadline crosses the wire as a number and
nothing else:

- `Portal.crawl(input: { …, deadlineAt: number })` (Task 11). No `signal` parameter.
- Every portal implementation checks `Date.now() >= deadlineAt` **before each page fetch** and
  returns what it already has. That cooperative check is the module's whole share of cancellation.
- Task 15's `runProfileStages` computes the crawl's share from the time **remaining in the
  invocation**, not from a fixed origin: `crawlDeadlineAt = now + (ctx.deadlineAt - now) *
CRAWL_SHARE`, evaluated when that profile's crawl starts. In a sweep the second profile's `now`
  is later than the first's, so it gets a share of what is actually left rather than a slice of a
  window that has already been spent.
- `runCrawl` (Task 14) then narrows that further per portal — an equal share of the crawl time
  still remaining, recomputed for each portal, so an early finisher donates its slack.
- The scoring stage (Task 15) checks `clock() < deadlineAt` before each `generateStructured` call
  and halts with `"deadline"` when it passes. It passes no signal, because the port has no
  parameter for one; the `aborted` branch of its switch is reachable because the **host** aborts
  the in-flight call at the ceiling (point 4 above), not because the module asked it to.

- [ ] **Step 6: Validate and clamp `queues[].timeoutMs`**

`validate.ts` normalizes queues by spreading the whole queue object
(`normalizedQueues.push({ ...queue, ...retryLimit clamp })`), so an unknown `timeoutMs` **already
survives validation today** — which is why the test list above asserts rejection and clamping, not
passthrough. Add, mirroring the existing `retryLimit` clamp:

- reject a `timeoutMs` that is not a positive integer (`0`, negative, fractional, `NaN`, a string,
  `null`);
- clamp anything above `MAX_INVOCATION_MS` down to it.

Confirmed while writing this plan: the validator returns `worker` reassembled from
`normalizedQueues`, so the clamped value is what every caller receives. No second fix is needed
there.

- [ ] **Step 7: Run the tests and the full typecheck**

```bash
pnpm vitest run tests/unit/external-module-invocation-budget.test.ts && pnpm typecheck
```

Expected: PASS. `pnpm typecheck` is not optional here — making `options` a required argument on
`invoke()` is a breaking signature change, and typecheck is the only thing that finds every caller,
including external modules.

- [ ] **Step 8: Commit**

```bash
git add packages/module-registry/src/external/worker-runtime.ts \
        packages/module-registry/src/external/worker-rpc-host.ts \
        packages/module-registry/src/external/validate.ts \
        packages/module-sdk/src/index.ts \
        packages/module-sdk/src/worker.ts \
        apps/api/src/external-module-tools.ts \
        apps/worker/src/external-module-job-handler.ts \
        tests/unit/external-module-invocation-budget.test.ts
git commit -m "fix(modules): stall budget, per-lane worker processes, and an invocation deadline"
```

**User-facing summary:** Long-running module background jobs no longer fail part-way through for no
visible reason, a background job no longer blocks the assistant from answering questions about the
same module, and a job that runs out of time now saves what it found instead of being cut off
mid-write.

---

## Phase 1 — Module scaffold

### Task 3: Scaffold `external-modules/job-search`

**Files:**

- Create: `external-modules/job-search/package.json`, `tsconfig.json`, `jarvis.module.json`,
  `src/module-info.ts`, `src/db/tables.ts`
- Modify: `package.json` (root) — `check:external-modules` currently reads
  `tsc -p external-modules/finance --noEmit` and typechecks finance **only**. Extend it.
- Test: `tests/unit/job-search-manifest.test.ts`

**Interfaces:**

- Produces: the manifest that every later task registers into, and

  ```ts
  // external-modules/job-search/src/module-info.ts
  export const MODULE_ID = "job-search";
  ```

- Produces:

  ```ts
  // external-modules/job-search/src/db/tables.ts
  /** The owned-table list, in TypeScript, for everything that can import TypeScript: Task 4's
   * install test, Task 13's store, Task 21's RLS loop. A list retyped in a test is a list that
   * drifts, and an RLS test naming a table the migration never creates passes by finding nothing
   * wrong with nothing.
   *
   * It is NOT the source of truth for the manifest, and no comment here should claim it is.
   * `jarvis.module.json` is JSON — it cannot import a constant, and the shipped finance manifest
   * likewise carries a literal array (`external-modules/finance/jarvis.module.json:42`). The
   * literal in the manifest and this array are two independent copies; the equality assertion in
   * this task's manifest test is the ONLY thing that stops them drifting, which is why that test
   * lives here, with the manifest, rather than in the task that first consumes the constant. */
  export const JOB_SEARCH_TABLES = [
    "job_search_profiles",
    "job_search_portals",
    "job_search_postings",
    "job_search_matches",
    "job_search_resumes"
  ] as const;
  ```

  It is created here, with the manifest, because the test that binds the two lives here and a
  constant introduced after its first consumer is a task-ordering defect.

- [ ] **Step 1: Write the failing manifest test**

Assert **through the validator**, not against the raw JSON. `validateExternalModuleManifest()`
reconstructs the manifest from an explicit field allowlist and silently discards anything it does
not know, so a test that reads the JSON file directly will pass for a manifest the loader would
strip to pieces.

```ts
// tests/unit/job-search-manifest.test.ts
import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";

import { JOB_SEARCH_TABLES } from "../../external-modules/job-search/src/db/tables";
import raw from "../../external-modules/job-search/jarvis.module.json";

const validated = () => {
  const res = validateExternalModuleManifest(raw);
  if (!res.ok) throw new Error(`manifest invalid: ${JSON.stringify(res.errors)}`);
  return res.manifest;
};

describe("job-search manifest", () => {
  it("validates against the real loader", () => {
    expect(validateExternalModuleManifest(raw).ok).toBe(true);
  });

  it("declares only hosts that serve public postings", () => {
    expect(validated().fetchHosts).toEqual(["www.linkedin.com", "freehire.me"]);
  });

  it("owns exactly the tables JOB_SEARCH_TABLES names, in the same order", () => {
    // THE seam. The JSON literal and the TS constant are two copies of one list and nothing in
    // the toolchain relates them — a table added to one and forgotten in the other produces a
    // module that installs happily and then has an unprotected or a non-existent table. This
    // assertion is what makes them one list, so it is deliberately an exact deep equality
    // including order, not a set comparison.
    expect(validated().database?.ownedTables).toEqual(JOB_SEARCH_TABLES.map((t) => `app.${t}`));
  });

  it("names five tables", () => {
    // Pinned separately: if someone "fixes" the assertion above by editing both lists at once,
    // this still fails and forces the spec conversation.
    expect(JOB_SEARCH_TABLES).toHaveLength(5);
  });

  it("survives reconstruction with its briefing block and nav badge intact", () => {
    const m = validated();
    expect(m.briefing).toEqual({
      handler: "briefing.contribute",
      sections: ["morning", "evening"],
      toolName: "job-search.briefing"
    });
    expect(m.navigation?.[0]?.badge).toEqual({ source: "notifications" });
  });

  it("keeps the briefing handler out of the chat tool registry", () => {
    // A briefing handler is a WORKER handler, not an assistantTools entry — that is what
    // keeps it invisible to chat. There is no worker.handlers list to check against
    // (the validator never enumerates handlers), so assert the negative directly:
    // no assistant tool and no queue routes to it.
    const m = validated();
    for (const tool of m.assistantTools ?? []) expect(tool.handler).not.toBe("briefing.contribute");
    for (const q of m.worker?.queues ?? []) expect(q.handler).not.toBe("briefing.contribute");
  });

  it("never exposes a blended score through a tool schema", () => {
    const json = JSON.stringify(validated());
    for (const banned of ["overall", "combinedScore", "totalScore", "matchScore"]) {
      expect(json).not.toContain(banned);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-manifest.test.ts`
Expected: FAIL — manifest file not found.

- [ ] **Step 3: Write the five scaffold files**

`external-modules/job-search/package.json`:

```json
{
  "name": "job-search",
  "private": true,
  "version": "0.1.0",
  "description": "Jarvis Job Search downloaded module. Prebuilt artifact package: jarvis.module.json + dist/worker.js + dist/web/index.js."
}
```

`external-modules/job-search/tsconfig.json` — copy `external-modules/finance/tsconfig.json`
verbatim. It already carries `jsx: "react"`, `jsxFactory: "h"`, and the
`@jarv1s/module-sdk/worker` path alias. Do not diverge from it.

`external-modules/job-search/src/module-info.ts`:

```ts
/** The scaffold needs at least one file under src/: the shared tsconfig has
 * `"include": ["src"]`, and tsc exits non-zero with TS18003 ("No inputs were found")
 * on an empty include — so an empty scaffold would break `pnpm typecheck` at Step 5. */
export const MODULE_ID = "job-search";
```

`external-modules/job-search/jarvis.module.json`:

```json
{
  "schemaVersion": 1,
  "id": "job-search",
  "name": "Job Search",
  "version": "0.1.0",
  "publisher": "Jarvis Project",
  "lifecycle": "optional",
  "compatibility": { "jarv1s": ">=0.1.0" },
  "description": "Finds job postings on public boards and reads each one against what you can do and what you actually want.",
  "auth": [],
  "storage": [
    { "namespace": "job-search.settings", "scopes": ["user"] },
    { "namespace": "job-search.meta", "scopes": ["user"] }
  ],
  "database": {
    "ownedTables": [
      "app.job_search_profiles",
      "app.job_search_portals",
      "app.job_search_postings",
      "app.job_search_matches",
      "app.job_search_resumes"
    ]
  },
  "runtime": { "workerEntrypoint": "dist/worker.js", "workerContractVersion": 1 },
  "fetchHosts": ["www.linkedin.com", "freehire.me"],
  "assistantTools": [],
  "worker": { "queues": [], "schedules": [], "reconcileJobs": [] },
  "briefing": {
    "handler": "briefing.contribute",
    "sections": ["morning", "evening"],
    "toolName": "job-search.briefing"
  },
  "web": { "entrypoint": "dist/web/index.js", "contractVersion": 1 },
  "navigation": [
    {
      "id": "job-search",
      "label": "Job Search",
      "path": "/",
      "icon": "compass",
      "badge": { "source": "notifications" }
    }
  ]
}
```

`auth` is empty on purpose: v1 uses no portal credentials, because it never signs in anywhere.
`assistantTools`, `queues`, and `schedules` fill in during Phases 4 and 5 — the manifest test above
tolerates that, because the badge and briefing assertions do not depend on them.

**Queue `paramsSchema` is not JSON Schema.** When Task 13 adds queues, use the platform's own DSL —
`{"type":"object","fields":{"profileId":{"type":"identifier"}}}` — the shape
`isValidModuleParamsSchema` accepts (see the `finance.categorize-apply` queue for a worked example).
`assistantTools[].inputSchema` _is_ JSON Schema. The two are different languages in the same file.

> The `icon: "compass"` value is a **Lucide icon name**, not the retired product name.
>
> Verify it properly, in two steps — the grep is a _locator_, not a verification.
> `rg "landmark" apps/web/src --files-with-matches` only tells you which file holds the nav's icon
> map, because `landmark` is a name already in it. It says nothing about `compass`. Open that file
> and check how icons are resolved: if it is an explicit map, `compass` must be **added to the map**
> or the nav renders nothing; if it re-exports `lucide-react` wholesale, confirm the export exists
> (`rg "^export .*\bCompass\b" node_modules/lucide-react/dist/lucide-react.d.ts`). Fall back to
> `briefcase` only if neither route works — and a silently missing icon is the failure mode here,
> so do not skip this.

- [ ] **Step 4: Extend the external-module typecheck**

Root `package.json`:

```json
"check:external-modules": "tsc -p external-modules/finance --noEmit && tsc -p external-modules/job-search --noEmit"
```

`pnpm typecheck` is the only gate that covers external modules — nothing else compiles them.

- [ ] **Step 5: Run the test and the gate**

```bash
pnpm vitest run tests/unit/job-search-manifest.test.ts && pnpm check:external-modules
```

Expected: test PASS; typecheck PASS. `src/module-info.ts` is what makes the second command pass —
without a file under `src/`, tsc fails with TS18003 rather than compiling nothing.

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search package.json tests/unit/job-search-manifest.test.ts
git commit -m "feat(job-search): scaffold the job search external module"
```

---

### Task 4: Database schema

**Four platform rules govern this task. Violating any of them produces a module that installs and
then fails at runtime, or worse, installs and leaks.** All four are verified, not assumed:

1. **The RLS scoping column is always `owner_user_id`.** `packages/db/src/module-rls-emitter.ts`
   hardcodes `owner_user_id = app.current_actor_user_id()`. A table named `user_id` installs, and
   then every generated policy references a column that does not exist.
2. **The module authors no RLS, no policies, and no grants.** `installModule()` Phase B generates
   all of it from `manifest.database.ownedTables`. Writing them by hand is not "belt and braces" —
   it collides with the generated objects.
3. **One statement per file.** `packages/db/src/migrations/module-sql-runner.ts:41` allows exactly
   one statement whose first command is `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `ALTER TABLE`,
   `DROP INDEX`, or `COMMENT ON`. Inline constraints inside a `CREATE TABLE` are one statement and
   are fine; a trailing `ALTER TABLE` in the same file is not.
4. **A foreign key is not an RLS boundary.** The generated predicate is
   `owner_user_id = app.current_actor_user_id()` on each table's own column, and FK checks run as
   the table owner without RLS filtering. So a child row carrying the _actor's_ `owner_user_id`
   while pointing at _another user's_ parent passes every policy. Every parent reference in this
   schema is therefore a composite `(owner_user_id, parent_id)` FK against a redundant
   `UNIQUE (owner_user_id, id)` on the parent — never a bare `parent_id REFERENCES …(id)`.

Module SQL is applied by `installModule()` and recorded in `app.module_schema_migrations`. It is
**not** run by `pnpm db:migrate` and it never appears in the core migration catalog, so
`tests/integration/foundation.test.ts` needs no change — do not touch it.

`vector(768)` is safe to use: `infra/postgres/bootstrap/0001_extensions.sql` installs pgvector as
superuser before any migration runs, so the type exists for every role.

**Files:**

- Create: `external-modules/job-search/sql/0001_create_job_search_profiles.sql`
- Create: `external-modules/job-search/sql/0002_create_job_search_portals.sql`
- Create: `external-modules/job-search/sql/0003_create_job_search_postings.sql`
- Create: `external-modules/job-search/sql/0004_create_job_search_matches.sql`
- Create: `external-modules/job-search/sql/0005_create_job_search_resumes.sql`
- Create: `external-modules/job-search/sql/0006_index_job_search_matches_board.sql`
- Create: `external-modules/job-search/sql/0007_index_job_search_postings_profile.sql`
- Test: `tests/integration/job-search-tables-install.test.ts`

**Interfaces:**

- Consumes: `JOB_SEARCH_TABLES` from `external-modules/job-search/src/db/tables.ts` — created in
  Task 3 alongside the manifest, and already pinned to the manifest's literal by Task 3's equality
  test. Do not redeclare it here.
- Produces: the five tables `JOB_SEARCH_TABLES` names, all scoped by `owner_user_id`. Each
  migration file must create the table whose bare name appears in that array — the constant does
  not generate DDL, and a table created under a different name would satisfy the manifest test and
  fail at install.

- [ ] **Step 1: Read the finance SQL and its install test**

Read `external-modules/finance/sql/0001_create_finance_items.sql` (the table shape and the header
comment that says the platform generates RLS) and `external-modules/finance/sql/0003_index_finance_accounts_item.sql`
(an index migration is a bare `CREATE INDEX`, nothing else). Then read
`tests/integration/finance-tables-install.test.ts` in full — this task's test is that file with the
identifiers changed, including its `afterEach` REVOKE-before-DROP-CASCADE teardown ordering.

- [ ] **Step 2: Write the failing integration test**

```ts
// tests/integration/job-search-tables-install.test.ts
// Proves the REAL external-modules/job-search/sql directory installs through the
// installModule pipeline — DDL, platform-generated FORCE RLS, and the migration
// ledger — and that one owner cannot see another's rows. Mirrors
// tests/integration/finance-tables-install.test.ts, including its teardown ordering.
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { getJarvisDatabaseUrls } from "../../packages/db/src/urls.js";
import { installModule } from "../../scripts/module-install.js";
import { resetEmptyFoundationDatabase } from "./test-database.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "job-search";
// The canonical list from Task 3's `src/db/tables.ts`, imported everywhere TypeScript can
// import it: this test, Task 13's store, Task 21's RLS loop. The manifest carries its own JSON
// literal and cannot import this — Task 3's equality test is what keeps the two identical.
import { JOB_SEARCH_TABLES } from "../../external-modules/job-search/src/db/tables";

const ownedTables = JOB_SEARCH_TABLES.map((t) => `app.${t}`);
const bare = (t: string) => t.replace(/^app\./, "");

const install = () =>
  installModule({
    moduleId,
    manifest: { database: { ownedTables } },
    bootstrapConnectionString: urls.bootstrap,
    migrationConnectionString: urls.migration,
    migrationsDirectory: "external-modules/job-search/sql"
  });

beforeAll(async () => {
  await resetEmptyFoundationDatabase();
});

afterEach(async () => {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  for (const table of ownedTables) await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  // CASCADE required: Phase B re-grants onward from the install role's WITH GRANT OPTION,
  // so revoking without CASCADE leaves a dependent grant and blocks DROP ROLE.
  await client.query(
    "REVOKE ALL PRIVILEGES ON SCHEMA app FROM jarvis_mod_job_search_install CASCADE"
  );
  await client.query("REVOKE ALL PRIVILEGES ON app.users FROM jarvis_mod_job_search_install");
  await client.query(
    "REVOKE EXECUTE ON FUNCTION app.current_actor_user_id() FROM jarvis_mod_job_search_install CASCADE"
  );
  await client.query("DROP ROLE IF EXISTS jarvis_mod_job_search_install");
  await client.query("DROP ROLE IF EXISTS jarvis_mod_job_search_runtime");
  await client.query("DELETE FROM app.module_installs WHERE module_id = $1", [moduleId]);
  await client.query("DELETE FROM app.module_schema_migrations WHERE module_id = $1", [moduleId]);
  await client.end();
});

describe("job-search module table install", () => {
  it("installs every migration with platform-generated FORCE RLS, idempotently", async () => {
    const result = await install();
    expect(result.installed).toHaveLength(7);

    const client = new Client({ connectionString: urls.bootstrap });
    await client.connect();

    const forceRls = await client.query(
      "SELECT relname FROM pg_class WHERE relname LIKE 'job_search_%' AND relforcerowsecurity"
    );
    expect(forceRls.rows.map((r) => r.relname).sort()).toEqual(ownedTables.map(bare).sort());

    const ledger = await client.query(
      "SELECT version FROM app.module_schema_migrations WHERE module_id = $1",
      [moduleId]
    );
    expect(ledger.rows).toHaveLength(7);
    await client.end();

    expect((await install()).installed).toHaveLength(0);
  });

  it("stores and returns a 768-dimension posting embedding", async () => {
    await install();
    const owner = await seedUser();
    // profile_id is NOT NULL REFERENCES app.job_search_profiles — a posting cannot exist
    // without a parent profile, so seed one first or the insert dies on the FK, not on RLS.
    const profile = await seedProfile(owner);
    await asRuntime(owner, async (client) => {
      await client.query(
        `INSERT INTO app.job_search_postings
           (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body, embedding)
         VALUES ($1,$2,'freehire','ext-1','Staff Engineer','Acme','Remote','https://x/1','body',$3)`,
        [owner, profile, `[${Array.from({ length: 768 }, () => 0.01).join(",")}]`]
      );
      const read = await client.query(
        "SELECT vector_dims(embedding) AS dims FROM app.job_search_postings WHERE external_id = 'ext-1'"
      );
      expect(read.rows[0].dims).toBe(768);
    });
  });

  it("hides another owner's profile completely", async () => {
    await install();
    const [a, b] = [await seedUser(), await seedUser()];
    await asRuntime(a, (c) =>
      c.query(
        "INSERT INTO app.job_search_profiles (owner_user_id, name, state) VALUES ($1,'Mine','active')",
        [a]
      )
    );
    await asRuntime(b, async (c) => {
      const rows = await c.query("SELECT id FROM app.job_search_profiles");
      // Not "b sees no rows of its own" — b must not see A's row at all, admin or not.
      expect(rows.rows).toHaveLength(0);
    });
  });

  it("refuses an insert that claims another owner", async () => {
    await install();
    const [a, b] = [await seedUser(), await seedUser()];
    await expect(
      asRuntime(b, (c) =>
        c.query(
          "INSERT INTO app.job_search_profiles (owner_user_id, name, state) VALUES ($1,'Spoof','active')",
          [a]
        )
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("refuses a child row that points at another owner's parent", async () => {
    // The case RLS cannot catch on its own. Every generated policy checks the row's OWN
    // owner_user_id (`packages/db/src/module-rls-emitter.ts:46`), so B inserting a B-owned
    // posting is legal as far as RLS is concerned — it is the owner-bound composite FK that
    // has to notice the parent belongs to A. Foreign-key checks run as the table owner and
    // are not filtered by RLS, so the constraint sees A's row and rejects the reference.
    await install();
    const [a, b] = [await seedUser(), await seedUser()];
    const profileA = await seedProfile(a);
    const profileB = await seedProfile(b);
    await expect(
      asRuntime(b, (c) =>
        c.query(
          `INSERT INTO app.job_search_postings
             (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body)
           VALUES ($1,$2,'freehire','x','T','C','L','https://x/1','body')`,
          [b, profileA]
        )
      )
    ).rejects.toThrow(/foreign key/i);

    // Same axis, every remaining child: portals, résumés, and both of a match's two parents.
    await expect(
      asRuntime(b, (c) =>
        c.query(
          "INSERT INTO app.job_search_portals (owner_user_id, profile_id, source_id) VALUES ($1,$2,'freehire')",
          [b, profileA]
        )
      )
    ).rejects.toThrow(/foreign key/i);
    await expect(
      asRuntime(b, (c) =>
        c.query(
          "INSERT INTO app.job_search_resumes (owner_user_id, profile_id, version, content) VALUES ($1,$2,1,'x')",
          [b, profileA]
        )
      )
    ).rejects.toThrow(/foreign key/i);

    // A match is the row that joins two parents, so it is checked against both. Give B a
    // legitimate posting of its own first, then try to hang it off A's profile.
    const postingB = await asRuntime(b, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO app.job_search_postings
           (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body)
         VALUES ($1,$2,'freehire','own','T','C','L','https://x/2','body') RETURNING id`,
        [b, profileB]
      );
      return rows[0].id as string;
    });
    await expect(
      asRuntime(b, (c) =>
        c.query(
          `INSERT INTO app.job_search_matches (owner_user_id, profile_id, posting_id, state)
           VALUES ($1,$2,$3,'unscored')`,
          [b, profileA, postingB]
        )
      )
    ).rejects.toThrow(/foreign key/i);

    // And the mirror: B's own profile, A's posting. Both FKs have to be present for this to
    // fail; a schema that bound only profile_id would let this one through.
    const postingA = await asRuntime(a, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO app.job_search_postings
           (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body)
         VALUES ($1,$2,'freehire','a-own','T','C','L','https://x/3','body') RETURNING id`,
        [a, profileA]
      );
      return rows[0].id as string;
    });
    await expect(
      asRuntime(b, (c) =>
        c.query(
          `INSERT INTO app.job_search_matches (owner_user_id, profile_id, posting_id, state)
           VALUES ($1,$2,$3,'unscored')`,
          [b, profileB, postingA]
        )
      )
    ).rejects.toThrow(/foreign key/i);
  });

  it("rejects a fit score outside 0..100", async () => {
    await install();
    const owner = await seedUser();
    await expect(insertMatch(owner, { fit: 101, want: 50 })).rejects.toThrow(/check constraint/i);
  });

  it("defaults briefing detail to count and rejects a value outside the union", async () => {
    await install();
    const owner = await seedUser();
    const profileId = await seedProfile(owner);
    const detail = await asRuntime(owner, async (c) => {
      const { rows } = await c.query(
        "SELECT briefing_detail FROM app.job_search_profiles WHERE id = $1",
        [profileId]
      );
      return rows[0].briefing_detail as string;
    });
    // The quiet default matters: a profile the user never opened settings for still
    // contributes a one-line count to the briefing rather than vanishing from it.
    expect(detail).toBe("count");
    // Separate transaction on purpose — a constraint violation aborts the one it happens in,
    // so any assertion after it inside the same `asRuntime` block would fail with
    // `current transaction is aborted` instead of the thing it meant to check.
    // The constraint is the enforcement point for the union. Task 16's tool validates too, but
    // a tool can be bypassed by a later direct write and the column cannot.
    await expect(
      asRuntime(owner, (c) =>
        c.query("UPDATE app.job_search_profiles SET briefing_detail = 'verbose' WHERE id = $1", [
          profileId
        ])
      )
    ).rejects.toThrow(/check constraint/i);
  });
});
```

Write `seedUser`, `seedProfile`, `asRuntime`, and `insertMatch` inline in the test file. Do not leave
any case as a comment.

**`asRuntime` cannot connect as the runtime role — do not try.** `packages/db/src/module-role-broker.ts:63`
creates every module role `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, and only the _install_ role
is briefly flipped to LOGIN and then forced back to `NOLOGIN PASSWORD NULL` on every call (:73). The
runtime role is never loginable. Assume the role inside a transaction instead — the same shape
`packages/db/src/module-storage-rpc.ts:89` uses in production, with the actor GUC set the way
`packages/db/src/data-context.ts:64,90` sets it:

```ts
// Connect as the bootstrap superuser, then drop into the module runtime role for the
// duration of one transaction. SET LOCAL ROLE + the actor GUC together are what the RLS
// policies read; both die with the transaction, so tests cannot leak privilege into each other.
async function asRuntime<T>(actorUserId: string, work: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE jarvis_mod_job_search_runtime");
    await client.query("SELECT set_config('app.actor_user_id', $1, true)", [actorUserId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
```

`seedUser` and `seedProfile` run as bootstrap, outside `asRuntime` — `app.users` is not a module-owned
table and the runtime role has no grant on it:

```ts
async function seedUser(): Promise<string> {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  const { rows } = await client.query(
    "INSERT INTO app.users (email, name) VALUES ($1,'Test') RETURNING id",
    [`js-${randomUUID()}@example.test`]
  );
  await client.end();
  return rows[0].id as string;
}

async function seedProfile(ownerUserId: string): Promise<string> {
  return asRuntime(ownerUserId, async (c) => {
    const { rows } = await c.query(
      "INSERT INTO app.job_search_profiles (owner_user_id, name, state) VALUES ($1,'Seed','active') RETURNING id",
      [ownerUserId]
    );
    return rows[0].id as string;
  });
}
```

Note the two pointers this plan previously gave here were wrong and have been removed:
`tests/integration/module-install.test.ts` contains no runtime-role data-access pattern (only teardown
REVOKEs), and the `rg` command as written escaped the alternation pipe so it searched for a literal.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm test:integration tests/integration/job-search-tables-install.test.ts`
Expected: FAIL — `migrationsDirectory` does not exist.

- [ ] **Step 4: Write the migrations — one statement each**

`0001_create_job_search_profiles.sql`:

```sql
-- One search profile per role the user is pursuing. `criteria` is the extracted,
-- user-confirmable frame (Task 10) — never free model prose.
-- owner_user_id is the mandatory RLS scoping column; the platform generates the
-- FORCE RLS policy from manifest.database.ownedTables at install time.
CREATE TABLE app.job_search_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  state         text NOT NULL CHECK (state IN ('in_conversation', 'active', 'paused')),
  criteria      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Broader-context summary distilled from the full-capability conversation (Task 8).
  -- Bounded and refreshed on confirmation; never raw transcript.
  context_summary text,
  schedule      text,
  -- How much this profile contributes to the daily briefing (Task 16's
  -- job-search.profile.set-briefing-detail tool; the settings screen in Task 20 writes it).
  -- On the profile row rather than in module KV for two reasons: it exports and deletes with the
  -- rest of the profile (NFR-7), and a stale KV entry can never disagree with a deleted profile.
  -- The three values are the union Task 16 already defines — do not add a fourth or rename one.
  briefing_detail text NOT NULL DEFAULT 'count'
                  CHECK (briefing_detail IN ('count', 'top', 'full')),
  -- Chat surface KEY for this profile's thread (Task 2c) — not the wire surface. The shell hashes
  -- (moduleId, key) into the legal surface string via moduleChatSurface(); a raw uuid here would
  -- never pass CHAT_SURFACE_PATTERN on its own. Stable for the profile's life.
  surface_key   text NOT NULL DEFAULT gen_random_uuid()::text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Redundant against the primary key on purpose. Every child table below binds
  -- (owner_user_id, profile_id) to THIS key, so a child row can only ever reference a parent
  -- owned by the same user. Without it, a child's single-column FK to `id` would happily point
  -- at another user's profile, and the generated RLS policy would not notice: the emitted
  -- predicate is `owner_user_id = app.current_actor_user_id()` on the child's OWN column
  -- (`packages/db/src/module-rls-emitter.ts:46`). A foreign key is not an RLS boundary.
  UNIQUE (owner_user_id, id)
);
```

`0002_create_job_search_portals.sql`:

```sql
-- Per-profile portal health. `cause` is the structured failure record from Task 5 —
-- which portal, what kind, what was retrieved, when it last worked, what happens next.
-- A bare "failed" is a spec violation, so there is no boolean-only error column.
CREATE TABLE app.job_search_portals (
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  source_id     text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  last_ok_at    timestamptz,
  cause         jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, profile_id, source_id),
  -- Owner-bound parent reference, not a bare `profile_id REFERENCES …(id)`. See the note on
  -- app.job_search_profiles: the single-column form lets a row owned by A hang off a profile
  -- owned by B, and RLS only ever checks this table's own owner_user_id.
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0003_create_job_search_postings.sql`:

```sql
-- Postings are deduped across portals, so identity is (source_id, external_id).
-- The embedding is triage-only: it decides which postings a model reads, and its
-- similarity value is never surfaced to the user.
CREATE TABLE app.job_search_postings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  source_id     text NOT NULL,
  external_id   text NOT NULL,
  title         text NOT NULL,
  company       text NOT NULL,
  location      text NOT NULL,
  url           text NOT NULL,
  body          text NOT NULL,
  posted_at     timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  embedding     vector(768),
  UNIQUE (owner_user_id, profile_id, source_id, external_id),
  -- The key app.job_search_matches binds its posting reference to (same reasoning as profiles).
  UNIQUE (owner_user_id, id),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0004_create_job_search_matches.sql`:

```sql
-- Fit and Want are two independent axes and are stored as two independent columns.
-- There is deliberately NO blended/overall/total column: the schema is the last place
-- that rule can be enforced structurally, so it is enforced here.
-- outside_frame marks the reserved recall slice — postings deliberately surfaced from
-- outside the user's stated criteria (Task 8). It is a first-class flag, not a filter.
CREATE TABLE app.job_search_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  posting_id    uuid NOT NULL,
  fit           integer CHECK (fit IS NULL OR fit BETWEEN 0 AND 100),
  want          integer CHECK (want IS NULL OR want BETWEEN 0 AND 100),
  fit_reason    text,
  want_reason   text,
  outside_frame boolean NOT NULL DEFAULT false,
  state         text NOT NULL CHECK (state IN ('unscored', 'new', 'seen', 'dismissed')),
  scored_at     timestamptz,
  UNIQUE (owner_user_id, profile_id, posting_id),
  -- BOTH parents are owner-bound. A match is the row that joins two other rows, so it is the
  -- one place where a single-column FK could stitch one user's posting to another user's
  -- profile and leave a legally-owned row behind that leaks a foreign posting through a join.
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id, posting_id)
    REFERENCES app.job_search_postings (owner_user_id, id) ON DELETE CASCADE
);
```

`0005_create_job_search_resumes.sql`:

```sql
-- One résumé per profile, versioned. The résumé is first-class input to Fit,
-- not an attachment bolted on afterwards.
CREATE TABLE app.job_search_resumes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  profile_id    uuid NOT NULL,
  version       integer NOT NULL,
  content       text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, profile_id, version),
  FOREIGN KEY (owner_user_id, profile_id)
    REFERENCES app.job_search_profiles (owner_user_id, id) ON DELETE CASCADE
);
```

`0006_index_job_search_matches_board.sql` — the board's primary read:

```sql
-- Board read: this profile's matches by state, newest scored first.
CREATE INDEX job_search_matches_board_idx
  ON app.job_search_matches (owner_user_id, profile_id, state, scored_at DESC);
```

`0007_index_job_search_postings_profile.sql` — the triage read:

```sql
-- Triage read: this profile's postings not yet matched, newest first.
CREATE INDEX job_search_postings_profile_idx
  ON app.job_search_postings (owner_user_id, profile_id, first_seen_at DESC);
```

No `ENABLE ROW LEVEL SECURITY`, no `CREATE POLICY`, no `GRANT` — the platform emits all of it. No
ANN index on `embedding`: the triage candidate set is one profile's recent postings, a sequential
scan over it is cheaper than maintaining an index, and adding one later is a one-statement migration.

- [ ] **Step 5: Run the test**

```bash
pnpm test:integration tests/integration/job-search-tables-install.test.ts
```

Expected: PASS (seven cases). Do **not** run `pnpm db:migrate` — module SQL is not in that catalog.

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search/sql tests/integration/job-search-tables-install.test.ts
git commit -m "feat(job-search): add module schema with platform-generated owner-only RLS"
```

---

## Phase 2 — Domain layer (pure, no SDK, no network)

Everything in this phase is a pure function tested with plain Vitest. No `ctx`, no `fetch`, no DB.
This is where the product's actual judgement lives, so it gets the heaviest test coverage.

### Task 5: Records and failure causes

**Files:**

- Create: `external-modules/job-search/src/domain/records.ts`
- Test: `tests/unit/job-search-failure-cause.test.ts`

**Interfaces:**

- Produces — every later task imports from here:

  ```ts
  export type FailureKind =
    | "rate_limited"
    | "login_required"
    | "parse_failed"
    | "network"
    /** The run ran out of time, not out of luck. Everything retrieved so far is kept and the
     *  portal is NEVER disabled — a slow crawl is not a broken source. Task 11's adapters
     *  produce this when `clock() >= deadlineAt` before a page fetch. */
    | "deadline";

  /** Never a bare "failed". Every field here answers a question the user will
   * otherwise have to ask: what broke, how much did we get, when did it last
   * work, and what happens next. */
  export interface FailureCause {
    kind: FailureKind;
    sourceId: string;
    /** Human-readable, rendered verbatim. Built from these fields, not by a model. */
    summary: string;
    retrieved: number;
    expected: number | null;
    lastOkAt: string | null;
    nextAction: string;
    retryAt: string | null;
    /** login_required is terminal: we do not sign in to job boards, so the
     * portal disables itself rather than retrying forever. */
    disabled: boolean;
  }

  export interface SearchCriteria {
    titles: string[];
    seniority: string[];
    locations: string[];
    remote: "required" | "preferred" | "no-preference" | "onsite-ok";
    compFloorCents: number | null;
    excludeCompanies: string[];
    mustHave: string[];
    niceToHave: string[];
    dealbreakers: string[];
    /** Free text the model uses for Want, that no filter acts on. */
    wantNarrative: string;
  }

  export interface Posting {
    id: string;
    sourceId: string;
    externalId: string;
    title: string;
    company: string;
    location: string;
    url: string;
    body: string;
    postedAt: string | null;
  }

  export interface Match {
    id: string;
    profileId: string;
    postingId: string;
    fit: number | null;
    want: number | null;
    fitReason: string;
    wantReason: string;
    outsideFrame: boolean;
    state: "unscored" | "new" | "seen" | "dismissed";
    scoredAt: string | null;
  }

  export interface PortalState {
    sourceId: string;
    enabled: boolean;
    lastOkAt: string | null;
    cause: FailureCause | null;
  }

  export function describeFailure(input: {
    kind: FailureKind;
    sourceId: string;
    sourceLabel: string;
    retrieved: number;
    expected: number | null;
    lastOkAt: string | null;
    retryAt: string | null;
  }): FailureCause;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-failure-cause.test.ts
import { describe, expect, it } from "vitest";
import { describeFailure } from "../../external-modules/job-search/src/domain/records";

describe("describeFailure", () => {
  it("says what was retrieved, when it last worked, and what happens next", () => {
    const cause = describeFailure({
      kind: "rate_limited",
      sourceId: "linkedin",
      sourceLabel: "LinkedIn",
      retrieved: 112,
      expected: 190,
      lastOkAt: "2026-07-25T06:40:00.000Z",
      retryAt: "2026-07-26T10:40:00.000Z"
    });

    expect(cause.summary).toBe(
      "LinkedIn rate-limited us after 112 of about 190 postings. Retrying at 10:40."
    );
    expect(cause.nextAction).toBe("Retrying at 10:40.");
    expect(cause.disabled).toBe(false);
  });

  it("disables a portal that demands a login and does not schedule a retry", () => {
    const cause = describeFailure({
      kind: "login_required",
      sourceId: "cascade",
      sourceLabel: "Cascade Labs",
      retrieved: 0,
      expected: null,
      lastOkAt: "2026-07-20T06:40:00.000Z",
      retryAt: null
    });

    expect(cause.disabled).toBe(true);
    expect(cause.retryAt).toBeNull();
    expect(cause.summary).toBe(
      "Cascade Labs asked for an account before showing postings, so I stopped. I will not sign in to a job board on your behalf."
    );
    expect(cause.nextAction).toBe("Disabled. Turn it back on if you want to try again.");
  });

  it("never produces an empty summary for any kind", () => {
    const kinds = ["rate_limited", "login_required", "parse_failed", "network"] as const;
    for (const kind of kinds) {
      const c = describeFailure({
        kind,
        sourceId: "x",
        sourceLabel: "X",
        retrieved: 0,
        expected: null,
        lastOkAt: null,
        retryAt: null
      });
      expect(c.summary.length, kind).toBeGreaterThan(20);
      expect(c.nextAction.length, kind).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-failure-cause.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `records.ts`**

Write every type above, then:

```ts
/** Renders the clock portion of an ISO timestamp in the user's locale-neutral
 * 24h form. Deliberately not a full date: "Retrying at 10:40" reads better than
 * a timestamp, and the board already shows the crawl date. */
function clock(iso: string): string {
  return iso.slice(11, 16);
}

export function describeFailure(input: {
  kind: FailureKind;
  sourceId: string;
  sourceLabel: string;
  retrieved: number;
  expected: number | null;
  lastOkAt: string | null;
  retryAt: string | null;
}): FailureCause {
  const { kind, sourceLabel, retrieved, expected, retryAt } = input;
  const retry = retryAt
    ? `Retrying at ${clock(retryAt)}.`
    : "Retrying on the next scheduled crawl.";

  let summary: string;
  let nextAction: string;
  let disabled = false;

  switch (kind) {
    case "rate_limited": {
      const got =
        expected === null
          ? `after ${retrieved} postings`
          : `after ${retrieved} of about ${expected} postings`;
      summary = `${sourceLabel} rate-limited us ${got}. ${retry}`;
      nextAction = retry;
      break;
    }
    case "login_required":
      // Terminal by policy, not by circumstance: the spec forbids signing in to
      // a job board, so retrying would just fail the same way forever.
      summary =
        `${sourceLabel} asked for an account before showing postings, so I stopped. ` +
        "I will not sign in to a job board on your behalf.";
      nextAction = "Disabled. Turn it back on if you want to try again.";
      disabled = true;
      break;
    case "parse_failed":
      summary =
        `${sourceLabel} answered, but its page layout changed and I could not read the postings. ` +
        `I kept the ${retrieved} I had already read.`;
      nextAction = "This needs a fix on our side. " + retry;
      break;
    case "network":
      summary =
        `I could not reach ${sourceLabel} at all — it did not answer. ` +
        `I kept the ${retrieved} postings I had already read.`;
      nextAction = retry;
      break;
    case "deadline":
      // Deliberately not phrased as a failure. Nothing is wrong; the run hit its time budget.
      summary =
        `I ran out of time on ${sourceLabel} and stopped there. ` +
        `I kept the ${retrieved} postings I had already read.`;
      nextAction = "Picking up where I left off on the next crawl.";
      break;
  }

  return {
    kind,
    sourceId: input.sourceId,
    summary,
    retrieved,
    expected,
    lastOkAt: input.lastOkAt,
    nextAction,
    retryAt: disabled ? null : input.retryAt,
    disabled
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-failure-cause.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/records.ts tests/unit/job-search-failure-cause.test.ts
git commit -m "feat(job-search): add domain records and structured failure causes"
```

---

### Task 6: Hard-exclude filter (stage 1)

Stage 1 removes only what is objectively disqualifying. It must be conservative: anything it drops
never gets read by a model and never reaches the user, so a wrong exclude is invisible.

**Files:**

- Create: `external-modules/job-search/src/domain/excludes.ts`
- Test: `tests/unit/job-search-excludes.test.ts`

**Interfaces:**

- Consumes: `Posting`, `SearchCriteria` from Task 5.
- Produces:

  ```ts
  export interface ExcludeResult {
    kept: Posting[];
    /** Why each drop happened, so the crawl log can answer "where did they go?" */
    dropped: Array<{ posting: Posting; reason: "excluded-company" | "duplicate-url" }>;
  }
  export function applyHardExcludes(
    postings: readonly Posting[],
    criteria: SearchCriteria
  ): ExcludeResult;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-excludes.test.ts
import { describe, expect, it } from "vitest";
import { applyHardExcludes } from "../../external-modules/job-search/src/domain/excludes";
import type { Posting, SearchCriteria } from "../../external-modules/job-search/src/domain/records";

const criteria = (over: Partial<SearchCriteria> = {}): SearchCriteria => ({
  titles: ["Software Engineer"],
  seniority: ["senior", "staff"],
  locations: ["Seattle, WA"],
  remote: "preferred",
  compFloorCents: 18_000_000,
  excludeCompanies: ["Acme Corp"],
  mustHave: [],
  niceToHave: [],
  dealbreakers: [],
  wantNarrative: "",
  ...over
});

const posting = (over: Partial<Posting> = {}): Posting => ({
  id: "p1",
  sourceId: "linkedin",
  externalId: "e1",
  title: "Software Engineer",
  company: "Globex",
  location: "Remote",
  url: "https://example.test/1",
  body: "…",
  postedAt: null,
  ...over
});

describe("applyHardExcludes", () => {
  it("drops a company on the exclude list, case- and whitespace-insensitively", () => {
    const out = applyHardExcludes([posting({ company: "  acme corp " })], criteria());
    expect(out.kept).toHaveLength(0);
    expect(out.dropped[0]?.reason).toBe("excluded-company");
  });

  it("keeps a posting whose location is nowhere near the stated one", () => {
    // Location is NOT a hard exclude: a Dublin posting from a company the user
    // would move for is exactly the recall case the product exists to catch.
    const out = applyHardExcludes([posting({ location: "Dublin, IE" })], criteria());
    expect(out.kept).toHaveLength(1);
  });

  it("keeps a posting with no salary listed", () => {
    // Most postings omit comp. Excluding on a missing field would delete the market.
    const out = applyHardExcludes([posting()], criteria({ compFloorCents: 30_000_000 }));
    expect(out.kept).toHaveLength(1);
  });

  it("keeps a posting whose title does not match the stated titles", () => {
    const out = applyHardExcludes([posting({ title: "Forward Deployed Engineer" })], criteria());
    expect(out.kept).toHaveLength(1);
  });

  it("collapses two postings that share a URL", () => {
    const out = applyHardExcludes([posting({ id: "a" }), posting({ id: "b" })], criteria());
    expect(out.kept).toHaveLength(1);
    expect(out.dropped[0]?.reason).toBe("duplicate-url");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-excludes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/domain/excludes.ts
import type { Posting, SearchCriteria } from "./records";

export interface ExcludeResult {
  kept: Posting[];
  dropped: Array<{ posting: Posting; reason: "excluded-company" | "duplicate-url" }>;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Stage 1 of the pipeline. Deliberately narrow: it drops ONLY what is
 * objectively disqualifying — a company the user named, or the same URL twice.
 *
 * It does not filter on title, location, or comp. Those look like obvious
 * excludes and are the exact thing that would kill the product: the postings
 * outside the stated frame are the ones the user cannot find on their own.
 * Relevance is stage 2's job, and it is a soft cut with a reserved slice.
 */
export function applyHardExcludes(
  postings: readonly Posting[],
  criteria: SearchCriteria
): ExcludeResult {
  const banned = new Set(criteria.excludeCompanies.map(norm));
  const seenUrls = new Set<string>();
  const kept: Posting[] = [];
  const dropped: ExcludeResult["dropped"] = [];

  for (const p of postings) {
    if (banned.has(norm(p.company))) {
      dropped.push({ posting: p, reason: "excluded-company" });
      continue;
    }
    const url = norm(p.url);
    if (seenUrls.has(url)) {
      dropped.push({ posting: p, reason: "duplicate-url" });
      continue;
    }
    seenUrls.add(url);
    kept.push(p);
  }

  return { kept, dropped };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-excludes.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/excludes.ts tests/unit/job-search-excludes.test.ts
git commit -m "feat(job-search): add conservative hard-exclude filter"
```

---

### Task 7: Cross-portal dedupe

The same job appears on LinkedIn and on the company's own ATS board behind freehire. Showing it
twice destroys the board's density argument, and freehire aggregates ~50 ATS boards, so the overlap
with LinkedIn is the normal case rather than the exception.

**Files:**

- Create: `external-modules/job-search/src/domain/dedupe.ts`
- Test: `tests/unit/job-search-dedupe.test.ts`

**Interfaces:**

- Consumes: `Posting`.
- Produces:

  ```ts
  /** Stable identity for a posting across portals. */
  export function postingIdentity(p: Posting): string;
  export function dedupePostings(
    postings: readonly Posting[],
    sourcePriority: readonly string[]
  ): Posting[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-dedupe.test.ts
import { describe, expect, it } from "vitest";
import {
  dedupePostings,
  postingIdentity
} from "../../external-modules/job-search/src/domain/dedupe";
import type { Posting } from "../../external-modules/job-search/src/domain/records";

const p = (over: Partial<Posting>): Posting => ({
  id: "x",
  sourceId: "linkedin",
  externalId: "e",
  title: "Staff Engineer",
  company: "Globex",
  location: "Seattle, WA",
  url: "https://a.test/1",
  body: "",
  postedAt: null,
  ...over
});

describe("postingIdentity", () => {
  it("ignores punctuation, case, and company suffixes", () => {
    expect(postingIdentity(p({ company: "Globex, Inc." }))).toBe(
      postingIdentity(p({ company: "globex inc" }))
    );
  });

  it("ignores a location qualifier in the title", () => {
    expect(postingIdentity(p({ title: "Staff Engineer (Seattle)" }))).toBe(
      postingIdentity(p({ title: "Staff Engineer" }))
    );
  });

  it("keeps two genuinely different roles at one company apart", () => {
    expect(postingIdentity(p({ title: "Staff Engineer" }))).not.toBe(
      postingIdentity(p({ title: "Senior Engineer" }))
    );
  });
});

describe("dedupePostings", () => {
  it("keeps the copy from the highest-priority source", () => {
    const out = dedupePostings(
      [p({ id: "a", sourceId: "linkedin" }), p({ id: "b", sourceId: "freehire" })],
      ["freehire", "linkedin"]
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("b");
  });

  it("prefers the copy with the longer body when sources tie", () => {
    const out = dedupePostings(
      [
        p({ id: "a", sourceId: "linkedin", body: "short" }),
        p({ id: "b", sourceId: "linkedin", body: "a much longer description" })
      ],
      ["linkedin"]
    );
    expect(out[0]?.id).toBe("b");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-dedupe.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/domain/dedupe.ts
import type { Posting } from "./records";

/** Corporate suffixes that carry no identity — "Globex" and "Globex, Inc." are one company. */
const SUFFIXES = /\b(inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|nv|ab|oy)\b/g;

function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(SUFFIXES, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Titles routinely carry a parenthetical location or req number that is not part
 * of the role: "Staff Engineer (Seattle)" and "Staff Engineer" are one job. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function postingIdentity(p: Posting): string {
  return `${normalizeCompany(p.company)}::${normalizeTitle(p.title)}`;
}

export function dedupePostings(
  postings: readonly Posting[],
  sourcePriority: readonly string[]
): Posting[] {
  const rank = (sourceId: string) => {
    const i = sourcePriority.indexOf(sourceId);
    // Unknown sources sort last rather than first — a source we did not rank is
    // one we have no reason to trust over one we did.
    return i === -1 ? sourcePriority.length : i;
  };

  const best = new Map<string, Posting>();
  for (const p of postings) {
    const key = postingIdentity(p);
    const held = best.get(key);
    if (!held) {
      best.set(key, p);
      continue;
    }
    const better =
      rank(p.sourceId) !== rank(held.sourceId)
        ? rank(p.sourceId) < rank(held.sourceId)
        : // Same source: the fuller description is the more useful record, and it
          // is what the scoring model will read.
          p.body.length > held.body.length;
    if (better) best.set(key, p);
  }
  return [...best.values()];
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-dedupe.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/dedupe.ts tests/unit/job-search-dedupe.test.ts
git commit -m "feat(job-search): dedupe postings across portals"
```

---

### Task 8: Embedding triage with the reserved recall slice (stage 2)

The cost-control stage, and the one most likely to be implemented wrong. A naive
"keep the top N by similarity to the criteria" implementation silently deletes the product's
entire reason for existing.

**Files:**

- Create: `external-modules/job-search/src/domain/triage.ts`
- Test: `tests/unit/job-search-triage.test.ts`

**Interfaces:**

- Consumes: `Posting`.
- Produces:

  ```ts
  export interface TriageInput {
    postings: readonly Posting[];
    /** Similarity of each posting to the stated criteria, keyed by posting id, 0..1. */
    criteriaSimilarity: ReadonlyMap<string, number>;
    /** Similarity to the user's broader profile — goals, notes, past conversation. */
    profileSimilarity: ReadonlyMap<string, number>;
    /** How many postings the scoring model will read this pass. */
    budget: number;
  }
  export interface TriageResult {
    /** Ordered: in-frame first, then the reserved recall slice. */
    selected: Array<{ posting: Posting; outsideFrame: boolean }>;
    /** How many postings were considered but not selected. Shown as a count only. */
    deferred: number;
  }
  export function triage(input: TriageInput): TriageResult;

  /** Share of the budget reserved for postings the stated criteria would have missed. */
  export const RECALL_SLICE = 0.2;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-triage.test.ts
import { describe, expect, it } from "vitest";
import { RECALL_SLICE, triage } from "../../external-modules/job-search/src/domain/triage";
import type { Posting } from "../../external-modules/job-search/src/domain/records";

const mk = (id: string): Posting => ({
  id,
  sourceId: "linkedin",
  externalId: id,
  title: id,
  company: "C",
  location: "L",
  url: `https://t.test/${id}`,
  body: "",
  postedAt: null
});

describe("triage", () => {
  it("reserves a slice of the budget for postings the criteria would have missed", () => {
    // Ten postings: in0..in7 match the criteria well, out0/out1 do not, but they
    // match the user's broader profile strongly. A naive top-N by criteria would
    // return only in0..in7 and lose both.
    const postings = [...Array(8)].map((_, i) => mk(`in${i}`)).concat([mk("out0"), mk("out1")]);
    const criteriaSimilarity = new Map(
      postings.map((p) => [p.id, p.id.startsWith("in") ? 0.9 : 0.2])
    );
    const profileSimilarity = new Map(
      postings.map((p) => [p.id, p.id.startsWith("out") ? 0.95 : 0.4])
    );

    const out = triage({ postings, criteriaSimilarity, profileSimilarity, budget: 5 });

    expect(out.selected).toHaveLength(5);
    const outside = out.selected.filter((s) => s.outsideFrame).map((s) => s.posting.id);
    expect(outside).toEqual(["out0"]); // floor(5 * 0.2) = 1
    expect(RECALL_SLICE).toBe(0.2);
  });

  it("always reserves at least one recall slot when a candidate exists", () => {
    const postings = [mk("in0"), mk("in1"), mk("out0")];
    const out = triage({
      postings,
      criteriaSimilarity: new Map([
        ["in0", 0.9],
        ["in1", 0.9],
        ["out0", 0.1]
      ]),
      profileSimilarity: new Map([
        ["in0", 0.3],
        ["in1", 0.3],
        ["out0", 0.99]
      ]),
      budget: 2
    });
    // floor(2 * 0.2) = 0, but a strong out-of-frame candidate still gets a seat.
    expect(out.selected.filter((s) => s.outsideFrame)).toHaveLength(1);
  });

  it("backfills the unused seats of a pool that ran dry", () => {
    // One in-frame posting, five out-of-frame, budget five. A reservation of one plus a
    // single in-frame candidate fills only two seats; the other three must go back to the
    // pool that still has candidates. Without backfill this selects 2 and defers 4 while
    // the scoring model sits idle with budget in hand.
    const postings = [mk("in0"), ...[...Array(5)].map((_, i) => mk(`out${i}`))];
    const criteriaSimilarity = new Map(
      postings.map((p) => [p.id, p.id.startsWith("in") ? 0.9 : 0.2])
    );
    const profileSimilarity = new Map(
      postings.map((p, i) => [p.id, p.id.startsWith("out") ? 0.99 - i / 100 : 0.4])
    );

    const out = triage({ postings, criteriaSimilarity, profileSimilarity, budget: 5 });

    expect(out.selected).toHaveLength(5);
    expect(out.deferred).toBe(1);
    expect(out.selected.filter((s) => s.outsideFrame)).toHaveLength(4);
  });

  it("gives the last seat to the stated criteria, not to the recall slice", () => {
    // budget 1 with both kinds of candidate. The recall seat is a floor on recall, not a
    // licence to spend the user's entire pass on a hunch — the top in-frame posting wins.
    const postings = [mk("in0"), mk("out0")];
    const out = triage({
      postings,
      criteriaSimilarity: new Map([
        ["in0", 0.9],
        ["out0", 0.1]
      ]),
      profileSimilarity: new Map([
        ["in0", 0.3],
        ["out0", 0.99]
      ]),
      budget: 1
    });
    expect(out.selected).toHaveLength(1);
    expect(out.selected[0]?.posting.id).toBe("in0");
    expect(out.selected[0]?.outsideFrame).toBe(false);
  });

  it("spends the whole budget on recall when nothing is in frame", () => {
    const postings = [mk("out0"), mk("out1")];
    const out = triage({
      postings,
      criteriaSimilarity: new Map([
        ["out0", 0.1],
        ["out1", 0.2]
      ]),
      profileSimilarity: new Map([
        ["out0", 0.99],
        ["out1", 0.98]
      ]),
      budget: 1
    });
    expect(out.selected).toHaveLength(1);
    expect(out.selected[0]?.outsideFrame).toBe(true);
  });

  it("spends the recall slots on in-frame postings when nothing is out of frame", () => {
    const postings = [...Array(4)].map((_, i) => mk(`in${i}`));
    const out = triage({
      postings,
      criteriaSimilarity: new Map(postings.map((p) => [p.id, 0.9])),
      profileSimilarity: new Map(postings.map((p) => [p.id, 0.9])),
      budget: 3
    });
    expect(out.selected).toHaveLength(3);
    expect(out.selected.every((s) => !s.outsideFrame)).toBe(true);
  });

  it("reports how many it deferred rather than dropping them silently", () => {
    const postings = [...Array(10)].map((_, i) => mk(`in${i}`));
    const sim = new Map(postings.map((p, i) => [p.id, 1 - i / 20]));
    const out = triage({
      postings,
      criteriaSimilarity: sim,
      profileSimilarity: sim,
      budget: 4
    });
    expect(out.deferred).toBe(6);
  });

  it("never returns a similarity value to the caller", () => {
    const postings = [mk("a")];
    const sim = new Map([["a", 0.77]]);
    const out = triage({ postings, criteriaSimilarity: sim, profileSimilarity: sim, budget: 1 });
    // The triage score is a cost-control device. If it can be read off the
    // result it will eventually be rendered, and that is a spec violation.
    expect(JSON.stringify(out)).not.toContain("0.77");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-triage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/domain/triage.ts
import type { Posting } from "./records";

/** Share of each pass's model budget reserved for postings the user's stated
 * criteria would have missed. This is the recall case: the whole reason the
 * product beats a keyword search. Do not tune it to zero to save tokens. */
export const RECALL_SLICE = 0.2;

/** A posting is "outside the stated frame" when it is a poor match for what the
 * user asked for but a strong match for who they are. */
const OUTSIDE_FRAME_CRITERIA_MAX = 0.5;
const OUTSIDE_FRAME_PROFILE_MIN = 0.6;

export interface TriageInput {
  postings: readonly Posting[];
  criteriaSimilarity: ReadonlyMap<string, number>;
  profileSimilarity: ReadonlyMap<string, number>;
  budget: number;
}

export interface TriageResult {
  selected: Array<{ posting: Posting; outsideFrame: boolean }>;
  deferred: number;
}

export function triage(input: TriageInput): TriageResult {
  const { postings, criteriaSimilarity, profileSimilarity, budget } = input;
  if (budget <= 0 || postings.length === 0) {
    return { selected: [], deferred: postings.length };
  }

  const crit = (p: Posting) => criteriaSimilarity.get(p.id) ?? 0;
  const prof = (p: Posting) => profileSimilarity.get(p.id) ?? 0;

  // One pass, two buckets. The obvious `postings.filter((p) => !outside.includes(p))` is
  // O(n²) over a list that routinely holds several hundred postings after a sweep.
  const outside: Posting[] = [];
  const inFrame: Posting[] = [];
  for (const p of postings) {
    if (crit(p) <= OUTSIDE_FRAME_CRITERIA_MAX && prof(p) >= OUTSIDE_FRAME_PROFILE_MIN) {
      outside.push(p);
    } else {
      inFrame.push(p);
    }
  }

  const rankedOutside = outside.sort((a, b) => prof(b) - prof(a));
  const rankedInFrame = inFrame.sort((a, b) => crit(b) - crit(a));

  // At least one recall seat whenever a candidate exists, even at small budgets where the
  // percentage floors to zero — one seat is the difference between the feature existing and
  // not existing. But never the LAST seat: `budget - 1` guarantees that whenever any in-frame
  // posting exists, the best one is read. At budget 1 the user's own stated criteria win;
  // starving them to show a hunch would read as the product ignoring the search.
  const reserved =
    rankedOutside.length === 0
      ? 0
      : rankedInFrame.length === 0
        ? budget
        : Math.min(Math.max(1, Math.floor(budget * RECALL_SLICE)), budget - 1);

  const takeOutside = rankedOutside.slice(0, reserved);
  const takeInFrame = rankedInFrame.slice(0, budget - takeOutside.length);

  // Backfill. Whichever pool runs dry hands its unused seats to the other, in similarity
  // order. Without this, a reservation held against a pool that only has one candidate burns
  // seats the scoring model had budget for: 1 in-frame + 5 outside at budget 5 would select
  // 2 and defer 4. The reservation is a floor on recall, not a ceiling on either pool.
  let leftover = budget - takeOutside.length - takeInFrame.length;
  if (leftover > 0 && rankedOutside.length > takeOutside.length) {
    takeOutside.push(...rankedOutside.slice(takeOutside.length, takeOutside.length + leftover));
    leftover = budget - takeOutside.length - takeInFrame.length;
  }
  if (leftover > 0 && rankedInFrame.length > takeInFrame.length) {
    takeInFrame.push(...rankedInFrame.slice(takeInFrame.length, takeInFrame.length + leftover));
  }

  const selected = [
    ...takeInFrame.map((posting) => ({ posting, outsideFrame: false })),
    ...takeOutside.map((posting) => ({ posting, outsideFrame: true }))
  ];

  return { selected, deferred: postings.length - selected.length };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-triage.test.ts`
Expected: PASS (all five).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/triage.ts tests/unit/job-search-triage.test.ts
git commit -m "feat(job-search): add embedding triage with reserved recall slice"
```

---

### Task 9: Two-axis scoring — prompt and result validation (stage 3)

**Files:**

- Create: `external-modules/job-search/src/domain/score.ts`
- Test: `tests/unit/job-search-score.test.ts`

**Interfaces:**

- Consumes: `Posting`, `SearchCriteria`, `Match`.
- Produces:

  ```ts
  export const SCORE_SCHEMA: object; // JSON Schema handed to ctx.ai.generateStructured

  export function buildScorePrompt(input: {
    posting: Posting;
    criteria: SearchCriteria;
    resume: string;
    /** Free-text profile context (goals, notes). Never credentials. */
    context: string;
  }): string;

  export interface ScoreResult {
    fit: number;
    want: number;
    fitReason: string;
    wantReason: string;
  }
  /** Throws on anything the model got wrong. Never coerces, never defaults —
   * a bad score must fail loudly rather than land on the board as a number. */
  export function parseScoreResult(raw: unknown): ScoreResult;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-score.test.ts
import { describe, expect, it } from "vitest";
import {
  buildScorePrompt,
  parseScoreResult,
  SCORE_SCHEMA
} from "../../external-modules/job-search/src/domain/score";

describe("SCORE_SCHEMA", () => {
  it("has exactly the two axes and their reasons, and no blended field", () => {
    const props = Object.keys((SCORE_SCHEMA as never as { properties: object }).properties);
    expect(props.sort()).toEqual(["fit", "fitReason", "want", "wantReason"]);
  });

  it("refuses unknown properties so a model cannot invent an overall score", () => {
    expect((SCORE_SCHEMA as never as { additionalProperties: boolean }).additionalProperties).toBe(
      false
    );
  });
});

describe("parseScoreResult", () => {
  it("accepts a well-formed result", () => {
    expect(
      parseScoreResult({
        fit: 82,
        want: 91,
        fitReason: "Ten years of the exact stack.",
        wantReason: "Small team."
      })
    ).toEqual({
      fit: 82,
      want: 91,
      fitReason: "Ten years of the exact stack.",
      wantReason: "Small team."
    });
  });

  it("rejects a score outside 0..100 instead of clamping it", () => {
    expect(() => parseScoreResult({ fit: 140, want: 50, fitReason: "x", wantReason: "y" })).toThrow(
      /fit must be an integer between 0 and 100/
    );
  });

  it("rejects a non-integer score", () => {
    expect(() =>
      parseScoreResult({ fit: 82.5, want: 50, fitReason: "x", wantReason: "y" })
    ).toThrow(/fit must be an integer/);
  });

  it("rejects an empty reason — an unexplained number is not usable", () => {
    expect(() => parseScoreResult({ fit: 82, want: 91, fitReason: "", wantReason: "y" })).toThrow(
      /fitReason must be a non-empty string/
    );
  });

  it("rejects a result carrying an extra blended field", () => {
    expect(() =>
      parseScoreResult({
        fit: 82,
        want: 91,
        fitReason: "x",
        wantReason: "y",
        overall: 87
      })
    ).toThrow(/unexpected field: overall/);
  });
});

describe("buildScorePrompt", () => {
  it("asks for the two axes independently and forbids averaging them", () => {
    const prompt = buildScorePrompt({
      posting: {
        id: "p",
        sourceId: "linkedin",
        externalId: "e",
        title: "Staff Engineer",
        company: "Globex",
        location: "Seattle",
        url: "https://t.test/p",
        body: "Build platform tooling.",
        postedAt: null
      },
      criteria: {
        titles: [],
        seniority: [],
        locations: [],
        remote: "no-preference",
        compFloorCents: null,
        excludeCompanies: [],
        mustHave: [],
        niceToHave: [],
        dealbreakers: [],
        wantNarrative: "Smaller team, less process."
      },
      resume: "RESUME TEXT",
      context: "Wants more autonomy."
    });

    expect(prompt).toContain("Staff Engineer");
    expect(prompt).toContain("RESUME TEXT");
    expect(prompt).toContain("Smaller team, less process.");
    expect(prompt).toMatch(/do not (average|combine|blend)/i);
    // The two axes must be described as answering different questions, or the
    // model collapses them into one number expressed twice.
    expect(prompt).toContain("a year in");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-score.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/domain/score.ts
import type { Posting, SearchCriteria } from "./records";

export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fit", "want", "fitReason", "wantReason"],
  properties: {
    fit: { type: "integer", minimum: 0, maximum: 100 },
    want: { type: "integer", minimum: 0, maximum: 100 },
    fitReason: { type: "string", minLength: 1, maxLength: 600 },
    wantReason: { type: "string", minLength: 1, maxLength: 600 }
  }
} as const;

export interface ScoreResult {
  fit: number;
  want: number;
  fitReason: string;
  wantReason: string;
}

const ALLOWED = new Set(["fit", "want", "fitReason", "wantReason"]);

/**
 * Validates a model result before it becomes a row. Deliberately strict and
 * non-coercing: a clamped or defaulted score is indistinguishable on the board
 * from one the model actually reasoned about, and the user would have no way to
 * know which they were looking at.
 */
export function parseScoreResult(raw: unknown): ScoreResult {
  if (typeof raw !== "object" || raw === null) throw new Error("score result must be an object");
  const r = raw as Record<string, unknown>;

  for (const key of Object.keys(r)) {
    // Catches a model that helpfully adds `overall` — the one thing the product
    // must never show.
    if (!ALLOWED.has(key)) throw new Error(`unexpected field: ${key}`);
  }

  for (const axis of ["fit", "want"] as const) {
    const v = r[axis];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
      throw new Error(`${axis} must be an integer between 0 and 100`);
    }
  }
  for (const reason of ["fitReason", "wantReason"] as const) {
    const v = r[reason];
    if (typeof v !== "string" || v.trim().length === 0) {
      throw new Error(`${reason} must be a non-empty string`);
    }
  }

  return {
    fit: r.fit as number,
    want: r.want as number,
    fitReason: (r.fitReason as string).trim(),
    wantReason: (r.wantReason as string).trim()
  };
}

export function buildScorePrompt(input: {
  posting: Posting;
  criteria: SearchCriteria;
  resume: string;
  context: string;
}): string {
  const { posting, criteria, resume, context } = input;
  return [
    "Read one job posting against one person and answer two separate questions.",
    "",
    "FIT (0-100): could this person do this job, and would this employer plausibly want them?",
    "Judge evidence in the résumé against what the posting asks for.",
    "",
    "WANT (0-100): would this person still want this job a year in?",
    "Judge the shape of the work — team size, autonomy, domain, process, trajectory —",
    "against what they have said they are looking for.",
    "",
    "These are independent. A job can be a perfect fit and a bad want, or the reverse.",
    "Do not average, combine, or blend them. Do not let one influence the other.",
    "Give each a short, concrete reason naming specific evidence, not a restatement of the score.",
    "",
    "--- POSTING ---",
    `${posting.title} at ${posting.company} — ${posting.location}`,
    posting.body,
    "",
    "--- RÉSUMÉ ---",
    resume,
    "",
    "--- WHAT THEY SAID THEY WANT ---",
    criteria.wantNarrative,
    criteria.dealbreakers.length > 0 ? `Dealbreakers: ${criteria.dealbreakers.join("; ")}` : "",
    "",
    "--- OTHER CONTEXT ---",
    context
  ]
    .filter((line) => line !== "")
    .join("\n");
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-score.test.ts`
Expected: PASS (all eight).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/domain/score.ts tests/unit/job-search-score.test.ts
git commit -m "feat(job-search): add two-axis scoring prompt and strict result validation"
```

---

### Task 10: Criteria extraction and surfacing shapes

**Files:**

- Create: `external-modules/job-search/src/domain/criteria.ts`
- Create: `external-modules/job-search/src/domain/surface.ts`
- Test: `tests/unit/job-search-criteria.test.ts`
- Test: `tests/unit/job-search-surface.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // criteria.ts
  export const CRITERIA_SCHEMA: object;
  export function parseCriteria(raw: unknown): SearchCriteria; // strict, throws
  /** Which onboarding steps the stored criteria satisfy. Drives the progress
   * readout — derived from the record, never from what the model claimed. */
  export const ONBOARDING_STEPS: readonly ["role", "want", "where", "comp", "sources"];
  export function completedSteps(
    criteria: Partial<SearchCriteria>,
    enabledPortals: number
  ): Array<(typeof ONBOARDING_STEPS)[number]>;
  export function isReadyToCrawl(
    criteria: Partial<SearchCriteria>,
    enabledPortals: number
  ): boolean;

  /** Hard bound on the profile's `context_summary`. See the note under Step 3. */
  export const CONTEXT_SUMMARY_MAX = 1200;
  /** Validate a distilled context summary before it is stored. Strict, throws. */
  export function parseContextSummary(raw: unknown): string;

  // surface.ts
  export function newMatchCount(matches: readonly Match[]): number;
  export function buildBriefingContribution(input: {
    profiles: ReadonlyArray<{
      id: string;
      name: string;
      matches: readonly Match[];
      postings: ReadonlyMap<string, Posting>;
    }>;
    detail: "count" | "top" | "full";
    degraded: readonly FailureCause[];
  }): {
    headline: string;
    items: Array<{ id: string; title: string; detail: string; href?: string }>;
  };
  ```

- [ ] **Step 1: Write both failing tests**

```ts
// tests/unit/job-search-criteria.test.ts
import { describe, expect, it } from "vitest";
import {
  completedSteps,
  CONTEXT_SUMMARY_MAX,
  isReadyToCrawl,
  parseContextSummary,
  parseCriteria
} from "../../external-modules/job-search/src/domain/criteria";

describe("parseCriteria", () => {
  it("rejects an unknown remote value rather than defaulting it", () => {
    expect(() => parseCriteria({ titles: [], remote: "maybe" })).toThrow(/remote must be one of/);
  });

  it("fills absent list fields with empty arrays but never invents content", () => {
    const c = parseCriteria({
      titles: ["SWE"],
      remote: "preferred",
      wantNarrative: "smaller team"
    });
    expect(c.titles).toEqual(["SWE"]);
    expect(c.dealbreakers).toEqual([]);
    expect(c.compFloorCents).toBeNull();
  });
});

describe("completedSteps", () => {
  it("counts a step done only when its field actually holds something", () => {
    expect(completedSteps({ titles: ["SWE"], wantNarrative: "smaller team" }, 0)).toEqual([
      "role",
      "want"
    ]);
  });

  it("counts sources from enabled portals, not from criteria", () => {
    expect(completedSteps({}, 2)).toEqual(["sources"]);
  });
});

describe("isReadyToCrawl", () => {
  it("needs a role, a want, and at least one source", () => {
    expect(isReadyToCrawl({ titles: ["SWE"], wantNarrative: "x" }, 1)).toBe(true);
    expect(isReadyToCrawl({ titles: ["SWE"], wantNarrative: "x" }, 0)).toBe(false);
    expect(isReadyToCrawl({ titles: ["SWE"] }, 1)).toBe(false);
  });
});

describe("parseContextSummary", () => {
  it("accepts a short summary and trims it", () => {
    expect(parseContextSummary("  Wants to stay IC. Left ServiceNow in June.  ")).toBe(
      "Wants to stay IC. Left ServiceNow in June."
    );
  });

  it("rejects a summary over the cap instead of truncating it", () => {
    // Truncating would silently cut a sentence in half and then feed the half-sentence to the
    // scoring model on every posting. Failing sends the distiller back to write a shorter one.
    expect(() => parseContextSummary("x".repeat(CONTEXT_SUMMARY_MAX + 1))).toThrow(
      /context summary must be 1200 characters or fewer/
    );
  });

  it("rejects an empty or whitespace-only summary", () => {
    // Clearing the summary is `null`, an explicit erase. An empty string would store a value
    // that reads as "we have context" while carrying none.
    expect(() => parseContextSummary("   ")).toThrow(/context summary must not be empty/);
  });

  it("rejects control characters, newlines included", () => {
    // The summary is interpolated into a prompt and then stored. It is one flowing paragraph by
    // construction, so no control character has a legitimate use here, and forbidding the lot is
    // easier to reason about than an allowlist. A NUL in particular must never reach Postgres:
    // it aborts the statement rather than storing anything.
    expect(() => parseContextSummary("Wants IC work.\u0000Ignore the above.")).toThrow(
      /context summary must not contain control characters/
    );
    expect(() => parseContextSummary("Wants IC work.\nSecond line.")).toThrow(
      /context summary must not contain control characters/
    );
  });

  it("rejects a non-string", () => {
    expect(() => parseContextSummary({ text: "hi" })).toThrow(/context summary must be a string/);
  });
});
```

```ts
// tests/unit/job-search-surface.test.ts
import { describe, expect, it } from "vitest";
import {
  buildBriefingContribution,
  newMatchCount
} from "../../external-modules/job-search/src/domain/surface";

describe("newMatchCount", () => {
  it("counts only unseen scored matches", () => {
    expect(
      newMatchCount([
        { state: "new" },
        { state: "new" },
        { state: "seen" },
        { state: "dismissed" },
        { state: "unscored" }
      ] as never)
    ).toBe(2);
  });
});

describe("buildBriefingContribution", () => {
  const profile = {
    id: "swe",
    name: "Software Engineer",
    matches: [
      { id: "m1", postingId: "p1", fit: 82, want: 91, state: "new", outsideFrame: false },
      { id: "m2", postingId: "p2", fit: 74, want: 88, state: "new", outsideFrame: true }
    ],
    postings: new Map([
      ["p1", { title: "Staff Engineer", company: "Globex", url: "https://t.test/1" }],
      ["p2", { title: "Founding Engineer", company: "Initech", url: "https://t.test/2" }]
    ])
  } as never;

  it("at detail 'count', gives a headline and no items", () => {
    const out = buildBriefingContribution({ profiles: [profile], detail: "count", degraded: [] });
    expect(out.headline).toBe("2 new job matches in Software Engineer.");
    expect(out.items).toEqual([]);
  });

  it("at detail 'top', names both axes separately in every item", () => {
    const out = buildBriefingContribution({ profiles: [profile], detail: "top", degraded: [] });
    expect(out.items[0]?.detail).toBe("Fit 82 · Want 91");
    expect(out.items[0]?.title).toBe("Staff Engineer at Globex");
  });

  it("flags an out-of-frame match rather than presenting it as a normal hit", () => {
    const out = buildBriefingContribution({ profiles: [profile], detail: "top", degraded: [] });
    expect(out.items[1]?.detail).toBe("Fit 74 · Want 88 · outside what you asked for");
  });

  it("reports a degraded portal in the briefing rather than staying quiet about it", () => {
    const out = buildBriefingContribution({
      profiles: [profile],
      detail: "count",
      degraded: [
        {
          kind: "rate_limited",
          sourceId: "linkedin",
          summary: "LinkedIn rate-limited us after 112 of about 190 postings. Retrying at 10:40.",
          retrieved: 112,
          expected: 190,
          lastOkAt: null,
          nextAction: "Retrying at 10:40.",
          retryAt: null,
          disabled: false
        }
      ]
    });
    expect(out.items.some((i) => i.detail.includes("rate-limited"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run both and watch them fail**

Run: `pnpm vitest run tests/unit/job-search-criteria.test.ts tests/unit/job-search-surface.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `criteria.ts`**

Strict parser in the same shape as `parseScoreResult` (Task 9): reject unknown keys, reject bad
enum values, default only absent list fields to `[]` and absent scalars to `null`. Then:

```ts
export const ONBOARDING_STEPS = ["role", "want", "where", "comp", "sources"] as const;

/** Derived from the stored record, never from the model's claim that it "got"
 * something. If the field is empty the step is not done, whatever the transcript says. */
export function completedSteps(
  criteria: Partial<SearchCriteria>,
  enabledPortals: number
): Array<(typeof ONBOARDING_STEPS)[number]> {
  const done: Array<(typeof ONBOARDING_STEPS)[number]> = [];
  if ((criteria.titles?.length ?? 0) > 0) done.push("role");
  if ((criteria.wantNarrative ?? "").trim().length > 0) done.push("want");
  if ((criteria.locations?.length ?? 0) > 0 || criteria.remote === "required") done.push("where");
  if (criteria.compFloorCents !== null && criteria.compFloorCents !== undefined) done.push("comp");
  if (enabledPortals > 0) done.push("sources");
  return done;
}

/** Comp and location are optional: plenty of people genuinely do not have a floor,
 * and forcing one would put a number in the record the user did not mean. */
export function isReadyToCrawl(criteria: Partial<SearchCriteria>, enabledPortals: number): boolean {
  const done = new Set(completedSteps(criteria, enabledPortals));
  return done.has("role") && done.has("want") && done.has("sources");
}

export const CONTEXT_SUMMARY_MAX = 1200;

// eslint-disable-next-line no-control-regex -- the point of this regex is control characters
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** The profile's broader context: the things the user said that shape judgement but are not
 * criteria. "Left a big-company platform team, wants to stay IC, will take less money for less
 * process" is context; "titles: [Staff Engineer]" is criteria. It exists because Ben asked for a
 * real open conversation rather than a form, and the parts of that conversation which are not
 * filter values still have to reach the scoring model somehow.
 *
 * Three rules, all enforced here because this is the only place the value is admitted:
 *
 * - **Provenance.** It is model-distilled but user-confirmed: the only writer is Task 16's
 *   `job-search.profile.set-context` tool, which the user sees and approves like any other tool
 *   call. Raw transcript is never stored. The record is therefore something the user agreed to,
 *   which matters because it is exportable and deletable under NFR-7 and they have to be able to
 *   recognise it as theirs.
 * - **Bounds.** 1200 characters. This string rides in `buildScorePrompt` once per posting, so its
 *   length multiplies across the whole scored batch — it is a budget line, not just a field. Over
 *   the cap is a rejection, never a truncation: a half-sentence fed to the scorer on every posting
 *   is worse than a distiller that has to try again.
 * - **Refresh.** Replaced wholesale on every confirmation, never appended. An accreting summary
 *   would drift out of date, silently outgrow the cap, and end up asserting things the user has
 *   since changed their mind about. Clearing it is `null`, which is why the empty string is
 *   rejected rather than treated as an erase.
 *
 * Trust: this text enters a model prompt carrying exactly the authority of a user turn. It is not
 * an instruction channel, and nothing downstream may treat it as one. */
export function parseContextSummary(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("context summary must be a string");
  if (CONTROL_CHARACTERS.test(raw)) {
    throw new Error("context summary must not contain control characters");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error("context summary must not be empty");
  if (trimmed.length > CONTEXT_SUMMARY_MAX) {
    throw new Error(`context summary must be ${CONTEXT_SUMMARY_MAX} characters or fewer`);
  }
  return trimmed;
}
```

`buildScorePrompt` (Task 9) already takes a `context` string — pass the stored `context_summary`
there, or `""` when the profile has none. Task 15 reads the column; Task 16 writes it. Until both
land the column is dead weight, so do not skip either.

- [ ] **Step 4: Implement `surface.ts`**

Every string it emits is assembled from record fields. `detail: "top"` takes the first three
matches per profile ordered by `want` descending; `"full"` takes all of them. Degraded portals
always contribute an item regardless of detail level — a silent partial crawl is the failure mode
the spec forbids.

- [ ] **Step 5: Run both tests**

Run: `pnpm vitest run tests/unit/job-search-criteria.test.ts tests/unit/job-search-surface.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search/src/domain/criteria.ts \
        external-modules/job-search/src/domain/surface.ts \
        tests/unit/job-search-criteria.test.ts tests/unit/job-search-surface.test.ts
git commit -m "feat(job-search): add criteria extraction and briefing/notification shaping"
```

---

## Phase 3 — Source adapters

### Task 11: Portal interface and the freehire adapter

`freehire.me` first, because it is the widest source (~50 ATS boards behind one declared host), so it
proves the interface before LinkedIn.

**Read the probe results before writing a line of this.** They were measured with live `curl` on
2026-07-27 and they contradict freehire's own apparent API:

- `GET /api/jobs` — **404**. It does not exist. Documentation that says otherwise is wrong.
- `GET /api/v1/jobs` — 200, `{data: [...], meta: {limit, offset, total}}`, no key, `limit` capped at 100. The field mapping is good (`external_id, url, title, company, location, description,
posted_at, source, skills, countries, is_tech`). **But it accepts no filters at all.** Every
  parameter tried — `search, q, query, keyword(s), title, text, country, countries, work_mode,
regions, is_tech, collections, per_page` — returned the byte-identical unfiltered first page of
  `total: 3,278,266` rows, most of them non-English. As a targeted source it is useless.
- `GET /__data.json` — the SvelteKit SSR route, and **the only thing that filters**. `work_mode` and
  `regions` narrow 3.28M → ~600; free-text `q` works but is fuzzy (`q=nurse` → 478,
  `q=zzzznotarealterm` → 3 against a 624 baseline, `q=kubernetes` → 608 — barely a filter). The
  parameter names came from the site root, which 302s to `/?work_mode=remote&regions=global`.

So the adapter targets `__data.json` and treats it as **a fragile internal route, not a public API**.
That is a design constraint, not a caveat: the fuzzy `q` means the adapter must not trust the
server's relevance, so it over-fetches and lets Task 6's hard-exclude filter and Task 8's triage do
the narrowing. And because SvelteKit is free to change its payload envelope in any deploy, a shape it
does not recognise is a `parse_failed` cause that **disables the portal** with an honest summary —
never an empty result set that reads as "no jobs matched your search".

**Files:**

- Create: `external-modules/job-search/src/adapters/types.ts`
- Create: `external-modules/job-search/src/adapters/freehire.ts`
- Test: `tests/unit/job-search-adapter-freehire.test.ts`

**Interfaces:**

- Consumes: `Posting`, `FailureCause`, `describeFailure`.
- Produces:

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
       * `ctx.deadlineAt` and Task 14 narrows it per portal. Compare against `clock()`, not
       * `Date.now()` directly, so the deadline is testable without fake timers.
       *
       * There is deliberately no `signal` here. A worker-side `AbortSignal` cannot cancel an
       * in-flight `ctx.fetch` — the request crosses JSON-RPC and `ModuleFetchRequest` carries no
       * signal field (`packages/module-sdk/src/index.ts:682`). Cancelling a request already in
       * the host's hands is the host's job (Task 2e Step 5); a portal's whole share of it is this
       * cooperative check between fetches. Do not add a `signal` parameter here to make the two
       * look symmetrical — it would be a parameter nothing could honour. */
      deadlineAt: number;
      /** Test seam only. Defaults to `Date.now`. It exists so the two deadline cases in every
       * adapter's test can advance time deterministically instead of reaching for
       * `vi.useFakeTimers()`, which fights the promise scheduling in these tests. Production
       * callers (Task 14's `runCrawl`) pass nothing. */
      clock?: () => number;
    }): Promise<CrawlResult>;
  }
  ```

- [ ] **Step 1: Capture a real fixture first — you cannot write this parser from memory**

The `__data.json` payload is SvelteKit's own serialization format, not the page's data. It is a
**deduplicated** structure: `{"type":"data","nodes":[…]}`, where a node's `data` is a flat array and
every object value inside it is an _integer index into that same array_ rather than a value. A
hand-written expectation will be wrong.

```bash
curl -s 'https://freehire.me/__data.json?work_mode=remote&regions=global&q=software+engineer' \
  -H 'User-Agent: Jarvis-JobSearch/0.1 (personal use)' \
  -o tests/fixtures/job-search/freehire-data.json
```

Then trim it: keep the envelope and **three** postings, delete the rest. Strip anything identifying —
no cookies, no session ids, no tracking parameters. The fixture is committed; treat it as public.

Open it and write down, in the adapter's header comment, the two facts you need: which node index
holds the job list, and which keys of a job object carry title / company / location / url /
description / posted date. Those are the only things the parser depends on, and naming them makes
the next `parse_failed` a five-minute fix instead of an archaeology session.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/job-search-adapter-freehire.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { freehirePortal } from "../../external-modules/job-search/src/adapters/freehire";

const criteria = {
  titles: ["Software Engineer"],
  seniority: [],
  locations: ["Seattle, WA"],
  remote: "preferred",
  compFloorCents: null,
  excludeCompanies: [],
  mustHave: [],
  niceToHave: [],
  dealbreakers: [],
  wantNarrative: ""
} as never;

// The real captured payload. Asserting against a hand-written envelope would test the fixture we
// invented rather than the format freehire actually serves.
const fixture = readFileSync("tests/fixtures/job-search/freehire-data.json", "utf8");
const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });
// `deadlineAt` is required on `Portal.crawl` (Task 11). Every case that is not ABOUT the deadline
// passes one far enough out that it never fires — otherwise a slow CI box turns unrelated
// assertions into flakes. The two cases that are about the deadline set it deliberately.
const FAR_FUTURE = Date.now() + 10 * 60 * 1000;

describe("freehirePortal", () => {
  it("maps the captured __data.json payload onto Posting records", async () => {
    const fetch = vi.fn().mockResolvedValue(ok(fixture));

    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(out.failure).toBeNull();
    expect(out.postings).toHaveLength(3);
    // `id: ""` is the store's job to fill. Every field below must be a real value from the
    // fixture — no empty strings, which is the signature of an index that was read as a value.
    const first = out.postings[0]!;
    expect(first.id).toBe("");
    expect(first.sourceId).toBe("freehire");
    expect(first.externalId).not.toBe("");
    expect(first.title).not.toBe("");
    expect(first.company).not.toBe("");
    expect(first.url).toMatch(/^https:\/\//);
    expect(first.body.length).toBeGreaterThan(20);
  });

  it("sends q, work_mode and regions — the only three parameters that actually filter", async () => {
    const fetch = vi.fn().mockResolvedValue(ok(fixture));
    await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });
    const url = new URL(fetch.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/__data.json");
    expect(url.searchParams.get("q")).toBe("Software Engineer");
    // Probed: /api/v1/jobs ignores every parameter, so hitting it would return 3.28M unfiltered
    // rows. If this assertion ever fails because someone "fixed" the URL, read the header comment.
    expect(url.pathname).not.toContain("/api/");
  });

  it("returns a structured rate_limited cause on 429 and keeps what it had", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok(fixture))
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "" });

    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: "2026-07-25T06:00:00.000Z",
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });

    expect(out.postings).toHaveLength(3);
    expect(out.failure?.kind).toBe("rate_limited");
    expect(out.failure?.retrieved).toBe(3);
    expect(out.failure?.disabled).toBe(false);
  });

  it("returns login_required and disables itself on 401/403", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" });
    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });
    expect(out.failure?.kind).toBe("login_required");
    expect(out.failure?.disabled).toBe(true);
  });

  it("disables itself on an unrecognised envelope rather than reporting zero jobs", async () => {
    // The whole point of the route being internal. A SvelteKit deploy can change the envelope on
    // any Tuesday, and "0 postings" would read to the user as "nothing matched your search" —
    // the single most misleading thing this module could say.
    const fetch = vi
      .fn()
      .mockResolvedValue(ok('{"type":"data","nodes":[null,{"type":"redirect"}]}'));
    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });
    expect(out.postings).toEqual([]);
    expect(out.failure?.kind).toBe("parse_failed");
    expect(out.failure?.disabled).toBe(true);
    expect(out.failure?.summary).toMatch(/freehire/i);
  });

  it("returns parse_failed when the body is not JSON at all", async () => {
    const fetch = vi.fn().mockResolvedValue(ok("<html>"));
    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });
    expect(out.failure?.kind).toBe("parse_failed");
    expect(out.postings).toEqual([]);
  });

  it("returns what it has when the deadline expires between pages", async () => {
    // Two pages of fixture available, but the clock crosses the deadline after the first. The
    // adapter must return page one's postings and NOT fetch again. A `deadline` failure is not
    // an error the user should see — it is a partial result.
    let now = 1_000;
    const clock = () => now;
    const fetch = vi.fn().mockImplementation(async () => {
      now += 5_000; // each page costs five seconds
      return ok(fixture);
    });

    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: 4_000,
      clock
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(out.postings).toHaveLength(3);
    expect(out.failure?.kind).toBe("deadline");
    expect(out.failure?.disabled).toBe(false); // a slow run must never disable a portal
  });

  it("fetches nothing at all when the deadline has already passed", async () => {
    const fetch = vi.fn();
    const out = await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: 0,
      clock: () => 1_000
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(out.postings).toEqual([]);
    expect(out.failure?.kind).toBe("deadline");
  });

  it("stops paging at the page cap so one crawl cannot run forever", async () => {
    const fetch = vi.fn().mockResolvedValue(ok(fixture));
    await freehirePortal.crawl({
      fetch,
      criteria,
      lastOkAt: null,
      now: "2026-07-26T06:00:00.000Z",
      deadlineAt: FAR_FUTURE
    });
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-adapter-freehire.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `types.ts` and `freehire.ts`**

`id: ""` on emitted postings is intentional — the store assigns the uuid, and the adapter must not
invent one. Map HTTP status to `FailureKind` in one shared helper the other adapter reuses:

```ts
/** One mapping for every adapter. 401/403 is the login wall: by policy we stop
 * and disable rather than trying to get around it. */
export function statusToKind(status: number): FailureKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "login_required";
  if (status >= 500) return "network";
  return "parse_failed";
}
export const PAGE_CAP = 10;
```

The one piece of real work here is undoing SvelteKit's deduplication. Write it as a standalone
function so it is testable and so the next envelope change touches one place:

```ts
/** SvelteKit's `__data.json` stores each node's payload as a FLAT array in which every object
 * value is an integer INDEX into that same array, so repeated strings are stored once. Reading a
 * job object directly gives you numbers where you expected text — which is exactly what the
 * "no empty strings" assertions in the test are guarding against.
 *
 * Resolve indices lazily and defensively: a value that is not a valid index into `flat` is a
 * payload we do not understand, and the caller turns that into a disabling `parse_failed` rather
 * than into a posting with a blank company name. */
function resolve(flat: readonly unknown[], value: unknown): unknown {
  if (typeof value !== "number" || !Number.isInteger(value)) return value;
  if (value < 0 || value >= flat.length) throw new Error("freehire: index out of range");
  return flat[value];
}
```

Everything else follows the shared contract: honour `PAGE_CAP`, return partial results alongside a
`FailureCause`, send a plain descriptive `User-Agent` (`Jarvis-JobSearch/0.1 (personal use)`), and do
not impersonate a browser version string or rotate identities.

Two things this adapter must NOT do. It must not fall back to `/api/v1/jobs` when `__data.json`
fails — that endpoint ignores filters, so the "fallback" is 3.28 million mostly-irrelevant rows
presented as search results. And it must not narrow on the server's relevance: `q` is fuzzy enough
that `q=kubernetes` barely moves the count, so over-fetch and let Task 6 and Task 8 do the real
filtering.

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run tests/unit/job-search-adapter-freehire.test.ts`
Expected: PASS (all seven).

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search/src/adapters tests/unit/job-search-adapter-freehire.test.ts \
        tests/fixtures/job-search/freehire-data.json
git commit -m "feat(job-search): add portal interface and freehire adapter"
```

---

### Task 12: LinkedIn guest adapter

**Indeed is cut from v1 — do not write an adapter, a fixture, or a manifest host for it.** Probed
live on 2026-07-27: `GET https://www.indeed.com/jobs?q=…&l=…` returns **HTTP 403** with a 27 KB
`<title>Security Check - Indeed.com</title>` body carrying Cloudflare markers. It is not a
User-Agent or header problem — it wants a real browser, and v1 has none. Anyone revisiting this must
re-probe first rather than trusting a stale note that says Indeed works. (JobSpy's
`apis.indeed.com/graphql` static-key path was never probed here; it is a research task, not a v1
task.)

That leaves LinkedIn guest as the second source, and it is the clean one: no auth, no key, no
cookie.

**Files:**

- Create: `external-modules/job-search/src/adapters/linkedin.ts`
- Create: `tests/unit/job-search-adapter-linkedin.test.ts`
- Create: `tests/fixtures/job-search/linkedin-guest.html`

**Interfaces:**

- Consumes: `Portal`, `FetchLike`, `statusToKind`, `PAGE_CAP` from Task 11.
- Produces: `linkedinPortal: Portal`.

- [ ] **Step 1: Capture a real fixture**

Probed shape: `GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&location=…&start=0`
→ 200, ~28 KB of HTML fragment, 30 `base-card` entries per page. Pagination is the `start` offset.

```bash
curl -s 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%20engineer&location=Seattle%2C%20WA&start=0' \
  -H 'User-Agent: Jarvis-JobSearch/0.1 (personal use)' \
  -o tests/fixtures/job-search/linkedin-guest.html
```

Trim to **three** cards. Strip anything identifying — no cookies, no session ids, no `trk=` or other
tracking parameters on the extracted URLs. The fixture is committed; treat it as public.

- [ ] **Step 2: Write the failing test**

Mirror the freehire cases against this fixture — map to `Posting`, `rate_limited` on 429 keeping
partials, `login_required` + disabled on 403, `parse_failed` on an unrecognised body, `PAGE_CAP`
respected, **and both deadline cases** (expires between pages → page one's postings, one fetch, a
non-disabling `deadline` failure; already passed → zero fetches) — plus the two below, which are
LinkedIn-specific and are the reason this adapter is not just a copy. Declare the same
`const FAR_FUTURE = Date.now() + 10 * 60 * 1000;` here and pass it on every non-deadline case;
`deadlineAt` is a required parameter, so a call that omits it does not compile.

```ts
it("treats an auth-wall interstitial as login_required even though it returns 200", async () => {
  // LinkedIn answers 200 with a sign-in page rather than a 401. Reading that as
  // a parse failure would make us retry a wall forever; the spec says hard stop.
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () =>
      '<html><body><form action="/uas/login">Sign in to continue</form></body></html>'
  });
  const out = await linkedinPortal.crawl({
    fetch,
    criteria,
    lastOkAt: null,
    now: "2026-07-26T06:00:00.000Z",
    deadlineAt: FAR_FUTURE
  });
  expect(out.failure?.kind).toBe("login_required");
  expect(out.failure?.disabled).toBe(true);
});

it("stops paging when a page comes back with no cards", async () => {
  // The guest endpoint does not report a total or a next cursor — an empty fragment IS the
  // end-of-results signal. Without this the crawl walks `start` up to PAGE_CAP every single
  // time and spends nine requests learning nothing.
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => fixture })
    .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });
  const out = await linkedinPortal.crawl({
    fetch,
    criteria,
    lastOkAt: null,
    now: "2026-07-26T06:00:00.000Z",
    deadlineAt: FAR_FUTURE
  });
  expect(fetch.mock.calls).toHaveLength(2);
  expect(out.failure).toBeNull();
  expect(out.postings).toHaveLength(3);
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-adapter-linkedin.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the adapter**

The response is an HTML fragment, so parse it with a small tolerant extractor over the `base-card`
elements rather than a full DOM library — the module bundle has no DOM dependency and should not
gain one for this. Pull title, company, location, posting URL and the `datetime` attribute of the
listing date; the guest fragment does **not** carry the job description, so `body` is the card's
snippet text and Task 8's triage has to work with less signal from this source than from freehire.
Say that in a comment: it is a real asymmetry, not an oversight.

Guest endpoint only. Honour `PAGE_CAP`, return partial results alongside a `FailureCause`, and set a
plain descriptive `User-Agent` (`Jarvis-JobSearch/0.1 (personal use)`) — do not impersonate a browser
version string you have not verified, and do not rotate identities.

- [ ] **Step 5: Run the test plus a real smoke check**

```bash
pnpm vitest run tests/unit/job-search-adapter-linkedin.test.ts
```

Then hit the live endpoint once by hand and confirm the parser survives the real shape. Fixtures rot;
that check is the whole reason `parse_failed` exists as a first-class cause.

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search/src/adapters/linkedin.ts \
        tests/unit/job-search-adapter-linkedin.test.ts \
        tests/fixtures/job-search/linkedin-guest.html
git commit -m "feat(job-search): add LinkedIn guest-endpoint adapter"
```

---

## Phase 4 — Worker

### Task 13: Worker skeleton, ports, and input validation

**Files:**

- Read first: `external-modules/finance/src/worker/ports.ts`, `index.ts`, and its validator
- Create: `external-modules/job-search/src/worker/{index.ts,ports.ts,validate.ts,store-sql.ts}`
- Create: `external-modules/job-search/src/domain/store-port.ts`
- Test: `tests/unit/job-search-validate.test.ts`
- Test: `tests/unit/job-search-fetch-bridge.test.ts`
- Test: `tests/integration/job-search-store.test.ts` — the store against a real database, before
  any handler depends on it

**Interfaces:**

- Consumes: `FetchLike` (Task 11).
- Produces:

  ```ts
  export function toFetchLike(ctx: ModuleWorkerContext): FetchLike;
  ```

  ```ts
  // domain/store-port.ts — structural, no SDK import, so handlers unit-test with a fake.

  /** `Posting` (Task 5) deliberately has no embedding field — the domain filters and the
   * dedupe never look at vectors. The scoring stage does, and reading the postings and then
   * re-reading their vectors one at a time is a query per posting. Hence one widened row type
   * rather than an optional field on `Posting`. */
  export interface PostingWithEmbedding extends Posting {
    readonly embedding: readonly number[];
  }

  export interface JobSearchStore {
    listProfiles(): Promise<Profile[]>;
    getProfile(id: string): Promise<Profile | null>;
    createProfile(name: string): Promise<Profile>;
    updateCriteria(id: string, criteria: SearchCriteria): Promise<void>;
    setProfileState(profileId: string, state: ProfileState): Promise<void>;
    setProfileContext(profileId: string, context: ProfileContext): Promise<void>;
    setBriefingDetail(profileId: string, detail: BriefingDetail): Promise<void>;
    listPortals(profileId: string): Promise<PortalState[]>;
    setPortalState(profileId: string, state: PortalState): Promise<void>;
    upsertPostings(profileId: string, postings: readonly Posting[]): Promise<Posting[]>;
    setEmbedding(postingId: string, vector: readonly number[]): Promise<void>;
    listUnscored(profileId: string, limit: number): Promise<Posting[]>;
    /** What the scoring stage actually reads. */
    listUnscoredPostingsWithEmbeddings(
      profileId: string,
      limit: number
    ): Promise<PostingWithEmbedding[]>;
    /** `limit` is required, not optional: the SQL binds it as `$2` and the board is a paged
     *  surface. An interface that omits it and a query that binds it is how `$2` ends up
     *  `undefined` at runtime — the driver rejects the statement and every board read 500s. */
    listMatches(profileId: string, limit: number): Promise<Match[]>;
    upsertMatch(profileId: string, match: Omit<Match, "id">): Promise<void>;
    setMatchState(matchId: string, state: Match["state"]): Promise<void>;
    /** The résumé is versioned and first-class (Task 4). `getLatestResume` is what the
     * scoring prompt uses; `getResumeVersion` is what a match pinned to an older version
     * needs, so the board can say which résumé produced a score. */
    getLatestResume(profileId: string): Promise<Resume | undefined>;
    getResumeVersion(profileId: string, version: number): Promise<Resume | undefined>;
    setResume(profileId: string, content: string): Promise<Resume>;
    /** Module KV, not a profile column: the sweep's rotation cursor belongs to the sweep,
     * and it has to survive the profile it happens to be pointing at being deleted. */
    getSweepCursor(): Promise<number>;
    setSweepCursor(index: number): Promise<void>;
  }
  ```

  **This interface is closed.** No task after this one may call a store method that is not
  listed here. If a later task needs one, it is added here first, with its own test, in the
  same change — a handler written against a method that exists only in its own fake compiles,
  passes its unit test, and fails on the first real invocation.

  There is deliberately **no `setPortalEnabled`**. `PortalState` already carries `enabled`, so
  `setPortalState` is a read-modify-write away; a second method that writes one field of the
  same row is two ways to write the same state and one of them will drift.

- [ ] **Step 1: Write the failing validator test**

```ts
// tests/unit/job-search-validate.test.ts
import { describe, expect, it } from "vitest";
import { validateProfileInput } from "../../external-modules/job-search/src/worker/validate";

describe("validateProfileInput", () => {
  it("strips the host-injected actorUserId instead of rejecting the call", () => {
    // The host spreads actorUserId onto EVERY external tool input. A strict
    // unknown-key validator that does not strip it kills every call with
    // `unknown key: actorUserId`.
    expect(validateProfileInput({ profileId: "p1", actorUserId: "u1" })).toEqual({
      profileId: "p1"
    });
  });

  it("still rejects a genuinely unknown key", () => {
    expect(() => validateProfileInput({ profileId: "p1", sneaky: 1 })).toThrow(
      /unknown key: sneaky/
    );
  });

  it("rejects a missing profileId", () => {
    expect(() => validateProfileInput({})).toThrow(/profileId is required/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// external-modules/job-search/src/worker/validate.ts

/** The host spreads actorUserId onto every external tool input as an anti-spoof
 * measure (FIN-04). It is deliberate and it is not going away, so every strict
 * validator in this module strips it before checking for unknown keys. */
export function stripEnvelope(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  const { actorUserId: _ignored, ...rest } = raw as Record<string, unknown>;
  return rest;
}

export function validateProfileInput(raw: unknown): { profileId: string } {
  const input = stripEnvelope(raw);
  for (const key of Object.keys(input)) {
    if (key !== "profileId") throw new Error(`unknown key: ${key}`);
  }
  if (typeof input.profileId !== "string" || input.profileId.length === 0) {
    throw new Error("profileId is required");
  }
  return { profileId: input.profileId };
}
```

- [ ] **Step 4: Write the failing fetch-bridge test**

```ts
// tests/unit/job-search-fetch-bridge.test.ts
import { describe, expect, it, vi } from "vitest";
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";
import { toFetchLike } from "../../external-modules/job-search/src/worker/ports";

const ctxWith = (response: unknown) =>
  ({ fetch: vi.fn().mockResolvedValue(response) }) as unknown as ModuleWorkerContext;

describe("toFetchLike", () => {
  it("decodes the host's base64 body and derives ok from the status", async () => {
    const ctx = ctxWith({
      status: 200,
      headers: { "content-type": "application/json" },
      bodyBase64: Buffer.from('{"jobs":[]}', "utf8").toString("base64")
    });
    const res = await toFetchLike(ctx)("https://freehire.me/x");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"jobs":[]}');
  });

  it("reports a rate-limit status as not-ok rather than throwing", async () => {
    // The adapters branch on `ok` to build a structured FailureCause. If the bridge threw
    // here, the pass would lose the partial results the adapter had already collected.
    const ctx = ctxWith({ status: 429, headers: {}, bodyBase64: "" });
    const res = await toFetchLike(ctx)("https://linkedin.com/x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
  });

  it("passes request headers through to the host port in its own shape", async () => {
    const ctx = ctxWith({ status: 200, headers: {}, bodyBase64: "" });
    await toFetchLike(ctx)("https://freehire.me/x", { headers: { accept: "application/json" } });
    // One object argument, not (url, init) — this is the whole reason the bridge exists.
    expect(ctx.fetch).toHaveBeenCalledWith({
      url: "https://freehire.me/x",
      method: "GET",
      headers: { accept: "application/json" }
    });
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-fetch-bridge.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement `ports.ts`**

`ports.ts` follows the finance pattern — build a per-invocation dependency set from `ctx` — and it
owns the fetch bridge, because **`ctx.fetch` is not WHATWG fetch and the adapters must never learn
that it isn't**:

```ts
// external-modules/job-search/src/worker/ports.ts
import type { ModuleWorkerContext } from "@jarv1s/module-sdk/worker";
import type { FetchLike } from "../adapters/types";

/** Bridge the host's fetch port to the shape Task 11's adapters consume.
 *
 * `ctx.fetch` takes ONE object (`ModuleFetchRequest`) and resolves
 * `{status, headers, bodyBase64}` — `packages/module-sdk/src/index.ts:682-694`. There is no
 * `ok`, no `text()`, and the body is base64 because the host reads it as an ArrayBuffer
 * (`worker-rpc-host.ts:149`). Writing adapters against the real port would put base64 decoding
 * in every one of them; writing them against a fetch that does not exist would compile and then
 * fail on the first live crawl. So: one bridge, here.
 *
 * Three host behaviours the adapters inherit and must not be surprised by:
 * - Only four response headers survive — `content-type`, `content-length`, `last-modified`,
 *   `etag` (`worker-rpc-host.ts:143`). `set-cookie` is dropped, so no adapter can hold a
 *   session. That is consistent with the hard rule that a portal demanding login stops rather
 *   than signing in; it also means no adapter may be written to depend on one.
 * - A missing or non-matching `fetchHosts` entry in the manifest is an `invalid_rpc` throw, not
 *   a status code. Callers must treat a rejection as a `network` FailureCause, never as "zero
 *   postings found".
 * - Redirects are followed inside the host's own fetch; the adapter sees only the final status.
 */
export function toFetchLike(ctx: ModuleWorkerContext): FetchLike {
  return async (url, init) => {
    const response = await ctx.fetch({
      url,
      method: "GET",
      ...(init?.headers ? { headers: init.headers } : {})
    });
    // Decoded eagerly. The body is already fully in memory as base64, so a lazy `text()` buys
    // nothing and would only move a decode failure somewhere harder to attribute.
    const text = Buffer.from(response.bodyBase64, "base64").toString("utf8");
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => text
    };
  };
}
```

- [ ] **Step 6b: Implement `store-sql.ts`**

Every handler in Tasks 14–20 is written against this and unit-tested against a fake, so a store that
compiles and misbehaves is invisible until the first real invocation. It gets specified here and
tested against a real database in Step 6d — not left as "then write the SQL".

**Four constraints the SDK imposes on every method below.** They are not stylistic:

1. **`ctx.db.query` allows exactly SELECT / INSERT / UPDATE / DELETE** (`worker.ts:57-69`). There is
   no `BEGIN`, so **there are no multi-statement transactions**. Anything that must be atomic has to
   be one statement — a CTE, an `INSERT … SELECT`, or an `ON CONFLICT`. Every method below that
   looks like it needs a transaction is written as a single statement for exactly this reason.
2. **Never pass an actor id.** Every write sets `owner_user_id = app.current_actor_user_id()`, and
   no read filters on owner at all — the generated RLS policy already does
   (`module-rls-emitter.ts:46`, and the function is EXECUTE-granted to the runtime role at `:40`).
   A store method that accepts an `ownerUserId` argument is a store method that can be called with
   the wrong one.
3. **Positional `$1` params only**, and results are capped at 5000 rows / 5 MiB with a 5 s statement
   timeout. Every list method takes an explicit `limit`.
4. **`vector` has no JS binding.** Pass the embedding as pgvector's text form and cast:
   `$2::vector`, with `JSON.stringify([...vector])` producing `[0.1,0.2,…]`. Passing a JS array
   directly is a runtime type error; passing a float array as `text` without the cast silently
   stores nothing usable.

The methods that are not a one-line `SELECT … WHERE id = $1`:

```ts
// listProfiles — DETERMINISTIC ORDER IS PART OF THE CONTRACT. Task 15's sweep persists an INDEX
// into this list, so an unstable order makes the cursor point at a different profile each sweep
// and the rotation silently degenerates into random selection.
`SELECT id, name, state, criteria, context_summary, schedule, briefing_detail, surface_key,
        created_at
   FROM app.job_search_profiles
  ORDER BY created_at ASC, id ASC`; // id breaks ties — created_at is not unique under a fast test

// upsertPostings — one statement per batch, deduped on the natural key. Returns the stored rows
// so the caller learns which were new without a second read. `first_seen_at` is NOT touched on
// conflict: it is what "new since" means, and refreshing it on every crawl erases that.
`INSERT INTO app.job_search_postings
   (owner_user_id, profile_id, source_id, external_id, title, company, location, url, body, posted_at)
 SELECT app.current_actor_user_id(), $1, x.source_id, x.external_id, x.title, x.company,
        x.location, x.url, x.body, x.posted_at
   FROM jsonb_to_recordset($2::jsonb) AS x(source_id text, external_id text, title text,
        company text, location text, url text, body text, posted_at timestamptz)
 ON CONFLICT (owner_user_id, profile_id, source_id, external_id) DO UPDATE
   SET title = excluded.title, company = excluded.company, location = excluded.location,
       url = excluded.url, body = excluded.body, posted_at = excluded.posted_at
 RETURNING id, source_id, external_id, title, company, location, url, body, posted_at,
           first_seen_at`;

// setEmbedding — the cast is the whole point.
`UPDATE app.job_search_postings SET embedding = $2::vector WHERE id = $1`;

// listUnscoredPostingsWithEmbeddings — the scoring stage's ONE read. Unscored means "no match row
// yet", which is a NOT EXISTS, not a state column on the posting. Embedding returned as text and
// parsed in JS; there is no array binding on the way out either.
`SELECT p.id, p.source_id, p.external_id, p.title, p.company, p.location, p.url, p.body,
        p.posted_at, p.first_seen_at, p.embedding::text AS embedding
   FROM app.job_search_postings p
  WHERE p.profile_id = $1
    AND p.embedding IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM app.job_search_matches m WHERE m.posting_id = p.id)
  ORDER BY p.first_seen_at DESC
  LIMIT $2`; // hits job_search_postings_profile_idx

// listMatches — the board read. One join, both axes as separate columns, and NO expression that
// combines them; a `(fit + want)` anywhere in this file is the product invariant breaking at the
// last place it can still be caught structurally.
`SELECT m.id, m.posting_id, m.fit, m.want, m.fit_reason, m.want_reason, m.outside_frame, m.state,
        m.scored_at, p.title, p.company, p.location, p.url, p.source_id
   FROM app.job_search_matches m
   JOIN app.job_search_postings p ON p.id = m.posting_id
  WHERE m.profile_id = $1
  ORDER BY m.scored_at DESC NULLS LAST, m.id ASC
  LIMIT $2`; // hits job_search_matches_board_idx

// upsertMatch — idempotent on (profile, posting) so re-scoring a posting updates rather than
// duplicating. Re-scoring returns the row to `new` deliberately: a changed score is news.
`INSERT INTO app.job_search_matches
   (owner_user_id, profile_id, posting_id, fit, want, fit_reason, want_reason, outside_frame,
    state, scored_at)
 VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5, $6, $7, 'new', now())
 ON CONFLICT (owner_user_id, profile_id, posting_id) DO UPDATE
   SET fit = excluded.fit, want = excluded.want, fit_reason = excluded.fit_reason,
       want_reason = excluded.want_reason, outside_frame = excluded.outside_frame,
       state = 'new', scored_at = now()`;

// setPortalState — the whole row, one statement. `last_ok_at` uses COALESCE so a failure NEVER
// erases the last-known-good timestamp; that timestamp is the only thing that lets the degraded
// strip say how long a board has been down (Task 20, and Task 21 case 10 asserts it).
`INSERT INTO app.job_search_portals
   (owner_user_id, profile_id, source_id, enabled, last_ok_at, cause, updated_at)
 VALUES (app.current_actor_user_id(), $1, $2, $3, $4, $5::jsonb, now())
 ON CONFLICT (owner_user_id, profile_id, source_id) DO UPDATE
   SET enabled = excluded.enabled,
       last_ok_at = COALESCE(excluded.last_ok_at, app.job_search_portals.last_ok_at),
       cause = excluded.cause, updated_at = now()`;

// setResume — ATOMIC VERSION ALLOCATION. This one is a LOOP, not a statement, and the reason is
// worth reading before anyone "simplifies" it back.
//
// `INSERT … SELECT COALESCE(MAX(version),0)+1` races: under READ COMMITTED both concurrent
// statements read the same MAX before either inserts, both compute the same next version, and the
// UNIQUE constraint turns the second upload into a user-visible error.
//
// Locking the parent profile row FOR UPDATE inside the same statement does NOT fix it, and this is
// the trap. Blocking on a row lock does not give the waiting statement a new snapshot. Postgres
// re-evaluates the LOCKED ROW after the lock is released (EvalPlanQual), but the aggregate over
// `app.job_search_resumes` is a different relation and keeps the snapshot taken when the statement
// began — before the wait. So the second statement still computes the OLD maximum and still
// collides. The lock changes the timing and hides the bug in casual testing; it does not remove it.
//
// The DB port allows no BEGIN (`packages/module-sdk/src/worker.ts:57`), so we cannot hold a
// transaction across a read and a write. What we can do is make each ATTEMPT a fresh statement —
// and therefore a fresh snapshot — and let the unique constraint arbitrate:
//
//   * `ON CONFLICT DO NOTHING RETURNING` means a loser returns ZERO ROWS instead of throwing. It
//     is not an error path; it is the signal to try again.
//   * The next attempt is a new statement, so its MAX sees the winner's committed row and computes
//     the next version up.
//   * The retry is BOUNDED. An unbounded loop under a pathological writer is a worker that never
//     finishes and burns its whole invocation deadline on one upload.
//
// The `locked` CTE stays. It is no longer load-bearing for correctness, but it still scopes the
// write to a profile the actor owns in the same statement, and it collapses the common two-writer
// case into one retry instead of a thundering herd. `locked` must be REFERENCED by the insert (it
// is, in the FROM) — Postgres does not guarantee an unreferenced CTE runs at all.

const SET_RESUME_SQL = `WITH locked AS (
   SELECT id FROM app.job_search_profiles
    WHERE id = $1 AND owner_user_id = app.current_actor_user_id()
    FOR UPDATE
 ),
 next AS (
   SELECT COALESCE(MAX(r.version), 0) + 1 AS version
     FROM app.job_search_resumes r, locked
    WHERE r.profile_id = locked.id
 )
 INSERT INTO app.job_search_resumes (owner_user_id, profile_id, version, content)
 SELECT app.current_actor_user_id(), locked.id, next.version, $2
   FROM locked, next
 ON CONFLICT (owner_user_id, profile_id, version) DO NOTHING
 RETURNING id, version, content, updated_at`;

/** Five attempts. Each is a fresh snapshot, so N concurrent uploads need at most N attempts; five
 * covers every realistic case (a single user's résumé uploads) with margin. Exhausting it is a real
 * error, not a silent no-op — swallowing it would hand the caller a résumé that was never stored. */
const SET_RESUME_MAX_ATTEMPTS = 5;

async setResume(profileId: string, content: string): Promise<Resume> {
  for (let attempt = 0; attempt < SET_RESUME_MAX_ATTEMPTS; attempt += 1) {
    const rows = await ctx.db.query(SET_RESUME_SQL, [profileId, content]);
    // Zero rows has TWO causes and they must not be conflated:
    //   * the profile does not exist or is not ours — `locked` is empty, so the insert had no
    //     source row. Retrying will never help.
    //   * we lost the version race — `locked` matched but ON CONFLICT swallowed the insert.
    // Distinguish them, or a missing profile spins five times and then reports a phantom
    // concurrency failure.
    if (rows.length > 0) return toResume(rows[0]!);
    const owned = await ctx.db.query(
      `SELECT 1 FROM app.job_search_profiles WHERE id = $1 AND owner_user_id = app.current_actor_user_id()`,
      [profileId]
    );
    if (owned.length === 0) throw new Error(`setResume: no such profile ${profileId}`);
  }
  throw new Error(`setResume: version allocation contended out after ${SET_RESUME_MAX_ATTEMPTS} attempts`);
}

// getLatestResume
`SELECT id, version, content, updated_at FROM app.job_search_resumes
  WHERE profile_id = $1 ORDER BY version DESC LIMIT 1`;
```

**The sweep cursor is `ctx.kv`, not SQL.** Namespace `job-search.meta` (declared in Task 3's
manifest), key `sweep-cursor`.

**The stored value is an OBJECT, `{ index: number }` — not a bare JSON number.** `ctx.kv.get`
and `ctx.kv.set` are typed `Record<string, unknown>` in both directions
(`packages/module-sdk/src/worker.ts:20`), so a bare number is not storable and does not typecheck.
Wrap it:

```ts
async getSweepCursor(): Promise<number> {
  const stored = await ctx.kv.get("job-search.meta", "sweep-cursor");
  const index = stored?.index;
  // Validate on READ, not just on write. This value round-trips through storage the module does
  // not own; a hand-edited or half-written record must degrade to "start at the beginning",
  // never to a NaN that makes `rotate()` return an empty list and the sweep silently do nothing.
  return typeof index === "number" && Number.isInteger(index) && index >= 0 ? index : 0;
}

async setSweepCursor(index: number): Promise<void> {
  await ctx.kv.set("job-search.meta", "sweep-cursor", { index });
}
```

`getSweepCursor` returns `0` when the key is absent — a fresh install starting at profile zero is
the correct behaviour, not an error. It is deliberately not a table: the cursor belongs to the sweep, and a profile row cannot own
a value that has to survive that profile being deleted.

- [ ] **Step 6c: Implement `index.ts`**

`defineModuleWorker({handlers})` with an empty handler map for now. Tasks 15 and 16 fill it.

- [ ] **Step 6d: Write the real-database store test**

`tests/integration/job-search-store.test.ts`, and it runs **before** any handler depends on the
store. Everything above is invisible to a fake. Eight cases, each one aimed at a specific way the
SQL above can be wrong while typechecking:

1. **`listProfiles` is stable across calls** with profiles created inside the same millisecond —
   this is what the `id ASC` tiebreak is for, and without it the test is flaky rather than failing.
2. **`upsertPostings` twice with the same natural key** yields one row, updated fields, and an
   **unchanged `first_seen_at`**.
3. **`setEmbedding` then `listUnscoredPostingsWithEmbeddings`** round-trips a 768-vector and
   `vector_dims` reports 768. This is the cast working end to end.
4. **A posting with a match row is excluded** from `listUnscoredPostingsWithEmbeddings`, and one
   without it is included.
5. **Concurrent `setResume`** — fire two on **two separate connections** without awaiting the
   first, assert versions 1 and 2 and no error. Two rules make this a real test: same-connection
   calls serialize for free and prove nothing, and sequential calls pass against the racy
   read-then-insert. What this exercises is the retry loop: a `FOR UPDATE`-only implementation
   fails this case, because waiting on the parent lock does not refresh the snapshot the version
   aggregate reads from. Assert **no error surfaced** as well as the two versions — the whole point
   of `ON CONFLICT DO NOTHING` is that the loser retries instead of throwing at the user. Then a
   third case in the same shape: `setResume` against a profile id that does not exist must throw
   **immediately**, not after five attempts, and the message must say "no such profile" rather than
   anything about contention.
6. **`setPortalState` with a failure cause preserves `last_ok_at`** from the previous success.
7. **`getSweepCursor` on a fresh install returns 0**, and survives a `setSweepCursor` followed by a
   profile delete. Then inspect the **stored KV payload directly** and assert it is
   `{ index: 3 }` — an object, not a bare `3`. This is the case that catches a store which
   typechecks against a `Promise<number>` façade while writing a shape the KV port cannot hold.
8. **A corrupt cursor reads as 0, not as NaN.** Write `{ index: "seven" }` into the same KV key,
   then call `getSweepCursor` and assert `0`. Without the read-side validation this returns
   `NaN`, `rotate()` produces an empty list, and the sweep does nothing forever without an error.

All of it through `createAppRuntimeRunner().withDataContext({actorUserId})` — the migration-owner
role is `NOBYPASSRLS`, so a raw query against these FORCE-RLS tables returns zero rows and every one
of these assertions passes for the wrong reason.

- [ ] **Step 7: Run every test in this task and typecheck**

```bash
pnpm vitest run tests/unit/job-search-validate.test.ts tests/unit/job-search-fetch-bridge.test.ts \
  && pnpm test:integration tests/integration/job-search-store.test.ts \
  && pnpm check:external-modules
```

Expected: PASS all three. The store test needs the module installed, so run it after Task 4's
migrations have been applied to the test database.

- [ ] **Step 8: Commit**

```bash
git add external-modules/job-search/src/worker external-modules/job-search/src/domain/store-port.ts \
        tests/unit/job-search-validate.test.ts tests/unit/job-search-fetch-bridge.test.ts \
        tests/integration/job-search-store.test.ts
git commit -m "feat(job-search): add worker skeleton, store port, fetch bridge, and envelope-safe validation"
```

---

### Task 14: Crawl stage

**This produces a function, not a handler.** Nothing in this task appears in the manifest. A worker
handler cannot enqueue anything — `ModuleWorkerContext` has no jobs port — so crawl and score cannot
be two queued steps that hand off to each other. They are two _stage functions_ composed inside one
invocation by Task 15. Keeping them as separate pure functions is what lets each be unit-tested
against a fake store without an SDK, a network, or a model. The directory name `stages/` is
load-bearing: a file in `handlers/` is something the manifest names, and this is not.

**Files:**

- Create: `external-modules/job-search/src/worker/stages/crawl.ts`
- Test: `tests/unit/job-search-crawl-stage.test.ts`

**Interfaces:**

- Consumes: `JobSearchStore` (Task 13), `Portal` / `FetchLike` (Task 11), `applyHardExcludes`
  (Task 6), `dedupePostings` (Task 7), `FailureCause` (Task 5).
- Produces:

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

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-crawl-stage.test.ts
import { describe, expect, it, vi } from "vitest";
import { runCrawl } from "../../external-modules/job-search/src/worker/stages/crawl";
```

Cover, each as its own `it`, against an in-memory fake `JobSearchStore`:

1. A clean crawl stores deduped postings and records `lastOkAt` for each portal.
2. **One portal failing does not lose the others' results** — a `rate_limited` LinkedIn alongside a
   healthy freehire stores freehire's postings and records LinkedIn's cause in `degraded`.
3. A `login_required` portal is written back with `enabled: false`.
4. **A disabled portal is not crawled on the next pass** — assert its `crawl` was never called.
5. Postings are embedded through `embedDocuments` in batches of ≤128 (Task 1's cap), and
   `embedQuery` is never called here — the criteria embedding belongs to the triage stage, and
   calling the wrong one silently degrades retrieval because the task prefix differs.
6. **The stage never writes a `fit` or `want` value** — crawling and scoring are separate stages,
   and a posting that has been crawled but not scored must be visibly `unscored` rather than
   silently absent.
7. **Past the deadline, the stage stops and says so.** Two portals, a clock that jumps past
   `deadlineAt` during the first one; assert the second portal's `crawl` was never called, that the
   first portal's postings were still stored, and that `truncated` is `true`:

```ts
it("stops starting portals past the deadline and reports that it did", async () => {
  // Crawl and score share ONE invocation (see Task 15). A slow first portal must not eat the
  // whole budget and leave the user with fresh postings and no scores — the worst outcome,
  // because the board would fill with rows that all read "unscored".
  let t = 0;
  const clock = () => t;
  const slow = portalStub("freehire", () => {
    t = 100_000;
  });
  const other = portalStub("linkedin", () => {});
  const out = await runCrawl({
    ...base,
    portals: [slow, other],
    deadlineAt: 60_000,
    clock
  });
  expect(other.crawl).not.toHaveBeenCalled();
  expect(out.kept).toBeGreaterThan(0);
  expect(out.truncated).toBe(true);
});
```

8. **A portal that throws does not prevent later portals from running**, and its `PortalState.cause`
   records the failure. This is test 2 one level lower: test 2 covers a portal that _reports_ a
   failure, this one covers a portal that rejects. Assert the second portal's `crawl` was called,
   its postings were stored, and the thrower's state carries a cause rather than a healthy
   `lastOkAt`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-crawl-stage.test.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement `runCrawl`**

Sequence per profile: list enabled portals → walk them **one at a time**, checking the deadline
before each → `dedupePostings` with priority `["freehire", "linkedin"]` → `applyHardExcludes` →
`upsertPostings` → `embedDocuments` in batches of 128 → `setEmbedding`. Write every portal's
`PortalState` back, healthy or not.

**Sequential, not `Promise.allSettled`.** `allSettled` starts every portal in the same tick, which
makes the deadline check above unreachable — portal two is already in flight before the clock is
ever consulted, so test 7 cannot pass. Isolation comes from the `try`/`catch` inside the loop, not
from the combinator:

Every argument is named. **Do not spread** — an earlier revision wrote `portal.crawl({ ...input,
deadlineAt })` against an `input` that this function does not have, which is not implementable and
would have hidden a missing field behind a type that structurally happened to fit.

```ts
// `portals` is what `store.listPortals(profileId)` returned, filtered to enabled.
// `criteria` and `lastOkAt` come from the store; `deps.now` and `deps.clock` are injected.
const results: PortalResult[] = [];
for (const [index, portal] of portals.entries()) {
  if (clock() >= deadlineAt) {
    results.push({ sourceId: portal.id, status: "skipped", cause: "deadline" });
    continue; // still recorded, so the board can say why
  }

  // Each portal gets an EQUAL SHARE OF WHAT IS LEFT, recomputed every iteration rather than
  // divided once up front. A portal that finishes early hands its unused time to the ones after
  // it; a portal that overruns eats only its own share. Dividing once would let portal one
  // consume the whole window and leave portal two a slice that has already expired.
  const remainingPortals = portals.length - index;
  const portalDeadlineAt = Math.min(
    deadlineAt,
    clock() + Math.floor((deadlineAt - clock()) / remainingPortals)
  );

  try {
    // No `signal` — `Portal.crawl` has no such parameter and could not honour one (Task 11).
    // The clock check above plus this per-portal number are the module's entire share of
    // cancellation.
    const result = await portal.crawl({
      fetch: deps.fetch,
      criteria,
      lastOkAt: portal.lastOkAt,
      now: deps.now,
      deadlineAt: portalDeadlineAt
    });
    results.push({ sourceId: portal.id, status: "ok", result });
  } catch (error) {
    // One portal failing must never abort the stage — record the cause and continue.
    results.push({ sourceId: portal.id, status: "error", cause: describe(error) });
  }
}
```

`truncated` is `true` if any portal was skipped for time **or** any `CrawlResult.failure` has kind
`"deadline"`. A portal that stopped at its own slice with partial postings is still a truncated
stage, and Task 15 has to be able to say "checked 1 of 2 boards".

Running the portals concurrently would also put both boards' full paging load on the wire at once
against a shared per-invocation deadline, so the slow one gets no more wall-clock than it does here
and the fast one gets less headroom to finish cleanly.

Two rules that are easy to get wrong:

- **Write portal state before returning, even on the truncated path.** A portal that was skipped for
  time keeps its previous state; a portal that failed records its cause. Losing this write is how a
  board ends up claiming a board is healthy when it has been failing for a week.
- **A rejected `crawl` promise is a `network` cause, never zero postings.** `ctx.fetch` throws
  `invalid_rpc` when the manifest's `fetchHosts` does not cover the URL, and that must not be
  reported to the user as "no jobs matched".

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-crawl-stage.test.ts`
Expected: PASS (all eight).

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/worker/stages/crawl.ts \
        tests/unit/job-search-crawl-stage.test.ts
git commit -m "feat(job-search): add the crawl stage with per-portal isolation and a deadline"
```

---

### Task 15: Score stage, the single-pass handler, and surfacing

Two things land here. First the scoring stage, in the same shape as Task 14 — a pure function over a
fake store. Then the module's two queue handlers: `crawl.run`, which runs crawl, then triage, then
score, for **one** profile inside one invocation, because it has no other choice; and `crawl.sweep`,
which exists because schedules fan out one job per _user_, not per profile, so something has to list
the actor's own profiles and walk them.

**Those are two declared queues, not one queue with two handlers.** A schedule can only ever reach
the handler of the queue it names — `job-reconciler.ts` resolves `queueByName.get(schedule.queue)`
and calls `boss.schedule(queue.name, …)`, and the job handler always invokes `queue.handler` with no
per-job override. A manifest that declares only `job-search.crawl-run` and points the schedule at it
makes `crawl.sweep` **unreachable code**, and the scheduled job arrives at `crawl.run` with
`params: {}` and no profile to crawl. That is the single most likely way this module ships looking
fine and never runs.

**Files:**

- Create: `external-modules/job-search/src/worker/stages/score.ts`
- Create: `external-modules/job-search/src/worker/handlers/pass.ts` — `crawl.run` and `crawl.sweep`
- Create: `external-modules/job-search/src/worker/job-input.ts` — the queue-envelope parser
- Create: `external-modules/job-search/src/worker/handlers/briefing.ts`
- Create: `external-modules/job-search/src/worker/handlers/matches.ts` — `matches.list` and
  `match.set-state`, the only path by which the board reaches the database (Step 12b)
- Modify: `external-modules/job-search/src/worker/index.ts` — register the handlers
- Modify: `external-modules/job-search/jarvis.module.json` — **both** queues
  (`job-search.crawl-run` → `crawl.run`, `job-search.crawl-sweep` → `crawl.sweep`), the schedule
  pointed at the **sweep** queue, and the `job-search.crawl.run-now` and `job-search.matches.list` /
  `job-search.match.dismiss` tools
- Test: `tests/unit/job-search-score-stage.test.ts`
- Test: `tests/unit/job-search-pass-handler.test.ts`
- Test: `tests/unit/job-search-job-input.test.ts`
- Test: `tests/unit/job-search-match-handler.test.ts`

**Interfaces:**

- Consumes: `runCrawl` / `EmbedPort` (Task 14), `triage` (Task 8), `buildScorePrompt`,
  `parseScoreResult`, `SCORE_SCHEMA` (Task 9), `buildBriefingContribution`, `newMatchCount`
  (Task 10), `JobSearchStore` (Task 13), `ctx.deadlineAt` (Task 2e — a number this handler compares
  against a clock, and the only cancellation surface the worker has; there is no `ctx.signal`).
- Produces:

  ```ts
  /** The AI dependency, typed as the REAL host contract. `ctx.ai.generateStructured` returns an
   * envelope, never a bare object, and never throws for a modelling failure — it reports one.
   * Typing this as `Promise<unknown>` is how a module ends up doing `result.fit` on
   * `{ok: false, error: "needs_config"}` and writing `undefined` into a score column. */
  export interface AiPort {
    generateStructured(input: {
      schema: Record<string, unknown>;
      prompt: string;
      maxOutputTokens?: number;
      tierHint?: "reasoning" | "interactive" | "economy";
    }): Promise<
      | { ok: true; object: unknown }
      | {
          ok: false;
          error:
            | "needs_config"
            | "validation_failed"
            | "provider_error"
            | "usage_limited"
            | "aborted";
        }
    >;
  }

  /** Task 2b's `ctx.notify` verbatim. `key` is required here even though the port makes `href`
   * optional: Task 2b dedupes on `key`, so omitting it makes every pass post a fresh
   * "N new matches" row instead of updating one. Use `new-matches:${profileId}`. */
  export interface NotifyPort {
    post(input: { key: string; title: string; body: string; href?: string }): Promise<void>;
  }

  /** The platform's hard cap, enforced PARENT-SIDE per invocation:
   * `worker-rpc-host.ts` exports `AI_CALLS_PER_INVOCATION_CAP = 8` and returns
   * `{ok:false, error:"usage_limited"}` on call nine. So this is the budget for the WHOLE
   * invocation — for a sweep, that is every profile put together, not eight each. */
  export const AI_CALL_BUDGET = 8;

  export async function runScore(deps: {
    store: JobSearchStore;
    embed: EmbedPort;
    ai: AiPort;
    notify: NotifyPort;
    profileId: string;
    /** Calls this stage may spend. Never larger than AI_CALL_BUDGET minus whatever the
     *  invocation already spent. Zero is legal and means "make no AI calls at all". */
    budget: number;
    now: string;
    deadlineAt: number;
    clock: () => number;
  }): Promise<{
    scored: number;
    deferred: number;
    failed: number;
    /** AI calls actually made. The sweep subtracts this from its remaining budget, so a stage
     *  that under-reports silently blows the platform cap on the next profile. */
    aiCallsUsed: number;
    /** Set when the stage stopped for a reason the user should be told about, rather than
     * because it ran out of postings. Rendered by Task 20's degraded strip. */
    halted: null | {
      reason: "needs_config" | "usage_limited" | "deadline" | "aborted" | "provider_error";
      detail: string;
    };
  }>;

  export async function contributeToBriefing(deps: {
    store: JobSearchStore;
    detail: "count" | "top" | "full";
  }): Promise<BriefingContribution>;
  ```

  ```ts
  // job-input.ts — the QUEUE envelope. Task 13's validateProfileInput handles the TOOL shape.
  export interface JobEnvelope {
    readonly actorUserId: string;
    readonly jobKind: string;
    readonly idempotencyKey: string;
    readonly params: Record<string, unknown>;
  }
  export function parseJobEnvelope(raw: unknown): JobEnvelope;
  ```

- [ ] **Step 1: Write the failing envelope test**

`ctx.input` has **two different shapes** depending on how the module was invoked, and this is the
single easiest thing in the whole module to get wrong:

| Invoked via                                                          | `ctx.input` is                                   |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| an assistant tool (`apps/api/src/external-module-tools.ts:82`)       | `{...toolInput, actorUserId}`                    |
| a queue job (`apps/worker/src/external-module-job-handler.ts:88-96`) | `{actorUserId, jobKind, idempotencyKey, params}` |

A handler written against the tool shape reads `input.profileId` on a queue job and finds nothing,
because the profile id is one level down in `params`. It does not crash — it silently does nothing,
which is why this needs its own parser and its own test.

The parser is **strict**: the host builds this object itself from exactly four literals
(`external-module-job-handler.ts:88-96`), so any other shape means the host contract changed under
us, and running against a shape we do not understand is worse than failing.

Two rules that look contradictory and are not, so write both down where the next person will read
them:

- **`actorUserId` is a first-class field here and is never stripped.** The external-module rule that
  a validator must _tolerate_ a host-spread `actorUserId` applies to **tool input schemas**, where
  the host adds it to a module-authored shape. This envelope is host-authored end to end. Do not
  "harmonise" the two.
- **`deadlineAt` is not in this envelope.** Task 2e ships it in the `module.invoke` params beside
  `input`, and the SDK exposes it as `ctx.deadlineAt` — a number, and the only cancellation
  surface the child has. If a future change moves it
  into the input envelope instead, it must be added to the allowed-key set in the same edit or
  **every job fails on an unknown key**.

```ts
// tests/unit/job-search-job-input.test.ts
import { describe, expect, it } from "vitest";
import { parseJobEnvelope } from "../../external-modules/job-search/src/worker/job-input";

const VALID = {
  actorUserId: "u1",
  jobKind: "job-search.crawl-sweep",
  idempotencyKey: "job-search:job-search.crawl-sweep:42",
  params: { profileId: "p1" }
};

describe("parseJobEnvelope", () => {
  it("reads exactly the four fields the queue path sends", () => {
    expect(parseJobEnvelope(VALID)).toEqual(VALID);
  });

  it("accepts the sweep's empty params object", () => {
    // The scheduled sweep declares no params, and the host sends `params: {}` because it
    // writes `params: job.data.params ?? {}`. Empty is valid; ABSENT is not.
    expect(parseJobEnvelope({ ...VALID, params: {} }).params).toEqual({});
  });

  it("rejects an unknown top-level key", () => {
    // The host sends four literals. A fifth means the contract moved.
    expect(() => parseJobEnvelope({ ...VALID, extra: 1 })).toThrow(/unknown key extra/);
  });

  it.each([
    ["an array", []],
    ["null", null],
    ["a scalar", "x"],
    ["absent", undefined]
  ])("rejects params that is %s", (_label, params) => {
    // `typeof [] === "object"` is true, so an array slips through a naive object check and
    // every `params.profileId` read afterwards is silently undefined.
    const input: Record<string, unknown> = { ...VALID };
    if (params === undefined) delete input.params;
    else input.params = params;
    expect(() => parseJobEnvelope(input)).toThrow(/params/);
  });

  it("rejects a tool-shaped input rather than treating it as a job", () => {
    // `{profileId, actorUserId}` is the TOOL shape. If a queue handler is ever wired to a
    // tool by mistake, failing loudly here is far better than a handler that runs against
    // `params: undefined` and reports success having done nothing.
    expect(() => parseJobEnvelope({ profileId: "p1", actorUserId: "u1" })).toThrow(
      /unknown key profileId/
    );
  });

  it("rejects a missing actorUserId", () => {
    // Everything this module stores is owner-scoped. There is no sensible default.
    expect(() => parseJobEnvelope({ jobKind: "k", idempotencyKey: "i", params: {} })).toThrow(
      /actorUserId/
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-job-input.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `job-input.ts`**

```ts
// external-modules/job-search/src/worker/job-input.ts

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The queue path's `ctx.input`, verbatim from
 * `apps/worker/src/external-module-job-handler.ts:88-96`. The host builds this object itself
 * from four literals, so anything else is a wiring mistake or a contract change — fail loudly
 * rather than run against a shape we do not understand. */
export interface JobEnvelope {
  readonly actorUserId: string;
  readonly jobKind: string;
  readonly idempotencyKey: string;
  readonly params: Record<string, unknown>;
}

const ALLOWED = new Set(["actorUserId", "jobKind", "idempotencyKey", "params"]);

export function parseJobEnvelope(raw: unknown): JobEnvelope {
  if (!isPlainObject(raw)) throw new Error("invalid envelope: not an object");
  for (const key of Object.keys(raw)) {
    if (!ALLOWED.has(key)) throw new Error(`invalid envelope: unknown key ${key}`);
  }
  const { actorUserId, jobKind, idempotencyKey, params } = raw;
  if (typeof actorUserId !== "string" || actorUserId.length === 0) {
    throw new Error("invalid envelope: actorUserId");
  }
  if (typeof jobKind !== "string" || jobKind.length === 0) {
    throw new Error("invalid envelope: jobKind");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new Error("invalid envelope: idempotencyKey");
  }
  // `params: []` passes `typeof x === "object"`. Rejecting it here is the whole reason this
  // helper exists rather than an inline cast.
  if (!isPlainObject(params)) throw new Error("invalid envelope: params");
  return { actorUserId, jobKind, idempotencyKey, params };
}
```

- [ ] **Step 4: Write the failing score-stage test**

```ts
// tests/unit/job-search-score-stage.test.ts
```

Cover, each as its own `it`:

1. Triage picks the batch; only selected postings are sent to the model.
2. `outsideFrame` from triage is persisted onto the match, so the recall slice stays visibly flagged.
3. **An `{ok: true}` envelope whose `object` fails `parseScoreResult` leaves the posting `unscored`**
   and increments `failed`. It never lands as a number, and it is retried next pass.
4. **One bad result does not abort the batch** — the other postings still score.
5. **`needs_config` halts the stage immediately and scores nothing further.** Retrying it is
   pointless: no model is configured, so every remaining call returns the same thing. Assert
   `ai.generateStructured` was called exactly once and `halted.reason` is `"needs_config"`.
6. **`usage_limited` halts and leaves the remaining postings `unscored`, not `failed`.** They are
   perfectly good postings that nobody looked at yet, and marking them `failed` would hide them from
   the next pass's retry:

```ts
it("stops on usage_limited and leaves the rest unscored rather than failed", async () => {
  const ai = {
    generateStructured: vi
      .fn()
      .mockResolvedValueOnce({ ok: true, object: goodScore })
      .mockResolvedValue({ ok: false, error: "usage_limited" })
  };
  const out = await runScore({ ...base, ai, budget: 8 });
  expect(out.scored).toBe(1);
  expect(out.failed).toBe(0); // NOT failed — untouched
  expect(out.halted?.reason).toBe("usage_limited");
  // The 8-call cap is per invocation and resets next pass; these postings are still fine.
  expect(await store.listUnscored("p1", 100)).toHaveLength(2);
});
```

7. **`aborted` ends the stage.** The host has torn down the invocation's controller, so every
   remaining call returns `aborted` too; continuing the loop turns a clean partial result into a
   page of failures. Assert exactly one call, zero `failed`, and `halted.reason === "aborted"`.
   Note what this test does _not_ do: it never constructs an `AbortSignal`. The module has none to
   give — the fake `ai` port simply returns the envelope, exactly as the host's would.
8. **`provider_error` gets exactly one retry across the whole stage, on the same posting.** First
   occurrence: retry the same posting. Second occurrence anywhere in the stage: halt with
   `"provider_error"`. Assert three things — that the two calls after the first `provider_error`
   carried the **same posting id** in their prompt (`expect(ai.generateStructured.mock.calls[0][0].prompt)
.toContain(postings[0].id)` and the same for `calls[1]`), that no posting was skipped, and that
   the second occurrence halts. A retry written as a bare `continue` passes a call-count assertion
   while silently dropping the posting it claimed to retry, which is exactly why the prompt
   assertion is here.
9. **`validation_failed` is per-posting** — increment `failed`, leave the posting `unscored`, keep
   going. It is the one error the _model_, not the platform, caused.
10. **The stage never makes more than its `budget` calls**, and never more than `AI_CALL_BUDGET`.
    Assert with 40 candidate postings and `budget: 8` that `generateStructured` was called exactly
    8 times and `deferred` is the remainder — the 9th call returns `usage_limited` anyway, so
    spending it to discover that is pure waste.
11. **`budget: 0` makes no AI calls at all** and returns `aiCallsUsed: 0` without an error. The
    sweep hands out zero when the invocation's budget is spent, and that is a normal outcome.
12. **`aiCallsUsed` equals the number of `generateStructured` calls**, including the ones that
    returned failures. A retry counts. This is the number the sweep does its arithmetic on.
13. **A retry cannot exceed `budget`.** `budget: 1`, one candidate posting, first call returns
    `provider_error`: assert `generateStructured` was called exactly **once** and the stage halted
    `"usage_limited"` rather than spending a second call it was not given.
14. **A retry cannot exceed `AI_CALL_BUDGET` either.** Eight candidate postings with `budget: 8`
    where the first returns `provider_error`: assert exactly eight calls total — the retry consumes
    the eighth posting's call, and the eighth posting is deferred, not scored. Without the counter
    this is nine, and the ninth returns `usage_limited` from the host after already spending it.
15. A notification fires **once per pass** with the new-match count, not once per match.
16. **The notification body never contains a blended number** — assert against
    `/\b(overall|combined|score of)\b/i`.

- [ ] **Step 5: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-score-stage.test.ts`
Expected: FAIL.

- [ ] **Step 6: Implement `runScore`**

`embedQuery` the criteria text and the profile's `context_summary` → compute both similarity maps
against the stored posting vectors → `triage` → take at most `min(budget, AI_CALL_BUDGET)` of the
selected postings → for each, `buildScorePrompt` → `ai.generateStructured({schema: SCORE_SCHEMA,
prompt, tierHint: "reasoning"})` → branch on the envelope → `parseScoreResult` → `upsertMatch`.
Then one `notify.post` carrying `newMatchCount`.

The envelope branch is the whole point of the task, so write it as an explicit switch rather than a
truthiness check. **Five typed errors, four behaviours** — and the loop is written out around it,
because the retry rule is a property of the loop and not of the switch:

```ts
/** Getting this wrong is silent: a module that treats the envelope as the object writes
 * `undefined` into `fit` and `want`, and the board renders two blank axes with no explanation
 * anywhere. */
for (const posting of selected) {
  if (clock() >= deadlineAt) {
    return halt("deadline", "Ran out of time before every posting was read.");
  }

  // The inner loop and its label exist for one reason: "retry the same posting" and "move to
  // the next posting" are DIFFERENT instructions, and a bare `continue` inside the switch
  // below means the second one. Retrying by writing `continue` in a per-posting loop silently
  // skips the posting it claims to be retrying, and every test that only counts calls passes.
  attempts: for (let attempt = 1; attempt <= 2; attempt += 1) {
    // The cap is on CALLS, and a retry is a call. Taking `min(budget, AI_CALL_BUDGET)` postings
    // up front bounds the *initial* calls only — one retry on top of a full batch is one call
    // over both the stage's budget and the host's per-invocation cap, and the host answers that
    // call with `usage_limited` (`worker-rpc-host.ts:212-214` increments BEFORE the check, so a
    // rejected attempt still spends the budget). Count here, and check before every call
    // including the retry, so the stage never asks for a call it cannot have.
    if (callsUsed >= Math.min(budget, AI_CALL_BUDGET)) {
      return halt("usage_limited", "Reached this run's model-call limit.");
    }
    callsUsed += 1;

    const result = await ai.generateStructured({
      schema: SCORE_SCHEMA,
      prompt: buildScorePrompt(posting, criteria, contextSummary),
      tierHint: "reasoning"
    });

    if (result.ok) {
      const parsed = parseScoreResult(result.object);
      if (!parsed.ok) {
        failed += 1; // shape came back wrong — never write a partial score
        break attempts;
      }
      await store.upsertMatch(toMatch(posting, parsed.value));
      scored += 1;
      break attempts;
    }

    switch (result.error) {
      // No model is configured for this module. Every remaining call returns exactly this, so
      // burning the rest of the budget to hear it seven more times helps nobody. Halt, and let
      // Task 20's degraded strip tell the user to configure a model — that is a settings
      // problem with a settings fix, not a failure of the search.
      case "needs_config":
        return halt("needs_config", "No AI model is configured for Job Search.");
      // The per-invocation cap. Same reasoning, different remedy: nothing is broken and the
      // next scheduled pass picks up where this one stopped.
      case "usage_limited":
        return halt("usage_limited", "Reached this run's model-call limit.");
      // The HOST aborted the call it was holding — the invocation hit Task 2e's ceiling and the
      // host-side controller fired. This module never passes a signal anywhere (nothing accepts
      // one); this member is reachable purely because of that host-side plumbing. Every
      // remaining call would return `aborted` too. Stop now: the remaining postings stay
      // `unscored` and the next run picks them up, which is a clean partial result rather than
      // a page of failures nobody caused.
      case "aborted":
        return halt("aborted", "Ran out of time before every posting was read.");
      // Transient at the provider. Retry ONCE, for the whole stage — not once per posting, or
      // a provider that is down is hammered for every remaining posting in the batch.
      case "provider_error":
        if (retriedProviderError) {
          return halt("provider_error", "The model provider is not responding.");
        }
        retriedProviderError = true;
        continue attempts; // SAME posting — this is the label's entire reason to exist
      // The model produced something that did not fit SCORE_SCHEMA. That is this posting's
      // problem, not the batch's — count it and move on. Never write a partial score.
      case "validation_failed":
        failed += 1;
        break attempts; // next POSTING
    }
  }
}
```

The rule in prose, because the switch is easy to "simplify" back into one branch: **`needs_config`,
`usage_limited`, and `aborted` end the stage; `validation_failed` is per-posting;
`provider_error` gets exactly one retry across the whole stage.**

The `attempt <= 2` bound is belt-and-braces: `retriedProviderError` is what actually enforces the
one-retry rule, and the bound guarantees the inner loop terminates even if someone later edits that
flag wrong. Assert both — that the two `generateStructured` calls after a `provider_error` received
the **same posting** in their prompt, and that no posting is skipped by the retry.

**Cancellation, precisely.** Check `clock() < deadlineAt` before each call and halt with
`"deadline"` when it passes. That check is this module's entire share of cancellation: it stops a
call that has not started. A call already in flight is stopped by the **host**, which owns the
invocation's `AbortController` (Task 2e Step 5) — the module has no way to reach it, and
`ctx.ai.generateStructured` accepts no signal parameter (`packages/module-sdk/src/worker.ts:38`).
Do not go looking for a `ctx.signal` to pass into an `ai` call here: there is none (Task 2e removed
it deliberately), and `generateStructured` would reject it if there were. The invocation is shared with the crawl stage and bounded by
Task 2e's ceiling; running out of time is a normal outcome and must be reported, not hidden.

`contributeToBriefing` reads the store and delegates entirely to `buildBriefingContribution` — no
string assembly in the handler.

- [ ] **Step 7: Run the test**

Run: `pnpm vitest run tests/unit/job-search-score-stage.test.ts`
Expected: PASS (all fourteen).

- [ ] **Step 8: Write the failing pass-handler test**

```ts
// tests/unit/job-search-pass-handler.test.ts
```

Cover:

1. **`crawl.run` runs both stages in one invocation** — assert `runCrawl` ran, then `runScore` ran,
   against the same `profileId`, from a single handler call. This is the assertion that encodes why
   the two stages are not two queue entries.
2. **The crawl deadline leaves room for scoring.** With a total budget of `T`, assert the deadline
   handed to `runCrawl` is meaningfully earlier than the one handed to `runScore`. Crawling is
   cheap per unit and scoring is not; a crawl allowed to consume the whole invocation produces a
   board full of `unscored` rows, which looks broken.
3. **`crawl.run` reads `params.profileId`, not `input.profileId`** — feed it a real queue envelope
   and assert the right profile was crawled.
4. **`crawl.run` rejects a missing or non-string `profileId` itself.** The queue `paramsSchema` DSL
   has no "required" concept, so `{type:"object",fields:{…}}` accepts `{}` and the platform will
   happily deliver an empty params object. Assert a typed failure, not a crash and not a silent
   no-op.
5. **`crawl.sweep` takes no params, lists the actor's own active profiles, and runs each.**
   Schedules fan out one job per user with static params, so the profile ids can only come from the
   store.
6. **`crawl.sweep` skips profiles that are not `active`** — a profile still `in_conversation` has no
   criteria, and crawling on empty criteria fetches the entire board.
7. **One profile failing does not stop the sweep** — assert the second profile still ran and the
   handler resolved rather than threw. A thrown handler is a pg-boss retry of the _whole_ sweep.
8. **Nine active profiles, one sweep: at most 8 AI calls in total, and the ninth profile is
   untouched.** This is the platform cap, not a policy choice.
9. **The next sweep starts at that ninth profile.** Seed the cursor from the first sweep's write.
10. **Twenty profiles across three sweeps: every profile is served at least once, and no profile is
    served twice before all the others have been served once.**
11. **Zero active profiles: no AI calls, no cursor write, no error.**
12. **A profile that receives zero budget is skipped without an error** and is first in line on the
    next sweep.

- [ ] **Step 9: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-pass-handler.test.ts`
Expected: FAIL.

- [ ] **Step 10: Implement the handlers**

```ts
// external-modules/job-search/src/worker/handlers/pass.ts

/** ONE handler runs the whole pipeline for one profile because a worker handler cannot enqueue —
 * there is no jobs port on ModuleWorkerContext, and the single production enqueue path is the
 * browser-facing `POST /api/modules/:id/queues/:name/run`. So crawl → triage → score is a
 * sequence inside one invocation, bounded by the queue's declared `timeoutMs` (Task 2e).
 *
 * The invocation's TIME is split rather than shared first-come-first-served. Crawling is many
 * cheap HTTP calls and scoring is a few expensive model calls, so a crawl that runs long is
 * *always* the thing to cut: fresh postings with no scores is a worse result than slightly stale
 * postings that are scored. Hence CRAWL_SHARE below.
 *
 * CRAWL_SHARE is a share of TIME. AI_CALL_BUDGET is a count of CALLS. They are different
 * resources with different limits and are never traded against each other — the crawl stage
 * makes no AI calls at all. */
const CRAWL_SHARE = 0.4;
```

`crawl.run` parses the envelope, requires `params.profileId`, and runs the two stages for that one
profile with the full `AI_CALL_BUDGET`.

`crawl.sweep` takes no params. It lists the actor's profiles via the store — never a parameter,
since a schedule cannot carry one — filters to `state === "active"`, and spends the invocation's
eight calls across them **sequentially, from a persisted rotation cursor**:

**Count the calls at the port, not at the return value.** The obvious shape — add up what each
`runProfileStages` _returns_ — cannot survive rule three below, because a profile that throws
returns nothing while having already spent calls the host has already counted. The host's own
counter is private to the parent RPC closure (`worker-rpc-host.ts:111`, incremented at `:212`) and
the worker cannot read it. So the handler wraps `ctx.ai` once, before the loop, and that wrapper is
the only authority on how much budget is left:

```ts
/** One wrapper for the whole sweep, shared by every profile. It increments BEFORE awaiting, so a
 * call that throws or is aborted still counts as spent — which is the only way the arithmetic can
 * survive rule three. Deriving remaining budget from returned usage instead double-spends after a
 * throw and blows past the host's cap of 8, at which point the host returns `usage_limited` and
 * the sweep looks broken for a reason nothing logged. */
function countingAi(inner: AiPort): AiPort & { used: () => number } {
  let used = 0;
  return {
    used: () => used,
    generateStructured: (req) => {
      used += 1;
      return inner.generateStructured(req);
    }
  };
}

const ai = countingAi(ctx.ai);
```

```ts
// `listProfiles` + filter, not a `listActiveProfiles` store method: the store contract is
// closed (Task 13) and "active" is a domain predicate, not a storage concern.
//
// `listProfiles` MUST return a deterministic order (Task 13 pins it to `ORDER BY created_at,
// id`). The cursor below is an INDEX into this list, so a non-deterministic order makes the
// persisted cursor point at a different profile on every sweep and the rotation degenerates to
// random selection — which still passes any test that only counts calls.
const profiles = (await store.listProfiles()).filter((p) => p.state === "active");
if (profiles.length === 0) return { scanned: 0 }; // no cursor write, no error

const cursor = await store.getSweepCursor(); // index into that stable ordering
const ordered = rotate(profiles, cursor % profiles.length);

let stoppedAt = cursor;
for (const [i, profile] of ordered.entries()) {
  const remaining = AI_CALL_BUDGET - ai.used();
  if (remaining <= 0) break;
  try {
    // Sequential, not Promise.allSettled: the budget is spent one call at a time and each
    // profile's allocation depends on what the previous one actually used. Concurrency here
    // would also start every profile's crawl at once and blow straight past the deadline.
    //
    // No `signal` argument: nothing downstream of here accepts one (Task 2e). The deadline is a
    // number, and it is the whole of what this handler can pass down.
    await runProfileStages(profile, { ai, aiBudget: remaining, deadlineAt: ctx.deadlineAt });
  } catch (cause) {
    // Rule three. `ai.used()` has ALREADY counted whatever this profile spent before throwing,
    // so the next iteration's `remaining` is correct without any bookkeeping here.
    //
    // No store write: the closed interface (Task 13) has no method for a per-profile failure
    // note, and `ProfileState` has no error member. Inventing either here would be a silent
    // widening of a deliberately closed contract. The failure goes in the handler's returned
    // summary, which is what the manual-run response surfaces.
    failures.push({ profileId: profile.id, cause: describe(cause) });
  }
  stoppedAt = (cursor + i + 1) % profiles.length;
}
await store.setSweepCursor(stoppedAt); // next sweep starts at the first unserved profile
```

Four rules that make the rotation real rather than decorative:

- **A profile that receives zero budget is legal.** It is skipped without an error and is first in
  line next sweep. Without that, "rotation" just means the first profile is scored every six hours
  and the last one never is.
- `runProfileStages` takes the wrapped `ai` port as an argument rather than reaching for `ctx.ai`,
  and must never issue a call when its remaining budget is zero. Its return value is for reporting
  only — the budget arithmetic reads `ai.used()`.
- One profile throwing must not stop the sweep: catch per profile, push the cause onto the
  returned summary, and continue. Its calls are already counted by the wrapper, and nothing is
  written to the store — the closed interface has no failure-note method and `ProfileState` has no
  error member. The cursor still advances past it, so a permanently broken profile cannot starve
  the others.
- **Test rule three at the wrapper.** Make profile 1 spend three calls and then throw; assert
  profile 2 is offered a budget of exactly 5, not 8. That assertion fails against every
  return-value-based accounting scheme, which is the point.

`getSweepCursor` / `setSweepCursor` are on the Task 13 store interface. They are module KV, not a
profile column: the cursor belongs to the sweep, not to any one profile, and it must survive a
profile being deleted.

- [ ] **Step 11: Run the test**

Run: `pnpm vitest run tests/unit/job-search-pass-handler.test.ts`
Expected: PASS (all twelve).

- [ ] **Step 12: Register the queues, schedule, and tools**

```jsonc
// jarvis.module.json additions
"assistantTools": [
  {
    "name": "job-search.crawl.run-now",
    "permissionId": "job-search.crawl.run-now",
    "description": "Crawl this search profile's enabled job boards now.",
    "risk": "write",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": { "profileId": { "type": "string" } }, "required": ["profileId"]
    },
    "handler": "crawl.run-now"
  },
  {
    // The board's read. `risk: "read"` is not a preference — it is the whole reason this
    // works from the browser at all. See Step 12b.
    "name": "job-search.matches.list",
    "permissionId": "job-search.matches.list",
    "description": "List scored matches for a search profile.",
    "risk": "read",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "profileId": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
      },
      "required": ["profileId", "limit"]
    },
    "handler": "matches.list"
  },
  {
    // Kept as a tool for the ASSISTANT path only ("dismiss that one" in chat, then confirm).
    // The board does NOT call this — see Step 12b for why it cannot.
    "name": "job-search.match.dismiss",
    "permissionId": "job-search.match.dismiss",
    "description": "Dismiss a match so it leaves the board.",
    "risk": "write",
    "inputSchema": {
      "type": "object", "additionalProperties": false,
      "properties": { "matchId": { "type": "string" } }, "required": ["matchId"]
    },
    "handler": "match.set-state"
  }
],
"worker": {
  "queues": [
    {
      "name": "job-search.crawl-run", "handler": "crawl.run", "retryLimit": 2,
      // The board's "Search now" button enqueues through
      // POST /api/modules/:id/queues/:name/run, which is gated on this flag and is the
      // ONLY enqueue path that exists. Without it the button has nothing to call.
      "allowManualRun": true,
      // Task 2e. A pass is two portals of paged HTTP plus up to eight structured model
      // calls; the 30s default kills it mid-run with an empty log.
      "timeoutMs": 600000,
      // NOT JSON Schema — queue paramsSchema is the platform DSL
      // (`isValidModuleParamsSchema`), while assistantTools[].inputSchema above IS JSON
      // Schema. Two languages, one manifest file.
      //
      // The DSL has NO "required" concept, so this accepts `{}` as well. `crawl.run` must
      // therefore reject a missing profileId itself — see Step 10.
      "paramsSchema": { "type": "object", "fields": { "profileId": { "type": "identifier" } } }
    },
    {
      // The scheduled entry point. It exists as its own queue because a schedule can only
      // reach the handler of the queue it names — there is no per-job handler override.
      "name": "job-search.crawl-sweep", "handler": "crawl.sweep", "retryLimit": 1,
      // Nothing in the product enqueues a sweep by hand; the "Search now" button runs one
      // profile through crawl-run.
      "allowManualRun": false,
      "timeoutMs": 600000,
      // Deliberately empty. The DSL rejects unknown keys, so `fields: {}` accepts `{}` and
      // nothing else — belt and braces against a caller that invents params for a job that
      // takes none.
      "paramsSchema": { "type": "object", "fields": {} }
    },
    {
      // The board's WRITE path. Step 12b explains why a write cannot be a browser tool call.
      "name": "job-search.match-state", "handler": "match.set-state", "retryLimit": 2,
      "allowManualRun": true,
      "timeoutMs": 30000,
      // Two identifiers and an enum — metadata only, no posting content, per the global
      // constraint on job payloads.
      "paramsSchema": {
        "type": "object",
        "fields": { "matchId": { "type": "identifier" }, "state": { "type": "string" } }
      }
    }
  ],
  "schedules": [
    // Off the hour: every module scheduling at :00 stampedes the same minute.
    // scope "user" fans this out to one job per active user with these static params —
    // there is no per-profile scheduling, which is why the handler is a sweep.
    //
    // `queue` MUST be the sweep queue. Pointing it at job-search.crawl-run delivers a job
    // with no profileId to a handler that needs one, and leaves crawl.sweep unreachable.
    { "id": "job-search.crawl-sweep", "cron": "17 */6 * * *", "scope": "user",
      "jobKind": "job-search.crawl-sweep", "queue": "job-search.crawl-sweep" }
  ],
  "reconcileJobs": []
}
```

All four schedule fields are required by `validate.ts`: `id` and `jobKind` must match
`/^[a-z][a-z0-9_.-]{0,63}$/`, `cron` must be five fields, and `scope` must be `"user"`. A schedule
missing any of them fails validation, which fails install.

The `crawl.run-now` tool and the `crawl.run` queue are **different handler names on purpose**. The
tool receives the tool-shaped input and the queue receives the envelope; one handler serving both
would have to sniff its own input to know which it got. Register `crawl.run-now` as a thin wrapper
that validates with Task 13's `validateProfileInput` and calls the same internal function.

The payload carries `profileId` and nothing else — metadata-only, per the global constraints.

- [ ] **Step 12b: Implement the match handlers — the board's only route to the database**

Without this step the board in Task 20 has nothing to render and nothing to dismiss with. Task 13's
store exposes `listMatches(profileId, limit)` and `setMatchState(matchId, state)`, and until a
declared handler calls them they are unreachable code: the web bundle receives only
`{hostActions, assistantSurface?}` (`apps/web/src/external-modules/loader.ts:11-20`) and has no
database access of any kind.

**The read and the write take different transports, and this is forced, not chosen.** A `risk: "read"`
tool executes inline on `POST /api/ai/assistant-tools/:name/invoke`. A `write` or `destructive` tool
does **not**: the route creates a pending assistant action and returns **403 with
`blockedReason: "confirmation_required"`** before ever reaching `execute`
(`packages/ai/src/routes.ts:645-668`). So a board that calls `invokeTool("job-search.match.dismiss")`
gets `{kind: "blocked"}` from Task 18's transport and the match is never dismissed — a button that
does nothing, on a path where nothing errors. Writes from a module's own surface go through the
manual-run queue endpoint instead, which is exactly what finance does and says so
(`external-modules/finance/src/web/api.ts:1-8`).

- `matches.list` — `risk: "read"`, called with `invokeTool`, returns records.
- `match.set-state` — reached two ways, one handler: the **board** enqueues it with
  `runQueue("job-search.match-state", "match.set-state", {matchId, state})`, and the **assistant**
  reaches the same handler through the `job-search.match.dismiss` write tool, where the confirmation
  prompt is the correct consent boundary rather than an obstacle.

```ts
// handlers/matches.ts

/** `limit` is REQUIRED, with no default. Task 13's store takes it as a required parameter, and a
 * handler that quietly substitutes one lets an unbounded board read ship as an omission rather
 * than fail. Clamp is 1..100 in the schema; re-check here because the queue path's params DSL has
 * no numeric bounds and never validated it. */
export async function matchesList(input: unknown, ctx: ModuleWorkerContext) {
  const { profileId, limit } = validateMatchesListInput(input); // throws on missing/!integer/out of range
  // Profile scoping is not decoration: without it, `limit` alone would let a caller page another
  // profile's board. RLS confines this to the actor's own rows, so the risk here is one of the
  // actor's OTHER profiles leaking into this profile's board, not a cross-user leak — still wrong,
  // and invisible in a single-profile test.
  const matches = await store(ctx).listMatches(profileId, limit);
  return { matches: matches.map(toBoardRecord) };
}

/** The state is a closed set, and the handler is the enforcement point. The queue's params DSL
 * types this field as `string` because the DSL has no enum, so an unvalidated handler accepts
 * `state: "anything"` straight from a manual-run body into the database. */
const SETTABLE_STATES = ["new", "saved", "dismissed"] as const;

export async function matchSetState(input: unknown, ctx: ModuleWorkerContext) {
  const { matchId, state } = validateMatchStateInput(input); // rejects any state outside the set
  await store(ctx).setMatchState(matchId, state);
  return { matchId, state };
}
```

Both handlers are registered in `src/worker/index.ts` under the names the manifest declares —
`matches.list` and `match.set-state`. A handler that exists but is not registered fails at runtime
with `unknown handler`, and nothing at install time catches it.

**Tests — `tests/unit/job-search-match-handler.test.ts`, against a fake store:**

1. `matches.list` with no `limit` **throws**; it does not default. Same for `limit: 0`, `limit: 101`,
   and `limit: 1.5`.
2. `matches.list` passes `profileId` and `limit` through to the store **unchanged** — assert on the
   fake's recorded arguments, because a handler that reads the whole board and slices in memory
   passes any assertion made on the returned length.
3. `match.set-state` with `state: "archived"` (or any string outside the set) throws and calls the
   store **zero** times.
4. `match.set-state` with each of the three legal states calls the store exactly once with that
   state.
5. `matches.list` returns board records — id, title, company, both axis scores as separate fields,
   and the reasons — and **never** a raw store row. Assert the returned keys explicitly: the spec's
   render-from-records rule is only real if the record shape is pinned.

And one assertion that belongs in Step 13's manifest test rather than here: `job-search.matches.list`
is declared with `risk: "read"`. If it is ever changed to `write`, the board stops working and every
unit test above still passes.

- [ ] **Step 13: Verify the manifest survives validation**

The validator reconstructs the manifest from an explicit field list and silently drops what it does
not recognise, so `timeoutMs` returning `ok: true` proves nothing:

```bash
pnpm vitest run tests/unit/job-search-manifest.test.ts
```

Assert through `validateExternalModuleManifest()`, never against the raw JSON:

- `result.manifest.worker.queues` has **two** entries, with handlers `crawl.run` and `crawl.sweep`.
- `queues[0].timeoutMs === 600000`. If it is `undefined`, Task 2e's `validate.ts` change was not
  made and the pass will die at 30 seconds in production while passing every test here.
- `result.manifest.worker.schedules[0].queue === "job-search.crawl-sweep"`.
- `result.manifest.worker.queues` also contains `job-search.match-state` with
  `allowManualRun: true` — the board's dismiss has no other way in, and `allowManualRun` defaulting
  to false is a silent 403 at the one moment it matters.
- `job-search.matches.list` survives with `risk: "read"`, and `job-search.match.dismiss` with
  `risk: "write"`. Assert both explicitly. The read one is load-bearing: flip it to `write` and the
  board's every read returns `confirmation_required` instead of matches.
- Every `schedules[].queue` names a declared queue. **Defence in depth, and be honest about which
  layer is load-bearing:** `validateWorker` already rejects a schedule whose queue is undeclared
  (`packages/module-registry/src/external/validate.ts:176`), so a validated install cannot reach
  the reconciler's silent `queueByName.get()` miss (`job-reconciler.ts:127`) with this defect. The
  validator is the primary guard. This assertion exists to verify the **normalized, install-time**
  wiring — that the queue name survives normalization and still matches after the manifest passes
  through the field allowlist — not to catch a typo the validator would already have rejected.

- [ ] **Step 14: Commit**

```bash
git add external-modules/job-search/src external-modules/job-search/jarvis.module.json \
        tests/unit/job-search-score-stage.test.ts tests/unit/job-search-pass-handler.test.ts \
        tests/unit/job-search-job-input.test.ts tests/unit/job-search-match-handler.test.ts
git commit -m "feat(job-search): add the scoring stage, the single-pass handler, and the sweep queue"
```

---

### Task 16: Conversation, profile, résumé, and settings tools

**Files:**

- Create: `external-modules/job-search/src/worker/handlers/{profile.ts,resume.ts}`
- Modify: `jarvis.module.json` — eight tools
- Test: `tests/unit/job-search-profile-handler.test.ts`

**Interfaces:**

- Consumes: `parseCriteria`, `parseContextSummary`, `CONTEXT_SUMMARY_MAX`, `completedSteps`,
  `isReadyToCrawl` (Task 10), `validateProfileInput` (Task 13), `JobSearchStore`.
- Produces the eight handlers below, each returning **records, never prose**:

  | Tool                                     | Handler                       | Risk  |
  | ---------------------------------------- | ----------------------------- | ----- |
  | `job-search.profile.create`              | `profile.create`              | write |
  | `job-search.profile.list`                | `profile.list`                | read  |
  | `job-search.criteria.set`                | `criteria.set`                | write |
  | `job-search.profile.set-context`         | `profile.set-context`         | write |
  | `job-search.profile.set-briefing-detail` | `profile.set-briefing-detail` | write |
  | `job-search.resume.set`                  | `resume.set`                  | write |
  | `job-search.resume.get`                  | `resume.get`                  | read  |
  | `job-search.portal.set-enabled`          | `portal.set-enabled`          | write |

  `set-enabled`, not `toggle`: the tool names the state it writes rather than the transition, so a
  retry or a double-click is idempotent instead of flipping the portal back off. Task 20's settings
  UI, the seed prompt, and the Task 21/22 tests all call this exact name.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/job-search-profile-handler.test.ts
```

Cover:

1. `criteria.set` on an `in_conversation` profile that becomes ready flips `state` to `active`.
   **It does not enqueue anything** — it cannot, and the test asserts that absence explicitly:

```ts
it("flips to active without enqueueing, because a handler cannot enqueue", async () => {
  // The first crawl is started by the browser: the UI calls
  // POST /api/modules/job-search/queues/job-search.crawl-run/run after this tool returns
  // `readyToCrawl: true`. A handler that tried to enqueue would have nothing to call.
  const out = await handlers["criteria.set"](ctxWith({ profileId: "p1", criteria: full }));
  expect(await store.getProfile("p1")).toMatchObject({ state: "active" });
  expect(out).toMatchObject({ readyToCrawl: true });
});
```

2. A profile that is still incomplete stays `in_conversation` and returns `readyToCrawl: false`
   with its `completedSteps`, so the UI's progress readout comes from the record.
3. `profile.list` returns `completedSteps` — a screen must never compute progress from prose.
4. `resume.set` bumps `version` and keeps the prior row.
5. **`resume.get` never appears in any tool result destined for a portal request** — assert the
   crawl path does not read the résumé. It is scoring input only; a résumé must never leave the
   instance inside an outbound HTTP request.
6. Every handler strips `actorUserId` via Task 13's `validateProfileInput`, and none of them accepts
   a genuinely unknown key.
7. **`profile.set-context` rejects an over-length summary rather than truncating it.** Assert a
   `CONTEXT_SUMMARY_MAX + 1` string throws and the stored value is unchanged — a half-sentence gets
   fed to the scorer on every posting in the batch.
8. **`profile.set-context` replaces wholesale and never appends.** Set twice, assert the second
   value is the whole stored value.
9. **`profile.set-briefing-detail` accepts exactly `count | top | full`** and rejects a fourth
   value, matching the column's check constraint from Task 4.
10. **No handler returns a blended score.** Walk every handler's result object and assert no key
    matches `/^(score|overall|match|rank)$/i`. This is a cheap structural guard against the one
    thing the whole design forbids.
11. **The manifest's declared tool names and the handler registration keys are the same set** —
    compare them both ways, so a name declared with no handler and a handler with no declaration
    both fail:

```ts
it("declares exactly the tools it registers", () => {
  // Nothing else in the stack cross-checks these. A tool declared as
  // `job-search.portal.toggle` and registered as `portal.set-enabled` installs cleanly,
  // appears in the assistant's tool list, and fails only when a user asks for it.
  const declared = manifest.assistantTools.map((t) => t.handler).sort();
  expect(Object.keys(handlers).sort()).toEqual(declared);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run tests/unit/job-search-profile-handler.test.ts`
Expected: FAIL — the handler module does not exist.

- [ ] **Step 3: Implement the handlers**

Each handler is the same four lines: validate the input, call the store, shape a record, return it.
No handler builds a sentence, and no handler decides policy — `isReadyToCrawl` and `completedSteps`
live in Task 10's domain layer and are called, not reimplemented.

Two that are less mechanical than they look:

- **`profile.set-context`** runs `parseContextSummary` (Task 10) and writes the result. This is the
  only writer of `context_summary`, which is what makes the stored value something the user
  approved: the tool call is visible and confirmable like any other. Raw transcript is never stored.
- **`resume.get`** is `risk: "read"` and returns the résumé text to the _assistant_, which is
  intended — the whole point is letting the user talk about their own résumé. What it must never do
  is reach an adapter. Keep it out of `ports.ts`'s crawl dependency set entirely, so the wiring
  makes the mistake impossible rather than merely discouraged.

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/job-search-profile-handler.test.ts`
Expected: PASS (all eleven).

- [ ] **Step 5: Register the tools and check the manifest**

Add all eight entries to `assistantTools`. Every `inputSchema` is **JSON Schema** with
`additionalProperties: false` — unlike the queue `paramsSchema` in Task 15, which is the platform
DSL. Then re-run the manifest test from Task 3 to confirm all eight survive validation:

```bash
pnpm vitest run tests/unit/job-search-manifest.test.ts && pnpm check:external-modules
```

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search/src external-modules/job-search/jarvis.module.json \
        tests/unit/job-search-profile-handler.test.ts
git commit -m "feat(job-search): add profile, criteria, context, résumé, and portal tools"
```

---

### Task 17: Seed prompt for the job-search thread

The thread is a full-capability session — full tool set, no restrictions. It differs from the main
thread only by seed prompt and scope.

**Files:**

- Create: `external-modules/job-search/src/domain/seed-prompt.ts`
- Test: `tests/unit/job-search-seed-prompt.test.ts`

**Interfaces:**

- Produces: `export function buildSeedPrompt(profile: Profile): string;`

- [ ] **Step 1: Write the failing test**

```ts
it("names the tools that write criteria so the model records rather than narrates", () => {
  const p = buildSeedPrompt({
    id: "swe",
    name: "Software Engineer",
    state: "in_conversation"
  } as never);
  // Nothing validates a tool name written in prose — a wrong name here fails
  // silently at runtime. Assert the exact registered names.
  expect(p).toContain("job-search.criteria.set");
  expect(p).toContain("job-search.resume.set");
});

it("tells the model the interview has a defined end", () => {
  const p = buildSeedPrompt({
    id: "swe",
    name: "Software Engineer",
    state: "in_conversation"
  } as never);
  for (const step of ["role", "want", "where", "comp", "sources"]) expect(p).toContain(step);
});

it("does not tell the model to withhold any capability", () => {
  const p = buildSeedPrompt({ id: "swe", name: "SWE", state: "active" } as never);
  expect(p).not.toMatch(/only use|do not use|you cannot|not available here/i);
});
```

Add a test asserting every tool name in the prompt exists in `manifest.assistantTools` — a prose
tool name is unvalidated by anything else in the stack and has broken a previous module.

- [ ] **Step 2–4: Fail, implement, pass**

- [ ] **Step 5: Wire it — a seed prompt with no caller is dead code**

`buildSeedPrompt` is only worth writing if something calls it. The consumer is the web root, using
the two seams Task 2c adds to `AssistantSurfaceHandleV1`. Add to
`external-modules/job-search/src/web/use-profiles.ts`:

```ts
// external-modules/job-search/src/web/use-profiles.ts (addition)
/** Bind the module's chat surface to the active profile and frame it once.
 *
 * Order matters: `setSurfaceKey` first, because `seedContext` is curried with whatever surface the
 * handle currently holds — seeding first would frame the *drawer*, which is exactly the leak Ben
 * ruled out ("if the user is in the job search and they open the drawer, I don't want that job
 * search to show up in the drawer").
 *
 * The idempotency key is versioned (`:v1`). The manager dedupes on it
 * (`chat-session-manager.ts:384`), so a remount is a no-op — but editing the prompt text without
 * bumping the version would leave existing sessions framed by the old copy forever.
 */
export function useProfileThread(
  assistantSurface: AssistantSurfaceHandleV1 | undefined,
  profile: Profile | null
): void {
  useEffect(() => {
    if (!assistantSurface || !profile) return;
    assistantSurface.setSurfaceKey(profile.id);
    void assistantSurface.seedContext(buildSeedPrompt(profile), `job-search:${profile.id}:v1`);
    // Returning to the drawer on unmount is the shell's job (Task 2c), but say it here too:
    // a module that navigates away must not leave the drawer pointed at its own transcript.
    return () => assistantSurface.setSurfaceKey(null);
  }, [assistantSurface, profile?.id]);
}
```

Add to `tests/unit/job-search-web-root.test.tsx`:

```tsx
it("binds the surface before framing it, and frames it once", async () => {
  const assistantSurface = {
    setSurfaceKey: vi.fn(),
    seedContext: vi.fn().mockResolvedValue(undefined),
    Surface: () => null,
    seedComposer: vi.fn(),
    submitTurn: vi.fn(),
    uploadAttachment: vi.fn(),
    subscribeRecords: vi.fn()
  };
  withProfiles(ready([{ id: "p1", state: "in_conversation", criteria: null }]));
  const { rerender } = render(
    <Root hostActions={hostActions} assistantSurface={assistantSurface} />
  );
  rerender(<Root hostActions={hostActions} assistantSurface={assistantSurface} />);

  // Ordering, not just presence: seeding before binding frames the drawer.
  expect(assistantSurface.setSurfaceKey.mock.invocationCallOrder[0]).toBeLessThan(
    assistantSurface.seedContext.mock.invocationCallOrder[0]
  );
  expect(assistantSurface.setSurfaceKey).toHaveBeenCalledWith("p1");
  expect(assistantSurface.seedContext).toHaveBeenCalledTimes(1);
  expect(assistantSurface.seedContext).toHaveBeenCalledWith(
    expect.stringContaining("job-search.criteria.set"),
    "job-search:p1:v1"
  );
});

it("works when the host gives it no assistant surface", async () => {
  // `assistantSurface` is optional in the host contract (loader.ts:10-19). The board must render.
  withProfiles(ready([{ id: "p1", state: "active", criteria: { titles: ["Staff Engineer"] } }]));
  render(<Root hostActions={hostActions} />);
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
});
```

- [ ] **Step 6: Commit**

```bash
git add external-modules/job-search/src/domain/seed-prompt.ts \
        external-modules/job-search/src/web/use-profiles.ts \
        tests/unit/job-search-seed-prompt.test.ts tests/unit/job-search-web-root.test.tsx
git commit -m "feat(job-search): frame the profile thread with a seed prompt"
```

---

## Phase 5 — Web surface

Built from `apps/web/src/job-search-prototype/variant-flow.tsx`. Read that file and `flow.css`
before starting: they hold the decided shape and the reasoning in their header comments. The
prototype's fake data does **not** come across — every value comes from a tool result.

### Task 18: Web entrypoint, the empty-install bootstrap, and the onboarding/board branch

**Files:**

- Read first: `external-modules/finance/src/web/index.ts` for the entrypoint contract
- Read first: `apps/web/src/external-modules/host-actions.ts` — what `openAssistant` actually does
- Create: `external-modules/job-search/src/web/{index.ts,root.tsx,use-profiles.ts,api.ts,styles.css}`
- Test: `tests/unit/job-search-web-root.test.tsx`

**Interfaces:**

- Produces: the module web entrypoint registered by `web.entrypoint` in the manifest.
- Produces:

  ```ts
  type ProfilesState =
    | { status: "loading" }
    | { status: "empty" } // zero profiles → bootstrap panel
    | { status: "ready"; profiles: Profile[]; selectedId: string };

  export interface UseProfilesOptions {
    /** The bootstrap latch. `Root` owns it, not the hook: the thing that arms polling is a
     *  button press in `Root`'s bootstrap panel, and the thing that clears it is either a
     *  profile arriving or expiry. `false` means the hook schedules no interval at all. */
    pollArmed: boolean;
    /** Fired once when the window or the attempt cap is reached. `Root` responds by setting
     *  `pollArmed` back to false and rendering the retry action. The hook does not own the
     *  latch, so it cannot clear it itself — it reports. */
    onPollExpired(): void;
  }

  export function useProfiles(options: UseProfilesOptions): ProfilesState & {
    refetch(): void;
    select(id: string): void;
  };
  ```

  Everything the bounded poll needs lives on one side or the other, and this is the split:
  **the hook owns the timing** — the interval, the attempt counter, the `visibilitychange`
  subscription, and the hidden-time accounting that keeps the window from draining while the tab
  is backgrounded. **`Root` owns the latch and the UI** — `pollArmed`, the bootstrap button that
  sets it, and the retry action `onPollExpired` causes it to render. Neither half can be tested
  without the other being nameable, which is why this contract is written before the tests.

  ```ts
  // src/web/api.ts — the module's transport, and the ONLY place it talks to the host.
  export async function invokeTool(name: string, input?: Record<string, unknown>): Promise<unknown>;

  /** Enqueue a manual run on a declared queue. Mirrors finance's `runQueue`
   *  (`external-modules/finance/src/web/api.ts:96`) exactly — same route, same body shape,
   *  same outcome union — because this is a host route with a fixed contract, not a place to
   *  be creative. `POST /api/modules/job-search/queues/:queueName/run`, body
   *  `{jobKind, params?}`, 202 → queued (a null jobId means the actor's manual singleton is
   *  already queued), 404 → the queue is not manual-runnable, anything else → error. */
  export type RunOutcome =
    | { kind: "queued" }
    | { kind: "already-queued" }
    | { kind: "disabled" }
    | { kind: "error"; message: string };
  export function runQueue(
    queueName: string,
    jobKind: string,
    params?: Record<string, unknown>
  ): Promise<RunOutcome>;
  ```

  **This is the only thing in the entire product that starts a crawl.** A worker handler cannot
  enqueue — there is no enqueue port on `ModuleWorkerContext` — and the schedule only ever reaches
  `crawl.sweep`. If `runQueue` is not written and wired, a user can complete the conversation, watch
  `criteria.set` return `readyToCrawl: true`, and then wait forever for a first crawl that nothing
  asked for. Two call sites, both required:
  1. **The `readyToCrawl` transition** (Task 18/19). When a `profile.list` result shows a profile
     that has just become `active`, call
     `runQueue("job-search.crawl-run", "crawl.run", { profileId })` once for that profile and show
     the queued state. Once per transition — key it by profile id so a refetch does not re-enqueue.
  2. **The board's "Search now" button** (Task 20), which is the same call on demand.

  Both render the `RunOutcome`: `already-queued` is a normal, calm state ("Already searching"), not
  an error, and `disabled` means the manifest lost `allowManualRun` and should say so plainly.

  The hook is **plural**. Multiple profiles is a settled product decision, and a singular
  `useProfile` bakes "there is exactly one" into the first file every later screen imports.

**The empty install is a real state and it needs a real path out of it.** A freshly installed module
has zero profiles, and there is no way for the module's own surface to create one:

- `hostActions.openAssistant({starterPrompt})` inserts an **editable draft into the assistant
  composer**. It never submits a turn and never runs a tool
  (`apps/web/src/external-modules/host-actions.ts`).
- The browser REST invoke route serves `risk: "read"` tools only and 403s writes
  (`external-modules/finance/src/web/api.ts` is the read-only usage pattern). `profile.create` is a
  write tool, so **no module surface can call it directly**.
- `Root` receives only `{hostActions, assistantSurface?}`
  (`apps/web/src/external-modules/loader.ts:10-19`) — no host-supplied profile, ever.

So the bootstrap is a five-step handoff, and each step is somebody else's:

1. `status: "empty"` renders a module-owned bootstrap panel — the authored empty-state pattern, no
   model output anywhere in the chrome — with **one** primary action.
2. That action calls
   `hostActions.openAssistant({ starterPrompt: "Set up my first job search profile" })`. The draft
   arrives **editable and unsent, and the user presses send**. That is the consent boundary, and it
   is the reason a module surface cannot create the profile itself: a write that the user did not
   send is a write the user did not authorise.
3. The assistant turn calls the `profile.create` write tool through the assistant tool path — the
   only path a write tool has.
4. The surface picks the new profile up by **polling `profile.list` every 3 s**, and that poll is
   **bounded on four axes**. Pressing the bootstrap button is only a latch — `openAssistant` inserts
   an unsent draft and nothing more (`apps/web/src/external-modules/host-actions.ts`), so the user
   may close the drawer, edit without sending, or send a turn that fails to create anything. A latch
   with no exit is an infinite background poll on an abandoned tab, which is exactly what the
   previous revision of this step shipped. The four bounds:
   - **Armed, not free-running.** No poll at all until the bootstrap action has been pressed. An
     untouched empty install issues zero tool calls.
   - **Expiring.** The armed window is `POLL_WINDOW_MS = 120_000` **or** `POLL_MAX_ATTEMPTS = 40`,
     whichever comes first, measured from the press. Both are module constants so the test can
     shorten them; do not hardcode either number at the call site.
   - **Suspended while hidden.** While `document.hidden` the interval does not fire and **elapsed
     time does not accrue** — a backgrounded tab must not silently burn the window down and expire
     the moment the user returns. Subscribe to `visibilitychange`, and on becoming visible fetch
     once immediately before resuming the interval. The existing window-`focus` refetch stays.
   - **Reset on expiry, with a way back.** On expiry the poll stops, the latch clears, and the
     bootstrap panel re-renders with a **retry action** ("Still setting up? Try again") that re-arms
     the whole cycle. Expiry is not an error state and must not render one — the common cause is a
     user who decided not to finish, and the panel they land back on is the same panel they left.

   Do not assume an assistant-completion event exists on `assistantSurface`; if the implementer
   confirms one, they may replace the poll with it and should note that here. The bounds above still
   apply to whatever replaces it.

5. `status: "ready"` with more than one profile renders the profile switcher. `selectedId` persists
   in module-local storage and falls back to the first profile when the stored id no longer exists.

- [ ] **Step 1: Write the failing test**

**`Root` does not take a `profile` prop and cannot be made to.** A module gets its state by _calling
a tool_, so the test drives every branch by controlling what that call returns:

```tsx
// tests/unit/job-search-web-root.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ExternalModuleHostActionsV1 } from "../../apps/web/src/external-modules/host-actions";
import { Root } from "../../external-modules/job-search/src/web/root";

// The module's OWN transport — the single function every read in the surface goes through
// (`external-modules/finance/src/web/api.ts` is the pattern). Spying here is what makes "never
// through a tool invoke" a real assertion; `vi.hoisted` is required because `vi.mock` is lifted
// above the imports and cannot close over an ordinary `const`.
const invokeToolSpy = vi.hoisted(() => vi.fn());
const runQueueSpy = vi.hoisted(() => vi.fn(async () => ({ kind: "queued" }) as const));
// ONE vi.mock for the whole path. Both transports live in `api.ts`, and a second `vi.mock` of the
// same specifier replaces the first silently — the earlier factory's spies simply stop being
// installed, and the tests that used them fail with "not a function" a long way from the cause.
vi.mock("../../external-modules/job-search/src/web/api", () => ({
  invokeTool: invokeToolSpy,
  runQueue: runQueueSpy
}));

// The host props, stubbed against the REAL contract. `ExternalModuleHostActionsV1` requires BOTH
// `actorScopeKey` and `openAssistant` (`apps/web/src/external-modules/host-actions.ts:14-24`); a
// stub with only `openAssistant` does not typecheck, and typing it as `any` to make it compile
// hides the next field the contract grows. `assistantSurface` is optional, so omit it — `Root`
// must not require it (`loader.ts:11-20`).
const hostActions: ExternalModuleHostActionsV1 = {
  actorScopeKey: "scope-test",
  openAssistant: vi.fn()
};

/** Drive the branch by fixing what the module's own data hook resolves to.
 *
 * `vi.mock` is HOISTED above the imports, so it cannot close over a `const` declared here and it
 * runs exactly once for the file — calling it inside a helper per test does nothing after the
 * first. The mutable box from `vi.hoisted` is the only shape that lets each test choose its own
 * state. Mock the module's data hook, NOT the component: mocking the component would assert
 * nothing about the branch under test. */
const state = vi.hoisted(() => ({ current: { status: "loading" } as Record<string, unknown> }));

vi.mock("../../external-modules/job-search/src/web/use-profiles", () => ({
  useProfiles: () => ({ refetch: vi.fn(), select: vi.fn(), ...state.current })
}));

const withProfiles = (next: Record<string, unknown>) => {
  state.current = next;
};

const ready = (profiles: unknown[], selectedId = "p1") => ({
  status: "ready",
  profiles,
  selectedId
});

it("renders the bootstrap panel and no board when there are no profiles", async () => {
  withProfiles({ status: "empty" });
  render(<Root hostActions={hostActions} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /set up/i })).toBeTruthy());
  expect(screen.queryByRole("table")).toBeNull();
});

it("bootstraps through the assistant composer and never through a tool invoke", async () => {
  // The only path from an empty install to its first profile. If this ever becomes a direct
  // invoke it will 403 in production and pass in any test that stubs the transport.
  //
  // Assert the absence at the TRANSPORT, not through a prop: `Root` receives only
  // `{hostActions, assistantSurface?}` (`loader.ts:11-20`), so an `invokeTool` prop passed here
  // would be silently ignored by the real component and the assertion would pass no matter what
  // the bootstrap did. `invokeTool` is the module's own transport module, so spy on that.
  withProfiles({ status: "empty" });
  render(<Root hostActions={hostActions} />);
  screen.getByRole("button", { name: /set up/i }).click();
  expect(hostActions.openAssistant).toHaveBeenCalledWith({
    starterPrompt: expect.stringMatching(/job search profile/i)
  });
  expect(invokeToolSpy).not.toHaveBeenCalled(); // from vi.mock of the module's api.ts
});

it("shows onboarding and no table when the profile has no criteria", async () => {
  withProfiles(ready([{ id: "p1", state: "in_conversation", criteria: null }]));
  render(<Root hostActions={hostActions} />);
  // A profile with nothing in it has nothing to put in a table, so it shows no table.
  await waitFor(() => expect(screen.getByText(/what this search is for/i)).toBeTruthy());
  expect(screen.queryByRole("table")).toBeNull();
});

it("shows the board and no onboarding once criteria exist", async () => {
  withProfiles(ready([{ id: "p1", state: "active", criteria: { titles: ["Staff Engineer"] } }]));
  render(<Root hostActions={hostActions} />);
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
  expect(screen.queryByText(/what this search is for/i)).toBeNull();
});

it("does not render a chat button — the core header already has one", async () => {
  withProfiles(ready([{ id: "p1", state: "active", criteria: { titles: ["Staff Engineer"] } }]));
  render(<Root hostActions={hostActions} />);
  await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
  expect(screen.queryByRole("button", { name: /chat/i })).toBeNull();
});
```

That last case is a real constraint from Ben, and the prototype violates it deliberately
(`variant-flow.tsx:145`). Do not port that button.

Then the hook's own cases, against a fake tool transport rather than through `Root`:

Use `vi.useFakeTimers()` for the poll cases, and drive visibility by stubbing
`document.visibilityState` and dispatching `visibilitychange` — jsdom does not change it for you.

```
- while empty AND armed, profile.list is polled every 3s; the first non-empty response switches
  status to "ready" and stops the interval (advance another 30s, assert no further calls)
- while empty and NOT armed, profile.list is not polled at all
- armed, then POLL_WINDOW_MS elapses with every response empty: polling stops, the latch clears,
  and the retry action renders — advance a further 60s and assert no additional calls
- armed, then POLL_MAX_ATTEMPTS responses arrive before the window elapses: same expiry behaviour
  (this is the axis a time-only bound misses when the interval is shortened)
- pressing retry after expiry re-arms: calls resume and a non-empty response still resolves
- while document.hidden the interval does not fire AND the window does not accrue — hide, advance
  past POLL_WINDOW_MS, show again, and assert the poll is still live rather than expired
- becoming visible fetches once immediately, before the next interval tick
- one profile renders the board with no switcher
- three profiles render the switcher; selecting persists and survives a remount
- a stored selectedId that no longer exists falls back to the first profile rather than
  rendering an empty board
- a profile that arrives already `active` enqueues the first crawl exactly once: assert
  `runQueue` was called with `("job-search.crawl-run", "crawl.run", {profileId: "p1"})`, then
  refetch the same list and assert the call count is still one
- a profile that arrives `in_conversation` enqueues nothing — the crawl starts when criteria are
  complete, not when a profile exists
- `runQueue` resolving `{kind: "already-queued"}` renders the calm queued state, not an error
```

`runQueueSpy` is the one declared with `invokeToolSpy` at the top of the file — reset it in a
`beforeEach` (`runQueueSpy.mockClear()`) so the "exactly once" assertion measures this test's
renders and not the file's.

- [ ] **Step 2–4: Fail, implement, pass**

`root.tsx` reads state through `use-profiles.ts` (created here, mocked above), branches
`loading → empty → ready`, and inside `ready` branches on
`profile.state === "in_conversation"`. Keeping the fetch in its own file is what makes those
branches testable without a live host. Every component uses the module's `h` factory
(`jsxFactory: "h"`), and every keyed component needs an explicit `key?: string` prop in its props
type — external modules compile with their own factory, so `key` is not compiler-stripped and its
absence is a TS2322. `pnpm check:external-modules` is the only gate that catches this.

- [ ] **Step 5: Commit**

```bash
git add external-modules/job-search/src/web tests/unit/job-search-web-root.test.tsx
git commit -m "feat(job-search): add module web entrypoint with the empty-install bootstrap"
```

---

### Task 19: Onboarding screen

**Files:**

- Create: `external-modules/job-search/src/web/screens/onboarding.tsx`
- Test: `tests/unit/job-search-web-onboarding.test.tsx`

- [ ] **Step 1: Write the failing test**

Cover:

1. The progress readout renders one chip per `ONBOARDING_STEPS` entry and marks done ones from
   `completedSteps` — **from the record, not from the transcript**.
2. An empty profile renders the "nothing gets crawled until we both know what we're looking for"
   copy, not a spinner.
3. There is no table, no rail, and no source strip during onboarding.

- [ ] **Step 2–4: Fail, implement, pass**

Port the markup from the prototype's `.jp-onb` block and the styles from `flow.css`, renaming
`jp-` to the module's prefix. Tokens only — `pnpm check:design-tokens` fails on a literal.

- [ ] **Step 5: Commit**

---

### Task 20: Board, inspector, settings, and degraded states

**Files:**

- Create: `external-modules/job-search/src/web/screens/{board.tsx,inspector.tsx,settings.tsx}`
- Test: `tests/unit/job-search-web-board.test.tsx`
- Test: `tests/unit/job-search-web-settings.test.tsx`

- [ ] **Step 1: Write the failing test**

Cover all of these — they are the states that decide whether the thing is usable:

1. Fit and Want are **separate sortable columns**; sorting by one does not reorder the other's values.
2. An unscored row renders `—` in both columns plus a "Not read yet" flag, and its inspector
   explains the queue backed up and it has not been dropped.
3. A row outside the stated frame renders its flag.
4. A degraded portal renders `cause.summary` and `cause.nextAction` **verbatim** — the component
   must not compose its own failure sentence.
5. A disabled portal renders as disabled with its cause, not as an error.
6. **No element anywhere renders a combined score** — assert the rendered text against
   `/\boverall\b|\bcombined\b/i`.
7. Unscored rows sort last regardless of the active sort.
8. **"Search now" enqueues a real crawl.** The board's primary action calls
   `runQueue("job-search.crawl-run", "crawl.run", { profileId })` from Task 18's `src/web/api.ts`
   — assert on that call, not on local state. There is no other way to start a crawl on demand:
   worker handlers have no enqueue port, and the schedule only reaches `crawl.sweep`.
9. **Each `RunOutcome` renders its own state.** `queued` → searching; `already-queued` → "Already
   searching", calm, not an error; `disabled` → a plain explanation that manual runs are off (it
   means the manifest lost `allowManualRun`); `error` → the message with the button still usable.
   A button that fires and then looks identical is the failure this case exists to catch.

- [ ] **Step 2–4: Fail, implement, pass**

- [ ] **Step 5: Write the failing settings test**

`settings.tsx` is the per-profile configuration surface. It is small, but it is the only home for
two things Ben asked for by name — turning a portal off, and choosing how much of this module lands
in the briefing — so it gets its own screen rather than being buried in the inspector.

```tsx
// tests/unit/job-search-web-settings.test.tsx
it("lists every portal with its state and lets one be turned off", async () => {
  // Calls job-search.portal.set-enabled. Asserted on the tool call, not on local state:
  // a toggle that only flips a useState is the failure this test exists to catch.
});

it("shows a disabled portal's cause rather than presenting it as a user choice", async () => {
  // A portal the module disabled itself (login_required) must say why it went off, verbatim
  // from cause.summary — otherwise the user re-enables it forever and it keeps failing.
});

it("offers the three briefing detail levels and persists the choice", async () => {
  // Exactly the union Task 16 already defines — `"count" | "top" | "full"`. Do not invent a
  // fourth level or rename these: `buildBriefingContribution` switches on this string.
  // Ben: "The user can kind of define how much detail do they want in the briefing from it."
  // Persisted via job-search.profile.set-briefing-detail.
});

it("renders no combined score and no scoring controls", async () => {
  // Fit and Want are not user-weightable. A weighting slider here would smuggle in the blended
  // number the whole design forbids.
});
```

- [ ] **Step 6: Fail, implement, pass**

The briefing detail level feeds `buildBriefingContribution({… detail})` in Task 16. Store it on the
profile row as `briefing_detail text not null default 'count'` with a check constraint on the three
values (Task 4's schema) — **not** in module KV, so it exports and deletes with the rest of the
profile, and so a stale KV value can never disagree with a deleted profile. Task 16 adds the
`job-search.profile.set-briefing-detail` tool that writes it.

- [ ] **Step 7: Run the full frontend gate and commit**

```bash
pnpm check:design-tokens && pnpm check:file-size && pnpm check:external-modules
git add external-modules/job-search/src/web tests/unit/job-search-web-board.test.tsx \
        tests/unit/job-search-web-settings.test.tsx
git commit -m "feat(job-search): add match board, inspector, settings, and degraded portal states"
```

---

## Phase 6 — Verification

### Task 21: Integration tests

These run against a real Postgres with RLS on. Everything up to here was a unit test against a fake
store, which means everything up to here proved the module's _logic_ and nothing about its
_isolation_. This task is where the security invariants are actually exercised.

**Files:**

- Create: `tests/integration/job-search.test.ts`

**Interfaces:**

- Consumes: the installed module (Task 3's manifest, Task 4's DDL), `JOB_SEARCH_TABLES` (Task 3),
  `JobSearchStore` (Task 13), the handlers from Tasks 15 and 16.

- [ ] **Step 1: Write the harness**

**This file does both tiers, in two `describe` blocks over one install.** Tier A is DB-level RLS
with no worker process; tier B drives the real gateway and a live worker child process. Keeping
them in one file is only defensible because the install is the expensive part and both tiers need
the same one — but tier A must never depend on the worker being up, so a broken worker fails tier B
alone and the security assertions still run.

Read these first and copy their setup rather than inventing one:
`tests/integration/external-module-gateway.test.ts`, `tests/integration/module-install.test.ts`,
`tests/integration/module-worker-queue-ai.test.ts`, `tests/integration/module-worker-rpc.test.ts`,
`tests/integration/external-module-finance.test.ts`.

Setup order, and every step is load-bearing:

1. **Build the module package** — the same build the release path runs, not a hand-assembled
   directory.
2. **Place it in the discovery directory** the installer scans.
3. **Install it.**
4. **Enable it.** An installed-but-disabled module is silently skipped.
5. **Assert `manifest_hash` and `package_hash` match what was installed.** This is the step that
   gets left out. `apps/worker/src/external-module-job-handler.ts:52` gates on the enabled flag and
   these hashes and **returns silently** when they do not match — no throw, no log line worth
   reading. A harness that skips this assertion produces a green suite that invoked nothing at all,
   which is strictly worse than a red one.
6. **Start the worker runtime** with injected AI and fetch providers.
7. **Tear down** the child processes and every row this file created.

Two owners and one admin, created once for the file. Every read goes through
`createAppRuntimeRunner().withDataContext({actorUserId})` — the migration-owner role is
`NOBYPASSRLS`, so a raw query against a FORCE-RLS table silently returns zero rows and every
assertion passes for the wrong reason.

```ts
// tests/integration/job-search.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Imported, never retyped. The previous draft of this file listed
// `job_search_portal_state`, which the migration does not create.
import { JOB_SEARCH_TABLES } from "../../external-modules/job-search/src/db/tables";

// test:uat-seed runs sequentially against ONE shared, non-reset database, so durable rows leak
// into whichever file runs next. Everything this file creates is torn down in `finally`,
// including on a failing assertion.
afterAll(async () => {
  await cleanup();
});
```

- [ ] **Step 2: Write the failing tests — tier A, no worker process**

1. **The database's tables are exactly the canonical list.** Query
   `information_schema.tables` for `app.job_search_%` and assert the set equals
   `JOB_SEARCH_TABLES`. Without this, a table added in a later migration and forgotten here is
   never checked for RLS by anything, and the omission is invisible.
2. **Cross-owner isolation, both directions, on every table.** Loop `JOB_SEARCH_TABLES`; for each,
   insert as owner A and assert owner B reads zero rows, then the reverse. Asserting one direction
   only is how a policy that is accidentally `USING (true)` on `SELECT` but correct on `INSERT`
   survives.
3. **An admin actor sees nothing.** Same loop, admin context. Admin power is configuration power;
   there is no private-data bypass anywhere, and this is the assertion that says so.
4. **Every owned table actually has a policy.** Query `pg_policies` for each and assert a row
   exists. `installModule()` Phase B generates RLS from `manifest.database.ownedTables`, so a table
   missing from that array gets a table with **no policy at all** — which fails open. Test 2 would
   still pass if the row simply were not there, so this check is not redundant with it.

```ts
it("has RLS enabled and a policy on every owned table", async () => {
  for (const table of JOB_SEARCH_TABLES) {
    const policies = await asMigrationOwner((db) =>
      db.selectFrom("pg_policies").selectAll().where("tablename", "=", table).execute()
    );
    expect(policies.length, `${table} has no RLS policy`).toBeGreaterThan(0);
  }
});
```

5. **The stored embedding has the dimension the port reports.** Assert
   `vector_dims(embedding) === await ctx.embed.dimensions()` for a stored posting. A 768-column
   holding a 384-vector does not error on insert in every path, and the symptom downstream is
   "triage returns nonsense", which is very expensive to trace back to here.

- [ ] **Step 3: Write the failing tests — tier B, real gateway and a live worker**

6. **The queue payload carries metadata only.** Enqueue through the real path, read the row back out
   of pg-boss, and assert the serialized JSON against a whitelist rather than spot-checking absences:

```ts
it("puts nothing but ids in the job payload", async () => {
  await enqueueCrawl({ actorUserId: ownerA, profileId });
  const job = await readLatestJob("job-search.crawl-run");
  // `manifestHash` is REQUIRED by the payload contract (`packages/jobs/src/module-jobs.ts:7`,
  // validated at `:75` as `sha256:` + 64 hex, populated by the reconciler at
  // `job-reconciler.ts:137`). It is metadata — a content anchor for the trust gate — not
  // forbidden content, and a whitelist that omits it fails against a correct implementation.
  expect(Object.keys(job.data).sort()).toEqual(
    ["actorUserId", "jobKind", "manifestHash", "moduleId", "params"].sort()
  );
  // And it must be THIS install's hash, not any well-formed digest: the job handler compares it
  // and returns silently on a mismatch, so a stale hash is a module that never runs.
  expect(job.data.manifestHash).toBe(installed.manifestHash);
  expect(job.data.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(Object.keys(job.data.params)).toEqual(["profileId"]);
  // Belt: a whitelist catches a new key, this catches a key whose VALUE grew a body.
  const serialized = JSON.stringify(job.data);
  expect(serialized).not.toContain(RESUME_MARKER);
  expect(serialized).not.toContain(POSTING_BODY_MARKER);
  expect(serialized.length).toBeLessThan(512);
});
```

7. **The manual-run route is the enqueue path, and it works.** `POST
/api/modules/job-search/queues/job-search.crawl-run/run` via `app.inject`, asserting a job
   appears. This is the only production enqueue path that exists — the board's "Search now" button
   calls it — so if `allowManualRun` is missing from the manifest, nothing in the module can ever
   start a crawl and no unit test would notice.
8. **The schedule resolves to the sweep queue.** Read the reconciled schedule rows and assert the
   `job-search.crawl-sweep` schedule is bound to the `job-search.crawl-sweep` **queue**. Note what
   this does and does not protect against: `validateWorker` (`validate.ts:176`) already rejects an
   install whose schedule names an undeclared queue, so this is not a typo net. What it verifies is
   that the binding survives **normalization and install** — the reconciler's
   `queueByName.get(schedule.queue)` miss is silent (`job-reconciler.ts:127`), so if normalization
   ever renames or reshapes a queue the module simply never runs on its own and nothing says so.
9. **A tool call survives the host's `actorUserId` envelope.** Invoke each of the eight Task 16
   tools through the real gateway, not by calling the handler directly. The host spreads
   `actorUserId` onto every external tool input, last, and a strict `additionalProperties: false`
   validator that does not strip it rejects **every call the module will ever receive**. Calling the
   handler directly in a unit test never sees this.
10. **A partial crawl persists both halves.** One portal succeeds, one returns `rate_limited`;
    assert the postings landed _and_ that `job_search_portals` holds the structured cause with its
    `lastOkAt` intact. A failure that erases the last-known-good timestamp destroys the only signal
    that tells the user how long a board has been down.
11. **The briefing contribution round-trips.** Feed `contributeToBriefing` output through
    `collectBriefingContributions` (Task 2) and assert it is accepted and rendered. Also assert the
    `count` / `top` / `full` levels produce three different lengths — if they do not, Task 4's
    `briefing_detail` column is being read but not used.
12. **No response, at any level, contains a blended score.** Walk every object returned in this file
    and assert no key matches `/^(score|overall|match|rank)$/i` and no string matches
    `/\b\d{1,3}%\s*(match|overall|fit and want)\b/i`. Two axes, never one number — enforced at the
    boundary as well as in the schema.

- [ ] **Step 4: Run and watch them fail**

```bash
pnpm test:integration tests/integration/job-search.test.ts; echo "EXIT=$?"
```

Expected: FAIL. Note that `pnpm test:integration <file>` **does not actually narrow the run** — the
script passes a directory — so expect the whole integration suite. Read to the end rather than
trusting the last screen, and never pipe to `tail`: it masks the exit code.

- [ ] **Step 5: Fix what they catch, then run green**

```bash
pnpm test:integration tests/integration/job-search.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add tests/integration/job-search.test.ts
git commit -m "test(job-search): add RLS, payload, and envelope integration tests"
```

---

### Task 22: End-to-end test on a real dev instance

**Required, not optional.** Every UI/UX feature ships with a Playwright test against a real dev
instance. The unit tests prove the parts and Task 21 proves the isolation; neither one can tell you
that the board renders, that the chat is scoped to the right thread, or that a degraded portal says
anything useful on screen.

**Files:**

- Create: `tests/e2e/job-search.spec.ts`
- Create: `tests/e2e/fixtures/job-search-portal-server.ts` — the fixture HTTP server
- Modify: `apps/worker/src/external-module-job-handler.ts` — the **host-side** test-only
  `createFetch` injection (generic: it applies to every module, not to this one)
- Create: `tests/unit/external-module-test-fetch-seam.test.ts` — proves the seam is inert unless
  explicitly turned on

Note what is **not** in this list: nothing under `external-modules/job-search/src`. The module's
code is identical in the e2e run and in production, which is the entire point of the ruling below.

**Interfaces:**

- Consumes: the installed module on a running dev instance; the instance's existing test-provider
  seam for the model; Task 11's saved HTML/JSON fixtures.

- [ ] **Step 1: Stand up deterministic sources**

The test must not touch LinkedIn or freehire. A live portal makes this test fail on someone else's
Cloudflare rule at 3am, which trains everyone to ignore it.

**A local fixture origin cannot be reached through `ctx.fetch`, and no amount of allowlisting
changes that.** `packages/host-fetch/src/policy.ts` rejects it on four independent grounds, any one
of which is fatal: `validateUrl` requires `https:`; it requires the port to be empty or `443`;
`isPinnableHost` rejects IPv4 literals and any hostname containing `:`; and resolved addresses go
through `isBlocked`, which rejects loopback and private ranges outright. Adding the fixture to the
manifest's `fetchHosts` does nothing — the allowlist is checked _before_ the pinning policy, not
instead of it.

**Playwright route interception is also not an option.** The crawl requests originate in a **worker
child process**, not the browser, so `page.route` never sees them.

**A module-side seam is also not an option, and this is the correction to an earlier ruling in this
plan.** A worker child process receives an environment of exactly three keys — `LANG`, `LC_ALL`,
`TZ` (`packages/module-registry/src/external/worker-runtime.ts:120`). Any `process.env.JOB_SEARCH_*`
read inside module code is `undefined` in every environment, test included, so a module-side branch
behind an env var is not a seam at all; it is dead code that would have failed on first run. Worse,
a module-side bypass means the code path under test is not the code path that ships.

**Ruling: inject `createFetch` at the host, in the worker app.** The seam already exists —
`createExternalModuleRpcHandler` takes an optional `createFetch` (`worker-rpc-host.ts:99`) and uses
it at the one place the pinned fetch is constructed (`:134`). Nothing new is invented; the worker
app simply supplies it under a test-only env var **in its own process**, where env vars are
ordinary:

```ts
// apps/worker/src/external-module-job-handler.ts, at the existing createExternalModuleRpcHandler
// call (:67). Generic by construction: it is keyed on nothing about job-search, so any module's
// e2e can use it.
//
// Gated POSITIVELY, on two conditions that must both be true. An earlier revision of this plan
// wrote `process.env.NODE_ENV !== "production"`, which is fail-OPEN: `NODE_ENV` is unset in a
// plain `node dist/index.js`, in a container that forgot to set it, and in most systemd units,
// and `undefined !== "production"` is true. A bypass whose guard defaults to "on" is not a guard.
//
// `JARVIS_RUNTIME_MODE` is net-new — nothing in the tree reads it today. It is set to `e2e` by
// the e2e harness and by nothing else; every other deployment leaves it unset, and unset never
// opens the seam. `createHostPinnedFetch` stays the default, so deleting this block changes
// nothing but the e2e.
const E2E_MODE = process.env.JARVIS_RUNTIME_MODE === "e2e";
const fixtureBase = process.env.JARVIS_E2E_MODULE_FETCH_BASE;

// Fail LOUD rather than fail quiet. If the fixture variable is present without the mode, the
// deployment is misconfigured in a way that a silent `undefined` would hide until someone
// wondered why the e2e stopped exercising the fixture — or, in the other direction, until a
// leaked variable went unnoticed in production. Refuse to boot.
if (fixtureBase && !E2E_MODE) {
  throw new Error(
    'JARVIS_E2E_MODULE_FETCH_BASE is set but JARVIS_RUNTIME_MODE is not "e2e". ' +
      "This variable enables a host-fetch bypass and must never be set outside the e2e harness."
  );
}

const testFetchBase = E2E_MODE ? fixtureBase : undefined;

const rpc = createExternalModuleRpcHandler({
  /* …unchanged… */
  ...(testFetchBase ? { createFetch: createE2eFixtureFetch(testFetchBase) } : {})
});
```

Add `JARVIS_RUNTIME_MODE=e2e` to the e2e harness's worker environment alongside
`JARVIS_E2E_MODULE_FETCH_BASE`, in the same place the harness already sets the worker's database
variables. Set neither anywhere else — not in `docker-compose`, not in `.env.example`, not in any
dev script. A variable that appears in a checked-in example file is a variable someone will copy.

`createE2eFixtureFetch(base)` keeps the allowlist meaningful rather than discarding it: it receives
the module's declared `fetchHosts` exactly as `createHostPinnedFetch` does, **rejects any request
whose host is not in that list**, and only then rewrites the origin to the fixture base. Otherwise
turning the var on would silently disable the one check the manifest's `fetchHosts` exists to make.

The module keeps calling `ctx.fetch`. The RPC crosses the real process boundary, the real
`fetch.request` method runs, and the real allowlist is enforced — the only substitution is which
socket the host opens at the very end. **The module's shipped bytes are byte-identical between the
e2e and production**, which is strictly stronger than the packaging test the previous ruling needed
to prove the same claim.

The alternative — driving the e2e against recorded stage inputs and skipping the crawl entirely —
stays rejected: it would leave the degraded-portal strip, the posting counts, and the "Search now"
button all rendering from hand-seeded rows, which is precisely the wiring this test exists to prove.

The fixture server binds `127.0.0.1` on an **ephemeral** port and serves Task 11's byte-for-byte
captures. The port reaches the worker app through `JARVIS_E2E_MODULE_FETCH_BASE`, so no
`http://127.0.0.1:PORT` literal appears anywhere in the spec or its assertions — the assertions name
the portal's real hostname, which is what the module thinks it is talking to.

- [ ] **Step 2: Prove the seam cannot be reached by accident**

`tests/unit/external-module-test-fetch-seam.test.ts`. "Test-only" is a claim until something checks
it, and the check has to cover the **default** environment, not just the production one — the
previous guard's whole defect was that it passed a `NODE_ENV=production` test while being wide open
with `NODE_ENV` unset. Restore `process.env` in `afterEach` so these cases cannot leak into each
other.

- With `JARVIS_E2E_MODULE_FETCH_BASE` unset, the handler is constructed **without** a `createFetch`
  key at all — assert on the argument object, not on behaviour, so the test fails if someone passes
  `createFetch: undefined` and relies on the `??` further down.
- With the fixture var set and `JARVIS_RUNTIME_MODE` **unset**, construction **throws**, and the
  message names the variable. Run this same case four times over `NODE_ENV` ∈ {unset,
  `"development"`, `"test"`, `"production"`} and assert the outcome is identical in all four:
  `NODE_ENV` must have no influence on this decision at all. Under the old guard three of those
  four silently enabled the bypass.
- With both vars set (`JARVIS_RUNTIME_MODE=e2e`), `createFetch` **is** passed — otherwise the guard
  is untestably strict and the e2e would fail with no explanation.
- `createE2eFixtureFetch(base)(["www.linkedin.com"])` rejects a request to a host outside the
  allowlist and rewrites one inside it. A fixture fetch that answers everything is a fixture fetch
  that would let the module reach anywhere.

No packaging test is needed any more, and the build-config `define` from the previous ruling is
deleted: there is nothing in the module bundle to eliminate.

- [ ] **Step 3: Write the spec**

**The required path is ONE test.** Steps 2–11 below each depend on state the previous step created —
an installed module, a profile, criteria, crawl results, a notification, a scoped conversation.
Playwright tests are isolated and may run in parallel, and nothing here declares serial mode, so
splitting them into eleven `test` blocks produces eleven tests that pass or fail depending on
execution order and on leftovers in a shared backend. That is not a flaky test; it is a test that
proves nothing either way.

One long test is the honest shape for one long journey. It costs a worse failure message — the
mitigation is `test.step`, which names the failing phase in the report — and it buys an assertion
set that means what it says.

The only alternative that also works is giving **every** test an independent API fixture that
installs the module and seeds exactly its own prerequisites through the REST API before touching the
page. If a later change needs that, take it wholesale; do not take it for some cases and leave the
others depending on order.

```ts
// tests/e2e/job-search.spec.ts
import { expect, test } from "@playwright/test";

test.describe("job search", () => {
  // One journey, one test. Phases are `test.step`s so a failure names the phase.
  test("installs, onboards, crawls, scores, and scopes its chat", async ({ page }) => {
    await signIn(page);
    // A seeded owner lands on onboarding: Skip setup → Skip anyway.
    await skipOnboarding(page);

    await test.step("install and open", async () => {
      /* … */
    });
    await test.step("empty install offers exactly one way forward", async () => {
      /* … */
    });
    // …one step per numbered item below…
  });
});
```

The path, one `test.step` each:

1. **Install and open.** Install the module from the modules screen, open it from the nav.
2. **An empty install offers exactly one way forward.** Assert the bootstrap panel renders, that
   pressing its primary action puts an **unsent, editable draft** in the assistant composer, and
   that no profile exists until the user sends it. This is the consent boundary from Task 18, and it
   is the one step of the whole flow that a user cannot route around.
3. **A new profile shows chat and no table.** Assert the onboarding chat is visible and
   `getByRole("table")` is **not** — the ruling is that onboarding is chat-only, and a table
   appearing early is the specific regression.
4. **Criteria fill the progress chips from the record.** Drive the conversation through the stubbed
   provider until criteria are set; assert each chip's state. The chips must reflect stored fields,
   so also assert the chip state survives a full page reload — that is what distinguishes a record
   from model prose held in component state.
5. **The first crawl is actually enqueued, and it finishes.** The step every earlier revision of
   this plan skipped, and the one that would have caught the gap: nothing on the worker side can
   enqueue, so if the browser does not call `runQueue` the board sits empty forever and steps 6–10
   fail for a reason none of them names. Assert the surface issues
   `POST /api/modules/job-search/queues/job-search.crawl-run/run` with body
   `{jobKind: "crawl.run", params: {profileId}}` — observe it at the network layer with
   `page.waitForRequest`, so this passes only if the real route is called with the real body — then
   wait for the pass to land (poll the board for a non-empty match list, with a timeout that fails
   with "crawl never produced matches", not a bare locator timeout). Also press **"Search now"** and
   assert a second run is accepted or reported as already queued; both are correct outcomes and
   neither is an error.
6. **The board replaces the chat once the profile is active.** Assert the table appears and the
   onboarding chat is gone.
7. **Both axes are separate columns.** Assert a `Fit` column and a `Want` column exist, and assert
   no cell in the row matches `/^\d{1,3}%\s*match$/`. This is the one product invariant that has to
   hold on screen, not just in the schema.
8. **A degraded portal states the whole cause.** Assert the strip names the portal, the kind of
   failure, what was retrieved before it stopped, when it last worked, and what happens next — five
   assertions, not one on the word "failed". "Job search failed" tells the user nothing.
9. **An unscored row explains itself.** Assert it renders `—` in both axes plus a reason, rather
   than a zero. A zero is a judgement; this is the absence of one.
10. **A recall posting is visibly flagged.** Assert an `outside_frame` row carries its flag, so the
    user can tell a deliberate stretch from a bad match.
11. **The core header chat carries the profile's thread — and only there.** Open the drawer inside
    the profile, assert the job-search turns are present; navigate out, open it again, assert they
    are **absent** from the main transcript.
12. **The nav badge shows the new-match count, and reading the notification clears it.** Task 2d
    defines the badge as the module's **unread notification count**, so that is what the test
    drives: assert the badge appears after a pass produces matches, mark the module's notification
    read through the existing notifications UI, and assert `unreadByModule` for the module drops to
    zero and the badge disappears.

    Do **not** assert that dismissing or acknowledging the matches clears the badge. Nothing marks
    those notifications read, so the assertion would be testing undefined behaviour. If the product
    later wants the board to clear it, that is a core change with its own step in Task 2d — a
    repository method that marks one module's unread notifications read, a route for it, and a call
    from the board — not something to smuggle in through an e2e expectation.

Item 11 is the one that proves the drawer-scoping ruling holds. It is the most likely thing to
regress and the least likely to be caught by anything else in this plan, because both transcripts
are correct in isolation — only the boundary between them is wrong.

Two harness notes that cost an afternoon each if you rediscover them: `getByLabel`
substring-matches, so use `{ exact: true }`; and on failure the DOM snapshot is in
`error-context.md`, which is far more useful than the stack trace.

- [ ] **Step 4: Run against a real instance**

```bash
pnpm dev:instance up            # a real instance, not the shared dev DB
# The fixture server prints its ephemeral base; the WORKER app needs it in its environment, not
# the browser and not the module child.
JARVIS_E2E_MODULE_FETCH_BASE="$FIXTURE_BASE" pnpm test:e2e tests/e2e/job-search.spec.ts; echo "EXIT=$?"
```

Expected: `EXIT=0`. If the module's tools 400 on every call, check that the dev instance has a
model configured for the module — an unconfigured instance returns `needs_config` from
`ai.generateStructured`, which surfaces as a stuck onboarding rather than an error.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/job-search.spec.ts tests/e2e/fixtures/job-search-portal-server.ts \
        tests/unit/external-module-test-fetch-seam.test.ts \
        apps/worker/src/external-module-job-handler.ts
git commit -m "test(job-search): add the end-to-end UI pass on a real dev instance"
```

---

### Task 23: Full gate, prototype capture, and release notes

- [ ] **Step 1: Run the full gate with a real exit code**

```bash
pnpm verify:foundation; echo "EXIT=$?"
```

Never pipe it to `tail` — a background command ending in `tail` reports exit 0 for a failing gate.
Drop and recreate the gate DB first: the gate's own `uat-seed` leaves durable rows that fail the
next run.

- [ ] **Step 2: Capture the prototype as a primary source**

```bash
git checkout -b prototype/job-search-ui
git add apps/web/src/job-search-prototype
git commit -m "chore: capture throwaway job search UI prototype"
git push -u origin prototype/job-search-ui
git checkout -
```

Then delete `apps/web/src/job-search-prototype/` and the DEV-guarded interception block in
`apps/web/src/main.tsx` from the working branch, and leave a pointer to the branch on the
implementation issue along with the verdict it settled.

- [ ] **Step 3: Update the module registry and docs**

Add `job-search` to `scripts/publish-module-registry.ts`'s inputs so the module is publishable.
Note in the PR body which of the three spec §10 core changes shipped and which deferred.

- [ ] **Step 4: Write the user-facing summary**

Every commit and PR needs one in release-note language:

> **Job Search.** Jarvis can now run job searches for you. Describe what you are looking for in a
> conversation, and it crawls public job boards on a schedule and reads every posting against two
> questions: could you do this job, and would you still want it a year in. Those two answers stay
> separate — there is no single "match score" — and each comes with the reasoning behind it. New
> matches show up as a notification, a badge, and a line in your briefing. When a board rate-limits
> us or asks for a login, it says exactly what happened and what it will do next.

---

## Self-Review

**Spec coverage.** Every numbered spec section maps to a task: §2 two axes → Tasks 9, 20;
§3.1 crawler → 11, 12, 14; §3.2 no paywalls → 11 (`statusToKind`), 12 (LinkedIn interstitial);
§3.3 résumé → 4, 16; §3.4 open conversation → 17; §3.5 profiles → 4, 16; §3.6 render from records
→ 10, 19, 20; §3.7 structured failures → 5, 11, 20; §3.8 recall → 8; §3.9 module owns everything →
Phase 0 confined to two additive core files. §5 architecture → 3, 4, 13. §6 surfacing → 15.
§7 UI → 18–20. §8 thread scoping → 17, 22 step 7. §9 résumé → 16. §10 core changes → 1, 2, and the
flagged deferral. §11 security → 13, 21. §12 testing → 21, 22.

**Known gaps, stated rather than hidden:**

- **§10.1 dynamic fetch hosts is deferred**, so "add your own job portal" does not ship in v1.
  Flagged at the top for Ben's decision; if he wants it, this plan gains a Phase 0 task.
- **Chat thread plumbing is assumed, not built.** Tasks 17 and 22 assume the core chat drawer can
  already carry a module-scoped thread. If it cannot, that is a fourth core change and a
  prerequisite task — **the implementer must verify this before starting Phase 5** by reading the
  drawer's thread resolution, and stop and report if the seam does not exist.
- Sports and news are not migrated onto the Task 2 briefing seam. Separate cleanup, separate issue.

**Type consistency.** `FailureCause`, `SearchCriteria`, `Posting`, `Match`, `PortalState`,
`JobSearchStore`, `Portal`, `CrawlResult`, `ScoreResult`, `TriageInput`/`TriageResult`, and
`BriefingContribution` are each defined once — in Task 5, 11, 13, 9, 8, or 2 respectively — and
referenced by name thereafter. `completedSteps`, `isReadyToCrawl`, `parseScoreResult`,
`applyHardExcludes`, `dedupePostings`, `postingIdentity`, `triage`, `describeFailure`,
`stripEnvelope`, `runCrawl`, `runScore`, and `contributeToBriefing` keep the same names in every
task that mentions them.
