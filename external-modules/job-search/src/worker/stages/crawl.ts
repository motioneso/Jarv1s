// external-modules/job-search/src/worker/stages/crawl.ts
//
// Task 14 (#1298): the crawl stage. A function, not a handler — nothing here appears in the
// manifest. `ModuleWorkerContext` has no jobs port, so crawl and score cannot be two queued
// steps handing off to each other; Task 15 composes this and the score stage inside one
// invocation. `stages/` (not `handlers/`) is load-bearing: a file in `handlers/` is something
// the manifest names, and this is not.
//
// Depends on: Task 5 (`FailureCause`, `describeFailure`), Task 6 (`applyHardExcludes`),
// Task 7 (`dedupePostings`), Task 11 (`Portal`, `FetchLike`), Task 13 (`JobSearchStore`).
import {
  describeFailure,
  type FailureCause,
  type Posting,
  type PortalState
} from "../../domain/records.js";
import type { JobSearchStore } from "../../domain/store-port.js";
import { dedupePostings } from "../../domain/dedupe.js";
import { applyHardExcludes } from "../../domain/excludes.js";
import type { FetchLike, Portal } from "../../adapters/types.js";

// Task 6's dedupe trusts a ranked source over an unranked one, and freehire is the widest
// source (~50 ATS boards behind one host) so it is trusted first. A future portal added here
// without a ranking falls through `dedupePostings`'s own unranked-sorts-last rule rather than
// needing this list touched.
const SOURCE_PRIORITY: readonly string[] = ["freehire", "linkedin"];

// Task 1's `ctx.embed.embedDocuments` cap (packages/module-sdk/src/index.ts: EMBED_BATCH_MAX).
// Duplicated here rather than imported: this file has no SDK import by design (it is unit
// tested against a fake `EmbedPort`, never the real one), and the cap is a stable, published
// contract, not an implementation detail likely to drift silently out from under a copy.
const EMBED_BATCH_SIZE = 128;

/** The embedding dependency, structurally typed so the unit test passes a plain object.
 * These three names are Task 1's `ModuleEmbedPort` verbatim — `ctx.embed` satisfies this
 * without an adapter, and the document/query split must survive down to here because nomic
 * applies a different task prefix to each. */
export interface EmbedPort {
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  dimensions(): Promise<number>;
}

export interface CrawlSummary {
  found: number;
  kept: number;
  degraded: FailureCause[];
  /** True when the deadline cut the stage short. Task 15 turns this into a visible
   * "checked 1 of 2 boards" state rather than letting it look like a clean pass. */
  truncated: boolean;
}

// One representative string per posting for `embedDocuments`. Title and company carry most of
// the "is this even the right kind of role" signal that the triage stage's criteria similarity
// leans on; location and body round it out. No test pins this exact shape (only the ≤128
// batching and the embedQuery/embedDocuments split are contracted) — if scoring or triage later
// needs a different composition, change it here, in the one place a posting becomes text.
function embeddingTextFor(posting: Posting): string {
  return `${posting.title}\n${posting.company} — ${posting.location}\n\n${posting.body}`;
}

/** `store.upsertPostings` and `embed.embedDocuments` are called with parallel arrays; a
 * provider that returned a different vector count than texts it was given is a contract
 * violation, not something to paper over with a non-null assertion — that would silently drop
 * postings' embeddings instead of failing loudly on the exact call that broke the invariant. */
function zipPostingsAndVectorsOrThrow(
  postings: readonly Posting[],
  vectors: readonly number[][]
): Array<{ posting: Posting; vector: number[] }> {
  if (postings.length !== vectors.length) {
    throw new Error(
      `embedDocuments returned ${vectors.length} vectors for ${postings.length} texts`
    );
  }
  return postings.map((posting, index) => {
    const vector = vectors[index];
    if (vector === undefined) {
      throw new Error(`embedDocuments returned no vector at index ${index}`);
    }
    return { posting, vector };
  });
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
}): Promise<CrawlSummary> {
  const { store, portals, fetch, embed, profileId, now, deadlineAt, clock } = deps;

  const profile = await store.getProfile(profileId);
  if (profile === null) {
    // A precondition, not a runtime case Task 15 is expected to hit: the caller resolves the
    // profile before invoking this stage. Throwing loudly here beats silently crawling with no
    // criteria, which would look like a working crawl that happens to match nothing.
    throw new Error(`runCrawl: profile ${profileId} not found`);
  }

  const existingStates = await store.listPortals(profileId);
  const stateBySourceId = new Map(existingStates.map((state) => [state.sourceId, state]));

  // List enabled portals BEFORE walking: a portal already disabled from a previous crawl is
  // filtered out here, not left to refuse itself. A portal with no prior state at all (its
  // first-ever crawl) defaults to enabled.
  const enabledPortals = portals.filter(
    (portal) => stateBySourceId.get(portal.id)?.enabled !== false
  );

  const rawPostings: Posting[] = [];
  const degraded: FailureCause[] = [];
  let truncated = false;

  // Sequential, not `Promise.allSettled`: concurrency would start every portal in the same
  // tick, making the deadline check below unreachable (portal two is already in flight before
  // the clock is ever consulted), and would put every portal's full paging load on the wire at
  // once against one shared deadline. Isolation comes from the try/catch inside the loop, not
  // from a combinator — and it is cooperative only (N/A per Task 11: no `signal` exists to
  // preempt a portal that ignores its share or blocks inside one fetch).
  for (let index = 0; index < enabledPortals.length; index++) {
    const nowMs = clock();
    if (nowMs >= deadlineAt) {
      // The stage-level deadline is already gone: do not start this portal, and do not write
      // its state — it keeps whatever state it already had, unchanged.
      truncated = true;
      break;
    }

    const portal = enabledPortals[index];
    if (portal === undefined) {
      // Unreachable given the loop bound, but noUncheckedIndexedAccess cannot see that; a
      // thrown error here is a compiler-satisfying no-op in practice, never a silent skip.
      throw new Error(`runCrawl: no portal at index ${index}`);
    }

    const priorState = stateBySourceId.get(portal.id) ?? null;

    // Each portal gets an equal share of what is left, recomputed every iteration from a fresh
    // clock() read — not divided once up front, which would let portal one consume the whole
    // window and hand portal two a slice that has already expired. A portal that finishes early
    // donates its unused time to the ones after it.
    const remainingPortals = enabledPortals.length - index;
    const portalDeadline = Math.min(
      deadlineAt,
      nowMs + Math.floor((deadlineAt - nowMs) / remainingPortals)
    );

    try {
      const result = await portal.crawl({
        fetch,
        criteria: profile.criteria,
        lastOkAt: priorState?.lastOkAt ?? null,
        now,
        deadlineAt: portalDeadline
      });

      rawPostings.push(...result.postings);

      if (result.failure) {
        degraded.push(result.failure);
        if (result.failure.kind === "deadline") {
          truncated = true;
        }
        const nextState: PortalState = {
          sourceId: portal.id,
          // Every kind except login_required leaves the portal enabled and degraded (N16) —
          // `disabled` on the cause is the single source of truth for this, not a kind check
          // repeated here.
          enabled: !result.failure.disabled,
          // A failed crawl does not overwrite the last time it actually worked.
          lastOkAt: priorState?.lastOkAt ?? null,
          cause: result.failure
        };
        await store.setPortalState(profileId, nextState);
      } else {
        const nextState: PortalState = {
          sourceId: portal.id,
          enabled: true,
          lastOkAt: now,
          cause: null
        };
        await store.setPortalState(profileId, nextState);
      }
    } catch {
      // A rejected `crawl` promise (e.g. `ctx.fetch` throwing `invalid_rpc`) is a `network`
      // cause, never zero postings silently — reporting a thrown error as "no jobs matched"
      // is exactly the misleading-silence failure this module exists to prevent.
      const cause = describeFailure({
        kind: "network",
        sourceId: portal.id,
        sourceLabel: portal.label,
        retrieved: 0,
        expected: null,
        lastOkAt: priorState?.lastOkAt ?? null,
        retryAt: null
      });
      degraded.push(cause);
      const nextState: PortalState = {
        sourceId: portal.id,
        enabled: !cause.disabled,
        lastOkAt: priorState?.lastOkAt ?? null,
        cause
      };
      await store.setPortalState(profileId, nextState);
    }
  }

  const deduped = dedupePostings(rawPostings, SOURCE_PRIORITY);
  const { kept } = applyHardExcludes(deduped, profile.criteria);
  const stored = await store.upsertPostings(profileId, kept);

  for (let batchStart = 0; batchStart < stored.length; batchStart += EMBED_BATCH_SIZE) {
    const batch = stored.slice(batchStart, batchStart + EMBED_BATCH_SIZE);
    // embedDocuments, never embedQuery: the criteria/context embedding belongs to the triage
    // stage, and nomic applies a different task prefix to each — calling the wrong one here
    // would silently degrade retrieval rather than throw.
    const vectors = await embed.embedDocuments(batch.map(embeddingTextFor));
    for (const { posting, vector } of zipPostingsAndVectorsOrThrow(batch, vectors)) {
      await store.setEmbedding(posting.id, vector);
    }
  }

  return {
    found: rawPostings.length,
    kept: stored.length,
    degraded,
    truncated
  };
}
